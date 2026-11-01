import type { Attachment, Message } from '@alga/shared'
import { DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@alga/shared'
import { Download, File, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, ImageOff, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { errorText } from '@/lib/errors'
import { attachmentKind, fitBox, formatBytes, gridRows, localKind } from '@/lib/files'
import { refreshMessage } from '@/store/actions'
import { useData } from '@/store/data'
import { Icon, IconButton, toast } from '@/ui'
import { openLightbox } from './Lightbox'
import { removeFile, type TrayItem } from './tray'
import { t } from './strings'
import s from './chat.module.css'

const SINGLE_MAX = { w: 420, h: 320 }
const GRID_W = 420
/** Row height by cells per row: fewer cells, taller row. */
const ROW_H = [0, 240, 180, 132]

/**
 * Signed URLs expire (~1 h). The first failed load of an attachment refetches its message page (fresh URLs)
 * and the element retries with the new src; a second failure within a minute shows the broken state.
 */
const lastRefresh = new Map<string, number>()
function useSignedLoad(m: Message, a: Attachment) {
  const [broken, setBroken] = useState<string | null>(null)
  // Bumped after a refresh: remounts the element even when the server handed back the same (still valid) URL.
  const [attempt, setAttempt] = useState(0)
  const pending = m.nonce === m.id
  const refresh = () =>
    refreshMessage(m.channelId, m.id).then(
      () => setAttempt((n) => n + 1),
      () => setBroken(a.url),
    )
  const onError = () => {
    if (pending) return setBroken(a.url)
    const at = lastRefresh.get(a.id) ?? 0
    if (Date.now() - at < 60_000) return setBroken(a.url)
    lastRefresh.set(a.id, Date.now())
    void refresh()
  }
  const retry = () => {
    lastRefresh.set(a.id, Date.now())
    setBroken(null)
    void refresh()
  }
  // A new URL (after a refresh) deserves a fresh attempt.
  return { broken: broken !== null && broken === a.url, onError, retry, key: `${a.url}#${attempt}` }
}

/** Attachments of a message: image grid, inline video/audio players, download cards. */
export function Attachments({ message: m }: { message: Message }) {
  const progress = useData((st) => st.uploads[m.id])
  const images = m.attachments.filter((a) => attachmentKind(a.contentType) === 'image')
  const rest = m.attachments.filter((a) => attachmentKind(a.contentType) !== 'image')
  const uploading = progress !== undefined
  return (
    <div className={`${s.attachments} ${uploading ? s.uploading : ''}`}>
      {images.length > 0 && <ImageGrid message={m} images={images} />}
      {rest.map((a) => {
        const kind = attachmentKind(a.contentType)
        return kind === 'video' ? <VideoAttachment key={a.id} message={m} a={a} /> : kind === 'audio' ? <AudioAttachment key={a.id} message={m} a={a} /> : <FileCard key={a.id} message={m} a={a} />
      })}
      {uploading && (
        <div className={s.uploadProgress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t.files.uploading(m.attachments.length, Math.round(progress * 100))}>
          <span className="tnum">{t.files.uploading(m.attachments.length, Math.round(progress * 100))}</span>
          <span className={s.uploadBar}>
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        </div>
      )}
    </div>
  )
}

function ImageGrid({ message: m, images }: { message: Message; images: Attachment[] }) {
  const pending = m.nonce === m.id
  const open = (i: number) => !pending && openLightbox(m.channelId, m.id, i)
  if (images.length === 1) {
    const a = images[0]!
    const box = fitBox(a.width, a.height, SINGLE_MAX.w, SINGLE_MAX.h)
    return (
      <div className={s.imageGrid} style={{ width: box.width, maxWidth: '100%' }}>
        <ImageCell message={m} a={a} style={{ aspectRatio: `${box.width} / ${box.height}` }} onOpen={() => open(0)} />
      </div>
    )
  }
  let i = 0
  return (
    <div className={s.imageGrid} style={{ width: GRID_W, maxWidth: '100%' }}>
      {gridRows(images.length).map((n, r) => (
        <div key={r} className={s.imageRow} style={{ height: ROW_H[n] }}>
          {images.slice(i, (i += n)).map((a, k) => {
            const idx = i - n + k
            return <ImageCell key={a.id} message={m} a={a} onOpen={() => open(idx)} />
          })}
        </div>
      ))}
    </div>
  )
}

function ImageCell({ message: m, a, style, onOpen }: { message: Message; a: Attachment; style?: React.CSSProperties; onOpen: () => void }) {
  const { broken, onError, retry, key } = useSignedLoad(m, a)
  if (broken) return <Broken style={style} onRetry={retry} />
  return (
    <button type="button" className={s.imageCell} style={style} aria-label={t.files.open(a.filename)} onClick={onOpen}>
      <img key={key} src={a.url} alt="" loading="lazy" decoding="async" draggable={false} onError={onError} />
    </button>
  )
}

function Broken({ style, onRetry }: { style?: React.CSSProperties; onRetry: () => void }) {
  return (
    <div className={s.broken} style={style} role="alert">
      <Icon icon={ImageOff} size={18} />
      <span>{t.files.broken}</span>
      <button type="button" className={s.failedAction} onClick={onRetry}>
        {t.files.retry}
      </button>
    </div>
  )
}

function VideoAttachment({ message: m, a }: { message: Message; a: Attachment }) {
  const { broken, onError, retry, key } = useSignedLoad(m, a)
  if (broken) return <Broken style={{ width: 480, maxWidth: '100%', aspectRatio: '16 / 9' }} onRetry={retry} />
  return (
    <video key={key} className={s.video} src={a.url} controls preload="metadata" aria-label={a.filename} onError={onError}>
      <track kind="captions" />
    </video>
  )
}

function AudioAttachment({ message: m, a }: { message: Message; a: Attachment }) {
  const { broken, onError, retry, key } = useSignedLoad(m, a)
  return (
    <div className={s.fileCard}>
      <div className={s.fileTop}>
        <FileMeta a={a} icon={FileAudio} />
        <DownloadButton message={m} a={a} />
      </div>
      {broken ? <Broken onRetry={retry} /> : <audio key={key} className={s.audio} src={a.url} controls preload="metadata" aria-label={a.filename} onError={onError} />}
    </div>
  )
}

function FileCard({ message: m, a }: { message: Message; a: Attachment }) {
  return (
    <div className={s.fileCard}>
      <div className={s.fileTop}>
        <FileMeta a={a} icon={fileIcon(a.filename)} />
        <DownloadButton message={m} a={a} />
      </div>
    </div>
  )
}

function FileMeta({ a, icon }: { a: Attachment; icon: LucideIcon }) {
  return (
    <>
      <span className={s.fileIcon}>
        <Icon icon={icon} size={18} />
      </span>
      <span className={s.fileText}>
        <span className={s.fileName} title={a.filename}>
          {a.filename}
        </span>
        <span className={`${s.fileSize} tnum`}>{formatBytes(a.size)}</span>
      </span>
    </>
  )
}

function DownloadButton({ message: m, a }: { message: Message; a: Attachment }) {
  if (m.nonce === m.id) return null
  return <IconButton icon={Download} label={t.files.download(a.filename)} onClick={() => void saveAttachment(m.channelId, m.id, a.id)} />
}

const EXT: Array<[RegExp, LucideIcon]> = [
  [/\.(zip|rar|7z|tar|gz|bz2|xz)$/i, FileArchive],
  [/\.(csv|xlsx?|ods|tsv)$/i, FileSpreadsheet],
  [/\.(js|ts|tsx|jsx|json|py|rs|go|java|c|cpp|h|cs|rb|php|sh|ps1|html|css|xml|ya?ml|toml|sql)$/i, FileCode],
  [/\.(txt|md|pdf|docx?|odt|rtf)$/i, FileText],
]
const fileIcon = (name: string): LucideIcon => EXT.find(([re]) => re.test(name))?.[1] ?? File

/**
 * Saves a file through the OS "Salvar como" (blob URL + download attribute; a cross-origin link would just
 * navigate). An expired URL (403) is refreshed once.
 */
export async function saveAttachment(channelId: string, messageId: string, attachmentId: string): Promise<void> {
  const find = () => useData.getState().messages[channelId]?.byId[messageId]?.attachments.find((x) => x.id === attachmentId)
  try {
    let a = find()
    if (!a) return
    let res = await fetch(a.url)
    if (res.status === 403) {
      await refreshMessage(channelId, messageId)
      a = find()
      if (!a) return
      res = await fetch(a.url)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = a.filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    toast.error(errorText(e, t.files.saveError))
  }
}

/** Text for previews (reply bar, notifications, delete dialog) of a message without words. */
export function attachmentSummary(m: Pick<Message, 'attachments'>): string {
  const n = m.attachments.length
  return t.files.summary(n, n > 0 && m.attachments.every((a) => attachmentKind(a.contentType) === 'image'))
}

// ── Composer tray ─────────────────────────────────────────

/** `onRemoved`: where focus goes after a remove (the button disappears with its item). */
export function AttachmentTray({ channelId, items, onRemoved }: { channelId: string; items: TrayItem[]; onRemoved: () => void }) {
  if (!items.length) return null
  return (
    <ul className={s.tray} aria-label={t.files.attach}>
      {items.map((it) => {
        const kind = localKind(it.file.type)
        const problem =
          it.problem === 'empty' ? t.files.problem.empty
          : it.problem === 'tooBig' ? t.files.problem.tooBig(formatBytes(DEFAULT_MAX_ATTACHMENT_BYTES))
          : it.problem === 'tooMany' ? t.files.problem.tooMany(MAX_ATTACHMENTS)
          : null
        return (
          <li key={it.id} className={`${s.trayItem} ${problem ? s.trayProblem : ''}`}>
            <span className={s.trayThumb}>
              {kind === 'image' && !problem ? (
                <img src={it.url} alt="" draggable={false} />
              ) : kind === 'video' && !problem ? (
                <video src={it.url} muted preload="metadata" aria-hidden />
              ) : (
                <Icon icon={kind === 'audio' ? FileAudio : fileIcon(it.file.name)} size={20} />
              )}
            </span>
            <span className={s.trayName} title={it.file.name}>
              {it.file.name}
            </span>
            <span className={`${s.traySize} tnum`} role={problem ? 'alert' : undefined}>
              {problem ?? formatBytes(it.file.size)}
            </span>
            <IconButton icon={X} label={t.files.remove(it.file.name)} size="sm" className={s.trayRemove} onClick={() => {
                removeFile(channelId, it.id)
                onRemoved()
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}
