import { Check, Lock, Monitor, AppWindow } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CaptureSource } from '../../../../shared/bridge'
import { media, useMedia, SCREEN_PRESETS, type ContentType, type ScreenPresetId } from '@/media'
import { Button, Icon, Modal, SegmentedControl, Spinner, Switch, Tabs } from '@/ui'
import { openSettings } from '../settings/store'
import { t } from './strings'
import { qualityAxes, type QualityChoice } from './picker'
import { useVoice } from './voice'
import ui from '@/ui/misc.module.css'
import s from './picker.module.css'

type Kind = 'screen' | 'window'
const REFRESH_MS = 1500

/** What to share, at what quality, with or without sound. Nothing is captured until "Transmitir". */
export function ScreenPicker() {
  const open = useVoice((st) => st.picker)
  const close = () => useVoice.setState({ picker: false })
  // 836 = 464 px preview + 24 gap + 300 px options + the modal's 2 × 24 padding.
  return (
    <Modal open={open} onClose={close} title={t.picker.title} description={t.picker.description} width={836}>
      {open && <PickerBody onDone={close} />}
    </Modal>
  )
}

function PickerBody({ onDone }: { onDone: () => void }) {
  const screen = useMedia(useShallow((st) => ({ active: st.screen.active, preset: st.screen.preset, contentType: st.screen.contentType, audio: st.screen.audio, offered: st.screen.offered, locked: st.screen.locked, sourceId: st.screen.sourceId })))
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [kind, setKind] = useState<Kind>('screen')
  const [picked, setPicked] = useState<string | null>(screen.sourceId)
  const offered = screen.offered.length ? screen.offered : [SCREEN_PRESETS[0]!]
  const [quality, setQuality] = useState<ScreenPresetId>(() => (offered.some((p) => p.id === screen.preset) ? screen.preset : (offered.find((p) => p.id === '1080p60') ?? offered[offered.length - 1]!).id))
  const [content, setContent] = useState<ContentType>(screen.contentType)
  const [audio, setAudio] = useState(screen.audio)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridgeOk = !!window.alga?.screen?.getSources

  // Live thumbnails while the picker is open (cheap: 320×200 PNGs from the main process).
  useEffect(() => {
    if (!bridgeOk) return setSources([])
    // Chained, not an interval: a slow enumeration never stacks requests.
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () =>
      media
        .getScreenSources()
        .then((list) => alive && setSources(list))
        .catch(() => alive && setSources((cur) => cur ?? []))
        .finally(() => {
          if (alive) timer = setTimeout(load, REFRESH_MS)
        })
    void load()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [bridgeOk])

  const list = useMemo(() => (sources ?? []).filter((x) => x.kind === kind), [sources, kind])
  // Live from a window: open on Janelas, with that window chosen.
  const liveKind = sources?.find((x) => x.id === screen.sourceId)?.kind
  useEffect(() => {
    if (liveKind) setKind(liveKind)
  }, [liveKind])
  // Always one of this tab's sources: the pick, else the first (the primary screen, one click from "Transmitir").
  const chosen = list.find((x) => x.id === picked) ?? list[0] ?? null
  // Live: the same dialog switches the source and/or the quality, both without stopping the stream.
  const newSource = !!chosen && chosen.id !== screen.sourceId
  const newQuality = quality !== screen.preset
  const canApply = !!chosen && (!screen.active || newSource || newQuality)

  const start = async () => {
    if (!chosen || !canApply) return
    setBusy(true)
    setError(null)
    try {
      if (!screen.active) await media.startScreenShare({ sourceId: chosen.id, audio, quality, contentType: content })
      else {
        if (newSource) await media.switchScreenSource(chosen.id)
        if (newQuality) await media.setScreenQuality(quality)
      }
      onDone()
    } catch {
      setError(useMedia.getState().screen.error ?? t.picker.failed)
    } finally {
      setBusy(false)
    }
  }

  const axes = qualityAxes(offered, screen.locked, quality)

  return (
    <div className={s.body}>
      <div className={s.left}>
        <Tabs<Kind>
          label={t.picker.title}
          value={kind}
          onChange={setKind}
          items={[
            { value: 'screen', label: t.picker.screens },
            { value: 'window', label: t.picker.windows },
          ]}
        />
        {/* One source: no grid, the preview is the choice. */}
        {list.length > 1 && (
          <div
            className={s.grid}
            role="radiogroup"
            aria-label={kind === 'screen' ? t.picker.screens : t.picker.windows}
            // Radio pattern: one tab stop (the chosen source), arrows move and choose.
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!d) return
              e.preventDefault()
              const at = list.findIndex((x) => x.id === chosen?.id)
              const next = list[(at + d + list.length) % list.length]!
              setPicked(next.id)
              e.currentTarget.querySelector<HTMLElement>(`[data-source="${CSS.escape(next.id)}"]`)?.focus()
            }}
          >
            {list.map((src) => (
              <button
                key={src.id}
                type="button"
                role="radio"
                data-source={src.id}
                tabIndex={src.id === chosen?.id ? 0 : -1}
                aria-checked={src.id === chosen?.id}
                className={s.source}
                onClick={() => setPicked(src.id)}
                onDoubleClick={() => {
                  setPicked(src.id)
                  void start()
                }}
              >
                <span className={s.thumb}>
                  <img src={src.thumbnail} alt="" draggable={false} />
                  {src.id === chosen?.id && (
                    <span className={s.check}>
                      <Icon icon={Check} size={14} />
                    </span>
                  )}
                </span>
                <span className={s.sourceName}>
                  {src.appIcon ? <img src={src.appIcon} alt="" className={s.appIcon} /> : <Icon icon={src.kind === 'screen' ? Monitor : AppWindow} size={14} />}
                  <span>{src.name}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className={s.preview}>
          {!bridgeOk ? (
            <p className={s.note}>{t.picker.unavailable}</p>
          ) : sources === null ? (
            <p className={s.note}>
              <Spinner size={16} /> {t.picker.loading}
            </p>
          ) : !chosen ? (
            <p className={s.note}>{kind === 'screen' ? t.picker.none.screens : t.picker.none.windows}</p>
          ) : (
            <img src={chosen.thumbnail} alt={`${t.picker.preview}: ${chosen.name}`} draggable={false} />
          )}
        </div>
        {chosen && <div className={s.previewName}>{chosen.name}</div>}
      </div>

      <div className={s.right}>
        <fieldset className={s.field}>
          <legend className={s.legend}>{t.picker.quality}</legend>
          <div className={s.stack}>
            <QualitySegments label={t.picker.resolution} items={axes.resolutions} value={quality} onChange={setQuality} />
            <QualitySegments label={t.picker.fps} items={axes.rates} value={quality} onChange={setQuality} />
          </div>
          {screen.locked.length > 0 ? (
            <p className={s.hint}>
              {t.picker.lockedHint(screen.locked.map((p) => p.label))}{' '}
              <button
                type="button"
                className={s.hintLink}
                onClick={() => {
                  onDone()
                  openSettings('plan')
                }}
              >
                {t.picker.seePlus}
              </button>
            </p>
          ) : (
            <p className={s.hint}>{screen.active ? t.picker.qualityLiveHint : t.picker.qualityHint}</p>
          )}
        </fieldset>

        {!screen.active && (
          <>
            <fieldset className={s.field}>
              <legend className={s.legend}>{t.picker.content}</legend>
              <SegmentedControl<ContentType>
                label={t.picker.content}
                value={content}
                onChange={setContent}
                items={[
                  { value: 'motion', label: t.picker.motion },
                  { value: 'detail', label: t.picker.detail },
                ]}
              />
              <p className={s.hint}>{content === 'motion' ? t.picker.motionHint : t.picker.detailHint}</p>
            </fieldset>

            <div className={s.field}>
              <label className={s.switchRow}>
                <span className={s.legend}>{t.picker.audio}</span>
                <Switch checked={audio} onChange={setAudio} label={t.picker.audio} />
              </label>
              <p className={s.hint}>{chosen?.kind === 'window' && audio ? t.picker.audioWindowHint : t.picker.audioHint}</p>
            </div>
          </>
        )}

        <div className={s.actions}>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onDone}>
            {t.picker.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={!canApply} onClick={() => void start()}>
            {!screen.active ? t.picker.start : newSource ? t.picker.switch : t.picker.apply}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * SegmentedControl look with plan-locked segments: visible, `aria-disabled`, a 12 px lock, skipped by the arrow keys.
 * shortcut: forks ui SegmentedControl (its items can't be disabled); fold back into ui/Tabs.tsx once they can.
 */
function QualitySegments({ label, items, value, onChange }: { label: string; items: QualityChoice[]; value: ScreenPresetId; onChange: (v: ScreenPresetId) => void }) {
  const thumb = useId()
  const open = items.filter((it) => !it.locked)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = open.findIndex((it) => it.value === value)
    const n = open.length
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (next < 0) return
    e.preventDefault()
    const v = open[next]!.value
    onChange(v)
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${v}"]`)?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className={ui.segmented} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="radio"
          data-value={it.value}
          aria-checked={it.value === value}
          aria-disabled={it.locked || undefined}
          aria-label={it.locked ? `${it.label}, ${t.picker.plus}` : undefined}
          tabIndex={it.value === value ? 0 : -1}
          className={`${ui.segment} ${it.locked ? s.segmentLocked : ''}`}
          onClick={() => !it.locked && onChange(it.value)}
        >
          {it.value === value && <motion.span layoutId={thumb} className={ui.segmentThumb} transition={{ duration: 0.18, ease: [0.165, 0.84, 0.44, 1] }} />}
          <span className={ui.segmentLabel}>
            {it.label}
            {it.locked && <Icon icon={Lock} size={12} />}
          </span>
        </button>
      ))}
    </div>
  )
}
