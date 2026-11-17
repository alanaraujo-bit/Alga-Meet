// What the screen shows of the domino table I sit at, over the 3D room: who is at the table and whose turn it is, the
// score, and the two moments that need buttons (before the first deal, and between rounds). The room itself
// (DominoRoom) owns the tiles and the plays; this reads the game and asks for deals and bots.
import { DOMINO_BOT, DOMINO_GOAL, DOMINO_SEATS, DOMINO_TILES, dominoSide, type DominoView } from '@alga/shared'
import { useEffect, useState, type CSSProperties } from 'react'
import { Button, IconButton } from '@/ui'
import { Eye, LogOut, Minus, Play, Plus } from '@/ui/icons'
import { t } from '../strings'
import s from '../worlds.module.css'
import type { DominoRoom, DominoUi } from './DominoRoom'

export interface DominoHudProps {
  ui: DominoUi
  /** The table I sit at, as the server lets me see it. */
  view: DominoView | null
  /** When that arrived (performance.now): what `view.auto.ms` counts from. */
  at: number
  meId: string | null
  nameOf(userId: string): string
  room(): DominoRoom | null
  onStart(table: string): void
  onBot(table: string, add: boolean): void
  onStand(): void
}

const tileName = (tile: number): string => t.domino.tile(DOMINO_TILES[tile]![0], DOMINO_TILES[tile]![1])

/** Seconds left of something that ends `ms` after `at`, counted down on screen while `on`. */
function useCountdown(at: number, ms: number, on: boolean): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [on, at])
  return Math.max(0, Math.ceil((ms - (performance.now() - at)) / 1000))
}

