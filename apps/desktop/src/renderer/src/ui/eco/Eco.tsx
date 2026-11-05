import { memo, type ReactNode } from 'react'
import { BRAND_ECO, eyeColor, shade, type EcoAccessory, type EcoEyes, type EcoHair, type EcoLook, type EcoState } from './ecoRules'
import s from './eco.module.css'

// Master drawing, viewBox 0 0 100 130 (docs/brand/mascote/ref: the Gemini "HOOD" master, redrawn as clean vector).
const BODY = 'M33 88 L67 88 L69 95 C73 96 77 100 77 105 C77 109 74 110 72 107 L69 103 L69 114 C69 119 66 122 62 122 C58.5 122 57 120 56 117.5 L44 117.5 C43 120 41.5 122 38 122 C34 122 31 119 31 114 L31 103 L28 107 C26 110 23 109 23 105 C23 100 27 96 31 95 Z'
const HOOD = 'M50 30 C66 30 82 46 84 64 C85 75 82 84 76 90 C71 93 66 93 60 92.5 L40 92.5 C34 93 29 93 24 90 C18 84 15 75 16 64 C18 46 34 30 50 30 Z'
const HOOD_EDGE = 'M24 90 C18 84 15 75 16 64 C18 46 34 30 50 30 C66 30 82 46 84 64 C85 75 82 84 76 90'
const ANT_L = 'M45 44 C42 34 36 20 24 6 C38 15 45 28 48.5 40 Z'
const ANT_R = 'M55 44 C58 34 64 20 76 6 C62 15 55 28 51.5 40 Z'
const GRAPHITE = '#1c1c23'
const HOOD_FILL = '#25252e'
const VISOR = '#0c0c10'

/** How the antennae turn per state (left, right), around their roots inside the hood. */
const ANTENNAE: Record<EcoState, [number, number]> = {
  idle: [0, 0], blink: [0, 0], talking: [0, 0], listening: [0, 38], muted: [-26, 26], connecting: [0, 0],
  streaming: [0, 0], sleeping: [-24, 30], error: [-62, 62], success: [0, 0],
}

/** The avatar crop tightens as it shrinks: antennae tips first, then the shoulders, so the face stays big. */
const avatarBox = (size: number): string => (size >= 40 ? '2 2 96 96' : size >= 24 ? '6 9 88 88' : '12 22 76 76')

