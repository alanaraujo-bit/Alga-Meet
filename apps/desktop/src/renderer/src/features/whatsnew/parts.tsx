import type { ReleaseCategory, ReleaseMedia } from '@alga/shared'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useUi } from '@/store/ui'
import { Icon, Tooltip } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import type { EcoState } from '@/ui/eco/ecoRules'
import { ImageOff, Play, Sparkle, ThumbsDown, ThumbsUp, TrendUp, Wrench, type Glyph } from '@/ui/icons'
import { react, useWhatsNew } from './store'
import { t } from './strings'
import s from './whatsnew.module.css'

export const CATEGORY_GLYPH: Record<ReleaseCategory, Glyph> = { new: Sparkle, improved: TrendUp, fixed: Wrench }
const ECO_MOOD: Record<ReleaseCategory, EcoState> = { new: 'hop', improved: 'success', fixed: 'idle' }

export function CategoryTag({ category }: { category: ReleaseCategory }) {
  return (
    <span className={s.tag} data-cat={category}>
      <Icon icon={CATEGORY_GLYPH[category]} size={12} />
      {t.categoryOne[category]}
    </span>
  )
}

export function CategoryGlyph({ category, size = 28 }: { category: ReleaseCategory; size?: number }) {
  return (
    <span className={s.glyph} data-cat={category} style={{ width: size, height: size }} aria-hidden>
      <Icon icon={CATEGORY_GLYPH[category]} size={size >= 32 ? 18 : size >= 26 ? 16 : 12} />
    </span>
  )
}

const prefersReduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
export function useReduced(): boolean {
  const pref = useUi((st) => st.reducedMotion)
  return pref || prefersReduced()
}

/** True once the element has come near the viewport (media is only fetched then), and whether it is on screen now. */
function useVisibility<T extends Element>(): [React.RefObject<T | null>, boolean, boolean] {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return
        if (e.isIntersecting) setNear(true)
        setVisible(e.intersectionRatio > 0.25)
      },
      { rootMargin: '160px 0px', threshold: [0, 0.25, 0.6] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, near, visible]
}

/**
 * An item's picture: image, GIF or short muted video, fetched only when near the screen, paused off screen and never
 * moving under reduced motion (a still poster and a play button instead). No media, or media that fails, gets a calm
 * tile with the Eco, so a broken link never leaves a hole.
 */
export function MediaFrame({ media, alt, category, ratio = '16 / 9', className }: { media: ReleaseMedia | null; alt?: string; category: ReleaseCategory; ratio?: string; className?: string }) {
  const [ref, near, visible] = useVisibility<HTMLDivElement>()
  const reduced = useReduced()
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [play, setPlay] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const gif = media?.kind === 'image' && /\.gif(?:$|[?#])/i.test(media.url)
  const moving = media?.kind === 'video' || gif
  const still = moving && reduced && !play
  const style = { aspectRatio: ratio } as CSSProperties

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
    setPlay(false)
  }, [media?.url])
  useEffect(() => {
    const v = video.current
    if (!v) return
    if (visible && !still) void v.play().catch(() => {})
    else v.pause()
  }, [visible, still, near])

  if (!media || failed) {
    return (
      <div ref={ref} className={`${s.media} ${s.mediaEmpty} ${className ?? ''}`} style={style} data-cat={category} role={failed ? 'img' : undefined} aria-label={failed ? t.media.unavailable : undefined}>
        {failed ? (
          <span className={s.mediaFail}>
            <Icon icon={ImageOff} size={18} />
            {t.media.unavailable}
          </span>
        ) : (
          <span className={s.mediaEco}>
            <Eco state={reduced ? 'idle' : ECO_MOOD[category]} size={84} />
          </span>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className={`${s.media} ${className ?? ''}`} style={style} data-loaded={loaded || undefined}>
      {near && still && (
        <>
          {media.poster ? <img className={s.mediaEl} src={media.poster} alt={alt ?? ''} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} draggable={false} /> : <span className={s.mediaEco}><Eco state="idle" size={72} /></span>}
          <button type="button" className={s.mediaPlay} onClick={() => setPlay(true)} aria-label={t.media.play}>
            <Icon icon={Play} size={18} filled />
          </button>
        </>
      )}
      {near && !still && media.kind === 'image' && (
        <img className={s.mediaEl} src={media.url} alt={alt ?? ''} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} draggable={false} />
      )}
      {near && !still && media.kind === 'video' && (
        <video
          ref={video}
          className={s.mediaEl}
          src={media.url}
          poster={media.poster}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={alt}
          onLoadedData={() => setLoaded(true)}
          onError={() => setFailed(true)}
          controls={reduced}
          disablePictureInPicture
        />
      )}
    </div>
  )
}

/** 👍/👎 for one item. Mine is shown pressed; pressing it again takes it back. */
export function Reactions({ version, itemId, compact, disabled }: { version: string; itemId: string; compact?: boolean; disabled?: boolean }) {
  const mine = useWhatsNew((st) => (st.notes?.find((n) => n.version === version) ?? st.upcoming[version])?.mine[itemId])
  const [thanks, setThanks] = useState(false)
  useEffect(() => {
    if (!thanks) return
    const id = setTimeout(() => setThanks(false), 2400)
    return () => clearTimeout(id)
  }, [thanks])
  const press = (v: 1 | -1) => {
    if (disabled) return
    if (mine !== v) setThanks(true)
    void react(version, itemId, v)
  }
  return (
    <div className={s.reactions} data-compact={compact || undefined} role="group" aria-label={t.react.ask}>
      {!compact && <span className={s.reactAsk} aria-live="polite">{thanks ? t.react.thanks : t.react.ask}</span>}
      {([1, -1] as const).map((v) => {
        const on = mine === v
        const label = v === 1 ? (on ? t.react.upOn : t.react.up) : on ? t.react.downOn : t.react.down
        return (
          <Tooltip key={v} content={label}>
            <button type="button" className={s.reactBtn} data-on={on || undefined} data-v={v} aria-pressed={on} aria-label={v === 1 ? t.react.up : t.react.down} disabled={disabled} onClick={() => press(v)}>
              <Icon icon={v === 1 ? ThumbsUp : ThumbsDown} size={16} filled={on} />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
export const longDate = (iso: string) => dateFmt.format(new Date(iso))
const shortFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
export const shortDate = (iso: string) => shortFmt.format(new Date(iso)).replace('.', '')
