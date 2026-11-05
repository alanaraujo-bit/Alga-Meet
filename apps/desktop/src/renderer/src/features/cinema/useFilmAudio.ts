import { useEffect } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import type { FilmAudio } from './audio'

/** True when anyone other than the user is speaking ('self' is the engine's key for the local user). */
function othersSpeaking(p: Record<string, { speaking: boolean }>, meId: string | undefined): boolean {
  return Object.entries(p).some(([id, v]) => id !== 'self' && id !== meId && v.speaking)
}

/** Feeds a FilmAudio with the call's speaking state and output device. */
export function useFilmAudio(audio: FilmAudio | null): void {
  const meId = useData((s) => s.me?.id)
  const others = useMedia((s) => othersSpeaking(s.participants, meId))
  const outputId = useMedia((s) => s.devices.outputId)
  const label = useMedia((s) => s.devices.outputs.find((d) => d.deviceId === s.devices.outputId)?.label ?? null)
  useEffect(() => audio?.setOthersSpeaking(others), [audio, others])
  useEffect(() => {
    void audio?.setOutput(outputId, label)
  }, [audio, outputId, label])
}