function Eyes({ state, eyes, color }: { state: EcoState; eyes: EcoEyes; color: string }): ReactNode {
  switch (state) {
    case 'blink':
    case 'muted':
      return (
        <g fill={color} opacity={state === 'muted' ? 0.55 : 1}>
          <rect x="35" y="65.5" width="10" height="2" rx="1" />
          <rect x="55" y="65.5" width="10" height="2" rx="1" />
        </g>
      )
    case 'sleeping':
      return (
        <g fill={color} opacity="0.8">
          <rect x="35" y="67" width="10" height="2" rx="1" />
          <rect x="55" y="67" width="10" height="2" rx="1" />
        </g>
      )
    case 'talking':
      // A voice meter: two bars that bounce out of step.
      return (
        <g fill={color}>
          <rect className={s.barA} x="37.5" y="58" width="5" height="16" rx="2.5" />
          <rect className={s.barB} x="57.5" y="58" width="5" height="16" rx="2.5" />
        </g>
      )
    case 'listening':
      return (
        <g fill={color}>
          <rect x="40" y="63.5" width="10" height="5" rx="2.5" />
          <rect x="60" y="63.5" width="10" height="5" rx="2.5" />
        </g>
      )
    case 'connecting':
      return <circle className={s.scan} cx="38" cy="66" r="3" fill={color} />
    case 'streaming':
      return <rect x="39" y="60" width="22" height="12" rx="2" fill="none" stroke={color} strokeWidth="2.4" />
    case 'error':
      return (
        <g stroke={color} strokeWidth="3" strokeLinecap="round">
          <path d="M35 62.5 L42 69.5 M42 62.5 L35 69.5" />
          <path d="M58 62.5 L65 69.5 M65 62.5 L58 69.5" />
        </g>
      )
    case 'success':
      return (
        <g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M34 69.5 L39.5 63.5 L45 69.5" />
          <path d="M55 69.5 L60.5 63.5 L66 69.5" />
        </g>
      )
    case 'idle':
      break
  }
  switch (eyes) {
    case 'slit':
      return (
        <g fill={color}>
          <path d="M34 62 L45.5 64.5 L44.5 68.5 L35 67.5 Z" />
          <path d="M66 62 L54.5 64.5 L55.5 68.5 L65 67.5 Z" />
        </g>
      )
    case 'dot':
      return (
        <g fill={color}>
          <circle cx="40" cy="66" r="3.6" />
          <circle cx="60" cy="66" r="3.6" />
        </g>
      )
    case 'line':
      return <rect x="34" y="64" width="32" height="4.2" rx="2.1" fill={color} />
    case 'wing':
      // Slanted almond with a sharp eyeliner flick.
      return (
        <g fill={color} stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M35 66.5 C38 63 42.5 62.5 46 64 C43 67.5 38.5 68.5 35 66.5 Z M35.5 66.3 L31 63" />
          <path d="M65 66.5 C62 63 57.5 62.5 54 64 C57 67.5 61.5 68.5 65 66.5 Z M64.5 66.3 L69 63" />
        </g>
      )
    case 'almond':
      return (
        <>
          <path d="M35 66 C38 62.8 42 62.8 45 66 C42 68.6 38 68.6 35 66 Z M55 66 C58 62.8 62 62.8 65 66 C62 68.6 58 68.6 55 66 Z" fill={color} />
          <path d="M34 63.2 C38 60.2 42 60.2 46 62.6 M54 62.6 C58 60.2 62 60.2 66 63.2" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
    case 'bar':
      return (
        <g fill={color} className={s.blink}>
          <rect x="35" y="63.5" width="10" height="5" rx="2.5" />
          <rect x="55" y="63.5" width="10" height="5" rx="2.5" />
        </g>
      )
  }
}

/** Accessories drawn behind the antennae (they wrap the head) or in front of them. */
const BEHIND: ReadonlySet<EcoAccessory> = new Set(['headset', 'cat'])

function Accessory({ kind, a }: { kind: EcoAccessory; a: string }): ReactNode {
  const dark = shade(a, 0.62)
  switch (kind) {
    case 'headset':
      return (
        <>
          <path d="M17 66 C15 36 85 36 83 66" fill="none" stroke="#3a3b48" strokeWidth="5" strokeLinecap="round" />
          <rect x="9" y="58" width="11" height="19" rx="5" fill="#2e2f3b" stroke={a} strokeWidth="2.5" />
          <rect x="80" y="58" width="11" height="19" rx="5" fill="#2e2f3b" stroke={a} strokeWidth="2.5" />
          <path d="M14 76 C15 85 21 89 29 88" fill="none" stroke="#3a3b48" strokeWidth="3" strokeLinecap="round" />
          <circle cx="30.5" cy="88" r="3" fill={a} />
        </>
      )
    case 'cat':
      return (
        <>
          <path d="M24 46 L27 28 L38 39 Z" fill={dark} />
          <path d="M76 46 L73 28 L62 39 Z" fill={dark} />
          <path d="M17 66 C15 36 85 36 83 66" fill="none" stroke={dark} strokeWidth="4" strokeLinecap="round" />
          <rect x="9" y="58" width="11" height="19" rx="5" fill={shade(a, 0.5)} />
          <rect x="80" y="58" width="11" height="19" rx="5" fill={shade(a, 0.5)} />
        </>
      )
    case 'cap':
      return (
        <>
          <path d="M20 55 C19 33 81 33 80 55 Z" fill={a} />
          <path d="M74 51 C84 48 94 52 95 57 C87 58 79 57 74 56 Z" fill={shade(a, 0.78)} />
          <circle cx="50" cy="35" r="2.5" fill={shade(a, 0.78)} />
        </>
      )
    case 'beanie':
      return (
        <>
          <path d="M19 57 C18 30 82 30 81 57 Z" fill={shade(a, 0.5)} />
          <rect x="17" y="49" width="66" height="10" rx="4" fill={shade(a, 0.68)} />
          <path d="M27 50 V58 M35 50 V58 M43 50 V58 M51 50 V58 M59 50 V58 M67 50 V58 M75 50 V58" stroke="#000" strokeOpacity="0.25" strokeWidth="1.5" />
        </>
      )
    case 'mask':
      return (
        <>
          <path d="M19 70 C38 75 62 75 81 70 L81 84 C64 93 36 93 19 84 Z" fill="#2b2c36" stroke={a} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M28 79 C42 82 58 82 72 79" fill="none" stroke={a} strokeWidth="1.6" strokeOpacity="0.7" />
        </>
      )
    case 'shades':
      return (
        <>
          <path d="M24 58 H76 C79 58 80 60 79.5 63 L77 71 C76 74 73 75 70 75 H58 C55 75 53 73 52 70 L50 67 L48 70 C47 73 45 75 42 75 H30 C27 75 24 74 23 71 L20.5 63 C20 60 21 58 24 58 Z" fill="#dfe4ec" />
          <path d="M20 61 L14 59 M80 61 L86 59" stroke="#dfe4ec" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )
    case 'crown':
      return <path d="M39 30 L40 18 L45.5 24 L50 15 L54.5 24 L60 18 L61 30 Z" fill={a} />
    case 'horns':
      return (
        <>
          <path d="M25 47 C17 41 15 31 19 22 C21 32 27 38 33 41 Z" fill={a} />
          <path d="M75 47 C83 41 85 31 81 22 C79 32 73 38 67 41 Z" fill={a} />
        </>
      )
    case 'bandana':
      return (
        <>
          <path d="M17 50 C35 45 65 45 83 50 L83 58 C65 53 35 53 17 58 Z" fill={shade(a, 0.58)} />
          <path d="M22 52 L26 49 L30 52 L34 49 L38 52 L42 49 L46 52 L50 49 L54 52 L58 49 L62 52 L66 49 L70 52 L74 49 L78 52" fill="none" stroke={a} strokeWidth="1.5" />
          <path d="M83 53 C89 50 94 52 95 56 C91 57 88 58 86 61 C85 58 84 56 83 55 Z" fill={shade(a, 0.58)} />
        </>
      )
    case 'scarf':
      return (
        <>
          <path d="M21 84 C36 94 64 94 79 84 L80 95 C64 104 36 104 20 95 Z" fill={shade(a, 0.6)} />
          <path d="M24 89 C38 97 62 97 76 89" fill="none" stroke={a} strokeWidth="1.6" />
          <path d="M62 96 L66 112 L58 111 Z" fill={shade(a, 0.5)} />
        </>
      )
    case 'earrings':
      return (
        <g fill="none" stroke={a} strokeWidth="2.4">
          <circle cx="15.5" cy="81" r="3.6" />
          <circle cx="84.5" cy="81" r="3.6" />
        </g>
      )
    case 'cracked':
      return (
        <g fill="none" stroke={a} strokeLinejoin="round">
          <path d="M61 55 L57 62 L62 66 L55 73 L58 77" strokeWidth="1.4" />
          <path d="M57 62 L52 63" strokeWidth="1.2" />
        </g>
      )
    case 'choker':
      return (
        <>
          <path d="M38 93 C44 96 56 96 62 93" fill="none" stroke={a} strokeWidth="3" strokeLinecap="round" />
          <circle cx="50" cy="98" r="2.2" fill={a} />
        </>
      )
    case 'clip':
      // A frond-shaped hair clip, in the logo's white.
      return <path d="M60 50 C64 45 70 43 75 44 C72 48 67 51 60 50 Z" fill="#f7f8f8" />
    case 'veil':
      return <path d="M27 70 C40 74 60 74 73 70 L75 86 C62 94 38 94 25 86 Z" fill={a} fillOpacity="0.38" stroke={a} strokeWidth="1.6" />
    case 'none':
      return null
  }
}

/**
 * Hair comes out of the hood in three layers: behind the hood (buns, ponytail), around the visor as a center-parted
 * frame (every style), and in front (a braid over the shoulder, a side fringe over the visor).
 */
const FRAME = 'M23 82 C21 62 33 45 50 45 C67 45 79 62 77 82 L77 91 L70 91 C70.5 84 71 76 70.5 68 L29.5 68 C29 76 29.5 84 30 91 L23 91 Z'

function HairBack({ hair, a, dark }: { hair: EcoHair; a: string; dark: string }): ReactNode {
  if (hair === 'buns')
    return (
      <>
        <circle cx="27" cy="38" r="9" fill={a} />
        <circle cx="73" cy="38" r="9" fill={a} />
        <path d="M22 37 C24 32 31 32 31 38 M78 37 C76 32 69 32 69 38" fill="none" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />
      </>
    )
  if (hair === 'ponytail')
    return (
      <>
        <path d="M57 35 C64 21 82 17 89 28 C95 38 92 54 86 64 C87 51 85 41 79 36 C73 32 65 34 61 39 Z" fill={a} />
        <path d="M80 28 C86 34 88 44 86 54" fill="none" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />
      </>
    )
  return null
}

function HairFrame({ hair, a, dark }: { hair: EcoHair; a: string; dark: string }): ReactNode {
  if (hair === 'none') return null
  return (
    <>
      <path d={FRAME} fill={a} />
      <path d="M50 45.5 V53" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />
      {hair === 'long' && (
        <path d="M17 84 C15 96 18 106 23 112 L31 111 C29 103 29 96 30 90 L23 90 Z M83 84 C85 96 82 106 77 112 L69 111 C71 103 71 96 70 90 L77 90 Z" fill={a} />
      )}
      {hair === 'wavy' && (
        <path d="M17 84 C13 92 20 97 16 104 C14 110 20 114 25 113 L31 111 C27 106 32 101 29 96 C27 93 30 91 30 90 L23 90 Z M83 84 C87 92 80 97 84 104 C86 110 80 114 75 113 L69 111 C73 106 68 101 71 96 C73 93 70 91 70 90 L77 90 Z" fill={a} />
      )}
    </>
  )
}

function HairFront({ hair, a, dark }: { hair: EcoHair; a: string; dark: string }): ReactNode {
  if (hair === 'braid')
    return (
      <>
        <g fill={a} stroke={dark} strokeWidth="1.2">
          <ellipse cx="74" cy="94" rx="5" ry="5.5" />
          <ellipse cx="76" cy="103" rx="4.6" ry="5.2" />
          <ellipse cx="77.5" cy="111.5" rx="4.2" ry="4.8" />
        </g>
        <path d="M77.5 115 L73.5 123 L81.5 122 Z" fill={a} />
      </>
    )
  if (hair === 'fringe')
    return (
      <>
        <path d="M27 62 C29 50 42 45 57 48 C65 50 71 54 73 58 C63 54 53 55 45 59 C40 62 36 66 34 70 C31 66 29 64 27 62 Z" fill={a} />
        <path d="M41 52 C48 50.5 56 51.5 63 54.5" fill="none" stroke={dark} strokeWidth="1.3" strokeLinecap="round" />
      </>
    )
  return null
}

/**
 * The mascot. `framing="full"` is the whole character (welcome, empty rooms, errors); `"avatar"` is the head and
 * shoulders cropped for a round avatar of `size` px. Decorative by default: the caller names it.
 */
export const Eco = memo(function Eco({
  spec = BRAND_ECO,
  state = 'idle',
  framing = 'full',
  size,
  className,
}: {
  spec?: EcoLook
  state?: EcoState
  framing?: 'full' | 'avatar'
  /** Rendered height in px for "full" (width follows), the square side for "avatar". */
  size: number
  className?: string
}) {
  const a = spec.accent
  const eye = eyeColor(a)
  const [turnL, turnR] = ANTENNAE[state]
  const accessory = spec.accessory
  const hair = spec.hair ?? 'none'
  const dark = shade(a, 0.55)
  const full = framing === 'full'
  const lift = state === 'success' ? -4 : 0
  return (
    <svg
      className={className}
      width={full ? Math.round((size * 100) / 130) : size}
      height={size}
      viewBox={full ? '0 0 100 130' : avatarBox(size)}
      aria-hidden
      focusable="false"
    >
      <g transform={lift ? `translate(0 ${lift})` : undefined}>
        <HairBack hair={hair} a={a} dark={dark} />
        <path d={BODY} fill={GRAPHITE} stroke={a} strokeWidth="3.5" strokeLinejoin="round" />
        <path d={HOOD} fill={HOOD_FILL} />
        <path d={HOOD_EDGE} fill="none" stroke={a} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M24 90 C29 93 34 93.5 39.5 92.5" fill="none" stroke={a} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M76 90 C71 93 66 93.5 60.5 92.5" fill="none" stroke={a} strokeWidth="3.2" strokeLinecap="round" />
        <HairFrame hair={hair} a={a} dark={dark} />
        <rect x="28" y="55" width="44" height="22" rx="11" fill={VISOR} />
        {BEHIND.has(accessory) && <Accessory kind={accessory} a={a} />}
        <path d={ANT_L} fill={a} transform={turnL ? `rotate(${turnL} 46 41)` : undefined} />
        <path d={ANT_R} fill={a} transform={turnR ? `rotate(${turnR} 54 41)` : undefined} />
        <HairFront hair={hair} a={a} dark={dark} />
        {!BEHIND.has(accessory) && accessory !== 'mask' && accessory !== 'shades' && <Accessory kind={accessory} a={a} />}
        {accessory === 'shades' ? (
          <>
            <Accessory kind="shades" a={a} />
            <circle cx="37" cy="66" r="3" fill={VISOR} />
            <circle cx="63" cy="66" r="3" fill={VISOR} />
          </>
        ) : accessory === 'mask' ? (
          <>
            <Accessory kind="mask" a={a} />
            <rect x="34" y="60" width="32" height="4" rx="2" fill={eye} />
          </>
        ) : (
          <Eyes state={state} eyes={spec.eyes} color={eye} />
        )}
        {state === 'sleeping' && <path d="M78 30 h7 l-7 8 h7 M88 20 h5 l-5 6 h5" fill="none" stroke={a} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      </g>
    </svg>
  )
})
