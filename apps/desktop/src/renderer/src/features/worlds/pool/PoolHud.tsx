// What the screen shows of a pool table over the 3D room: the hint to take a cue, the scoreboard, and while the cue
// is mine the power and the spin. The room itself (PoolRoom) owns aiming and the shot; this only reads and nudges it.
import type { PoolGroup, PoolState } from '@alga/shared'
import { useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon, IconButton } from '@/ui'
import { Eye, LogOut, RotateCcw } from '@/ui/icons'
import { t } from '../strings'
import s from '../worlds.module.css'
import type { PoolRoom, PoolUi } from './PoolRoom'

/** Paint of each number, as on the balls (balls.ts): kept here too so the scoreboard does not load three.js for a colour. */
const PAINT = ['#f3efe2', '#f1bf12', '#1c49b8', '#cf2a1e', '#5a2a8a', '#ee7616', '#12733f', '#7c2222', '#0e0e0f']
const paintOf = (n: number): string => PAINT[n === 8 ? 8 : ((n - 1) % 8) + 1]!

function Ball({ n, gone }: { n: number; gone: boolean }) {
  const stripe = n > 8
  const style = { '--paint': paintOf(n) } as CSSProperties
  return <i className={`${s.poolBall} ${stripe ? s.poolStripe : ''} ${gone ? s.poolGone : ''}`} style={style} aria-hidden>{n}</i>
}

const ballsOf = (group: PoolGroup): number[] => (group === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15])

export interface PoolHudProps {
  ui: PoolUi
  /** The table I play at, as the scoreboard may show it (one shot behind while the balls roll). */
  state: PoolState | null
  meId: string | null
  nameOf(userId: string): string
  /** The room's pool, for the controls that act on it. */
  room(): PoolRoom | null
  onRack(table: string): void
}

