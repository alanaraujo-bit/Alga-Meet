import type { FeedbackContext, FeedbackItem, FeedbackKind } from '@alga/shared'
import { kindTakesLog } from '@alga/shared'
import { create } from 'zustand'
import { api, upload } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { useCinema } from '../cinema/store'
import { currentMoment } from '../whatsnew/store'
import { canSend, contextOf, draftKey, readDraft, sendsLog, type Crash } from './logic'

interface FeedbackState {
  open: boolean
  pane: 'form' | 'sent' | 'mine'
  kind: FeedbackKind
  text: string
  /** The optional screenshot (pasted, dropped or captured) and its preview URL. */
  shot: { blob: Blob; url: string } | null
  /** The switch in "Vai junto"; only matters for the kinds that take the log. */
  logOn: boolean
  /** The exact log that would go (what "ver" shows); null until loaded. */
  log: string | null
  /** Set when the card was opened from the offer: the feedback is about the session that crashed. */
  crash: Crash | null
  /** "Travei da última vez…" on screen. */
  offer: Crash | null
  phase: 'idle' | 'sending' | 'error'
  error: string | null
  /** What was just sent (the "sent" pane). */
  last: FeedbackItem | null
  /** "Seus envios", newest first; null = not loaded yet. */
  mine: FeedbackItem[] | null
  mineError: boolean
  /** The card is hidden for a moment so it does not appear in its own screenshot. */
  capturing: boolean
}

const initial: FeedbackState = {
  open: false, pane: 'form', kind: 'idea', text: '', shot: null, logOn: true, log: null, crash: null, offer: null,
  phase: 'idle', error: null, last: null, mine: null, mineError: false, capturing: false,
}

export const useFeedback = create<FeedbackState>()(() => initial)

const key = (): string | null => {
  const me = useData.getState().me
  return me ? draftKey(me.id) : null
}

function saveDraft(): void {
  const k = key()
  if (!k) return
  const { kind, text } = useFeedback.getState()
  try {
    if (text) localStorage.setItem(k, JSON.stringify({ kind, text }))
    else localStorage.removeItem(k)
  } catch {
    // Storage full or disabled: the draft lives for this run only.
  }
}

const dropShot = (): void => {
  const { shot } = useFeedback.getState()
  if (shot) URL.revokeObjectURL(shot.url)
}

async function loadLog(): Promise<void> {
  const { crash } = useFeedback.getState()
  const log = await window.alga?.app.recentLog(crash !== null).catch(() => '') ?? ''
  // Same card still open on the same question (a crash report reads the previous session's log).
  if (useFeedback.getState().crash === crash) useFeedback.setState({ log })
}

async function loadMine(): Promise<void> {
  try {
    useFeedback.setState({ mine: await api<FeedbackItem[]>('GET', '/feedback/@me'), mineError: false })
  } catch {
    useFeedback.setState({ mineError: true })
  }
}

/** Where the person is right now, as it would be sent (also what "ver" shows). */
export function currentContext(): FeedbackContext {
  return contextOf({
    view: useUi.getState().view.kind,
    inCall: currentMoment().inCall,
    sharing: useMedia.getState().screen.active,
    cinema: useCinema.getState().session !== null,
    crash: useFeedback.getState().crash,
  })
}

/** Opens the card on the saved draft. `kind` picks the kind; `crash` makes it a report about the previous session. */
export function openFeedback(opts: { kind?: FeedbackKind; crash?: Crash } = {}): void {
  const st = useFeedback.getState()
  const k = key()
  let draft = { kind: st.kind, text: st.text }
  if (!st.text) {
    try {
      draft = readDraft(k ? localStorage.getItem(k) : null)
    } catch {}
  }
  const crash = opts.crash ?? st.crash
  const kind = opts.kind ?? (opts.crash ? 'crash' : draft.kind)
  useFeedback.setState({
    open: true, pane: 'form', kind, text: draft.text, crash, phase: 'idle', error: null, offer: null,
    // A different question (this session vs. the one that crashed) needs a different log.
    log: crash === st.crash ? st.log : null,
  })
  if (kindTakesLog(kind) && useFeedback.getState().log === null) void loadLog()
  if (st.mine === null) void loadMine()
}

/** Esc, ×, or done: the draft stays (in memory and on disk). */
export const closeFeedback = (): void => useFeedback.setState({ open: false })

export function setKind(kind: FeedbackKind): void {
  useFeedback.setState({ kind })
  saveDraft()
  if (kindTakesLog(kind) && useFeedback.getState().log === null) void loadLog()
}

export function setText(text: string): void {
  useFeedback.setState({ text, phase: 'idle', error: null })
  saveDraft()
}

export function setShot(blob: Blob | null): void {
  dropShot()
  useFeedback.setState({ shot: blob ? { blob, url: URL.createObjectURL(blob) } : null })
}

export const setLogOn = (logOn: boolean): void => useFeedback.setState({ logOn })

const nextPaint = (): Promise<void> =>
  new Promise((done) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => requestAnimationFrame(() => done())) : setTimeout(done, 0)))

/** "Tirar print do app": the card steps out of the picture, main captures the window, the card comes back with it. */
export async function captureShot(): Promise<boolean> {
  useFeedback.setState({ capturing: true })
  try {
    await nextPaint()
    const png = await window.alga?.app.captureWindow()
    if (!png) return false
    setShot(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    return true
  } catch {
    return false
  } finally {
    useFeedback.setState({ capturing: false })
  }
}

export async function send(): Promise<void> {
  const st = useFeedback.getState()
  if (st.phase === 'sending' || !canSend(st.text)) return
  const form = new FormData()
  form.append('kind', st.kind)
  form.append('text', st.text.trim())
  form.append('context', JSON.stringify(currentContext()))
  if (sendsLog(st.kind, st.logOn) && st.log) form.append('log', st.log)
  if (st.shot) form.append('screenshot', st.shot.blob, 'print.png')
  useFeedback.setState({ phase: 'sending', error: null })
  try {
    const item = await upload<FeedbackItem>('POST', '/feedback', form)
    dropShot()
    useFeedback.setState((s) => ({
      pane: 'sent', last: item, text: '', shot: null, crash: null, log: null, logOn: true, phase: 'idle',
      mine: [item, ...(s.mine ?? [])],
    }))
    saveDraft()
  } catch (e) {
    useFeedback.setState({ phase: 'error', error: errorText(e, 'Não deu para enviar. Tente de novo.') })
  }
}

export async function showMine(): Promise<void> {
  useFeedback.setState({ pane: 'mine' })
  await loadMine()
}

export const showForm = (): void => useFeedback.setState({ pane: 'form' })

/** "Contar" opens the card on "Travou" about the session that crashed; "Agora não" just consumes the offer. */
export function answerOffer(tell: boolean): void {
  const { offer } = useFeedback.getState()
  useFeedback.setState({ offer: null })
  if (tell && offer) openFeedback({ crash: offer })
}

/** Sign-out (and tests): nothing of this account stays in memory. The draft on disk is per account and stays. */
export function resetFeedback(): void {
  dropShot()
  useFeedback.setState(initial)
}
