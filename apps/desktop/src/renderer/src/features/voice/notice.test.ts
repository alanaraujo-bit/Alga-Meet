import { describe, expect, it } from 'vitest'
import { streamNoticeOnTile } from './notice'

describe('stream notices', () => {
  const onStage = { sharing: true, stage: 'c1', call: 'c1' }
  it('go on your tile while the call stage is on screen', () => {
    expect(streamNoticeOnTile('Seu plano não inclui 1080p 60 fps: a transmissão continua, em 720p 60 fps.', onStage)).toBe(true)
    expect(streamNoticeOnTile('A transmissão agora vai em 720p 30 fps.', onStage)).toBe(true)
  })
  it('stay toasts elsewhere, when not sharing, or when they are about something else', () => {
    expect(streamNoticeOnTile('A transmissão agora vai em 720p 30 fps.', { ...onStage, stage: null })).toBe(false)
    expect(streamNoticeOnTile('A transmissão agora vai em 720p 30 fps.', { ...onStage, stage: 'c2' })).toBe(false)
    expect(streamNoticeOnTile('A transmissão agora vai em 720p 30 fps.', { ...onStage, sharing: false })).toBe(false)
    expect(streamNoticeOnTile('Microfone desconectado: usando o padrão do sistema.', onStage)).toBe(false)
  })
})
