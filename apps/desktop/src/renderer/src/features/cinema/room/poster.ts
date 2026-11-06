import { useEffect, useState } from 'react'
import { extraPiece, useCinema } from '../store'

const RETRY_MS = 2_000

/**
 * The session's poster or thumbnail sprite as a blob: URL, revoked on unmount; null until the piece is held (the host
 * makes the poster after the subtitles, the sprite after the first video pieces), so callers show a placeholder.
 */
export function useExtraUrl(track: 'poster' | 'thumbs'): string | null {
  const sessionId = useCinema((s) => s.session?.sessionId ?? null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!sessionId) return
    let dead = false
    let made: string | null = null
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const bytes = await extraPiece(track)
      if (dead) return
      if (!bytes) return void (timer = setTimeout(load, RETRY_MS))
      made = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
      setUrl(made)
    }
    timer = setTimeout(load, 0)
    return () => {
      dead = true
      clearTimeout(timer)
      if (made) URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [track, sessionId])
  return url
}
