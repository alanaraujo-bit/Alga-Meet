/** Soundboard: space sounds (CRUD + audio) and playing a sound in a voice call. Contract: packages/shared/src/soundboard.ts. */
import { readFile, rm } from 'node:fs/promises'
import {
  MAX_SOUND_BYTES, MAX_SOUNDS_PER_SPACE, Permission, SoundMetaBody, SoundboardPlayBody, algaSound, parseWav, uuidv7,
  type SpaceSound,
} from '@alga/shared'
import { and, asc, count, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireChannel, requireSpace, spaceMemberIds } from '../access.js'
import type { Ctx } from '../app.js'
import type { Db } from '../db/index.js'
import { spaceSounds, spaces, type SpaceSoundRow } from '../db/schema.js'
import { HttpError, badRequest, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { FILE_HEADERS, spool, type Spooled } from '../files.js'
import { SoundboardLimiter } from '../soundboard.js'
import { perMinute } from './users.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const soundView = (r: SpaceSoundRow): SpaceSound => ({
  id: r.id, spaceId: r.spaceId, name: r.name, emoji: r.emoji, durationMs: r.durationMs, createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
})

const soundKey = (spaceId: string, soundId: string) => `sounds/${spaceId}/${soundId}`

export async function listSounds(db: Db, spaceId: string): Promise<SpaceSound[]> {
  const rows = await db.select().from(spaceSounds).where(eq(spaceSounds.spaceId, spaceId)).orderBy(asc(spaceSounds.id))
  return rows.map(soundView)
}

