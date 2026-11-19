import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { WorldEngine } from './engine/World'
import { t } from './strings'
import s from './worlds.module.css'

const RADIUS = 48
const DEAD = 0.18

/**
 * The on-screen stick of a touch screen (WASD on a keyboard): drag the knob, the figure walks where the camera looks.
 * Taps on the room still walk to the spot and sit on chairs; two fingers on the room pinch the camera.
 */
export function Joystick({ engine }: { engine: { current: WorldEngine | null } }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0, on: false })
  const id = useRef<number | null>(null)

  const move = (e: ReactPointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    let dx = e.clientX - (r.left + r.width / 2)
    let dy = e.clientY - (r.top + r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS
      dy = (dy / len) * RADIUS
    }
    setKnob({ x: dx, y: dy, on: true })
    const mag = Math.min(1, len / RADIUS)
    engine.current?.setStick(mag < DEAD ? 0 : dx / RADIUS, mag < DEAD ? 0 : -dy / RADIUS)
  }
  const end = () => {
    id.current = null
    setKnob({ x: 0, y: 0, on: false })
    engine.current?.setStick(0, 0)
  }

  return (
    <div
      ref={base}
      className={s.stick}
      role="application"
      aria-label={t.hud.stick}
      data-on={knob.on || undefined}
      onPointerDown={(e) => {
        if (id.current !== null) return
        id.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
        navigator.vibrate?.(8)
      }}
      onPointerMove={(e) => e.pointerId === id.current && move(e)}
      onPointerUp={(e) => e.pointerId === id.current && end()}
      onPointerCancel={(e) => e.pointerId === id.current && end()}
    >
      <span className={s.stickKnob} style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  )
}
