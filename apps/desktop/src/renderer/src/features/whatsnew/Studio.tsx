import {
  compareVersions, DEFAULT_RELEASE_LOCALE, RELEASE_CATEGORIES, RELEASE_LOCALES, ReleaseContent, releaseMarkdown, RELEASE_VERSION_RE,
  type AdminReleaseNote, type ReleaseCategory, type ReleaseContent as Content, type ReleaseItem, type ReleaseLocale, type ReleaseNote, type ReleaseText,
} from '@alga/shared'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { copyText, openExternal } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { Button, EmptyState, IconButton, Modal, SegmentedControl, Spinner, Switch, TextField, toast } from '@/ui'
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Eye, Plus, Trash2, X } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { NoteView } from './NoteView'
import { shortDate } from './parts'
import { closeCenter, previewWelcome } from './store'
import { st } from './studioStrings'
import s from './whatsnew.module.css'

const REPO = 'alanaraujo-bit/Alga-Meet' // electron-builder.yml publish.owner/repo

type Release = { state: 'checking' } | { state: 'found'; url: string; draft: boolean } | { state: 'missing' } | { state: 'unknown' }
/** Is there a GitHub Release for this version? (public API, no token; only a hint for the team, never a gate). */
const releases = new Map<string, Promise<Release>>()
function githubRelease(version: string): Promise<Release> {
  if (!releases.has(version)) {
    releases.set(version, fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, { headers: { accept: 'application/vnd.github+json' } })
      .then(async (r) => {
        if (r.status === 404) return { state: 'missing' } as const
        if (!r.ok) return { state: 'unknown' } as const
        const j = (await r.json()) as { html_url?: string; draft?: boolean }
        return { state: 'found', url: j.html_url ?? `https://github.com/${REPO}/releases/tag/v${version}`, draft: !!j.draft } as const
      })
      .catch(() => ({ state: 'unknown' }) as const))
  }
  return releases.get(version)!
}

