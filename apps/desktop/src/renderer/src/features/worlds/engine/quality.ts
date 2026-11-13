/**
 * How much the 3D room may cost. Alga Meet is a calling app that people leave open next to a game, so the room adapts
 * to the machine instead of the other way round: it measures its own frames and steps down (or back up) by itself,
 * draws less when the window is not the one in use, and stops drawing when nobody can see it.
 */

export const QUALITY_TIERS = ['low', 'medium', 'high'] as const
export type QualityTier = (typeof QUALITY_TIERS)[number]
/** What the person chose in the room's settings. */
export type QualityPref = 'auto' | QualityTier

export interface TierSettings {
  /** Upper bound of the device pixel ratio the canvas is drawn at. */
  maxPixelRatio: number
  /** Frames per second while the window is in use. */
  fps: number
  /** Side of the shadow map of the key light; 0 = no shadow maps (people still get a soft contact shadow). */
  shadowMap: number
  /** People and moved furniture cast shadows every frame; otherwise shadows are drawn once per layout. */
  liveShadows: boolean
  /** Ambient occlusion, bloom and edge smoothing as a post-process. */
  post: boolean
  /** Lamps that really light the room (the rest only glow). */
  lamps: number
  /** Largest side of a texture kept on the GPU. */
  textureSize: number
  anisotropy: number
}

export const TIERS: Readonly<Record<QualityTier, TierSettings>> = {
  low: { maxPixelRatio: 0.8, fps: 30, shadowMap: 0, liveShadows: false, post: false, lamps: 2, textureSize: 512, anisotropy: 2 },
  medium: { maxPixelRatio: 1, fps: 60, shadowMap: 1024, liveShadows: false, post: false, lamps: 4, textureSize: 1024, anisotropy: 4 },
  high: { maxPixelRatio: 1.5, fps: 60, shadowMap: 2048, liveShadows: true, post: true, lamps: 6, textureSize: 1024, anisotropy: 8 },
}

/** Frames per second when the app window is open but another program has the keyboard (a game, usually). */
export const BACKGROUND_FPS = 12

/** What the frame loop should do right now. */
export function frameBudget(tier: QualityTier, state: { visible: boolean; focused: boolean; reducedMotion: boolean }): number {
  if (!state.visible) return 0
  if (!state.focused) return BACKGROUND_FPS
  return state.reducedMotion ? Math.min(30, TIERS[tier].fps) : TIERS[tier].fps
}

const STEP_DOWN_MS = 2_500
const STEP_UP_MS = 12_000
/** After a change the measurements of the old tier are worthless for a moment (shaders compile, targets resize). */
const SETTLE_MS = 1_500

/**
 * Picks the tier in `auto`. Fed with the time each drawn frame took (work, not the wait for the next one): a tier that
 * keeps missing its budget for a couple of seconds goes down; one with plenty of room for a while goes up, never past
 * the ceiling and never right after having come down from there (no ping-pong).
 */
export class QualityGovernor {
  tier: QualityTier
  private ema = 0
  private overSince = -1
  private underSince = -1
  private changedAt = -Infinity
  /** The tier it came down from, and when: it waits before trying it again. */
  private failed: { tier: QualityTier; at: number } | null = null

  constructor(start: QualityTier = 'medium', private readonly ceiling: QualityTier = 'high') {
    this.tier = QUALITY_TIERS.indexOf(start) > QUALITY_TIERS.indexOf(ceiling) ? ceiling : start
  }

  /** `workMs`: CPU+GPU time of the frame just drawn; `now`: ms clock. Returns the new tier when it changes. */
  frame(workMs: number, now: number): QualityTier | null {
    if (now - this.changedAt < SETTLE_MS) return null
    this.ema = this.ema === 0 ? workMs : this.ema * 0.9 + workMs * 0.1
    const budget = 1000 / TIERS[this.tier].fps
    const i = QUALITY_TIERS.indexOf(this.tier)
    if (this.ema > budget * 0.92) {
      this.underSince = -1
      if (this.overSince < 0) this.overSince = now
      if (now - this.overSince >= STEP_DOWN_MS && i > 0) {
        this.failed = { tier: this.tier, at: now }
        return this.set(QUALITY_TIERS[i - 1]!, now)
      }
      return null
    }
    this.overSince = -1
    // The next tier costs roughly twice as much: only try it with that much room.
    if (this.ema < budget * 0.38 && i < QUALITY_TIERS.indexOf(this.ceiling)) {
      if (this.underSince < 0) this.underSince = now
      const next = QUALITY_TIERS[i + 1]!
      const cooling = this.failed?.tier === next && now - this.failed.at < 120_000
      if (now - this.underSince >= STEP_UP_MS && !cooling) return this.set(next, now)
    } else {
      this.underSince = -1
    }
    return null
  }

  private set(tier: QualityTier, now: number): QualityTier {
    this.tier = tier
    this.changedAt = now
    this.ema = 0
    this.overSince = this.underSince = -1
    return tier
  }
}
