import { AVATAR_CONTENT_TYPES } from '@alga/shared'
import { ImageUp, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { errorText } from '@/lib/errors'
import { checkAvatar, clampPan, cropRect } from '@/lib/files'
import { Button, Icon, Modal } from '@/ui'
import { t } from './strings'
import s from './settings.module.css'

const VIEW = 280

/**
 * Avatar / space icon control: preview, "Enviar"/"Trocar", "Remover" and a square crop with zoom before upload.
 * Output: ≤ 1024 px WebP drawn on a canvas (EXIF and anything outside the crop never leave the machine).
 * GIFs skip the crop and go as they are, so the animation survives (the server checks type, size and sides).
 */
export function ImagePicker({
  preview,
  hasImage,
  shape,
  onUpload,
  onRemove,
  disabledReason,
}: {
  preview: ReactNode
  hasImage: boolean
  shape: 'circle' | 'rounded'
  onUpload: (file: Blob, name: string) => Promise<unknown>
  onRemove: () => Promise<unknown>
  disabledReason?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const [cropping, setCropping] = useState<{ url: string; name: string } | null>(null)

  const send = async (file: Blob, name: string) => {
    setBusy('upload')
    setError(null)
    try {
      await onUpload(file, name)
      setCropping(null)
    } catch (e) {
      setError(errorText(e, t.image.error))
    } finally {
      setBusy(null)
    }
  }
  const pick = (file: File | undefined) => {
    if (!file) return
    const problem = checkAvatar(file)
    if (problem) return setError(problem === 'type' ? t.image.type : t.image.tooBig)
    setError(null)
    if (file.type === 'image/gif') return void send(file, file.name)
    setCropping({ url: URL.createObjectURL(file), name: file.name })
  }
  useEffect(() => () => void (cropping && URL.revokeObjectURL(cropping.url)), [cropping])

  return (
    <div className={s.imagePicker}>
      <span className={shape === 'circle' ? s.pickerPreview : `${s.pickerPreview} ${s.pickerRounded}`}>{preview}</span>
      <div className={s.pickerBody}>
        <div className={s.pickerActions}>
          <Button size="sm" icon={ImageUp} loading={busy === 'upload' && !cropping} disabled={!!disabledReason} title={disabledReason} onClick={() => input.current?.click()}>
            {hasImage ? t.image.change : t.image.upload}
          </Button>
          {hasImage && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              loading={busy === 'remove'}
              disabled={!!disabledReason}
              onClick={() => {
                setBusy('remove')
                setError(null)
                onRemove()
                  .catch((e: unknown) => setError(errorText(e, t.image.error)))
                  .finally(() => setBusy(null))
              }}
            >
              {t.image.remove}
            </Button>
          )}
        </div>
        {error ? (
          <span className={`${s.rowHint} ${s.error}`} role="alert">
            {error}
          </span>
        ) : (
          <span className={s.rowHint}>{disabledReason ?? t.image.hint}</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={AVATAR_CONTENT_TYPES.join(',')}
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <CropModal crop={cropping} shape={shape} busy={busy === 'upload'} error={cropping ? error : null} onCancel={() => setCropping(null)} onApply={(blob) => void send(blob, 'imagem.webp')} />
    </div>
  )
}

function CropModal({
  crop,
  shape,
  busy,
  error,
  onCancel,
  onApply,
}: {
  crop: { url: string; name: string } | null
  shape: 'circle' | 'rounded'
  busy: boolean
  error: string | null
  onCancel: () => void
  onApply: (blob: Blob) => void
}) {
  const img = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [decodeError, setDecodeError] = useState(false)
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null)

  useEffect(() => {
    setSize(null)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setDecodeError(false)
  }, [crop?.url])

  const setZ = (z: number) => {
    const next = Math.max(1, Math.min(4, z))
    setZoom(next)
    if (size) setPan((p) => clampPan(size, VIEW, next, p))
  }
  const move = (dx: number, dy: number) => size && setPan((p) => clampPan(size, VIEW, zoom, { x: p.x + dx, y: p.y + dy }))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, pan }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !size) return
    setPan(clampPan(size, VIEW, zoom, { x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y }))
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 6
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(step, 0),
      ArrowRight: () => move(-step, 0),
      ArrowUp: () => move(0, step),
      ArrowDown: () => move(0, -step),
      '+': () => setZ(zoom + 0.1),
      '=': () => setZ(zoom + 0.1),
      '-': () => setZ(zoom - 0.1),
    }
    const run = keys[e.key]
    if (run) {
      e.preventDefault()
      run()
    }
  }

  const apply = () => {
    const el = img.current
    if (!el || !size) return
    const r = cropRect(size, VIEW, zoom, pan)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = r.out
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(el, r.sx, r.sy, r.side, r.side, 0, 0, r.out, r.out)
    canvas.toBlob((b) => b && onApply(b), 'image/webp', 0.92)
  }

  const k = size ? (VIEW / Math.min(size.w, size.h)) * zoom : 1
  return (
    <Modal
      open={!!crop}
      onClose={onCancel}
      title={t.image.cropTitle}
      description={t.image.cropBody}
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t.image.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={!size} onClick={apply}>
            {t.image.apply}
          </Button>
        </>
      }
    >
      {crop && (
        <div className={s.crop}>
          <div
            className={s.cropView}
            style={{ width: VIEW, height: VIEW }}
            tabIndex={0}
            role="group"
            aria-label={t.image.cropArea}
            data-autofocus
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onWheel={(e) => setZ(zoom - e.deltaY * 0.0015)}
            onKeyDown={onKey}
          >
            <img
              ref={img}
              src={crop.url}
              alt=""
              draggable={false}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setDecodeError(true)}
              style={
                size
                  ? { width: size.w * k, height: size.h * k, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }
                  : { visibility: 'hidden' }
              }
            />
            <span className={shape === 'circle' ? s.cropMask : `${s.cropMask} ${s.cropMaskRounded}`} aria-hidden />
          </div>
          <label className={s.cropZoom}>
            <Icon icon={ZoomOut} size={16} />
            <input type="range" className={s.range} min={1} max={4} step={0.01} value={zoom} aria-label={t.image.zoom} onChange={(e) => setZ(Number(e.target.value))} />
            <Icon icon={ZoomIn} size={16} />
          </label>
          {(decodeError || error) && (
            <span className={`${s.rowHint} ${s.error}`} role="alert">
              {decodeError ? t.image.decodeError : error}
            </span>
          )}
        </div>
      )}
    </Modal>
  )
}
