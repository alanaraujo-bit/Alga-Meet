import { create } from 'zustand'
import { useData } from '@/store/data'
import { actorFor, visibleSections, type SpaceSection } from './permissions'

/** Space settings overlay (same frame as user settings). null = closed. Apart from SpaceSettings.tsx: lazy chunk. */
export const useSpaceSettings = create<{ spaceId: string | null; section: SpaceSection }>()(() => ({ spaceId: null, section: 'overview' }))
export function openSpaceSettings(spaceId: string, section?: SpaceSection): void {
  const allowed = visibleSections(actorFor(useData.getState(), spaceId))
  const next = section && allowed.includes(section) ? section : allowed[0]
  if (next) useSpaceSettings.setState({ spaceId, section: next })
}
