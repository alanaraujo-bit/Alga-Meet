/**
 * Novidades (release notes) — one note per app version, written by the team in the in-app studio and read in the
 * welcome after an update and in the "Novidades" center. Structure (categories, media, highlight) is locale-neutral;
 * every string lives under `text[locale]`, pt-BR required, the others optional and falling back per field to pt-BR.
 * Feedback is one 👍/👎 per person per item (`release_reactions`), changeable; the team sees only the totals.
 */
import { z } from 'zod'

export const RELEASE_LOCALES = ['pt-BR', 'en', 'es'] as const
export type ReleaseLocale = (typeof RELEASE_LOCALES)[number]
export const DEFAULT_RELEASE_LOCALE: ReleaseLocale = 'pt-BR'

export const RELEASE_CATEGORIES = ['new', 'improved', 'fixed'] as const
export type ReleaseCategory = (typeof RELEASE_CATEGORIES)[number]

/** Same shape the installer and electron-updater use (apps/desktop/package.json "version"). */
export const RELEASE_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
export const ReleaseVersion = z.string().regex(RELEASE_VERSION_RE, 'Use o formato 1.2.3.')

/** -1 / 0 / 1 for a < b / a = b / a > b (numeric per part: 0.1.10 > 0.1.9). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

const httpsUrl = z.string().trim().max(2048).refine((u) => {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}, 'Use um endereço https://.')

/**
 * Image (PNG/JPEG/WebP/GIF) or short video (MP4/WebM, played muted). Hosted as an asset of the version's GitHub
 * Release (`gh release upload`) or any https host the team controls; loaded only when the card is on screen.
 */
export const ReleaseMedia = z.object({
  kind: z.enum(['image', 'video']),
  url: httpsUrl,
  /** Still frame for a video or a GIF: shown before it plays and instead of it under reduced motion. */
  poster: httpsUrl.optional(),
})
export type ReleaseMedia = z.infer<typeof ReleaseMedia>

export const RELEASE_ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
export const ReleaseItem = z.object({
  /** Stable across edits and locales: reactions are keyed by it. */
  id: z.string().regex(RELEASE_ITEM_ID_RE, 'Use letras minúsculas, números e hífens.'),
  category: z.enum(RELEASE_CATEGORIES),
  /** Shown in the welcome and as a big card in the center. */
  highlight: z.boolean(),
  media: ReleaseMedia.nullable(),
})
export type ReleaseItem = z.infer<typeof ReleaseItem>

export const ReleaseItemText = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(600),
  /** Describes the media for screen readers. */
  alt: z.string().trim().max(200).optional(),
})
export type ReleaseItemText = z.infer<typeof ReleaseItemText>

export const ReleaseText = z.object({
  /** The version's headline: "Assista junto, no mesmo frame". */
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(280),
  items: z.record(z.string(), ReleaseItemText),
})
export type ReleaseText = z.infer<typeof ReleaseText>

export const ReleaseContent = z.object({
  items: z.array(ReleaseItem).min(1).max(20),
  // One key per RELEASE_LOCALES entry (a new locale = a new optional key here).
  text: z.object({ 'pt-BR': ReleaseText, en: ReleaseText.optional(), es: ReleaseText.optional() }),
}).superRefine((c, ctx) => {
  const ids = new Set<string>()
  c.items.forEach((it, i) => {
    if (ids.has(it.id)) ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: 'Cada novidade precisa de um id diferente.' })
    ids.add(it.id)
    if (!c.text['pt-BR'].items[it.id]) ctx.addIssue({ code: 'custom', path: ['text', 'pt-BR', 'items', it.id], message: 'Falta o texto em português desta novidade.' })
  })
  for (const l of RELEASE_LOCALES) {
    for (const id of Object.keys(c.text[l]?.items ?? {})) {
      if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['text', l, 'items', id], message: 'Texto de uma novidade que não existe.' })
    }
  }
})
export type ReleaseContent = z.infer<typeof ReleaseContent>

/** GET /releases, GET /releases/:version: a published note as people see it. */
export interface ReleaseNote {
  version: string
  publishedAt: string
  content: ReleaseContent
  /** My current reaction per item id (absent = none). */
  mine: Record<string, 1 | -1>
}

export type ReleaseStatus = 'draft' | 'published'

/** GET /admin/releases: every note, drafts included, with the team-only totals. */
export interface AdminReleaseNote {
  version: string
  status: ReleaseStatus
  content: ReleaseContent
  /** Bumped by every save; PUT sends the one it edited (409 when someone saved in between). */
  revision: number
  createdAt: string
  updatedAt: string
  updatedBy: string | null
  publishedAt: string | null
  /** Totals only, never who. `people`: distinct accounts that reacted to anything in this version. */
  stats: { people: number; items: Record<string, { up: number; down: number }> }
}

export const CreateReleaseBody = z.object({ version: ReleaseVersion, content: ReleaseContent })
export type CreateReleaseBody = z.infer<typeof CreateReleaseBody>
export const PutReleaseBody = z.object({ content: ReleaseContent, revision: z.number().int().min(1) })
export type PutReleaseBody = z.infer<typeof PutReleaseBody>
/** PUT /releases/:version/reactions/:itemId — 0 removes mine. */
export const ReleaseReactionBody = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) })
export type ReleaseReactionBody = z.infer<typeof ReleaseReactionBody>

/** The locale to read, from a BCP 47 tag (navigator.language): exact, then by language, then pt-BR. */
export function releaseLocale(tag: string | undefined): ReleaseLocale {
  if (!tag) return DEFAULT_RELEASE_LOCALE
  const exact = RELEASE_LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase())
  if (exact) return exact
  const lang = tag.split('-')[0]!.toLowerCase()
  return RELEASE_LOCALES.find((l) => l.split('-')[0]!.toLowerCase() === lang) ?? DEFAULT_RELEASE_LOCALE
}

/** The strings of one note in `locale`, each field falling back to pt-BR (a translation may be partial). */
export function releaseText(content: ReleaseContent, locale: ReleaseLocale): ReleaseText {
  const base = content.text['pt-BR']
  const t = content.text[locale]
  if (!t || locale === DEFAULT_RELEASE_LOCALE) return base
  const items: Record<string, ReleaseItemText> = {}
  for (const it of content.items) {
    const b = base.items[it.id]!
    const x = t.items[it.id]
    items[it.id] = x ? { title: x.title || b.title, body: x.body || b.body, alt: x.alt || b.alt } : b
  }
  return { title: t.title || base.title, summary: t.summary || base.summary, items }
}

const CATEGORY_HEADING: Record<ReleaseCategory, string> = { new: 'Novidades', improved: 'Melhorias', fixed: 'Correções' }

/** The GitHub Release body for a note (`gh release create … --notes-file`): one source for the app and GitHub. */
export function releaseMarkdown(content: ReleaseContent): string {
  const t = content.text['pt-BR']
  const out = [`**${t.title}**`]
  if (t.summary) out.push('', t.summary)
  for (const cat of RELEASE_CATEGORIES) {
    const items = content.items.filter((i) => i.category === cat)
    if (!items.length) continue
    out.push('', `### ${CATEGORY_HEADING[cat]}`)
    for (const it of items) {
      const x = t.items[it.id]!
      out.push(`- **${x.title}**${x.body ? ` — ${x.body.replace(/\s*\n+\s*/g, ' ')}` : ''}`)
    }
  }
  return out.join('\n')
}
