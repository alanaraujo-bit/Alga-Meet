import { MAX_SOUND_MS } from '@alga/shared'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { clampWindow, peaks } from './audio-edit'
import { t } from './strings'
import s from './editor.module.css'

export interface Win { start: number; end: number }

const MIN_VIEW_MS = 400

/**
 * Waveform of the whole file with the ≤ 5 s selection: drag a handle to trim, drag the selection to move it, click
 * outside to start a new one there, wheel to zoom around the pointer (Shift + wheel pans). Keyboard on the handles.
 */
export function Waveform({ samples, rate, win, onChange, playheadMs }: {
  samples: Float32Array
  rate: number
  win: Win
  onChange: (w: Win) => void
  playheadMs: number | null
}) {
  const totalMs = (samples.length / rate) * 1000
  const [view, setView] = useState<{ from: number; to: number }>(() => ({ from: 0, to: totalMs }))
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(600)
  const drag = useRef<{ kind: 'start' | 'end' | 'move'; at: number; win: Win } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Draw the visible range: mirrored bars, brighter inside the selection.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const h = 96
    c.width = Math.round(width * dpr)
    c.height = h * dpr
    const g = c.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, width, h)
    const from = Math.floor((view.from / 1000) * rate)
    const to = Math.ceil((view.to / 1000) * rate)
    const bars = Math.max(1, Math.floor(width / 3))
    const p = peaks(samples.subarray(from, to), bars)
    const css = getComputedStyle(c)
    const on = css.getPropertyValue('--wave-on').trim() || '#8b8ef7'
    const off = css.getPropertyValue('--wave-off').trim() || '#3a3b40'
    for (let i = 0; i < bars; i++) {
      const ms = view.from + ((i + 0.5) / bars) * (view.to - view.from)
      const amp = Math.max(1, Math.sqrt(p[i]!) * (h / 2 - 4))
      g.fillStyle = ms >= win.start && ms <= win.end ? on : off
      g.beginPath()
      g.roundRect(i * 3, h / 2 - amp, 2, amp * 2, 1)
      g.fill()
    }
  }, [samples, rate, view, width, win.start, win.end])

  const x = (ms: number) => ((ms - view.from) / (view.to - view.from)) * width
  const msAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    return view.from + ((clientX - r.left) / r.width) * (view.to - view.from)
  }

  const down = (kind: 'start' | 'end' | 'move' | 'new') => (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const at = msAt(e.clientX)
    if (kind === 'new') {
      const len = Math.min(win.end - win.start, MAX_SOUND_MS)
      const w = clampWindow({ start: at, end: at + len }, totalMs)
      onChange(w)
      drag.current = { kind: 'move', at, win: w }
      return
    }
    drag.current = { kind, at, win }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const at = msAt(e.clientX)
    if (d.kind === 'move') {
      const len = d.win.end - d.win.start
      const start = Math.min(Math.max(0, d.win.start + at - d.at), totalMs - len)
      onChange({ start, end: start + len })
    } else if (d.kind === 'start') {
      const start = Math.max(0, Math.min(at, d.win.end - 50, ))
      onChange(clampWindow({ start: Math.max(start, d.win.end - MAX_SOUND_MS), end: d.win.end }, totalMs))
    } else {
      const end = Math.min(totalMs, Math.max(at, d.win.start + 50))
      onChange(clampWindow({ start: d.win.start, end: Math.min(end, d.win.start + MAX_SOUND_MS) }, totalMs))
    }
  }
  const up = () => { drag.current = null }

  const wheel = (e: WheelEvent) => {
    const span = view.to - view.from
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const shift = ((e.deltaX || e.deltaY) / width) * span
      const from = Math.min(Math.max(0, view.from + shift), totalMs - span)
      setView({ from, to: from + span })
      return
    }
    const at = msAt(e.clientX)
    const next = Math.min(totalMs, Math.max(Math.min(MIN_VIEW_MS, totalMs), span * (e.deltaY > 0 ? 1.2 : 1 / 1.2)))
    const k = (at - view.from) / span
    const from = Math.min(Math.max(0, at - k * next), totalMs - next)
    setView({ from, to: from + next })
  }

  const key = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 100 : 10
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!dir) return
    e.preventDefault()
    if (which === 'start') onChange(clampWindow({ start: Math.max(win.start + dir * step, win.end - MAX_SOUND_MS), end: win.end }, totalMs))
    else onChange(clampWindow({ start: win.start, end: Math.min(win.end + dir * step, win.start + MAX_SOUND_MS) }, totalMs))
  }

  const left = Math.max(0, x(win.start))
  const right = Math.min(width, x(win.end))
  const zoomed = view.to - view.from < totalMs - 1
  return (
    <div className={s.waveWrap}>
      <div ref={box} className={s.wave} onPointerDown={down('new')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
        role="group" aria-label={t.editor.waveform}>
        <canvas ref={canvas} className={s.canvas} style={{ width: '100%', height: 96 }} />
        <div className={s.shade} style={{ left: 0, width: left }} />
        <div className={s.shade} style={{ left: right, right: 0 }} />
        {right > left && (
          <div className={s.sel} style={{ left, width: right - left }} onPointerDown={down('move')}>
            <span className={s.selLabel}>{t.editor.selection(win.end - win.start)}</span>
          </div>
        )}
        <div role="slider" tabIndex={0} className={`${s.handle} ${s.handleStart}`} style={{ left }} onPointerDown={down('start')} onKeyDown={key('start')}
          aria-label={t.editor.startHandle} aria-valuemin={0} aria-valuemax={Math.round(totalMs)} aria-valuenow={Math.round(win.start)}
          aria-valuetext={`${(win.start / 1000).toFixed(2)} s`} />
        <div role="slider" tabIndex={0} className={`${s.handle} ${s.handleEnd}`} style={{ left: right }} onPointerDown={down('end')} onKeyDown={key('end')}
          aria-label={t.editor.endHandle} aria-valuemin={0} aria-valuemax={Math.round(totalMs)} aria-valuenow={Math.round(win.end)}
          aria-valuetext={`${(win.end / 1000).toFixed(2)} s`} />
        {playheadMs !== null && playheadMs >= view.from && playheadMs <= view.to && <div className={s.playhead} style={{ left: x(playheadMs) }} />}
      </div>
      <div className={s.ruler}>
        <span>{(view.from / 1000).toFixed(1)} s</span>
        {zoomed && <button type="button" className={s.unzoom} onClick={() => setView({ from: 0, to: totalMs })}>{t.editor.showAll}</button>}
        <span>{(view.to / 1000).toFixed(1)} s</span>
      </div>
    </div>
  )
}
