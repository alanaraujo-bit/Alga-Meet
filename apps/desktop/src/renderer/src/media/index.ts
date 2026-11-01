// Public surface of the media engine. UI code imports from '@/media' only.
export { media, type JoinParams, type ScreenShareOptions } from './engine'
export { useMedia, type MediaState, type ConnectionState, type ParticipantView, type ViewerView, type DeviceInfo, type StreamQuality, type Quality } from './store'
export { SCREEN_PRESETS, type ScreenPreset, type ScreenPresetId, type ContentType, type VideoCodecId } from './presets'
export type { ProcessingMode, InputMode } from './prefs'
export { startCallTelemetry } from './telemetry'
export type { AudioInStats, AudioOutStats, VideoInStats, VideoOutStats, VideoLayerStats } from './stats'