export function DominoHud({ ui, view, at, meId, nameOf, room, onStart, onBot, onStand }: DominoHudProps) {
  const next = view?.auto?.kind === 'next' ? view.auto.ms : 0
  const seconds = useCountdown(at, next, next > 0)
  if (!ui.table || !view) return null

  const me = ui.seat
  const who = (seat: number): string => {
    const id = view.seats[seat]
    return id === DOMINO_BOT ? t.domino.bots[seat]! : id === meId ? t.domino.you : id ? nameOf(id) : t.domino.empty
  }
  /** The chairs in the order of play, starting with mine. */
  const order = Array.from({ length: DOMINO_SEATS }, (_, i) => (me + i) % DOMINO_SEATS)
  const taken = view.seats.filter(Boolean).length
  const bots = view.seats.filter((x) => x === DOMINO_BOT).length
  const mySide = dominoSide(view, me)
  const sideName = (side: number): string => (view.teams ? (side === mySide ? t.domino.us : t.domino.them) : who(side))
  const myTurn = view.phase === 'play' && view.turn === me
  // The tiles of a fresh deal are still on their way to the hands.
  const dealing = view.phase === 'play' && view.last?.k === 'deal' && performance.now() - at < 2400
  const r = view.result

  // One line for what is going on, one under it for what to do or what just happened.
  let now: string
  let then: string | null = null
  if (view.phase === 'lobby') {
    now = taken < 2 ? t.domino.waiting : t.domino.ready(taken)
    then = taken < 2 ? t.domino.waitingHint : t.domino.readyHint
  } else if (view.phase === 'done' && r) {
    now = r.side === null ? t.domino.out.tie : `${t.domino.out[r.kind]} ${t.domino.wonBy(sideName(r.side), t.domino.points(r.points))}`
    then = r.match
      ? (view.teams ? (r.side === mySide ? t.domino.matchUs : t.domino.matchThem) : r.side === me ? t.domino.matchYou : t.domino.matchOf(who(r.side ?? 0)))
      : r.kind === 'tie' ? t.domino.tieHint : r.kind === 'blocked' ? t.domino.blockedHint : null
  } else if (dealing) {
    now = t.domino.dealing
  } else if (myTurn) {
    if (view.auto?.kind === 'draw') now = t.domino.drawing
    else if (view.auto?.kind === 'pass') now = t.domino.passing
    else if (ui.choosing) {
      now = t.domino.choose
      then = t.domino.chooseHint
    } else {
      now = !view.line.length ? (view.must !== null ? t.domino.open(tileName(view.must)) : t.domino.openFree) : t.domino.yourTurn
      then = t.domino.yourTurnHint
    }
  } else {
    now = view.auto?.kind === 'draw' ? t.domino.drawingOf(who(view.turn)) : t.domino.turnOf(who(view.turn))
    if (view.last?.k === 'pass') then = view.last.seat === me ? t.domino.youPassed : t.domino.passed(who(view.last.seat))
  }

  const idle = view.auto?.kind === 'idle' ? view.auto.ms : 0

  return (
    <>
      <div className={s.domBoard} role="status" aria-live="polite" aria-label={t.domino.scoreboard}>
        <div className={s.domPlayers}>
          {order.filter((seat) => view.seats[seat]).map((seat) => {
            const side = dominoSide(view, seat)
            const turn = view.phase === 'play' && view.turn === seat
            const won = view.phase === 'done' && r?.side === side
            const partner = view.teams && seat !== me && side === mySide
            return (
              <div key={seat} className={`${s.domPlayer} ${turn ? s.domTurn : ''} ${won ? s.domWinner : ''}`} data-side={view.teams ? side : undefined}>
                <strong>{who(seat)}</strong>
                <span className={s.domMeta}>
                  {view.playing[seat] && view.phase === 'play' ? t.domino.tiles(view.counts[seat] ?? 0) : view.phase === 'done' && r ? (r.by === seat ? t.domino.wentOut : view.playing[seat] ? t.domino.left(r.pips[seat] ?? 0) : ' ') : ' '}
                  {partner ? ` · ${t.domino.partner}` : ''}
                </span>
                {!view.teams && view.round > 0 && <span className={s.domScore}>{view.score[seat] ?? 0}</span>}
                {turn && idle > 0 && <i key={view.seq} className={s.domClock} style={{ animationDuration: `${idle}ms` } as CSSProperties} />}
              </div>
            )
          })}
        </div>
        {view.teams && view.round > 0 && (
          <div className={s.domPairs} aria-label={t.domino.scoreboard}>
            <span data-side={mySide}>{t.domino.us}</span>
            <strong>{view.score[mySide] ?? 0}</strong>
            <i>×</i>
            <strong>{view.score[1 - mySide] ?? 0}</strong>
            <span data-side={1 - mySide}>{t.domino.them}</span>
          </div>
        )}
        <div className={s.domNow}>
          <strong>{now}</strong>
          <span>{then ?? (view.round > 0 ? `${t.domino.round(view.round)} · ${t.domino.goal(DOMINO_GOAL)}${view.stock > 0 ? ` · ${t.domino.stock(view.stock)}` : ''}` : ' ')}</span>
        </div>
        <div className={s.domActions}>
          <IconButton icon={Eye} label={ui.top ? t.domino.topOff : `${t.domino.top} (V)`} tooltipSide="bottom" onClick={() => room()?.toggleTop()} />
          <IconButton icon={LogOut} label={`${t.domino.stand} (E)`} tooltipSide="bottom" onClick={onStand} />
        </div>
      </div>

      {view.phase !== 'play' && (
        <div className={view.phase === 'done' ? `${s.domCard} ${s.domCardSide}` : s.domCard}>
          {view.phase === 'done' && r ? (
            <>
              <strong>{r.match ? (r.side !== null ? `${sideName(r.side)}: ${view.score[r.side] ?? 0} × ${Math.max(...view.score.filter((_, i) => i !== r.side))}` : '') : now}</strong>
              <span>{r.match ? t.domino.nextMatch(seconds) : t.domino.next(seconds)}</span>
              <Button variant="primary" icon={Play} onClick={() => onStart(view.table)} disabled={taken < 2}>{t.domino.again}</Button>
            </>
          ) : (
            <>
              <strong>{t.domino.title}</strong>
              <span>{then}</span>
              <div className={s.domCardRow}>
                <Button variant="primary" icon={Play} onClick={() => onStart(view.table)} disabled={taken < 2}>{t.domino.start}</Button>
                <Button variant="ghost" icon={Plus} onClick={() => onBot(view.table, true)} disabled={taken >= DOMINO_SEATS}>{t.domino.addBot}</Button>
                {bots > 0 && <Button variant="ghost" icon={Minus} onClick={() => onBot(view.table, false)}>{t.domino.removeBot}</Button>}
              </div>
            </>
          )}
        </div>
      )}

      {myTurn && !dealing && view.auto?.kind === 'idle' && !ui.choosing && view.round === 1 && view.line.length < 4 && (
        <div className={s.domHelp}>{t.domino.controls}</div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{ui.focus !== null ? t.domino.focus(tileName(ui.focus)) : ''}</span>
    </>
  )
}