export function PoolHud({ ui, state, meId, nameOf, room, onRack }: PoolHudProps) {
  const power = useRef<HTMLDivElement>(null)
  const spin = useRef<HTMLDivElement>(null)

  if (!ui.table) {
    if (!ui.near) return null
    return (
      <div className={s.hint} role="status">
        <kbd>E</kbd>
        <span>{t.pool.join}</span>
      </div>
    )
  }
  if (!state) return null

  const match = state.players.length === 2
  const shooter = state.players[state.turn]
  const mine = shooter === meId
  const who = (id: string): string => (id === meId ? t.pool.you : nameOf(id))
  const onTable = (n: number): boolean => !!state.balls[n]
  const left = state.balls.filter((b, i) => b && i > 0).length

  // One line for what is going on, one for what the last shot did.
  let now: string
  if (state.phase === 'over') now = state.winner === meId ? t.pool.youWon : t.pool.won(who(state.winner ?? ''))
  else if (ui.rolling) now = t.pool.rolling
  else if (mine && state.hand) now = state.hand === 'kitchen' ? t.pool.handKitchen : t.pool.hand
  else if (!match) now = state.breaking ? t.pool.breakShot : t.pool.left(left)
  else now = mine ? t.pool.yourTurn : t.pool.turnOf(who(shooter ?? ''))
  const last = state.last
  const then = !last || ui.rolling ? null : last.foul ? t.pool.foul[last.foul] : last.potted.length ? t.pool.potted(last.potted.length) : null

  const dragPower = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = power.current, r = room()
    if (!el || !r || !ui.aiming) return
    el.setPointerCapture(e.pointerId)
    const box = el.getBoundingClientRect()
    const at = (y: number): number => (y - box.top - 10) / (box.height - 20)
    r.setPull(at(e.clientY))
    const move = (ev: PointerEvent): void => r.setPull(at(ev.clientY))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      r.release()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const dragSpin = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = spin.current, r = room()
    if (!el || !r) return
    el.setPointerCapture(e.pointerId)
    const box = el.getBoundingClientRect()
    // The ball on screen is the ball as the player sees it: right is right, up is up. Its edge is a miscue.
    const set = (x: number, y: number): void => r.setSpin(((x - box.left) / box.width - 0.5) * 2, -((y - box.top) / box.height - 0.5) * 2)
    set(e.clientX, e.clientY)
    const move = (ev: PointerEvent): void => set(ev.clientX, ev.clientY)
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const spinKey = (e: ReactKeyboardEvent): void => {
    const step = e.shiftKey ? 0.02 : 0.08
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    room()?.setSpin(ui.spin[0] + d[0]!, ui.spin[1] + d[1]!)
  }

  return (
    <>
      <div className={s.poolBoard} role="status" aria-live="polite" aria-label={t.pool.scoreboard}>
        {match ? (
          <div className={s.poolPlayers}>
            {state.players.map((id, i) => {
              const group = state.groups?.[i] ?? null
              return (
                <div key={id} className={`${s.poolPlayer} ${i === state.turn && state.phase === 'play' ? s.poolTurn : ''} ${state.winner === id ? s.poolWinner : ''}`}>
                  <strong>{who(id)}</strong>
                  <span className={s.poolGroup}>{group ? t.pool.groups[group] : t.pool.open}</span>
                  <span className={s.poolBalls}>
                    {group ? ballsOf(group).map((n) => <Ball key={n} n={n} gone={!onTable(n)} />) : null}
                    {group && !ballsOf(group).some(onTable) ? <Ball n={8} gone={!onTable(8)} /> : null}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className={s.poolPlayers}>
            <div className={`${s.poolPlayer} ${s.poolTurn}`}>
              <strong>{t.pool.practice}</strong>
              <span className={s.poolGroup}>{t.pool.practiceHint}</span>
              <span className={s.poolBalls}>
                {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => <Ball key={n} n={n} gone={!onTable(n)} />)}
              </span>
            </div>
          </div>
        )}
        <div className={s.poolNow}>
          <strong>{now}</strong>
          {then && <span>{then}</span>}
        </div>
        <div className={s.poolActions}>
          <IconButton icon={Eye} label={ui.top ? t.pool.topOff : `${t.pool.top} (V)`} tooltipSide="bottom" onClick={() => room()?.toggleTop()} />
          <IconButton icon={RotateCcw} label={state.phase === 'over' ? t.pool.again : t.pool.rack} tooltipSide="bottom" onClick={() => onRack(state.table)} disabled={ui.rolling} />
          <IconButton icon={LogOut} label={`${t.pool.leave} (Esc)`} tooltipSide="bottom" onClick={() => room()?.leave()} />
        </div>
      </div>

      {ui.aiming && (
        <>
          <div className={s.poolPower}>
            <span>{t.pool.power}</span>
            <div
              ref={power} className={s.poolPowerTrack} role="slider" tabIndex={0} aria-label={t.pool.power} aria-description={t.pool.powerHint}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ui.pull * 100)} onPointerDown={dragPower}
              onKeyDown={(e) => {
                const r = room()
                if (!r) return
                if (e.key === 'ArrowDown') r.setPull(ui.pull + 0.05)
                else if (e.key === 'ArrowUp') r.setPull(ui.pull - 0.05)
                else if (e.key === 'Enter') r.release()
                else return
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <i className={s.poolPowerFill} style={{ transform: `scaleY(${ui.pull})` }} />
              <i className={s.poolPowerKnob} style={{ top: `calc(10px + (100% - 20px) * ${ui.pull})` }} />
            </div>
            <span className={s.poolPowerValue}>{Math.round(ui.pull * 100)}</span>
          </div>

          <div className={s.poolSpin}>
            <div
              ref={spin} className={s.poolSpinBall} role="slider" tabIndex={0} aria-label={t.pool.spin} aria-description={t.pool.spinHint}
              aria-valuetext={`${Math.round(ui.spin[0] * 100)}, ${Math.round(ui.spin[1] * 100)}`} aria-valuenow={Math.round(ui.spin[0] * 100)}
              onPointerDown={dragSpin} onDoubleClick={() => room()?.setSpin(0, 0)} onKeyDown={spinKey}
            >
              <i style={{ left: `${50 + ui.spin[0] * 50}%`, top: `${50 - ui.spin[1] * 50}%` }} />
            </div>
            <span>{t.pool.spin}</span>
          </div>

          <div className={s.poolHelp}>
            <Icon icon={Eye} size={14} />
            <span>{ui.top ? t.pool.controlsTop : t.pool.controls}</span>
          </div>
        </>
      )}
    </>
  )
}
