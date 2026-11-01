/*
 * Coleção 01 "Hora Azul" (docs/business/growth-plan.md §3): the palette and the 28 items this client draws.
 * Ids are the server's catalog SKUs (apps/server/src/billing/catalog.ts, CATALOG_VERSION 2).
 */

/** §3.2. Colors of the collection; state colors (online, idle, danger, live) and teal/cyan never appear in an item. */
export const HA = {
  ink: '#0f0f1a',
  deep: '#24255a',
  indigo: '#6163d0',
  indigoLight: '#8b8ef7',
  lilac: '#b9b2f9',
  porcelain: '#f7f8f8',
  silver: '#c9ccd6',
  graphite: '#2a2b30',
  ember: '#e8a898',
} as const

/** Where an item shows. One equipped item per slot. */
export type Slot = 'decoration' | 'theme' | 'effect' | 'nameplate' | 'aura' | 'sound' | 'reactions' | 'frame' | 'icon'

/**
 * GPU tier (§3.3.4): G0 static · G1 one CSS gesture (transform/opacity) · G2 one short canvas · GV voice-driven.
 * `ms` = length of the one-shot gesture (0 = never moves on its own). `plus` = in the Plus wardrobe, not sold.
 */
export interface ItemMeta {
  code: string
  slot: Slot
  name: string
  tier: 'G0' | 'G1' | 'G2' | 'GV' | 'audio'
  ms: number
  brl: number
  hero?: boolean
  plus?: boolean
  wave: 1 | 2
}

const item = (code: string, slot: Slot, name: string, tier: ItemMeta['tier'], ms: number, brl: number, extra: Partial<ItemMeta> = {}): ItemMeta => ({
  code, slot, name, tier, ms, brl, wave: Number(code.slice(3)) >= 16 && Number(code.slice(3)) <= 25 ? 2 : 1, ...extra,
})

export const HORA_AZUL = {
  deco_ha_halo_vidro: item('HA-01', 'decoration', 'Halo de vidro', 'G1', 900, 1290, { hero: true }),
  deco_ha_orbita: item('HA-02', 'decoration', 'Órbita', 'G1', 1200, 990),
  deco_ha_constelacao: item('HA-03', 'decoration', 'Constelação', 'G1', 1000, 990),
  deco_ha_fita_seda: item('HA-04', 'decoration', 'Fita de seda', 'G1', 1100, 1290),
  deco_ha_traco_grafite: item('HA-05', 'decoration', 'Traço de grafite', 'G0', 0, 690),
  effect_ha_hora_azul: item('HA-06', 'effect', 'Hora azul', 'G1', 2200, 1690, { hero: true }),
  effect_ha_poeira_luz: item('HA-07', 'effect', 'Poeira de luz', 'G2', 1800, 1290),
  effect_ha_cortina_vidro: item('HA-08', 'effect', 'Cortina de vidro', 'G1', 1000, 1290),
  nameplate_ha_crepusculo: item('HA-09', 'nameplate', 'Crepúsculo', 'G1', 700, 790, { hero: true }),
  nameplate_ha_vidro_fosco: item('HA-10', 'nameplate', 'Vidro fosco', 'G0', 0, 590),
  nameplate_ha_fio_luz: item('HA-11', 'nameplate', 'Fio de luz', 'G1', 900, 690),
  nameplate_ha_nanquim: item('HA-12', 'nameplate', 'Nanquim', 'G0', 0, 590),
  theme_ha_noite_indigo: item('HA-13', 'theme', 'Noite índigo', 'G0', 0, 790),
  theme_ha_porcelana: item('HA-14', 'theme', 'Porcelana', 'G0', 0, 990),
  theme_ha_nevoa_lavanda: item('HA-15', 'theme', 'Névoa lavanda', 'G0', 0, 790),
  aura_ha_respiro: item('HA-16', 'aura', 'Respiro', 'GV', 0, 1290, { hero: true }),
  aura_ha_prisma: item('HA-17', 'aura', 'Prisma', 'GV', 0, 1290),
  aura_ha_ondas: item('HA-18', 'aura', 'Ondas', 'GV', 0, 990),
  aura_ha_frondes: item('HA-19', 'aura', 'Frondes', 'GV', 0, 0, { plus: true }),
  sound_ha_toque_vidro: item('HA-20', 'sound', 'Toque de vidro', 'audio', 700, 590),
  sound_ha_corda: item('HA-21', 'sound', 'Corda', 'audio', 900, 690),
  sound_ha_sopro: item('HA-22', 'sound', 'Sopro', 'audio', 600, 590),
  reactions_ha_hora_azul: item('HA-23', 'reactions', 'Reações Hora Azul', 'G1', 1200, 990),
  frame_ha_cinema: item('HA-24', 'frame', 'Moldura Cinema', 'G1', 1200, 1290, { hero: true }),
  frame_ha_vidro: item('HA-25', 'frame', 'Moldura de vidro', 'G0', 0, 990),
  icon_ha_noite: item('HA-26', 'icon', 'Noite', 'G0', 0, 0, { plus: true }),
  icon_ha_porcelana: item('HA-27', 'icon', 'Porcelana', 'G0', 0, 0, { plus: true }),
  icon_ha_crepusculo: item('HA-28', 'icon', 'Crepúsculo', 'G0', 0, 590),
} as const satisfies Record<string, ItemMeta>

export type CosmeticId = keyof typeof HORA_AZUL

/**
 * Text drawn on top of a theme or a nameplate, with the surfaces under it (darkest and lightest point of the
 * gradient, flattened on the UI surface it sits on). tokens contract: primary ≥ 7:1, secondary ≥ 4.5:1 (§3.3.2).
 * The CSS uses these exact values; render.test.ts checks them.
 */
export const TEXT_ON = {
  theme_ha_noite_indigo: { primary: '#f7f8f8', secondary: '#d0d6e0', under: [HA.ink, HA.deep, '#1b1c45'] },
  // Includes the porcelain versions of the plates (cosmetics.module.css), flattened on #f4f4f6.
  theme_ha_porcelana: { primary: '#1b1b1d', secondary: '#4a4c55', under: ['#f4f4f6', '#e9e9ee', '#e2e3ea', '#d3d0f1', '#d2d3ef'] },
  theme_ha_nevoa_lavanda: { primary: '#f7f8f8', secondary: '#d0d6e0', under: [HA.ink, 'rgba(185, 178, 249, 0.18)', 'rgba(97, 99, 208, 0.22)'] },
  nameplate_ha_crepusculo: { primary: '#f7f8f8', secondary: '#f7f8f8', under: ['rgba(36, 37, 90, 0.7)', 'rgba(97, 99, 208, 0.35)'] },
  nameplate_ha_vidro_fosco: { primary: '#f7f8f8', secondary: '#f7f8f8', under: ['rgba(247, 248, 248, 0.07)'] },
  nameplate_ha_fio_luz: { primary: '#f7f8f8', secondary: '#f7f8f8', under: ['rgba(0, 0, 0, 0)'] },
  nameplate_ha_nanquim: { primary: '#f7f8f8', secondary: '#f7f8f8', under: ['rgba(36, 37, 90, 0.62)'] },
} as const
