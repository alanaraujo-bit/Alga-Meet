/** Saved music playlists, one person's own. Contract: packages/shared/src/music.ts (PlaylistCreateBody, PlaylistPatchBody). */
import { PLAYLISTS_MAX, PlaylistCreateBody, PlaylistPatchBody, uniqueVideoIds, uuidv7, type PlaylistItem, type SavedPlaylist } from '@alga/shared'
import { and, count, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { musicPlaylists, users, type MusicPlaylistRow } from '../db/schema.js'
import { idParam, invalid, notFound, parse } from '../errors.js'
import { perMinute } from './users.js'

export const playlistView = (r: MusicPlaylistRow): SavedPlaylist => ({
  id: r.id, name: r.name, items: r.items, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
})

export function playlistRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, music } = ctx

  /** Songs as YouTube has them (the server's own lookup, never a client's titles); unplayable ones left out. */
  async function resolve(videoIds: string[], known: PlaylistItem[] = []): Promise<PlaylistItem[]> {
    const ids = uniqueVideoIds(videoIds)
    const have = new Map(known.map((i) => [i.videoId, i]))
    const looked = new Map((await music.lookupMany(ids.filter((id) => !have.has(id)))).map((i) => [i.videoId, i]))
    const items = ids.flatMap((id) => have.get(id) ?? looked.get(id) ?? [])
    if (items.length === 0) throw invalid({ videoIds: 'Nenhuma dessas músicas toca fora do YouTube.' })
    return items
  }

  async function mine(userId: string, id: string): Promise<MusicPlaylistRow> {
    const [row] = await db.select().from(musicPlaylists).where(and(eq(musicPlaylists.id, idParam(id)), eq(musicPlaylists.ownerId, userId)))
    if (!row) throw notFound('Playlist não encontrada.')
    return row
  }

  app.get('/music/playlists', async (req): Promise<SavedPlaylist[]> => {
    const rows = await db.select().from(musicPlaylists).where(eq(musicPlaylists.ownerId, req.auth.user.id)).orderBy(desc(musicPlaylists.updatedAt))
    return rows.map(playlistView)
  })

  app.post('/music/playlists', { config: perMinute(20) }, async (req, reply) => {
    const me = req.auth.user.id
    const body = parse(PlaylistCreateBody, req.body)
    const items = await resolve(body.videoIds)
    const name = body.name ?? (body.listId ? await music.listName(body.listId).catch(() => null) : null) ?? 'Minha playlist'
    const row = await db.transaction(async (tx) => {
      // Row lock on me: two saves at once count one after the other.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, me)).for('update')
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(musicPlaylists).where(eq(musicPlaylists.ownerId, me))
      if (n >= PLAYLISTS_MAX) throw invalid({ name: `Você já tem ${PLAYLISTS_MAX} playlists. Apague uma para salvar outra.` })
      const [inserted] = await tx.insert(musicPlaylists).values({ id: uuidv7(), ownerId: me, name, items }).returning()
      return inserted!
    })
    return reply.code(201).send(playlistView(row))
  })

  app.patch<{ Params: { id: string } }>('/music/playlists/:id', { config: perMinute(60) }, async (req): Promise<SavedPlaylist> => {
    const row = await mine(req.auth.user.id, req.params.id)
    const body = parse(PlaylistPatchBody, req.body)
    const items = body.videoIds ? await resolve(body.videoIds, row.items) : undefined
    const [updated] = await db.update(musicPlaylists)
      .set({ ...(body.name !== undefined && { name: body.name }), ...(items && { items }), updatedAt: new Date() })
      .where(eq(musicPlaylists.id, row.id)).returning()
    return playlistView(updated!)
  })

  app.delete<{ Params: { id: string } }>('/music/playlists/:id', async (req, reply) => {
    const row = await mine(req.auth.user.id, req.params.id)
    await db.delete(musicPlaylists).where(eq(musicPlaylists.id, row.id))
    return reply.code(204).send()
  })
}
