import { MAX_SOUND_MS, SOUND_SAMPLE_RATE, type SpaceSound } from '@alga/shared'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ApiRequestError } from '@/lib/api'
import { EmojiPicker } from '@/features/chat/EmojiPicker'
import { Button, Icon, Modal, Switch, TextField, toast } from '@/ui'
import { FileAudio, Pause, Play, Repeat, Upload } from '@/ui/icons'
import { applyEdits, clampWindow, encodeWav, loudnessGainDb, mixdown } from './audio-edit'
import { cleanName } from './logic'
import { audioNow, playSamples } from './player'
import { openEditor, renameSound, uploadSound, useSoundboard } from './store'
import { t } from './strings'
import { Waveform, type Win } from './Waveform'
import s from './editor.module.css'

const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_INPUT_MS = 10 * 60 * 1000

/** New sound (pick → trim → save) or, with `sound`, rename + emoji. Mounted once in the call dock. */
export function SoundEditor() {
  const editor = useSoundboard((st) => st.editor)
  return (
    <Modal open={!!editor} onClose={() => openEditor(null)} title={editor?.sound ? t.rename : t.editor.title} width={editor?.sound ? 420 : 640}>
      {editor && (editor.sound ? <RenameForm spaceId={editor.spaceId} sound={editor.sound} /> : <NewSound spaceId={editor.spaceId} />)}
    </Modal>
  )
}

function MetaFields({ name, emoji, setName, setEmoji, nameError }: {
  name: string; emoji: string | null; setName: (v: string) => void; setEmoji: (v: string | null) => void; nameError?: string | null
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div className={s.meta}>
      <div className={s.emojiField}>
        <span className={s.fieldLabel}>{t.editor.emoji}</span>
        <button type="button" className={s.emojiBtn} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} aria-label={`${t.editor.emoji}: ${emoji ?? 'nenhum'}`} aria-expanded={!!anchor}>
          {emoji ?? <span className={s.emojiEmpty}>🙂</span>}
        </button>
        <EmojiPicker anchor={anchor} onClose={() => setAnchor(null)} onPick={(e) => { setEmoji(e); setAnchor(null) }} side="bottom" align="start" />
      </div>
      <div className={s.nameField}>
        <TextField label={t.editor.name} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} error={nameError ?? undefined} />
      </div>
    </div>
  )
}

function fieldError(e: unknown): { name?: string; file?: string; general?: string } {
  if (e instanceof ApiRequestError) return { name: e.fields?.name, file: e.fields?.file, general: e.fields?.name || e.fields?.file ? undefined : e.message }
  return { general: e instanceof Error ? e.message : String(e) }
}

function RenameForm({ spaceId, sound }: { spaceId: string; sound: SpaceSound }) {
  const [name, setName] = useState(sound.name)
  const [emoji, setEmoji] = useState<string | null>(sound.emoji)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    try {
      await renameSound(spaceId, sound.id, { name: name.trim(), emoji })
      openEditor(null)
    } catch (e) {
      const f = fieldError(e)
      setErr(f.name ?? null)
      if (f.general) toast.error(f.general)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); void save() }}>
      <MetaFields name={name} emoji={emoji} setName={setName} setEmoji={setEmoji} nameError={err} />
      <div className={s.actions}>
        <Button variant="ghost" onClick={() => openEditor(null)}>{t.cancel}</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>{t.save}</Button>
      </div>
    </form>
  )
}

interface Loaded { samples: Float32Array; fileName: string }

async function decode(file: File): Promise<Loaded> {
  if (file.size > MAX_INPUT_BYTES) throw new Error(t.editor.tooBig)
  let buf: AudioBuffer
  try {
    // An offline context at 48 kHz decodes and resamples in one go.
    buf = await new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: SOUND_SAMPLE_RATE }).decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error(t.editor.undecodable)
  }
  if (!buf.length || buf.duration * 1000 > MAX_INPUT_MS) throw new Error(buf.length ? t.editor.tooBig : t.editor.empty)
  const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
  return { samples: mixdown(channels), fileName: file.name }
}

/** Default selection: the loudest-starting 5 s, i.e. from the first non-silent sample. */
function firstWindow(samples: Float32Array): Win {
  const totalMs = (samples.length / SOUND_SAMPLE_RATE) * 1000
  let i = 0
  while (i < samples.length && Math.abs(samples[i]!) < 0.02) i++
  const start = Math.max(0, (i / SOUND_SAMPLE_RATE) * 1000 - 30)
  return clampWindow({ start, end: start + MAX_SOUND_MS }, totalMs)
}

