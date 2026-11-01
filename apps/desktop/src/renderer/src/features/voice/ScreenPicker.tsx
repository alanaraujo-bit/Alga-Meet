import { Check, Lock, Monitor, AppWindow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CaptureSource } from '../../../../shared/bridge'
import { media, useMedia, SCREEN_PRESETS, type ContentType, type ScreenPresetId } from '@/media'
import { Button, Icon, Modal, SegmentedControl, Spinner, Switch, Tabs } from '@/ui'
import { openSettings } from '../settings/store'
import { t } from './strings'
import { useVoice } from './voice'
import s from './picker.module.css'

type Kind = 'screen' | 'window'
const REFRESH_MS = 1500

/** What to share, at what quality, with or without sound. Nothing is captured until "Transmitir". */
export function ScreenPicker() {
  const open = useVoice((st) => st.picker)
  const close = () => useVoice.setState({ picker: false })
  return (
    <Modal open={open} onClose={close} title={t.picker.title} description={t.picker.description} width={800}>
      {open && <PickerBody onDone={close} />}
    </Modal>
  )
}

function PickerBody({ onDone }: { onDone: () => void }) {
  const screen = useMedia(useShallow((st) => ({ active: st.screen.active, preset: st.screen.preset, contentType: st.screen.contentType, audio: st.screen.audio, offered: st.screen.offered, locked: st.screen.locked, sourceId: st.screen.sourceId })))
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [kind, setKind] = useState<Kind>('screen')
  const [picked, setPicked] = useState<string | null>(null)
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
  // First open: the primary screen is preselected (the common case is one click away from "Transmitir").
  useEffect(() => {
    if (picked || !sources?.length) return
    setPicked(sources.find((x) => x.id === screen.sourceId)?.id ?? sources.find((x) => x.kind === 'screen')?.id ?? sources[0]!.id)
  }, [sources, picked, screen.sourceId])
  const chosen = sources?.find((x) => x.id === picked) ?? null
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
        <div className={s.grid} role="radiogroup" aria-label={kind === 'screen' ? t.picker.screens : t.picker.windows}>
          {!bridgeOk ? (
            <p className={s.note}>{t.picker.unavailable}</p>
          ) : sources === null ? (
            <p className={s.note}>
              <Spinner size={16} /> {t.picker.loading}
            </p>
          ) : list.length === 0 ? (
            <p className={s.note}>{kind === 'screen' ? t.picker.none.screens : t.picker.none.windows}</p>
          ) : (
            list.map((src) => (
              <button
                key={src.id}
                type="button"
                role="radio"
                aria-checked={src.id === picked}
                className={s.source}
                onClick={() => setPicked(src.id)}
                onDoubleClick={() => {
                  setPicked(src.id)
                  void start()
                }}
              >
                <span className={s.thumb}>
                  <img src={src.thumbnail} alt="" draggable={false} />
                  {src.id === picked && (
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
            ))
          )}
        </div>
      </div>

      <aside className={s.right} aria-label={t.picker.preview}>
        <div className={s.preview}>
          {chosen ? <img src={chosen.thumbnail} alt={`${t.picker.preview}: ${chosen.name}`} /> : <span className={s.note}>{t.picker.choose}</span>}
        </div>
        {chosen && <div className={s.previewName}>{chosen.name}</div>}

        <fieldset className={s.field}>
          <legend className={s.legend}>{t.picker.quality}</legend>
          <div role="radiogroup" aria-label={t.picker.quality} className={s.options}>
            {offered.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={p.id === quality} className={s.option} onClick={() => setQuality(p.id)}>
                <span>{p.label}</span>
                {p.id === quality && <Icon icon={Check} size={14} />}
              </button>
            ))}
            {/* What this computer could send but the plan doesn't include: visible, not selectable, never a modal. */}
            {screen.locked.map((p) => (
              <span key={p.id} role="radio" aria-checked={false} aria-disabled="true" className={`${s.option} ${s.optionLocked}`} aria-label={`${p.label}: ${t.picker.plus}`}>
                <span>{p.label}</span>
                <span className={s.plusTag}>
                  <Icon icon={Lock} size={12} />
                  {t.picker.plus}
                </span>
              </span>
            ))}
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
      </aside>
    </div>
  )
}
