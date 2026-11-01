import { useEffect, useState } from 'react'
import { hueFor, measuredHue, type AvatarUser } from './Avatar'

/*
 * Color from people (critique r3, "sexy move" 1): each person's hue comes from their accent color or the dominant hue
 * of their avatar (a 16×16 sample averaged in OKLab, weighted by chroma), else the stable hash. The chrome stays grey
 * and indigo; the hue only tints what is theirs (banner, their spot on the stage, their name chip), at low chroma.
 */

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** OKLab a, b of an sRGB color (0–255). */
function ab(r: number, g: number, b: number): [number, number] {
  const R = lin(r / 255)
  const G = lin(g / 255)
  const B = lin(b / 255)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

const deg = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360

/** Dominant OKLCH hue of RGBA pixels; null when the image is (nearly) grey or transparent. */
export function hueOfPixels(px: ArrayLike<number>): number | null {
  let sa = 0
  let sb = 0
  let w = 0
  let opaque = 0
  let colored = 0
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3]! < 128) continue
    opaque++
    const [a, b] = ab(px[i]!, px[i + 1]!, px[i + 2]!)
    const c = Math.hypot(a, b)
    if (c < 0.02) continue
    colored++
    sa += a * c
    sb += b * c
    w += c
  }
  // A few stray colored pixels on a grey photo are noise, not the person's color; opposite hues cancel out too.
  if (!colored || colored < opaque * 0.03 || Math.hypot(sa, sb) / w < 0.02) return null
  return Math.round(deg(sa, sb))
}

/** Hue of a #rrggbb accent color; null for greys or anything else. */
export function hueOfHex(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return hueOfPixels([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255])
}

/** The person's hue now (accent, else the measured avatar, else the hash). */
export function personHue(user: Pick<AvatarUser, 'id' | 'accentColor'>): number {
  return (user.accentColor ? hueOfHex(user.accentColor) : null) ?? hueFor(user.id)
}

const byUrl = new Map<string, Promise<number | null>>()

function measure(url: string): Promise<number | null> {
  let p = byUrl.get(url)
  if (p) return p
  p = new Promise((resolve) => {
    const img = new Image()
    // A separate request: the visible <img> never depends on CORS. A tainted canvas just falls back to the hash.
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 16
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(img, 0, 0, 16, 16)
        resolve(hueOfPixels(g.getImageData(0, 0, 16, 16).data))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  byUrl.set(url, p)
  return p
}

/** personHue that re-renders once the avatar's hue is measured (cached per URL, measured once per session). */
export function usePersonHue(user: Pick<AvatarUser, 'id' | 'avatarUrl' | 'accentColor'> | undefined): number {
  const [, bump] = useState(0)
  const id = user?.id
  const url = user?.avatarUrl
  const accent = user?.accentColor
  useEffect(() => {
    if (!id || !url || accent) return
    let live = true
    void measure(url).then((h) => {
      if (h === null) measuredHue.delete(id)
      else measuredHue.set(id, h)
      if (live) bump((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [id, url, accent])
  return user ? personHue(user) : 0
}
