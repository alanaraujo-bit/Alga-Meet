import { ALGA_SOUNDS, MAX_SOUNDS_PER_SPACE, Permission, hasPermission, type Channel } from '@alga/shared'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { spacePermissions } from '@/store/selectors'
import { Headphones, Pencil, Plus, Search, Trash2, Volume2, VolumeX, Waveform } from '@/ui/icons'
import { Icon, Popover, Switch, toast } from '@/ui'
import { filterSounds, tileState, type TileClock } from './logic'
import { deleteSound, openEditor, playSound, preview, setMuted, setVolume, useSoundboard } from './store'
import { t } from './strings'
import s from './soundboard.module.css'

interface TileSound { id: string; name: string; emoji: string | null; durationMs: number }

/** Re-renders every frame until `until` (cooldown ring, progress bar), plus one timer render at the end: rAF can be
 * throttled in a background window, and the tiles must never look ready while the store still says cooldown. */
function useNow(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const left = until - Date.now()
    if (left <= 0) return
    let raf = 0
    const tick = () => { setNow(Date.now()); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    const end = setTimeout(() => { cancelAnimationFrame(raf); setNow(Date.now()) }, left + 16)
    return () => { cancelAnimationFrame(raf); clearTimeout(end) }
  }, [until])
  return Date.now() < until ? now : Date.now()
}

export function SoundboardPanel({ anchor, onClose, channel }: { anchor: HTMLElement | null; onClose: () => void; channel: Channel }) {
  return (
    <Popover anchor={anchor} onClose={onClose} side="top" align="center" gap={12} label={t.title} width={392}>
      <Panel channel={channel} />
    </Popover>
  )
}

