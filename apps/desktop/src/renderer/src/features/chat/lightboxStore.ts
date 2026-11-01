import { create } from 'zustand'

/** One lightbox app-wide. It points at a message (not at URLs) so refreshed signed URLs flow in. Kept apart from
 * Lightbox.tsx so that chunk loads only on the first open. */
export const useLightbox = create<{ at: { channelId: string; messageId: string; index: number } | null }>()(() => ({ at: null }))
export const openLightbox = (channelId: string, messageId: string, index: number) => useLightbox.setState({ at: { channelId, messageId, index } })
