import { useEffect, useState } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { channelTitle, displayName } from '@/store/selectors'
import { t } from './strings'

/**
 * Screen readers hear who joins and leaves the call you are in (sighted people see the tile come and go). A live
 * region that always exists, so every new sentence is announced; mounted once in the shell.
 */
export function VoiceAnnouncer() {
  const [text, setText] = useState('')
  useEffect(() => {
    let room: string | null = null
    let people = new Set<string>()
    // The same sentence twice in a row would not change the DOM: a trailing space makes it new.
    const say = (s: string) => setText((prev) => (prev === s ? `${s} ` : s))
    const update = () => {
      const c = useMedia.getState().connection
      const id = c.state === 'connected' ? c.channelId : null
      const st = useData.getState()
      const now = new Set(Object.values(st.voiceStates).filter((v) => v.channelId === id && v.userId !== st.me?.id).map((v) => v.userId))
      if (id !== room) {
        const ch = id ? st.channels[id] : undefined
        if (ch) say(t.announce.connected(ch.name ?? channelTitle(st, ch)))
        else if (room) say(t.announce.disconnected)
        room = id
        people = now
        return
      }
      if (!id) return
      const spaceId = st.channels[id]?.spaceId ?? null
      const lines = [
        ...[...now].filter((u) => !people.has(u)).map((u) => t.announce.joined(displayName(st, u, spaceId))),
        ...[...people].filter((u) => !now.has(u)).map((u) => t.announce.left(displayName(st, u, spaceId))),
      ]
      people = now
      if (lines.length) say(lines.join('. '))
    }
    update()
    const offData = useData.subscribe(update)
    const offMedia = useMedia.subscribe(update)
    return () => {
      offData()
      offMedia()
    }
  }, [])
  return (
    <div className="sr-only" role="status">
      {text}
    </div>
  )
}
