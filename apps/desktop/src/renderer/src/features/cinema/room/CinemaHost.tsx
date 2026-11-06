// Where the room lives: at the app's level, not in the call's stage, so leaving the call's screen while seated keeps
// the same <video> and player (mini in a corner), and the end of a session I sat in shows the ticket wherever I am.
import { useShallow } from 'zustand/react/shallow'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { useVoice } from '../../voice/voice'
import { useCinema } from '../store'
import { CinemaRoom } from './CinemaRoom'
import { TicketScreen } from './TicketScreen'

export function CinemaHost() {
  const c = useCinema(useShallow((st) => ({ id: st.session?.sessionId ?? null, channelId: st.session?.channelId ?? null, seated: st.mine.seated })))
  const ended = useCinema((st) => (st.ended?.seated ? st.ended : null))
  const live = useMedia((st) => {
    const k = st.connection.state
    return k === 'connecting' || k === 'connected' || k === 'reconnecting' ? st.connection.channelId : null
  })
  const channel = useData((st) => (c.channelId ? st.channels[c.channelId] : undefined))
  const onStage = useVoice((st) => st.stage !== null && st.stage === c.channelId)
  return (
    <>
      {c.id && c.seated && channel && live === c.channelId && <CinemaRoom key={c.id} channel={channel} mini={!onStage} />}
      {ended && !c.seated && <TicketScreen key={ended.sessionId} ended={ended} />}
    </>
  )
}
