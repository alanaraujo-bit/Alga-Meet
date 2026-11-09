import { describe, expect, it } from 'vitest'
import { compareVersions, ReleaseContent, releaseLocale, releaseMarkdown, releaseText, type ReleaseContent as Content } from './releases.js'

const content = (over: Partial<Content> = {}): Content => ({
  items: [
    { id: 'cinema', category: 'new', highlight: true, media: { kind: 'video', url: 'https://example.com/a.mp4' } },
    { id: 'eco', category: 'fixed', highlight: false, media: null },
  ],
  text: {
    'pt-BR': { title: 'Assista junto', summary: 'Um resumo.', items: { cinema: { title: 'Sala de Cinema', body: 'Filme\njunto.' }, eco: { title: 'Eco', body: '' } } },
  },
  ...over,
})

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('0.1.9', '0.1.10')).toBe(-1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.1.15', '0.1.15')).toBe(0)
  })
})

describe('ReleaseContent', () => {
  it('accepts a valid note', () => expect(ReleaseContent.safeParse(content()).success).toBe(true))

  it('needs pt-BR text for every item, unique ids and https media', () => {
    const noText = content({ text: { 'pt-BR': { title: 'x', summary: '', items: { cinema: { title: 'a', body: '' } } } } })
    expect(ReleaseContent.safeParse(noText).success).toBe(false)
    const dup = content({ items: [content().items[0]!, { ...content().items[1]!, id: 'cinema' }] })
    expect(ReleaseContent.safeParse(dup).success).toBe(false)
    const http = content({ items: [{ ...content().items[0]!, media: { kind: 'image', url: 'http://example.com/a.png' } }, content().items[1]!] })
    expect(ReleaseContent.safeParse(http).success).toBe(false)
    const js = content({ items: [{ ...content().items[0]!, media: { kind: 'image', url: 'javascript:alert(1)' } }, content().items[1]!] })
    expect(ReleaseContent.safeParse(js).success).toBe(false)
  })

  it('refuses translations of items that do not exist', () => {
    const c = content()
    c.text.en = { title: 'Watch', summary: '', items: { ghost: { title: 'x', body: '' } } }
    expect(ReleaseContent.safeParse(c).success).toBe(false)
  })
})

describe('locale', () => {
  it('picks exact, then language, then pt-BR', () => {
    expect(releaseLocale('pt-BR')).toBe('pt-BR')
    expect(releaseLocale('pt-PT')).toBe('pt-BR')
    expect(releaseLocale('en-US')).toBe('en')
    expect(releaseLocale('es-AR')).toBe('es')
    expect(releaseLocale('ja')).toBe('pt-BR')
    expect(releaseLocale(undefined)).toBe('pt-BR')
  })

  it('falls back per field to pt-BR', () => {
    const c = content()
    c.text.en = { title: 'Watch together', summary: '', items: { cinema: { title: 'Cinema room', body: '' } } }
    const t = releaseText(c, 'en')
    expect(t.title).toBe('Watch together')
    expect(t.summary).toBe('Um resumo.')
    expect(t.items.cinema).toEqual({ title: 'Cinema room', body: 'Filme\njunto.', alt: undefined })
    expect(t.items.eco!.title).toBe('Eco')
  })
})

it('writes the GitHub body by category', () => {
  expect(releaseMarkdown(content())).toBe('**Assista junto**\n\nUm resumo.\n\n### Novidades\n- **Sala de Cinema** — Filme junto.\n\n### Correções\n- **Eco**')
})
