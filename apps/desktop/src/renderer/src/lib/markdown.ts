/**
 * Minimal chat markdown → AST (rendered as React elements, never as HTML, so no markup injection).
 * Supported: ```code blocks```, `inline code`, **bold**, *italic* / _italic_, ~~strike~~,
 * [text](https://url), bare https?:// links, <@userId> mentions.
 * Links are only produced for http(s) URLs that parse; anything else stays plain text.
 */

export type MdNode =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: MdNode[] }
  | { t: 'code'; v: string }
  | { t: 'pre'; v: string; lang: string | null }
  | { t: 'link'; href: string; c: MdNode[] }
  | { t: 'mention'; id: string }

export const MAX_DEPTH = 4

/** Returns a normalized http(s) URL or null. Rejects javascript:, data:, file:, etc. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

// Bare URL: stop at whitespace / '<'; trailing punctuation is not part of the link.
const BARE_URL = /^https?:\/\/[^\s<]+[^\s<.,:;"'!?)\]}]/
const RULES: Array<{ re: RegExp; make: (m: RegExpExecArray, depth: number) => MdNode | null }> = [
  { re: /^`([^`\n]+)`/, make: (m) => ({ t: 'code', v: m[1]! }) },
  { re: /^<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/i, make: (m) => ({ t: 'mention', id: m[1]!.toLowerCase() }) },
  {
    re: /^\[([^\]\n]+)\]\((\S+?)\)/,
    make: (m, d) => {
      const href = safeUrl(m[2]!)
      return href ? { t: 'link', href, c: parseInline(m[1]!, d + 1) } : null
    },
  },
  {
    re: BARE_URL,
    make: (m) => {
      const href = safeUrl(m[0])
      return href ? { t: 'link', href, c: [{ t: 'text', v: m[0] }] } : null
    },
  },
  { re: /^\*\*(?=\S)([\s\S]+?)\*\*/, make: (m, d) => ({ t: 'strong', c: parseInline(m[1]!, d + 1) }) },
  { re: /^~~(?=\S)([\s\S]+?)~~/, make: (m, d) => ({ t: 'del', c: parseInline(m[1]!, d + 1) }) },
  { re: /^\*(?=[^\s*])([^*\n]+?)\*/, make: (m, d) => ({ t: 'em', c: parseInline(m[1]!, d + 1) }) },
  { re: /^_(?=[^\s_])([^_\n]+?)_(?![\p{L}\p{N}_])/u, make: (m, d) => ({ t: 'em', c: parseInline(m[1]!, d + 1) }) },
]
// Characters where a rule may start. Underscore only counts at a word boundary (snake_case stays text).
const TRIGGER = /[`<[h*~_]/

function pushText(out: MdNode[], v: string) {
  const last = out[out.length - 1]
  if (last?.t === 'text') last.v += v
  else out.push({ t: 'text', v })
}

export function parseInline(src: string, depth = 0): MdNode[] {
  const out: MdNode[] = []
  if (depth > MAX_DEPTH) {
    pushText(out, src)
    return out
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (TRIGGER.test(ch) && !(ch === '_' && i > 0 && /[\p{L}\p{N}_]/u.test(src[i - 1]!)) && !(ch === 'h' && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1]!))) {
      const rest = src.slice(i)
      let matched = false
      for (const r of RULES) {
        const m = r.re.exec(rest)
        if (!m) continue
        const node = r.make(m, depth)
        if (!node) continue
        out.push(node)
        i += m[0].length
        matched = true
        break
      }
      if (matched) continue
    }
    // Backslash escapes the next markdown character.
    if (ch === '\\' && i + 1 < src.length && /[`*_~[\]\\<]/.test(src[i + 1]!)) {
      pushText(out, src[i + 1]!)
      i += 2
      continue
    }
    pushText(out, ch)
    i++
  }
  return out
}

/** Block level: fenced code blocks, everything else inline (newlines kept; rendered with pre-wrap). */
export function parseMarkdown(src: string): MdNode[] {
  const out: MdNode[] = []
  const fence = /```([a-z0-9+#-]*)\n?([\s\S]*?)```/gi
  let last = 0
  for (let m = fence.exec(src); m; m = fence.exec(src)) {
    if (m.index > last) out.push(...parseInline(src.slice(last, m.index).replace(/\n$/, '')))
    out.push({ t: 'pre', v: m[2]!.replace(/\n$/, ''), lang: m[1] || null })
    last = fence.lastIndex
    if (src[last] === '\n') last++
  }
  if (last < src.length) out.push(...parseInline(src.slice(last)))
  return out
}

/** User ids mentioned in a message (to highlight messages that mention me). */
export function mentionedIds(src: string): string[] {
  return Array.from(src.matchAll(/<@([0-9a-f-]{36})>/gi), (m) => m[1]!.toLowerCase())
}

/** Plain-text preview (reply snippets, notifications): strips markup, resolves mentions. */
export function toPlainText(src: string, nameOf: (id: string) => string): string {
  const walk = (ns: MdNode[]): string =>
    ns
      .map((n) =>
        n.t === 'text' ? n.v
        : n.t === 'code' || n.t === 'pre' ? n.v
        : n.t === 'mention' ? `@${nameOf(n.id)}`
        : walk(n.c),
      )
      .join('')
  return walk(parseMarkdown(src)).replace(/\s+/g, ' ').trim()
}
