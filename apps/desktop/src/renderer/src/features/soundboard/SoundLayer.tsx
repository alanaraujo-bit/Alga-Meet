import { useSoundboard } from './store'
import s from './soundboard.module.css'

/** On a seat's face while that person's sound plays: a soft ring and the sound's emoji rising once (≈1 s). */
export function SoundLayer({ userId }: { userId: string }) {
  const p = useSoundboard((st) => st.playing[userId])
  if (!p) return null
  return (
    <span className={s.layer} aria-hidden key={p.playId}>
      <span className={s.ring} />
      <span className={s.rise}>{p.emoji ?? '🔊'}</span>
    </span>
  )
}