function Panel({ channel }: { channel: Channel }) {
  const spaceId = channel.spaceId!
  const sounds = useSoundboard((st) => st.bySpace[spaceId])
  const sb = useSoundboard(useShallow((st) => ({ volume: st.volume, muted: st.muted, mine: st.mine, cooldownFrom: st.cooldownFrom, cooldownUntil: st.cooldownUntil })))
  const meId = useData((st) => st.me?.id ?? '')
  const perms = useData((st) => spacePermissions(st, spaceId))
  const serverMute = useData((st) => !!st.voiceStates[meId]?.serverMute)
  const canUse = hasPermission(perms, Permission.USE_SOUNDBOARD) && !serverMute
  const canManage = hasPermission(perms, Permission.MANAGE_SOUNDBOARD)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const list = sounds ?? []
  const shown = useMemo(() => filterSounds(list, query), [list, query])
  const alga = useMemo(() => filterSounds([...ALGA_SOUNDS], query), [query])
  const now = useNow(Math.max(sb.cooldownUntil, sb.mine?.until ?? 0))
  const clock: TileClock = { now, cooldownFrom: sb.cooldownFrom, cooldownUntil: sb.cooldownUntil, canUse, playingMine: sb.mine }
  const searchable = list.length + ALGA_SOUNDS.length > 12

  const fire = async (id: string) => {
    const r = await playSound(channel.id, id)
    if (!r.ok) toast.info(r.message)
  }
  const remove = async (id: string) => {
    setConfirm(null)
    try { await deleteSound(spaceId, id) } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className={s.panel}>
      <header className={s.head}>
        <span className={s.title}><Icon icon={Waveform} size={16} /> {t.title}</span>
        {canManage && <span className={s.count} aria-label={`${list.length} de ${MAX_SOUNDS_PER_SPACE} sons`}>{t.count(list.length)}</span>}
      </header>
      {searchable && (
        <label className={s.search}>
          <Icon icon={Search} size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} />
        </label>
      )}
      {!canUse && <p className={s.notice}>{serverMute ? t.readOnlyMuted : t.readOnlyNoPermission}</p>}

      <div className={s.scroll}>
        {(list.length > 0 || canManage || ALGA_SOUNDS.length === 0) && (
          <section aria-label={t.spaceSection}>
            {ALGA_SOUNDS.length > 0 && <h3 className={s.section}>{t.spaceSection}</h3>}
            {list.length === 0 && !canManage ? (
              <div className={s.empty}><strong>{t.emptyTitle}</strong><span>{t.emptyMember}</span></div>
            ) : (
              <div className={s.grid}>
                {shown.map((snd) => (
                  confirm === snd.id ? (
                    <div key={snd.id} className={`${s.tile} ${s.confirm}`} role="group" aria-label={t.removeConfirm(snd.name)}>
                      <span className={s.confirmText}>{t.removeConfirm(snd.name)}</span>
                      <div className={s.confirmRow}>
                        <button type="button" className={s.confirmNo} onClick={() => setConfirm(null)} autoFocus>{t.cancel}</button>
                        <button type="button" className={s.confirmYes} onClick={() => void remove(snd.id)}>{t.removeYes}</button>
                      </div>
                    </div>
                  ) : (
                    <Tile key={snd.id} sound={snd} clock={clock} onPlay={() => void fire(snd.id)} onPreview={() => void preview(spaceId, snd.id)}
                      manage={canManage ? { rename: () => openEditor({ spaceId, sound: snd }), remove: () => setConfirm(snd.id) } : undefined} />
                  )
                ))}
                {canManage && !query && list.length < MAX_SOUNDS_PER_SPACE && (
                  <button type="button" className={`${s.tile} ${s.add}`} onClick={() => openEditor({ spaceId })}>
                    <Icon icon={Plus} size={20} />
                    <span className={s.name}>{t.add}</span>
                  </button>
                )}
              </div>
            )}
            {list.length === 0 && canManage && <p className={s.hint}>{t.emptyManager}</p>}
            {query && shown.length === 0 && alga.length === 0 && <p className={s.hint}>{t.noResults}</p>}
          </section>
        )}
        {ALGA_SOUNDS.length > 0 && alga.length > 0 && (
          <section aria-label={t.algaSection}>
            <h3 className={s.section}>{t.algaSection}</h3>
            <div className={s.grid}>
              {alga.map((snd) => (
                <Tile key={snd.id} sound={snd} clock={clock} onPlay={() => void fire(snd.id)} onPreview={() => void preview(spaceId, snd.id)} />
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className={s.foot}>
        <button type="button" className={s.muteBtn} onClick={() => setMuted(!sb.muted)} aria-label={sb.muted ? t.mute : t.volume}>
          <Icon icon={sb.muted ? VolumeX : Volume2} size={16} />
        </button>
        <input
          className={s.volume}
          type="range" min={0} max={100} step={1}
          value={Math.round(sb.volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          aria-label={t.volume}
          disabled={sb.muted}
          style={{ ['--v' as string]: `${Math.round(sb.volume * 100)}%` } as CSSProperties}
        />
        <label className={s.muteLabel}>
          <span>{t.mute}</span>
          <Switch checked={sb.muted} onChange={setMuted} label={t.mute} />
        </label>
      </footer>
      {sb.muted && <p className={s.mutedHint}>{t.mutedHint}</p>}
    </div>
  )
}

function Tile({ sound, clock, onPlay, onPreview, manage }: {
  sound: TileSound
  clock: TileClock
  onPlay: () => void
  onPreview: () => void
  manage?: { rename: () => void; remove: () => void }
}) {
  const st = tileState(clock, sound.id)
  const disabled = st.kind === 'disabled' || st.kind === 'cooldown'
  return (
    <div className={s.tile} data-state={st.kind} style={{ ['--p' as string]: st.progress } as CSSProperties}>
      <button type="button" className={s.hit} onClick={disabled ? undefined : onPlay} aria-disabled={disabled || undefined} aria-label={t.play(sound.name)}>
        <span className={s.emoji} aria-hidden>{sound.emoji ?? '🔊'}</span>
        <span className={s.name}>{sound.name}</span>
        <span className={s.dur}>{t.duration(sound.durationMs)}</span>
      </button>
      <span className={s.fill} aria-hidden />
      <button type="button" className={`${s.tool} ${s.toolPreview}`} onClick={onPreview} aria-label={t.preview(sound.name)} title={t.preview(sound.name)}>
        <Icon icon={Headphones} size={12} />
      </button>
      {manage && (
        <div className={s.tools}>
          <button type="button" className={s.tool} onClick={manage.rename} aria-label={`${t.rename}: ${sound.name}`} title={t.rename}>
            <Icon icon={Pencil} size={12} />
          </button>
          <button type="button" className={`${s.tool} ${s.toolDanger}`} onClick={manage.remove} aria-label={`${t.remove}: ${sound.name}`} title={t.remove}>
            <Icon icon={Trash2} size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