const nextPatch = (v: string | undefined) => {
  if (!v) return window.alga?.config.version ?? '0.1.0'
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${(c ?? 0) + 1}`
}
const template = (version: string): Content => ({
  items: [{ id: 'destaque', category: 'new', highlight: true, media: null }],
  text: { 'pt-BR': { title: `Novidades da ${version}`, summary: '', items: { destaque: { title: 'O que mudou', body: '' } } } },
})
const slug = (title: string, taken: Set<string>) => {
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'novidade'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/**
 * Translations may be partial: an empty field means "use the Portuguese". Before saving, a locale with nothing in it
 * goes away and its empty item texts are dropped, so the schema only ever sees real translations.
 */
function clean(c: Content): Content {
  const base = c.text['pt-BR']
  const text: Content['text'] = { 'pt-BR': base }
  for (const l of RELEASE_LOCALES) {
    if (l === DEFAULT_RELEASE_LOCALE) continue
    const x = c.text[l]
    if (!x) continue
    const items = Object.fromEntries(Object.entries(x.items).filter(([id, it]) => c.items.some((i) => i.id === id) && (it.title.trim() || it.body.trim())).map(([id, it]) => [id, { ...it, title: it.title.trim() || base.items[id]?.title || '' }]))
    if (!x.title.trim() && !x.summary.trim() && !Object.keys(items).length) continue
    text[l] = { title: x.title.trim() || base.title, summary: x.summary, items }
  }
  return { items: c.items, text }
}

const issuesOf = (c: Content): string[] => {
  const r = ReleaseContent.safeParse(clean(c))
  return r.success ? [] : r.error.issues.slice(0, 6).map((i) => `${i.path.join(' › ') || 'nota'}: ${i.message}`)
}

/** The team's editor: write, translate, preview (center and welcome), publish. Every call is audit-logged (/admin). */
export default function Studio({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<AdminReleaseNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [leave, setLeave] = useState<null | (() => void)>(null)

  const load = useCallback(() => {
    setError(null)
    api<AdminReleaseNote[]>('GET', '/admin/releases').then((l) => {
      setList(l)
      setSelected((cur) => cur ?? l[0]?.version ?? null)
    }, (e: unknown) => setError(errorText(e, st.loadError)))
  }, [])
  useEffect(load, [load])

  const guard = (go: () => void) => (dirty ? setLeave(() => go) : go())
  const replace = (n: AdminReleaseNote) => setList((l) => (l ? [...l.filter((x) => x.version !== n.version), n].sort((a, b) => compareVersions(b.version, a.version)) : [n]))
  const current = list?.find((n) => n.version === selected) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]:not([data-whatsnew]), [role="menu"]')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      guard(onClose)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <motion.div
      className={s.studio}
      role="dialog"
      aria-modal="true"
      aria-label={st.title}
      data-whatsnew
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.14, ease: EASE_IN } }}
    >
      <aside className={s.side}>
        <header className={s.sideHead}>
          <div className={s.sideRow}>
            <IconButton icon={ArrowLeft} label={st.back} size="sm" onClick={() => guard(onClose)} />
            <h1 className={s.sideTitle}>{st.title}</h1>
          </div>
          <p className={s.sideSub}>{st.subtitle}</p>
          <Button icon={Plus} size="sm" onClick={() => guard(() => setCreating(true))}>
            {st.create}
          </Button>
        </header>
        <div className={s.versions} role="listbox" aria-label={st.notes}>
          {list?.map((n) => (
            <button key={n.version} type="button" role="option" aria-selected={n.version === selected} className={s.vrow} onClick={() => guard(() => setSelected(n.version))}>
              {n.version === selected && <motion.span layoutId="wn-studio-row" className={s.vrowBg} transition={{ duration: 0.2, ease: EASE_OUT_QUART }} />}
              <span className={s.vrowTop}>
                <span className={s.vnum}>{n.version}</span>
                <span className={s.statusTag} data-status={n.status}>{st.status[n.status]}</span>
                <span className={s.vdate}>{shortDate(n.updatedAt)}</span>
              </span>
              <span className={s.vtitle}>{n.content.text['pt-BR'].title}</span>
              {n.stats.people > 0 && <span className={s.vstats}>{st.people(n.stats.people)}</span>}
            </button>
          ))}
          {!list && !error && <div className={s.listNote}><Spinner label={st.loading} /></div>}
          {error && <div className={s.listNote}><span className={s.muted}>{error}</span><Button size="sm" onClick={load}>{st.retry}</Button></div>}
        </div>
      </aside>

      {current ? (
        <Editor key={`${current.version}:${current.revision}`} note={current} onSaved={replace} onDirty={setDirty} onDeleted={(v) => {
          setList((l) => l?.filter((x) => x.version !== v) ?? l)
          setSelected(null)
        }} />
      ) : (
        <section className={s.detail}>
          <div className={s.detailClose}><IconButton icon={X} label={st.close} onClick={() => guard(closeCenter)} /></div>
          <div className={s.emptyWrap}>
            <EmptyState title={st.pick[0]}>{st.pick[1]}</EmptyState>
          </div>
        </section>
      )}

      <CreateDialog
        open={creating}
        suggested={nextPatch(list?.[0]?.version)}
        taken={new Set(list?.map((n) => n.version))}
        onClose={() => setCreating(false)}
        onCreated={(n) => {
          replace(n)
          setSelected(n.version)
          setCreating(false)
        }}
      />
      <Modal
        open={!!leave}
        onClose={() => setLeave(null)}
        title={st.discard.title}
        description={st.discard.body}
        footer={
          <>
            <Button onClick={() => setLeave(null)}>{st.discard.keep}</Button>
            <Button variant="danger" onClick={() => {
              setDirty(false)
              const go = leave
              setLeave(null)
              go?.()
            }}>{st.discard.go}</Button>
          </>
        }
      />
    </motion.div>
  )
}

function CreateDialog({ open, suggested, taken, onClose, onCreated }: { open: boolean; suggested: string; taken: Set<string>; onClose: () => void; onCreated: (n: AdminReleaseNote) => void }) {
  const [version, setVersion] = useState(suggested)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setVersion(suggested)
      setErr(null)
    }
  }, [open, suggested])
  const bad = !RELEASE_VERSION_RE.test(version) ? st.createBadVersion : taken.has(version) ? st.createTaken : null
  const submit = async () => {
    if (bad) return setErr(bad)
    setBusy(true)
    try {
      onCreated(await api<AdminReleaseNote>('POST', '/admin/releases', { version, content: template(version) }))
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={st.createTitle}
      description={st.createBody}
      footer={
        <>
          <Button onClick={onClose}>{st.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{st.createGo}</Button>
        </>
      }
    >
      <TextField label={st.version} value={version} error={err} hint={st.versionHint} onChange={(e) => { setVersion(e.target.value.trim()); setErr(null) }} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
    </Modal>
  )
}

function Editor({ note, onSaved, onDirty, onDeleted }: { note: AdminReleaseNote; onSaved: (n: AdminReleaseNote) => void; onDirty: (d: boolean) => void; onDeleted: (v: string) => void }) {
  const [content, setContent] = useState<Content>(note.content)
  const [locale, setLocale] = useState<ReleaseLocale>(DEFAULT_RELEASE_LOCALE)
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'delete'>(null)
  const [confirm, setConfirm] = useState<null | 'publish' | 'unpublish' | 'delete'>(null)
  const [gh, setGh] = useState<Release>({ state: 'checking' })
  const dirty = JSON.stringify(content) !== JSON.stringify(note.content)
  const issues = useMemo(() => issuesOf(content), [content])
  const lastValid = useRef<Content>(note.content)
  if (!issues.length) lastValid.current = clean(content)
  const everPublished = note.publishedAt !== null

  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  useEffect(() => {
    let live = true
    void githubRelease(note.version).then((r) => live && setGh(r))
    return () => {
      live = false
    }
  }, [note.version])

  const save = async (): Promise<boolean> => {
    if (issues.length) {
      toast.error(st.fixFirst)
      return false
    }
    setBusy('save')
    try {
      onSaved(await api<AdminReleaseNote>('PUT', `/admin/releases/${note.version}`, { content: clean(content), revision: note.revision }))
      toast.success(note.status === 'published' ? st.savedLive : st.saved)
      return true
    } catch (e) {
      toast.error(errorText(e))
      return false
    } finally {
      setBusy(null)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setStatus = async (action: 'publish' | 'unpublish') => {
    setBusy('publish')
    try {
      onSaved(await api<AdminReleaseNote>('POST', `/admin/releases/${note.version}/${action}`))
      toast.success(action === 'publish' ? st.publishedToast(note.version) : st.unpublishedToast)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }
  const remove = async () => {
    setBusy('delete')
    try {
      await api('DELETE', `/admin/releases/${note.version}`)
      onDeleted(note.version)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  // ── content edits ──
  const text: ReleaseText = content.text[locale] ?? { title: '', summary: '', items: {} }
  const base = content.text['pt-BR']
  const setText = (patch: Partial<ReleaseText>) => setContent((c) => ({ ...c, text: { ...c.text, [locale]: { ...(c.text[locale] ?? { title: '', summary: '', items: {} }), ...patch } } }))
  const setItemText = (id: string, patch: Partial<ReleaseText['items'][string]>) =>
    setText({ items: { ...text.items, [id]: { ...(text.items[id] ?? { title: '', body: '' }), ...patch } } })
  const setItem = (id: string, patch: Partial<ReleaseItem>) => setContent((c) => ({ ...c, items: c.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
  const move = (id: string, d: -1 | 1) => setContent((c) => {
    const i = c.items.findIndex((x) => x.id === id)
    const j = i + d
    if (j < 0 || j >= c.items.length) return c
    const items = [...c.items]
    ;[items[i], items[j]] = [items[j]!, items[i]!]
    return { ...c, items }
  })
  const removeItem = (id: string) => setContent((c) => ({
    items: c.items.filter((i) => i.id !== id),
    text: Object.fromEntries(Object.entries(c.text).map(([l, x]) => [l, x && { ...x, items: Object.fromEntries(Object.entries(x.items).filter(([k]) => k !== id)) }])) as Content['text'],
  }))
  const addItem = () => setContent((c) => {
    const id = slug(`novidade ${c.items.length + 1}`, new Set(c.items.map((i) => i.id)))
    return { items: [...c.items, { id, category: 'new', highlight: false, media: null }], text: { ...c.text, 'pt-BR': { ...c.text['pt-BR'], items: { ...c.text['pt-BR'].items, [id]: { title: 'Nova novidade', body: '' } } } } }
  })
  // Renaming an id is safe until the note is first published (reactions are keyed by it after that).
  const renameItem = (id: string, next: string) => setContent((c) => {
    if (!next || c.items.some((i) => i.id === next)) return c
    return {
      items: c.items.map((i) => (i.id === id ? { ...i, id: next } : i)),
      text: Object.fromEntries(Object.entries(c.text).map(([l, x]) => [l, x && { ...x, items: Object.fromEntries(Object.entries(x.items).map(([k, v]) => [k === id ? next : k, v])) }])) as Content['text'],
    }
  })

  const previewNote: ReleaseNote = { version: note.version, publishedAt: note.publishedAt ?? new Date().toISOString(), content: lastValid.current, mine: {} }
  const pt = locale === DEFAULT_RELEASE_LOCALE

  return (
    <section className={s.editorWrap} aria-label={st.editing(note.version)}>
      <header className={s.editorBar}>
        <div className={s.editorBarTitle}>
          <span className={s.vnum}>{note.version}</span>
          <span className={s.statusTag} data-status={note.status}>{st.status[note.status]}</span>
          {dirty && <span className={s.dirty}>{st.unsaved}</span>}
          <GitHubHint state={gh} version={note.version} />
        </div>
        <div className={s.editorActions}>
          <Button size="sm" icon={Copy} onClick={() => void copyText(releaseMarkdown(lastValid.current)).then(() => toast.success(st.copied))}>{st.copyGithub}</Button>
          <Button size="sm" icon={Eye} onClick={() => previewWelcome([previewNote])}>{st.previewWelcome}</Button>
          <Button size="sm" loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>{st.save}</Button>
          {note.status === 'draft' ? (
            <Button size="sm" variant="primary" disabled={dirty || !!busy} onClick={() => setConfirm('publish')}>{st.publish}</Button>
          ) : (
            <Button size="sm" variant="secondary-danger" disabled={!!busy} onClick={() => setConfirm('unpublish')}>{st.unpublish}</Button>
          )}
        </div>
      </header>

      <div className={s.editorCols}>
        <div className={s.form}>
          {note.status === 'draft' && dirty && <p className={s.formHint}>{st.saveBeforePublish}</p>}
          {issues.length > 0 && (
            <div className={s.issues} role="alert">
              <strong>{st.issues}</strong>
              <ul>{issues.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}

          <SegmentedControl label={st.language} value={locale} onChange={setLocale} items={RELEASE_LOCALES.map((l) => ({ value: l, label: st.locales[l] }))} />
          {!pt && <p className={s.formHint}>{st.translateHint}</p>}

          <TextField label={st.noteTitle} value={text.title} placeholder={pt ? undefined : base.title} maxLength={80} onChange={(e) => setText({ title: e.target.value })} />
          <label className={s.fieldLabel} htmlFor="wn-summary">{st.summary}</label>
          <textarea id="wn-summary" className={s.textarea} rows={2} maxLength={280} value={text.summary} placeholder={pt ? st.summaryHint : base.summary} onChange={(e) => setText({ summary: e.target.value })} />

          <div className={s.formSection}>
            <h2 className={s.formTitle}>{st.items}</h2>
            <span className={s.muted}>{st.itemsHint}</span>
          </div>
          {content.items.map((it, n) => {
            const x = text.items[it.id] ?? { title: '', body: '' }
            const b = base.items[it.id]
            const stats = note.stats.items[it.id]
            return (
              <fieldset key={it.id} className={s.itemEdit}>
                <legend className={s.itemLegend}>
                  <span>{st.itemN(n + 1)}</span>
                  {stats && <span className={s.vstats}>👍 {stats.up} · 👎 {stats.down}</span>}
                  <span className={s.grow} />
                  <IconButton icon={ArrowUp} label={st.up} size="sm" disabled={n === 0} onClick={() => move(it.id, -1)} />
                  <IconButton icon={ArrowDown} label={st.down} size="sm" disabled={n === content.items.length - 1} onClick={() => move(it.id, 1)} />
                  <IconButton icon={Trash2} label={st.removeItem} size="sm" danger disabled={content.items.length === 1} onClick={() => removeItem(it.id)} />
                </legend>
                {pt && (
                  <div className={s.row2}>
                    <SegmentedControl label={st.category} value={it.category} onChange={(c: ReleaseCategory) => setItem(it.id, { category: c })} items={RELEASE_CATEGORIES.map((c) => ({ value: c, label: st.categories[c] }))} />
                    <span className={s.switchRow}>
                      <Switch checked={it.highlight} label={st.highlight} onChange={(v) => setItem(it.id, { highlight: v })} />
                      {st.highlight}
                    </span>
                  </div>
                )}
                <TextField label={st.itemTitle} value={x.title} placeholder={pt ? undefined : b?.title} maxLength={80} onChange={(e) => setItemText(it.id, { title: e.target.value })} />
                <label className={s.fieldLabel} htmlFor={`wn-body-${it.id}`}>{st.itemBody}</label>
                <textarea id={`wn-body-${it.id}`} className={s.textarea} rows={3} maxLength={600} value={x.body} placeholder={pt ? st.itemBodyHint : b?.body} onChange={(e) => setItemText(it.id, { body: e.target.value })} />
                {pt && (
                  <>
                    <div className={s.row2}>
                      <SegmentedControl
                        label={st.media}
                        value={it.media?.kind ?? 'none'}
                        onChange={(k: 'none' | 'image' | 'video') => setItem(it.id, { media: k === 'none' ? null : { kind: k, url: it.media?.url ?? '', poster: it.media?.poster } })}
                        items={[{ value: 'none', label: st.mediaNone }, { value: 'image', label: st.mediaImage }, { value: 'video', label: st.mediaVideo }]}
                      />
                    </div>
                    {it.media && (
                      <>
                        <TextField label={st.mediaUrl} hint={st.mediaUrlHint(note.version)} value={it.media.url} placeholder="https://" onChange={(e) => setItem(it.id, { media: { ...it.media!, url: e.target.value.trim() } })} />
                        <TextField label={st.poster} optional hint={st.posterHint} value={it.media.poster ?? ''} placeholder="https://" onChange={(e) => setItem(it.id, { media: { ...it.media!, poster: e.target.value.trim() || undefined } })} />
                      </>
                    )}
                    <IdField id={it.id} locked={everPublished} onRename={(v) => renameItem(it.id, v)} />
                  </>
                )}
                {it.media && <TextField label={st.alt} optional value={x.alt ?? ''} maxLength={200} placeholder={pt ? st.altHint : b?.alt} onChange={(e) => setItemText(it.id, { alt: e.target.value || undefined })} />}
              </fieldset>
            )
          })}
          {pt && content.items.length < 20 && <Button icon={Plus} onClick={addItem}>{st.addItem}</Button>}

          {note.status === 'draft' && !everPublished && (
            <div className={s.danger}>
              <Button variant="secondary-danger" size="sm" icon={Trash2} onClick={() => setConfirm('delete')}>{st.deleteDraft}</Button>
            </div>
          )}
        </div>

        <div className={s.previewCol} aria-label={st.preview}>
          <span className={s.previewLabel}>{st.previewCenter(st.locales[locale])}</span>
          <div className={s.previewFrame}>
            <NoteView note={previewNote} locale={locale} preview />
          </div>
        </div>
      </div>

      <Modal
        open={confirm === 'publish'}
        onClose={() => setConfirm(null)}
        title={st.publishTitle(note.version)}
        description={st.publishBody(note.version)}
        footer={<><Button onClick={() => setConfirm(null)}>{st.cancel}</Button><Button variant="primary" loading={busy === 'publish'} onClick={() => void setStatus('publish')}>{st.publish}</Button></>}
      >
        {gh.state === 'missing' && <p className={s.warn}>{st.noGithub(note.version)}</p>}
        {gh.state === 'found' && gh.draft && <p className={s.warn}>{st.githubDraft(note.version)}</p>}
      </Modal>
      <Modal
        open={confirm === 'unpublish'}
        onClose={() => setConfirm(null)}
        title={st.unpublishTitle}
        description={st.unpublishBody}
        footer={<><Button onClick={() => setConfirm(null)}>{st.cancel}</Button><Button variant="danger" loading={busy === 'publish'} onClick={() => void setStatus('unpublish')}>{st.unpublish}</Button></>}
      />
      <Modal
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={st.deleteTitle(note.version)}
        description={st.deleteBody}
        footer={<><Button onClick={() => setConfirm(null)}>{st.cancel}</Button><Button variant="danger" loading={busy === 'delete'} onClick={() => void remove()}>{st.deleteDraft}</Button></>}
      />
    </section>
  )
}

function IdField({ id, locked, onRename }: { id: string; locked: boolean; onRename: (v: string) => void }) {
  const [v, setV] = useState(id)
  return (
    <TextField
      label={st.itemId}
      size="sm"
      value={v}
      disabled={locked}
      hint={locked ? st.itemIdLocked : st.itemIdHint}
      onChange={(e) => setV(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))}
      onBlur={() => (v && v !== id ? onRename(v) : setV(id))}
    />
  )
}

function GitHubHint({ state, version }: { state: Release; version: string }) {
  if (state.state === 'checking' || state.state === 'unknown') return null
  if (state.state === 'missing') return <span className={s.ghTag} data-missing>{st.ghMissing(version)}</span>
  return (
    <button type="button" className={s.ghTag} onClick={() => openExternal(state.url)}>
      {state.draft ? st.ghDraft(version) : st.ghFound(version)}
    </button>
  )
}
