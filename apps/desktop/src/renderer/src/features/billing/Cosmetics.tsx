import type { PresenceStatus } from '@alga/shared'
import { useRef, type ReactNode } from 'react'
import { Avatar, useEnvelope, type AvatarUser } from '@/ui'
import { hueFor, type AvatarSize } from '@/ui/Avatar'
import { useAurasOn, type Motion } from './engine'
import { HA, HORA_AZUL } from './hora-azul'
import { COSMETICS, type CosmeticId, type Look, type Slot } from './look'
import { AppIcon } from './render/AppIcon'
import { Decoration } from './render/Decoration'
import { Plate, ProfileEffect } from './render/Profile'
import { playEntranceSound } from './render/sound'
import { AuraGlyph, EMOTES, ReactionGlyph, replacesRing, StreamFrame, VoiceAura } from './render/Voice'
import s from './cosmetics.module.css'

/*
 * Cosmetics rendering engine, Coleção 01 "Hora Azul" (docs/business/growth-plan.md §3). One renderer per slot in
 * render/, driven by catalog ids (hora-azul.ts); motion rules in engine.ts. This file composes them where people see
 * them: avatar + decoration (+ voice aura on a tile), name + plate, the profile card, shop thumbnails, and the
 * generic <Cosmetic slot id size state /> for the store and try-on UI.
 */

export type { Motion } from './engine'
export { AuraGlyph, ReactionLayer, showReaction, StreamFrame } from './render/Voice'
export { useCosmeticPreview } from './store'

export function DecoratedAvatar({
  user,
  size,
  presence,
  decoration,
  aura,
  decorative,
  play,
  glow,
  motion,
}: {
  user: AvatarUser
  size: AvatarSize
  presence?: PresenceStatus
  decoration?: CosmeticId
  /** Voice aura (call tiles, with `glow`): replaces the default speaking ring while the stage allows auras. */
  aura?: CosmeticId
  decorative?: boolean
  /** Shorthand for motion="play" (profile card). */
  play?: boolean
  /** Speaking ring driven by an ancestor's --speak (call tiles). The decoration stays still on the stage. */
  glow?: boolean
  /** Default: play with `play`, still with `glow`, once per hover otherwise (lists). */
  motion?: Motion
}) {
  const aurasOn = useAurasOn()
  const auraOn = !!glow && aurasOn && replacesRing(aura)
  return (
    <span className={s.decoWrap} style={{ width: size, height: size }}>
      <Avatar user={user} size={size} presence={presence} decorative={decorative} glow={glow && !auraOn} />
      {auraOn && <VoiceAura id={aura!} size={size} />}
      {decoration && <Decoration id={decoration} size={size} motion={motion ?? (play ? 'play' : glow ? 'rest' : 'hover')} />}
    </span>
  )
}

/** Background behind a name. `row` = the list version, moving once per hover of its row. */
export function Nameplate({ id, children, row, play, motion }: { id?: CosmeticId; children: ReactNode; row?: boolean; play?: boolean; motion?: Motion }) {
  return (
    <Plate id={id} row={row} motion={motion ?? (play ? 'play' : row ? 'hover' : 'rest')}>
      {children}
    </Plate>
  )
}

export interface ProfileUser extends AvatarUser {
  username: string
  bio?: string
}

/**
 * The profile card (popovers, the shop preview). The theme paints the card and its banner, the effect plays over
 * the banner, the decoration rings the avatar, the plate sits behind the name. Everything plays once on open.
 */
export function ProfileCard({
  user,
  look,
  name,
  presence,
  children,
  motion = 'play',
}: {
  user: ProfileUser
  look: Look
  /** Overrides the display name (space nickname). */
  name?: string
  presence?: PresenceStatus
  children?: ReactNode
  motion?: Motion
}) {
  const hueBanner = user.accentColor ?? `oklch(0.45 0.05 ${hueFor(user.id)})`
  return (
    <div className={s.card} data-theme={look.theme} style={{ ['--banner' as string]: hueBanner }}>
      <div className={s.banner} />
      <ProfileEffect id={look.effect} seed={user.id} motion={motion} />
      <div className={s.avatarSlot}>
        <span className={s.avatarRing}>
          <DecoratedAvatar user={user} size={80} presence={presence} decoration={look.decoration} decorative motion={motion} />
        </span>
      </div>
      <div className={s.body}>
        <div className={s.name}>
          <Nameplate id={look.nameplate} motion={motion}>
            {name ?? user.displayName}
          </Nameplate>
        </div>
        <div className={s.username}>@{user.username}</div>
        {user.bio && <p className={s.bio}>{user.bio}</p>}
        {children}
      </div>
    </div>
  )
}

/** A phrase-shaped fake voice level (syllables inside 2.4 s phrases, 0.9 s pauses): previews and the perf bench. */
export const demoLevel = (offset = 0) => () => {
  const t = performance.now() / 1000 + offset
  const phrase = t % 3.3 < 2.4 ? 1 : 0
  const syl = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6)) ** 1.5
  return phrase * syl * (0.55 + 0.45 * Math.sin(t * 1.7) ** 2)
}