function NewSound({ spaceId }: { spaceId: string }) {
  const [file, setFile] = useState<Loaded | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [pickErr, setPickErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const take = async (f: File | undefined) => {
    if (!f) return
    setPickErr(null)
    setDecoding(true)
    try { setFile(await decode(f)) } catch (e) { setPickErr(e instanceof Error ? e.message : String(e)) } finally { setDecoding(false) }
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void take(e.dataTransfer.files[0])
  }

  const picker = (
    <input ref={input} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm,.opus,.flac" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = '' }} />
  )

  if (!file) {
    return (
      <div
        className={`${s.drop} ${over ? s.dropOver : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {picker}
        <span className={s.dropIcon}><Icon icon={decoding ? FileAudio : Upload} size={24} /></span>
        <strong>{decoding ? t.editor.decoding : t.editor.drop}</strong>
        <span className={s.dropHint}>{t.editor.dropHint}</span>
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={decoding}>{t.editor.choose}</Button>
        {pickErr && <p className={s.error} role="alert">{pickErr}</p>}
      </div>
    )
  }
  return (
    <>
      {picker}
      <Trim key={file.fileName + file.samples.length} spaceId={spaceId} file={file} onOther={() => input.current?.click()} />
    </>
  )
}

function Trim({ spaceId, file, onOther }: { spaceId: string; file: Loaded; onOther: () => void }) {
  const rate = SOUND_SAMPLE_RATE
  const [win, setWin] = useState<Win>(() => firstWindow(file.samples))
  const [fadeIn, setFadeIn] = useState(0)
  const [fadeOut, setFadeOut] = useState(60)
  const [gain, setGain] = useState(0)
  const [normalize, setNormalize] = useState(true)
  const [loop, setLoop] = useState(false)
  const [name, setName] = useState(() => cleanName(file.fileName))
  const [emoji, setEmoji] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [errs, setErrs] = useState<{ name?: string; file?: string }>({})
  const [playhead, setPlayhead] = useState<number | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop

  const edits = { startMs: win.start, endMs: win.end, fadeInMs: fadeIn, fadeOutMs: fadeOut, gainDb: gain, normalize }
  const render = () => applyEdits(file.samples, rate, edits)

  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
    setPlayhead(null)
  }
  const play = () => {
    stop()
    const out = render()
    const t0 = audioNow()
    const startMs = win.start
    let raf = 0
    const tick = () => { setPlayhead(startMs + (audioNow() - t0) * 1000); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    const halt = playSamples(out, rate, 1, () => {
      cancelAnimationFrame(raf)
      stopRef.current = null
      setPlayhead(null)
      if (loopRef.current) play()
    })
    stopRef.current = () => { cancelAnimationFrame(raf); halt() }
  }
  useEffect(() => stop, [])
  // Changing the cut while previewing restarts the preview with the new edit.
  const changeWin = (w: Win) => { setWin(w); if (stopRef.current) stop() }

  const save = async () => {
    stop()
    setBusy(true)
    setErrs({})
    try {
      const wav = encodeWav(render())
      await uploadSound(spaceId, wav, { name: name.trim(), emoji }, setProgress)
      openEditor(null)
    } catch (e) {
      const f = fieldError(e)
      setErrs({ name: f.name, file: f.file })
      if (f.general) toast.error(f.general)
    } finally {
      setBusy(false)
    }
  }

  const autoGain = normalize ? loudnessGainDb(file.samples.subarray(Math.floor((win.start / 1000) * rate), Math.ceil((win.end / 1000) * rate))) : 0
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); void save() }}>
      <Waveform samples={file.samples} rate={rate} win={win} onChange={changeWin} playheadMs={playhead} />
      <div className={s.transport}>
        <Button variant="primary" size="sm" icon={playhead !== null ? Pause : Play} onClick={() => (playhead !== null ? stop() : play())}>
          {playhead !== null ? t.editor.pause : t.editor.play}
        </Button>
        <button type="button" className={`${s.chip} ${loop ? s.chipOn : ''}`} aria-pressed={loop} onClick={() => setLoop(!loop)}>
          <Icon icon={Repeat} size={14} /> {t.editor.loop}
        </button>
        <span className={s.max}>{t.editor.maxHint}</span>
        <button type="button" className={s.linkBtn} onClick={onOther}>{t.editor.other}</button>
      </div>
      {errs.file && <p className={s.error} role="alert">{errs.file}</p>}

      <div className={s.knobs}>
        <Slider label={t.editor.fadeIn} value={fadeIn} min={0} max={500} step={10} unit="ms" onChange={setFadeIn} />
        <Slider label={t.editor.fadeOut} value={fadeOut} min={0} max={500} step={10} unit="ms" onChange={setFadeOut} />
        <Slider label={t.editor.gain} value={gain} min={-12} max={12} step={0.5} unit="dB" onChange={setGain} signed />
        <div className={s.normalize}>
          <div>
            <span className={s.fieldLabel}>{t.editor.normalize}</span>
            <span className={s.knobHint}>{normalize ? `${t.editor.normalizeHint} (${autoGain >= 0 ? '+' : ''}${autoGain.toFixed(1)} dB)` : t.editor.normalizeHint}</span>
          </div>
          <Switch checked={normalize} onChange={setNormalize} label={t.editor.normalize} />
        </div>
      </div>

      <MetaFields name={name} emoji={emoji} setName={setName} setEmoji={setEmoji} nameError={errs.name} />
      <div className={s.actions}>
        <Button variant="ghost" onClick={() => openEditor(null)}>{t.cancel}</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>
          {busy ? `${t.editor.saving} ${Math.round(progress * 100)}%` : t.editor.save}
        </Button>
      </div>
    </form>
  )
}

function Slider({ label, value, min, max, step, unit, onChange, signed }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; signed?: boolean
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className={s.knob}>
      <span className={s.knobTop}>
        <span className={s.fieldLabel}>{label}</span>
        <span className={s.knobValue}>{signed && value > 0 ? '+' : ''}{value} {unit}</span>
      </span>
      <input type="range" className={s.range} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--v' as string]: `${pct}%` }} />
    </label>
  )
}
