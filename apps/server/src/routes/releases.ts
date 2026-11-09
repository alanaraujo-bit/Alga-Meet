/**
 * Novidades (packages/shared/src/releases.ts). People read published notes and react to items; the team (staff
 * 'admin', through /admin, so every call lands in staff_audit_log) writes drafts, publishes and reads the totals.
 */
import {
  compareVersions, CreateReleaseBody, PutReleaseBody, ReleaseReactionBody, ReleaseVersion,
  type AdminReleaseNote, type ReleaseNote,
} from '@alga/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { releaseNotes, releaseReactions, type ReleaseNoteRow } from '../db/schema.js'
import { conflict, notFound, parse } from '../errors.js'
import { perMinute } from './users.js'

const versionParam = (v: string | undefined) => parse(ReleaseVersion, v)

export function releaseRoutes(app: FastifyInstance, { db }: Ctx): void {
  async function mineFor(userId: string, versions: string[]): Promise<Map<string, Record<string, 1 | -1>>> {
    const out = new Map<string, Record<string, 1 | -1>>()
    if (!versions.length) return out
    const rows = await db.select().from(releaseReactions).where(and(eq(releaseReactions.userId, userId), inArray(releaseReactions.version, versions)))
    for (const r of rows) {
      const m = out.get(r.version) ?? {}
      m[r.itemId] = r.value === 1 ? 1 : -1
      out.set(r.version, m)
    }
    return out
  }
  const view = (r: ReleaseNoteRow, mine: Record<string, 1 | -1> = {}): ReleaseNote => ({
    version: r.version, publishedAt: (r.publishedAt ?? r.updatedAt).toISOString(), content: r.content, mine,
  })

  /**
   * Published notes up to `upTo` (the installed version: nothing the app does not have yet), newest first.
   * shortcut: all published rows are read and filtered by semver in JS; fine for hundreds of versions, move the
   * comparison into SQL (a sortable version column) if it ever gets to thousands.
   */
  app.get('/releases', async (req): Promise<ReleaseNote[]> => {
    const q = parse(z.object({ upTo: ReleaseVersion, limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query)
    const rows = (await db.select().from(releaseNotes).where(eq(releaseNotes.status, 'published')))
      .filter((r) => compareVersions(r.version, q.upTo) <= 0)
      .sort((a, b) => compareVersions(b.version, a.version))
      .slice(0, q.limit)
    const mine = await mineFor(req.auth.user.id, rows.map((r) => r.version))
    return rows.map((r) => view(r, mine.get(r.version)))
  })

  /** One published note: the update notice asks for the version electron-updater has already downloaded. */
  app.get<{ Params: { version: string } }>('/releases/:version', async (req): Promise<ReleaseNote> => {
    const version = versionParam(req.params.version)
    const [r] = await db.select().from(releaseNotes).where(and(eq(releaseNotes.version, version), eq(releaseNotes.status, 'published')))
    if (!r) throw notFound('Ainda não há novidades para esta versão.')
    return view(r, (await mineFor(req.auth.user.id, [version])).get(version))
  })

  app.put<{ Params: { version: string; itemId: string } }>('/releases/:version/reactions/:itemId', { config: perMinute(60) }, async (req, reply) => {
    const version = versionParam(req.params.version)
    const { value } = parse(ReleaseReactionBody, req.body)
    const [r] = await db.select().from(releaseNotes).where(and(eq(releaseNotes.version, version), eq(releaseNotes.status, 'published')))
    if (!r || !r.content.items.some((i) => i.id === req.params.itemId)) throw notFound('Novidade não encontrada.')
    const key = and(eq(releaseReactions.version, version), eq(releaseReactions.itemId, req.params.itemId), eq(releaseReactions.userId, req.auth.user.id))
    if (value === 0) await db.delete(releaseReactions).where(key)
    else {
      await db.insert(releaseReactions).values({ version, itemId: req.params.itemId, userId: req.auth.user.id, value })
        .onConflictDoUpdate({ target: [releaseReactions.version, releaseReactions.itemId, releaseReactions.userId], set: { value, updatedAt: new Date() } })
    }
    return reply.code(204).send()
  })
}

/** Registered inside adminRoutes' scope: staff check and audit log come from its hooks. */
export function releaseAdminRoutes(app: FastifyInstance, { db }: Ctx): void {
  const admin = { staff: 'admin' as const }

  async function adminView(rows: ReleaseNoteRow[]): Promise<AdminReleaseNote[]> {
    const totals = await db.select({
      version: releaseReactions.version, itemId: releaseReactions.itemId,
      up: sql<number>`count(*) filter (where ${releaseReactions.value} = 1)`.mapWith(Number),
      down: sql<number>`count(*) filter (where ${releaseReactions.value} = -1)`.mapWith(Number),
    }).from(releaseReactions).groupBy(releaseReactions.version, releaseReactions.itemId)
    const people = await db.select({ version: releaseReactions.version, n: sql<number>`count(distinct ${releaseReactions.userId})`.mapWith(Number) })
      .from(releaseReactions).groupBy(releaseReactions.version)
    return rows.map((r) => ({
      version: r.version, status: r.status, content: r.content, revision: r.revision,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      stats: {
        people: people.find((p) => p.version === r.version)?.n ?? 0,
        items: Object.fromEntries(totals.filter((x) => x.version === r.version).map((x) => [x.itemId, { up: x.up, down: x.down }])),
      },
    }))
  }
  async function one(version: string): Promise<AdminReleaseNote> {
    const [r] = await db.select().from(releaseNotes).where(eq(releaseNotes.version, version))
    if (!r) throw notFound('Nota de versão não encontrada.')
    return (await adminView([r]))[0]!
  }

  app.get('/admin/releases', { config: admin }, async (): Promise<AdminReleaseNote[]> =>
    adminView((await db.select().from(releaseNotes)).sort((a, b) => compareVersions(b.version, a.version))))

  app.post('/admin/releases', { config: admin }, async (req, reply): Promise<AdminReleaseNote> => {
    const body = parse(CreateReleaseBody, req.body)
    const [r] = await db.insert(releaseNotes).values({ version: body.version, content: body.content, updatedBy: req.auth.user.id })
      .onConflictDoNothing().returning()
    if (!r) throw conflict('Já existe uma nota para esta versão.', { version: 'Já existe uma nota para esta versão.' })
    reply.code(201)
    return one(r.version)
  })

  /** Edits a draft or a published note (a typo fix goes live at once). `revision` guards against two editors. */
  app.put<{ Params: { version: string } }>('/admin/releases/:version', { config: admin }, async (req): Promise<AdminReleaseNote> => {
    const version = versionParam(req.params.version)
    const body = parse(PutReleaseBody, req.body)
    const [r] = await db.update(releaseNotes)
      .set({ content: body.content, revision: sql`${releaseNotes.revision} + 1`, updatedAt: new Date(), updatedBy: req.auth.user.id })
      .where(and(eq(releaseNotes.version, version), eq(releaseNotes.revision, body.revision))).returning({ version: releaseNotes.version })
    if (!r) {
      await one(version) // 404 when it does not exist
      throw conflict('Alguém salvou esta nota enquanto você editava. Recarregue para ver a versão atual.')
    }
    return one(version)
  })

  app.post<{ Params: { version: string; action: string } }>('/admin/releases/:version/:action', { config: admin }, async (req): Promise<AdminReleaseNote> => {
    const version = versionParam(req.params.version)
    const action = parse(z.enum(['publish', 'unpublish']), req.params.action)
    const now = new Date()
    const [r] = await db.update(releaseNotes).set(action === 'publish'
      ? { status: 'published', publishedAt: sql`coalesce(${releaseNotes.publishedAt}, now())`, updatedAt: now, updatedBy: req.auth.user.id }
      : { status: 'draft', updatedAt: now, updatedBy: req.auth.user.id })
      .where(eq(releaseNotes.version, version)).returning({ version: releaseNotes.version })
    if (!r) throw notFound('Nota de versão não encontrada.')
    return one(version)
  })

  /** Drafts only: a published note has history (reactions); unpublish it instead. */
  app.delete<{ Params: { version: string } }>('/admin/releases/:version', { config: admin }, async (req, reply) => {
    const version = versionParam(req.params.version)
    const [r] = await db.delete(releaseNotes).where(and(eq(releaseNotes.version, version), eq(releaseNotes.status, 'draft'), sql`${releaseNotes.publishedAt} is null`))
      .returning({ version: releaseNotes.version })
    if (!r) {
      await one(version)
      throw conflict('Só rascunhos que nunca foram publicados podem ser apagados. Despublique em vez disso.')
    }
    return reply.code(204).send()
  })
}
