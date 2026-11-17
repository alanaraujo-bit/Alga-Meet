// My saved playlists (REST /music/playlists) and reading a YouTube playlist link. No YouTube API key: YouTube's own
// embed, cued with the list (`embed/videoseries?list=`), reports the list's video ids over postMessage.
import { PLAYLIST_MAX_ITEMS, uniqueVideoIds, type SavedPlaylist } from '@alga/shared'
import { create } from 'zustand'
import { ApiRequestError, api } from '@/lib/api'
import { LISTENING } from './logic'

interface PlaylistStore {
  /** null until first loaded. Last changed first. */
  list: SavedPlaylist[] | null
  loading: boolean
  error: string | null
}

export const usePlaylists = create<PlaylistStore>(() => ({ list: null, loading: false, error: null }))

export const apiErrorText = (e: unknown): string =>
  e instanceof ApiRequestError ? (Object.values(e.fields ?? {})[0] ?? e.message) : 'Algo deu errado. Tente de novo.'

const put = (p: SavedPlaylist): void =>
  usePlaylists.setState((s) => ({ list: [p, ...(s.list ?? []).filter((x) => x.id !== p.id)] }))

export async function loadPlaylists(): Promise<void> {
  if (usePlaylists.getState().loading) return
  usePlaylists.setState({ loading: true, error: null })
  try {
    usePlaylists.setState({ list: await api<SavedPlaylist[]>('GET', '/music/playlists'), loading: false })
  } catch (e) {
    usePlaylists.setState({ loading: false, error: apiErrorText(e) })
  }
}

/** Throws ApiRequestError (its first field says why). */
export async function createPlaylist(body: { name?: string; videoIds: string[]; listId?: string }): Promise<SavedPlaylist> {
  const p = await api<SavedPlaylist>('POST', '/music/playlists', { ...body, videoIds: uniqueVideoIds(body.videoIds) })
  put(p)
  return p
}

export async function updatePlaylist(id: string, patch: { name?: string; videoIds?: string[] }): Promise<SavedPlaylist> {
  const p = await api<SavedPlaylist>('PATCH', `/music/playlists/${id}`, patch)
  put(p)
  return p
}

export async function deletePlaylist(id: string): Promise<void> {
  const before = usePlaylists.getState().list
  usePlaylists.setState({ list: (before ?? []).filter((x) => x.id !== id) }) // gone at once; back if the server says no
  try {
    await api<void>('DELETE', `/music/playlists/${id}`)
  } catch (e) {
    usePlaylists.setState({ list: before, error: apiErrorText(e) })
  }
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(a: readonly T[], rnd = Math.random): T[] {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

const READ_TIMEOUT_MS = 12_000

/** The video ids of a YouTube playlist, read from YouTube's embed (cued, never played). */
export function readYoutubeList(listId: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe')
    // Off screen and silent: autoplay off, it only lists. Same embed host the player uses (Referer set by main).
    f.src = `https://www.youtube-nocookie.com/embed/videoseries?${new URLSearchParams({ list: listId, enablejsapi: '1', autoplay: '0', controls: '0' })}`
    f.setAttribute('aria-hidden', 'true')
    f.tabIndex = -1
    f.referrerPolicy = 'strict-origin-when-cross-origin'
    Object.assign(f.style, { position: 'fixed', left: '-10000px', top: '0', width: '320px', height: '200px', border: '0', pointerEvents: 'none' })
    const done = (err: Error | null, ids?: string[]) => {
      window.removeEventListener('message', onMessage)
      clearInterval(ping)
      clearTimeout(timer)
      f.remove()
      if (err) reject(err)
      else resolve(ids!)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== f.contentWindow) return
      let d: unknown = e.data
      if (typeof d === 'string') {
        try {
          d = JSON.parse(d)
        } catch {
          return
        }
      }
      const m = d as { event?: string; info?: unknown }
      if (m.event === 'onError') return done(new Error('Essa playlist é privada, um mix automático do YouTube ou não existe.'))
      const list = (m.info as { playlist?: unknown } | null)?.playlist
      if (Array.isArray(list) && list.length > 0) {
        const ids = uniqueVideoIds(list.filter((x): x is string => typeof x === 'string'), PLAYLIST_MAX_ITEMS)
        if (ids.length) done(null, ids)
      }
    }
    const ping = setInterval(() => f.contentWindow?.postMessage(LISTENING, 'https://www.youtube-nocookie.com'), 250)
    const timer = setTimeout(() => done(new Error('O YouTube demorou para responder. Tente de novo.')), READ_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    document.body.appendChild(f)
  })
}