/** An avatar on a call-tile-like surface, speaking with `level` (or held at --speak .8 when still). */
export function SpeakingSample({
  user,
  size,
  aura,
  decoration,
  level,
  className,
  children,
}: {
  user: AvatarUser
  size: AvatarSize
  aura?: CosmeticId
  decoration?: CosmeticId
  level?: () => number
  className?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEnvelope(ref, level ?? null)
  return (
    <span ref={ref} className={`${s.speakSample} ${className ?? ''}`} data-speak-host style={level ? undefined : { ['--speak' as string]: 0.8 }}>
      <DecoratedAvatar user={user} size={size} glow decorative aura={aura} decoration={decoration} />
      {children}
    </span>
  )
}

/** A stand-in stream (16:9 gradient "content") wearing a frame. */
export function StreamSample({ id, width, motion = 'play' }: { id: CosmeticId; width: number; motion?: Motion }) {
  return (
    // Sized so the area inside the 8 px letterbox is exactly 16:9, like a framed 16:9 stream.
    <span className={s.streamSample} style={{ width, height: ((width - 16) * 9) / 16 + 16 }}>
      <span className={s.streamContent} />
      <StreamFrame id={id} motion={motion} />
    </span>
  )
}

const SAMPLE_USER: ProfileUser = { id: 'sample', displayName: 'Você', username: 'voce', avatarUrl: null }

/** A sound item's sign: a glass bell's ripples (three arcs from 11 h), no speaker icon. */
function SoundGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden fill="none" strokeLinecap="round">
      <circle cx="5" cy="11" r="2" fill={HA.indigoLight} />
      <path d="M8.5 9.5A4 4 0 0 0 6.5 7.5" stroke={HA.lilac} strokeWidth="1.25" />
      <path d="M11.3 9A7 7 0 0 0 7 4.7" stroke={HA.lilac} strokeOpacity="0.7" strokeWidth="1.25" />
      <path d="M14 8.5A10 10 0 0 0 7.5 2" stroke={HA.lilac} strokeOpacity="0.4" strokeWidth="1.25" />
    </svg>
  )
}

/**
 * One item in context, for the store and try-on UI: the decoration on an avatar of `size`, the plate behind a
 * name, a card for themes and effects, a speaking avatar for auras, a stream for frames, the reactions, a play
 * button for sounds, the app icon. `state`: rest (still), play (its gesture once on mount), hover (once per hover).
 * A `slot` that does not match the id draws nothing (an old client meeting a new SKU draws less, never wrong).
 */
export function Cosmetic({ slot, id, size = 80, state = 'rest', user = SAMPLE_USER }: { slot?: Slot; id: CosmeticId; size?: AvatarSize; state?: Motion; user?: ProfileUser }) {
  const kind = COSMETICS[id]
  if (!kind || (slot && slot !== kind)) return null
  if (kind === 'decoration') return <DecoratedAvatar user={user} size={size} decoration={id} decorative motion={state} />
  if (kind === 'nameplate')
    return (
      <span className={s.sampleName}>
        <Nameplate id={id} motion={state}>
          {user.displayName}
        </Nameplate>
      </span>
    )
  if (kind === 'theme' || kind === 'effect') return <ProfileCard user={user} look={{ [kind]: id }} motion={state} />
  if (kind === 'aura')
    return (
      <SpeakingSample user={user} size={size} aura={id} level={state === 'rest' ? undefined : demoLevel()}>
        <span className={s.pill}>
          <AuraGlyph id={id} />
          {user.displayName}
        </span>
      </SpeakingSample>
    )
  if (kind === 'frame') return <StreamSample id={id} width={size * 3} motion={state} />
  if (kind === 'reactions')
    return (
      <span className={s.emotes}>
        {EMOTES.map((e) => (
          <ReactionGlyph key={e} emote={e} size={Math.max(24, Math.round(size / 2))} />
        ))}
      </span>
    )
  if (kind === 'sound')
    return (
      <button type="button" className={s.soundSample} onClick={() => playEntranceSound(id)} aria-label={`Ouvir ${HORA_AZUL[id].name}`}>
        <SoundGlyph />
        {HORA_AZUL[id].name}
      </button>
    )
  return <AppIcon id={id} size={size} />
}

/** Small stand-alone sample of one item (shop tiles: 96 px, still). */
export function CosmeticThumb({ id, user }: { id: CosmeticId; user: ProfileUser }) {
  const slot = COSMETICS[id]
  if (slot === 'decoration') return <DecoratedAvatar user={user} size={56} decoration={id} decorative motion="rest" />
  if (slot === 'nameplate')
    return (
      <span className={s.thumbName}>
        <Nameplate id={id} row motion="rest">
          {user.displayName}
        </Nameplate>
      </span>
    )
  if (slot === 'theme' || slot === 'effect')
    return (
      <span className={`${s.card} ${s.thumbCard}`} data-theme={slot === 'theme' ? id : undefined} style={{ ['--banner' as string]: 'var(--bg-raised)' }}>
        <span className={`${s.banner} ${s.thumbBanner}`} />
        <ProfileEffect id={id} seed={user.id} motion="rest" pose />
      </span>
    )
  if (slot === 'aura') return <SpeakingSample user={user} size={56} aura={id} />
  if (slot === 'frame') return <StreamSample id={id} width={132} motion="rest" />
  if (slot === 'reactions') return <ReactionGlyph emote="heart" size={48} />
  if (slot === 'icon') return <AppIcon id={id} size={56} />
  return <SoundGlyph size={40} />
}