export function soundRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, files, hub, voice } = ctx
  const limiter = new SoundboardLimiter()

  async function broadcast(spaceId: string): Promise<void> {
    hub.dispatch(await spaceMemberIds(db, spaceId), 'SPACE_SOUNDS_UPDATE', { spaceId, sounds: await listSounds(db, spaceId) })
  }

  async function findSound(spaceId: string, soundId: string): Promise<SpaceSoundRow> {
    const [row] = await db.select().from(spaceSounds).where(and(eq(spaceSounds.id, idParam(soundId)), eq(spaceSounds.spaceId, spaceId)))
    if (!row) throw notFound('Som não encontrado.')
    return row
  }

  /** `payload_json` (SoundMetaBody) + one `file` part spooled to a temp file (removed by the caller). */
  async function readUpload(req: FastifyRequest): Promise<{ meta: SoundMetaBody; file: Spooled }> {
    if (!req.isMultipart()) throw badRequest('Envie o som como multipart/form-data (campos "file" e "payload_json").')
    let payload: unknown
    let file: Spooled | undefined
    try {
      for await (const part of req.parts({ limits: { fileSize: MAX_SOUND_BYTES, files: 1, fields: 2, fieldSize: 4096 } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') { part.file.resume(); continue }
          file = await spool(part.file, part.filename, MAX_SOUND_BYTES)
        } else if (part.fieldname === 'payload_json') {
          try {
            payload = typeof part.value === 'string' ? JSON.parse(part.value) : part.value
          } catch {
            throw invalid({ payload_json: 'JSON inválido.' })
          }
        }
      }
      if (!file) throw invalid({ file: 'Envie um som.' })
      return { meta: parse(SoundMetaBody, payload), file }
    } catch (err) {
      if (file) await rm(file.path, { force: true })
      throw err
    }
  }

  app.get<{ Params: { id: string } }>('/spaces/:id/sounds', async (req): Promise<SpaceSound[]> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id)
    return listSounds(db, space.id)
  })

  app.post<{ Params: { id: string } }>('/spaces/:id/sounds', { config: perMinute(30) }, async (req, reply) => {
    const me = req.auth.user.id
    const { space } = await requireSpace(db, idParam(req.params.id), me, Permission.MANAGE_SOUNDBOARD)
    const { meta, file } = await readUpload(req)
    const id = uuidv7()
    const key = soundKey(space.id, id)
    let durationMs: number
    try {
      const wav = parseWav(await readFile(file.path))
      if (!wav.ok) throw invalid({ file: 'Use o editor do Alga Meet: o som precisa ser WAV mono de até 5 segundos.' })
      durationMs = wav.durationMs
      await files.store([{ key, path: file.path, size: file.size, sha256: file.sha256, contentType: 'audio/wav' }])
    } finally {
      await rm(file.path, { force: true })
    }
    try {
      const row = await db.transaction(async (tx) => {
        // Row lock on the space: concurrent uploads count one after the other.
        await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, space.id)).for('update')
        const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(spaceSounds).where(eq(spaceSounds.spaceId, space.id))
        if (n >= MAX_SOUNDS_PER_SPACE) {
          throw invalid({ file: `Este espaço já tem ${MAX_SOUNDS_PER_SPACE} sons. Apague um para adicionar outro.` })
        }
        const [inserted] = await tx.insert(spaceSounds).values({
          id, spaceId: space.id, name: meta.name, emoji: meta.emoji ?? null, storageKey: key, durationMs, createdBy: me,
        }).returning()
        await files.keep(tx, [key])
        return inserted!
      })
      await broadcast(space.id)
      return reply.code(201).send(soundView(row))
    } catch (err) {
      await files.abandon([key])
      throw err
    }
  })

  app.patch<{ Params: { id: string; soundId: string } }>('/spaces/:id/sounds/:soundId', async (req): Promise<SpaceSound> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_SOUNDBOARD)
    const sound = await findSound(space.id, req.params.soundId)
    const meta = parse(SoundMetaBody, req.body)
    const [row] = await db.update(spaceSounds)
      .set({ name: meta.name, ...(meta.emoji !== undefined ? { emoji: meta.emoji } : {}), updatedAt: new Date() })
      .where(eq(spaceSounds.id, sound.id)).returning()
    await broadcast(space.id)
    return soundView(row!)
  })

  app.delete<{ Params: { id: string; soundId: string } }>('/spaces/:id/sounds/:soundId', async (req, reply) => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_SOUNDBOARD)
    const sound = await findSound(space.id, req.params.soundId)
    await db.delete(spaceSounds).where(eq(spaceSounds.id, sound.id)) // the trigger queues the object
    files.kick()
    await broadcast(space.id)
    return reply.code(204).send()
  })

  app.get<{ Params: { id: string; soundId: string } }>('/spaces/:id/sounds/:soundId/audio',
    { config: perMinute(600) }, async (req, reply) => {
      const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id)
      const sound = await findSound(space.id, req.params.soundId)
      const body = await files.storage.get(sound.storageKey)
      if (!body) throw notFound('Som não encontrado.')
      // The id changes whenever the audio does (edits only touch name/emoji), so the bytes never change.
      return reply.headers({ ...FILE_HEADERS, 'content-type': 'audio/wav', 'cache-control': 'private, max-age=31536000, immutable' }).send(body)
    })

  app.post<{ Params: { id: string } }>('/channels/:id/soundboard/play', { config: perMinute(60) }, async (req, reply) => {
    const me = req.auth.user.id
    const { soundId } = parse(SoundboardPlayBody, req.body)
    const { channel } = await requireChannel(db, idParam(req.params.id), me, Permission.USE_SOUNDBOARD)
    if (!channel.spaceId || channel.type !== 'voice') throw notFound('O soundboard só existe nos canais de voz dos espaços.')
    const state = voice.stateOf(me)
    if (state?.channelId !== channel.id) throw forbidden('Entre na call para tocar sons.')
    if (state.serverMute) throw forbidden('Você foi silenciado neste espaço.')
    let durationMs: number
    if (soundId.startsWith('alga:')) {
      const sound = algaSound(soundId)
      if (!sound) throw notFound('Som não encontrado.')
      durationMs = sound.durationMs
    } else {
      if (!UUID_RE.test(soundId)) throw notFound('Som não encontrado.')
      durationMs = (await findSound(channel.spaceId, soundId)).durationMs
    }
    const verdict = limiter.tryPlay(me, channel.id, durationMs)
    if (!verdict.ok) {
      const message = verdict.reason === 'channel_busy'
        ? 'O canal está barulhento. Espere um instante.'
        : 'Calma aí — espere um instante para tocar de novo.'
      throw new HttpError('rate_limited', message, undefined, 429, { retryAfterMs: verdict.retryAfterMs, reason: verdict.reason })
    }
    hub.dispatch(voice.inChannel(channel.id).map((s) => s.userId), 'SOUNDBOARD_PLAY',
      { channelId: channel.id, soundId, userId: me, playId: uuidv7(), durationMs })
    return reply.code(204).send()
  })
}
