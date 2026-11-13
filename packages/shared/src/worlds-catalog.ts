/**
 * The catalog of Alga Worlds: everything a room or a figure can use, by SKU. One list for both sides: the desktop draws
 * from it (which model, how big, where people sit), the server validates against it (the SKU exists, is of the right
 * kind, the account holds it, the seat exists).
 *
 * Tiers: `base` belongs to everyone, forever (a full, good-looking room and figure without paying). `store` items are
 * sold one by one and `plus` items come with Alga Plus; both are Products with the same id in the billing catalog
 * (apps/server/src/billing/catalog.ts holds the prices), so they are bought, refunded and held like any cosmetic.
 * Adding something sold: add it here AND there (a server test fails when the two lists differ).
 *
 * Models: `glb` is a model id of the asset pack (apps/server/assets/worlds, built by tools/worlds-assets; all CC0, see
 * its CREDITS.md); `proc` is a piece the renderer builds itself (features/worlds/engine/furniture). Sizes are width (x),
 * height (y), depth (z) in metres with rot 0, when the piece faces +Z.
 */
import { ECO_ACCENTS, type EcoSpec } from './eco.js'
import {
  WORLD_ITEM_MAX_COPIES, WORLD_ROOM_MAX_ITEMS, WORLD_SHELLS,
  type WorldAvatar, type WorldPlacedItem, type WorldRoomLayout,
} from './worlds.js'

export type WorldTier = 'base' | 'store' | 'plus'
export type WorldCatalogKind = 'item' | 'floor' | 'wall' | 'mood' | 'avatar_finish' | 'avatar_outfit' | 'avatar_head'
export const WORLD_ITEM_CATEGORIES = ['seating', 'tables', 'storage', 'lighting', 'plants', 'decor', 'rugs', 'media', 'beds'] as const
export type WorldItemCategory = (typeof WORLD_ITEM_CATEGORIES)[number]
/** Where an item goes: standing on the floor, hung on a wall, on top of a piece of furniture, from the ceiling, or flat on the floor under everything. */
export type WorldItemPlace = 'floor' | 'wall' | 'surface' | 'ceiling' | 'rug'

/** The store collection of the first Worlds release. */
export const WORLD_COLLECTION = { id: 'atelie', name: 'Ateliê', description: 'Peças de assinatura para a sua sala e o seu manequim.' } as const

interface EntryBase {
  sku: string
  name: string
  tier: WorldTier
  /** Store shelf highlight. */
  hero?: boolean
}

export interface WorldItemDef extends EntryBase {
  kind: 'item'
  category: WorldItemCategory
  place: WorldItemPlace
  size: readonly [number, number, number]
  model: { glb: string; scale?: number; yaw?: number } | { proc: string }
  /** Seats in the item's own space: [x, z, yaw, seat height]. */
  seats?: readonly (readonly [number, number, number, number])[]
  /** People walk around it. Default: floor items yes, everything else no. */
  solid?: boolean
  /** Things can be put on it, at this height. */
  top?: number
  /** It shows the room's screen share: [width, height, centre height, z of the glass] in the item's own space. */
  screen?: readonly [number, number, number, number]
  /** It lights the room: [colour temperature in K, strength 0..1, height of the source]. */
  light?: readonly [number, number, number]
  variants?: readonly { id: string; name: string }[]
}
export interface WorldFinishDef extends EntryBase {
  kind: 'floor' | 'wall'
  /** Texture set of the asset pack. */
  texture: string
  /** Colour the texture is multiplied by. */
  tint: string
}
export interface WorldMoodDef extends EntryBase {
  kind: 'mood'
  /** Sky of the asset pack. */
  sky: string
}
export interface WorldAvatarPartDef extends EntryBase {
  kind: 'avatar_finish' | 'avatar_outfit' | 'avatar_head'
}
export type WorldEntry = WorldItemDef | WorldFinishDef | WorldMoodDef | WorldAvatarPartDef

const FABRIC = [
  { id: 'areia', name: 'Areia' }, { id: 'grafite', name: 'Grafite' }, { id: 'musgo', name: 'Musgo' },
  { id: 'terracota', name: 'Terracota' }, { id: 'indigo', name: 'Índigo' },
] as const
const RUG = [{ id: 'marfim', name: 'Marfim' }, { id: 'cinza', name: 'Cinza' }, { id: 'carvao', name: 'Carvão' }] as const
const ART = [{ id: 'mare', name: 'Maré' }, { id: 'duna', name: 'Duna' }, { id: 'noturno', name: 'Noturno' }, { id: 'brasa', name: 'Brasa' }] as const

type ItemInit = Omit<WorldItemDef, 'kind' | 'sku' | 'name' | 'tier' | 'category' | 'place' | 'size' | 'model'>
const item = (
  sku: string, name: string, tier: WorldTier, category: WorldItemCategory, place: WorldItemPlace,
  size: readonly [number, number, number], model: WorldItemDef['model'], more: ItemInit = {},
): WorldItemDef => ({ kind: 'item', sku, name, tier, category, place, size, model, ...more })
const glb = (id: string, more: { scale?: number; yaw?: number } = {}) => ({ glb: id, ...more })
const proc = (id: string) => ({ proc: id })

const ITEMS: WorldItemDef[] = [
  // ---- seating
  item('w_sofa_duo', 'Sofá Bloco · 2 lugares', 'base', 'seating', 'floor', [1.9, 0.76, 0.95], proc('sofa_2'), {
    seats: [[-0.45, 0.1, 0, 0.44], [0.45, 0.1, 0, 0.44]], variants: FABRIC }),
  item('w_sofa_trio', 'Sofá Bloco · 3 lugares', 'base', 'seating', 'floor', [2.6, 0.76, 0.95], proc('sofa_3'), {
    seats: [[-0.8, 0.1, 0, 0.44], [0, 0.1, 0, 0.44], [0.8, 0.1, 0, 0.44]], variants: FABRIC }),
  item('w_sofa_canto', 'Sofá Bloco · canto', 'store', 'seating', 'floor', [3.0, 0.76, 1.75], proc('sofa_corner'), {
    seats: [[-0.99, -0.3, 0, 0.44], [-0.38, -0.3, 0, 0.44], [0.24, -0.3, 0, 0.44], [1.02, 0.3, 0, 0.44]], variants: FABRIC, hero: true }),
  item('w_poltrona_nordica', 'Poltrona Nórdica', 'base', 'seating', 'floor', [0.82, 1.02, 0.99], glb('modern_arm_chair_01'), { seats: [[0, 0.02, 0, 0.42]] }),
  item('w_poltrona_lounge', 'Poltrona Lounge de couro', 'store', 'seating', 'floor', [1.01, 1.17, 1.19], glb('mid_century_lounge_chair'), { seats: [[0, 0.02, 0, 0.42]], hero: true }),
  item('w_sofa_chesterfield', 'Sofá Chesterfield', 'store', 'seating', 'floor', [1.81, 0.71, 0.82], glb('sofa_02'), { seats: [[-0.42, 0.06, 0, 0.42], [0.42, 0.06, 0, 0.42]] }),
  item('w_pufe_couro', 'Pufe de couro', 'base', 'seating', 'floor', [0.88, 0.62, 0.62], glb('ottoman_01', { scale: 0.72 }), { seats: [[0, 0, 0, 0.44]] }),
  item('w_cadeira_jantar', 'Cadeira Capitonê', 'base', 'seating', 'floor', [0.43, 0.97, 0.58], glb('dining_chair_02'), { seats: [[0, 0.03, 0, 0.47]] }),
  item('w_banqueta', 'Banqueta de aço', 'base', 'seating', 'floor', [0.35, 0.88, 0.35], glb('metal_stool_01', { scale: 0.86 }), { seats: [[0, 0, 0, 0.74]] }),

  // ---- tables
  item('w_mesa_centro_concreto', 'Mesa de centro Concreto', 'base', 'tables', 'floor', [1.2, 0.39, 0.6], glb('modern_coffee_table_01'), { top: 0.39 }),
  item('w_mesa_centro_marmore', 'Mesa de centro Mármore', 'store', 'tables', 'floor', [1.3, 0.49, 1.3], glb('coffee_table_round_01', { scale: 0.82 }), { top: 0.4 }),
  item('w_mesa_lateral', 'Mesa lateral Carvalho', 'base', 'tables', 'floor', [0.55, 0.55, 0.45], glb('side_table_01'), { top: 0.55 }),
  item('w_pedestal', 'Pedestal', 'base', 'tables', 'floor', [0.38, 0.76, 0.38], glb('side_table_tall_01'), { top: 0.76 }),
  item('w_mesa_redonda', 'Mesa redonda', 'base', 'tables', 'floor', [0.8, 0.75, 0.8], glb('round_wooden_table_02'), { top: 0.75 }),
  item('w_escrivaninha', 'Escrivaninha', 'base', 'tables', 'floor', [1.13, 0.8, 0.71], glb('wooden_table_02'), { top: 0.8 }),
  item('w_console', 'Console', 'base', 'tables', 'floor', [0.92, 0.53, 0.44], glb('small_wooden_table_01'), { top: 0.53 }),
  item('w_mesa_jantar', 'Mesa de jantar Lâmina', 'base', 'tables', 'floor', [2.2, 0.75, 1.0], proc('dining_table'), { top: 0.75 }),

  // ---- storage
  item('w_aparador_ripado', 'Aparador ripado', 'base', 'storage', 'floor', [2.44, 0.68, 0.52], glb('modern_wooden_cabinet'), { top: 0.68 }),
  item('w_estante_aco', 'Estante de aço', 'base', 'storage', 'floor', [1.1, 2.14, 0.5], glb('steel_frame_shelves_01')),
  item('w_estante_aco_dupla', 'Estante de aço dupla', 'store', 'storage', 'floor', [2.35, 2.31, 0.72], glb('steel_frame_shelves_03')),
  item('w_nichos', 'Estante de nichos', 'base', 'storage', 'floor', [1.08, 1.56, 0.37], glb('wooden_display_shelves_01'), { top: 1.56 }),

  // ---- lighting
  item('w_luminaria_piso', 'Luminária de piso Coluna', 'base', 'lighting', 'floor', [0.42, 1.72, 0.42], proc('floor_lamp'), { light: [2700, 0.9, 1.5], solid: false }),
  item('w_pendente_globo', 'Pendente Globo', 'base', 'lighting', 'ceiling', [0.43, 0.95, 0.43], glb('modern_ceiling_lamp_01'), { light: [2900, 0.8, 0.2] }),
  item('w_pendente_linear', 'Pendente Linear', 'plus', 'lighting', 'ceiling', [1.6, 0.7, 0.08], proc('linear_pendant'), { light: [3000, 1, 0.05] }),
  item('w_luminaria_mesa', 'Luminária articulada', 'base', 'lighting', 'surface', [0.62, 0.88, 0.41], glb('desk_lamp_arm_01', { scale: 0.7 }), { light: [3000, 0.5, 0.5] }),
  item('w_luminaria_industrial', 'Luminária Filamento', 'store', 'lighting', 'surface', [0.18, 0.36, 0.26], glb('industrial_pipe_lamp'), { light: [2200, 0.45, 0.3] }),

  // ---- plants
  item('w_planta_hera', 'Hera em vaso', 'base', 'plants', 'floor', [0.59, 1.35, 0.64], glb('potted_plant_01'), { solid: false }),
  item('w_planta_calocasia', 'Calocásia', 'base', 'plants', 'floor', [0.7, 0.84, 0.66], glb('potted_plant_02'), { solid: false }),
  item('w_suculenta', 'Suculenta', 'base', 'plants', 'surface', [0.17, 0.27, 0.19], glb('potted_plant_04')),

  // ---- decor
  item('w_vaso_gota', 'Vaso Gota', 'base', 'decor', 'surface', [0.2, 0.4, 0.21], glb('ceramic_vase_01')),
  item('w_vaso_bojudo', 'Vaso Bojudo', 'base', 'decor', 'surface', [0.22, 0.31, 0.22], glb('ceramic_vase_02')),
  item('w_vaso_prisma', 'Vaso Prisma', 'base', 'decor', 'surface', [0.11, 0.41, 0.11], glb('ceramic_vase_03')),
  item('w_vaso_moringa', 'Moringa', 'base', 'decor', 'surface', [0.18, 0.34, 0.18], glb('ceramic_vase_04')),
  item('w_enciclopedia', 'Coleção encadernada', 'base', 'decor', 'surface', [0.55, 0.24, 0.16], glb('book_encyclopedia_set_01')),
  item('w_porta_retrato_a', 'Porta-retrato preto', 'base', 'decor', 'surface', [0.2, 0.25, 0.1], glb('standing_picture_frame_01')),
  item('w_porta_retrato_b', 'Porta-retrato branco', 'base', 'decor', 'surface', [0.22, 0.27, 0.1], glb('standing_picture_frame_02')),
  item('w_quadro_retrato', 'Quadro vertical', 'base', 'decor', 'wall', [0.59, 0.84, 0.02], glb('hanging_picture_frame_01')),
  item('w_quadro_paisagem', 'Quadro horizontal', 'base', 'decor', 'wall', [0.75, 0.5, 0.03], glb('hanging_picture_frame_02')),
  item('w_tela_abstrata', 'Tela abstrata', 'base', 'decor', 'wall', [1.3, 0.95, 0.04], proc('canvas'), { variants: ART }),
  item('w_tela_grande', 'Tela de galeria', 'store', 'decor', 'wall', [2.0, 1.3, 0.05], proc('canvas_large'), { variants: ART, hero: true }),
  item('w_relogio', 'Relógio de parede', 'base', 'decor', 'wall', [0.32, 0.32, 0.05], glb('wall_clock')),
  item('w_cesto', 'Cesto de vime', 'base', 'decor', 'floor', [0.38, 0.12, 0.3], glb('wicker_basket_01'), { solid: false }),
  item('w_busto_marmore', 'Busto de mármore', 'store', 'decor', 'surface', [0.27, 0.51, 0.3], glb('marble_bust_01')),
  item('w_xadrez', 'Jogo de xadrez', 'store', 'decor', 'surface', [0.55, 0.11, 0.55], glb('chess_set')),
  item('w_jogo_cha', 'Jogo de chá', 'store', 'decor', 'surface', [0.92, 0.16, 0.48], glb('tea_set_01', { scale: 0.8 })),
  item('w_baleia_bronze', 'Baleia de bronze', 'store', 'decor', 'surface', [0.33, 0.37, 0.48], glb('bronze_whale_statue', { scale: 0.35 }), { hero: true }),
  item('w_ukulele', 'Ukulele', 'store', 'decor', 'wall', [0.18, 0.53, 0.05], glb('ukulele_01')),
  item('w_boombox', 'Boombox', 'store', 'decor', 'surface', [0.72, 0.47, 0.19], glb('boombox', { scale: 0.8 })),
  item('w_console_jogos', 'Console de jogos', 'store', 'decor', 'surface', [0.33, 0.1, 0.32], glb('gaming_console')),

  // ---- rugs
  item('w_tapete_la', 'Tapete de lã', 'base', 'rugs', 'rug', [3.2, 0.02, 2.2], proc('rug_wool'), { variants: RUG }),
  item('w_tapete_juta', 'Tapete redondo de juta', 'base', 'rugs', 'rug', [2.2, 0.02, 2.2], proc('rug_jute')),
  item('w_tapete_grande', 'Tapete de lã grande', 'store', 'rugs', 'rug', [4.4, 0.02, 3.0], proc('rug_wool_large'), { variants: RUG }),

  // ---- media: every room has a screen for free; the larger one is a taste, not a need.
  item('w_tv_parede', 'Tela de parede 85"', 'base', 'media', 'wall', [1.9, 1.09, 0.05], proc('tv_wall'), { screen: [1.872, 1.053, 0.545, 0.03] }),
  item('w_tv_pedestal', 'Tela com pedestal 55"', 'base', 'media', 'floor', [1.26, 1.32, 0.42], proc('tv_stand'), { screen: [1.21, 0.68, 0.94, 0.03], solid: true }),
  item('w_tv_cinema', 'Telão 110"', 'store', 'media', 'wall', [2.48, 1.42, 0.06], proc('tv_cinema'), { screen: [2.44, 1.3725, 0.71, 0.035], hero: true }),

  // ---- beds
  item('w_cama_casal', 'Cama Plataforma', 'base', 'beds', 'floor', [1.9, 0.9, 2.2], proc('bed'), { seats: [[-0.5, 0.86, 0, 0.42], [0.5, 0.86, 0, 0.42]], variants: FABRIC }),
]

const finish = (kind: 'floor' | 'wall', sku: string, name: string, tier: WorldTier, texture: string, tint: string): WorldFinishDef => ({ kind, sku, name, tier, texture, tint })
const FINISHES: WorldFinishDef[] = [
  finish('floor', 'f_carvalho', 'Carvalho natural', 'base', 'floor_oak', '#ffffff'),
  finish('floor', 'f_nogueira', 'Nogueira escura', 'base', 'floor_walnut', '#ffffff'),
  finish('floor', 'f_concreto', 'Concreto polido', 'base', 'floor_concrete', '#e9e7e2'),
  finish('floor', 'f_pedra', 'Pedra clara', 'store', 'floor_stone', '#ffffff'),
  finish('wall', 'p_gesso_branco', 'Branco quente', 'base', 'wall_plaster', '#efebe3'),
  finish('wall', 'p_gesso_areia', 'Areia', 'base', 'wall_plaster', '#cdbfa9'),
  finish('wall', 'p_gesso_salvia', 'Sálvia', 'base', 'wall_plaster', '#8f9c8a'),
  finish('wall', 'p_gesso_terracota', 'Terracota', 'base', 'wall_plaster', '#b4674b'),
  finish('wall', 'p_gesso_grafite', 'Grafite', 'base', 'wall_plaster', '#3a3b40'),
  finish('wall', 'p_gesso_indigo', 'Índigo profundo', 'base', 'wall_plaster', '#2e3258'),
  finish('wall', 'p_concreto', 'Concreto aparente', 'base', 'wall_concrete', '#d8d6d1'),
  finish('wall', 'p_madeira', 'Painel de madeira', 'store', 'wall_wood', '#ffffff'),
]
const MOODS: WorldMoodDef[] = [
  { kind: 'mood', sku: 'm_hora_azul', name: 'Hora azul', tier: 'base', sky: 'hora_azul' },
  { kind: 'mood', sku: 'm_tarde', name: 'Tarde', tier: 'base', sky: 'tarde' },
  { kind: 'mood', sku: 'm_noite', name: 'Noite', tier: 'base', sky: 'noite' },
]
const part = (kind: WorldAvatarPartDef['kind'], sku: string, name: string, tier: WorldTier = 'base', hero = false): WorldAvatarPartDef =>
  ({ kind, sku, name, tier, ...(hero ? { hero } : {}) })
const AVATAR_PARTS: WorldAvatarPartDef[] = [
  part('avatar_finish', 'a_porcelana', 'Porcelana'),
  part('avatar_finish', 'a_areia', 'Areia'),
  part('avatar_finish', 'a_argila', 'Argila'),
  part('avatar_finish', 'a_grafite', 'Grafite'),
  part('avatar_finish', 'a_bronze', 'Bronze acetinado', 'store', true),
  part('avatar_finish', 'a_obsidiana', 'Obsidiana', 'store'),
  part('avatar_finish', 'a_perola', 'Pérola', 'plus'),
  part('avatar_outfit', 'o_nenhum', 'Só o manequim'),
  part('avatar_outfit', 'o_basico', 'Camiseta e calça'),
  part('avatar_outfit', 'o_manga', 'Manga longa e calça'),
  part('avatar_outfit', 'o_verao', 'Camiseta e bermuda'),
  part('avatar_outfit', 'o_macacao', 'Macacão'),
  part('avatar_outfit', 'o_alfaiataria', 'Alfaiataria acetinada', 'store', true),
  part('avatar_outfit', 'o_veludo', 'Conjunto de veludo', 'store'),
  part('avatar_head', 'h_nenhum', 'Nada'),
  part('avatar_head', 'h_headset', 'Headset'),
  part('avatar_head', 'h_bone', 'Boné'),
  part('avatar_head', 'h_gorro', 'Gorro'),
  part('avatar_head', 'h_oculos', 'Óculos redondos'),
  part('avatar_head', 'h_chapeu', 'Chapéu de aba', 'store'),
  part('avatar_head', 'h_oculos_sol', 'Óculos escuros', 'store'),
]

export const WORLD_CATALOG: readonly WorldEntry[] = [...ITEMS, ...FINISHES, ...MOODS, ...AVATAR_PARTS]
const BY_SKU: ReadonlyMap<string, WorldEntry> = new Map(WORLD_CATALOG.map((e) => [e.sku, e]))

export const worldEntry = (sku: string): WorldEntry | undefined => BY_SKU.get(sku)
export function worldItem(sku: string): WorldItemDef | undefined {
  const e = BY_SKU.get(sku)
  return e?.kind === 'item' ? e : undefined
}
type EntryOf<K extends WorldCatalogKind> =
  K extends 'item' ? WorldItemDef : K extends 'floor' | 'wall' ? WorldFinishDef : K extends 'mood' ? WorldMoodDef : WorldAvatarPartDef
export const worldEntries = <K extends WorldCatalogKind>(kind: K): EntryOf<K>[] =>
  WORLD_CATALOG.filter((e) => e.kind === kind) as EntryOf<K>[]
/** SKUs that are sold or come with a plan: each must be a Product of the billing catalog. */
export const WORLD_PAID_SKUS: readonly string[] = WORLD_CATALOG.filter((e) => e.tier !== 'base').map((e) => e.sku)

/** `held`: the SKUs of the account's entitlements (billing.ts Entitlements.items). */
export const holdsWorldSku = (sku: string, held: ReadonlySet<string>): boolean => {
  const e = BY_SKU.get(sku)
  return !!e && (e.tier === 'base' || held.has(sku))
}

// ---- avatars ---------------------------------------------------------------------------------------------------------

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}
const ECO_HEAD: Partial<Record<EcoSpec['accessory'], string>> = { headset: 'h_headset', cap: 'h_bone', beanie: 'h_gorro' }
const AUTO_FINISH = ['a_porcelana', 'a_areia', 'a_argila', 'a_grafite'] as const
const AUTO_TOPS = [0, 1, 6, 7, 8, 9, 10, 13, 14] as const
const AUTO_BOTTOMS = [2, 3, 4, 5, 6] as const

/** The figure of someone who never made one: steady for the account, in the colour and with the headwear of their Eco. */
export function defaultWorldAvatar(userId: string, eco?: EcoSpec | null): WorldAvatar {
  const h = hash(userId)
  return {
    body: (h & 1) === 0 ? 'a' : 'b',
    finish: AUTO_FINISH[(h >>> 1) % AUTO_FINISH.length]!,
    accent: eco?.accent ?? ECO_ACCENTS[(h >>> 4) % ECO_ACCENTS.length]!,
    outfit: 'o_basico',
    top: AUTO_TOPS[(h >>> 8) % AUTO_TOPS.length]!,
    bottom: AUTO_BOTTOMS[(h >>> 12) % AUTO_BOTTOMS.length]!,
    shoes: (h >>> 16) % 2 === 0 ? 0 : 5,
    head: (eco && ECO_HEAD[eco.accessory]) ?? 'h_nenhum',
  }
}

/** Why an avatar cannot be saved by an account holding `held`, or null. */
export function avatarProblem(a: WorldAvatar, held: ReadonlySet<string>): { field: 'finish' | 'outfit' | 'head'; reason: 'unknown' | 'not_owned' } | null {
  const parts = [['finish', 'avatar_finish'], ['outfit', 'avatar_outfit'], ['head', 'avatar_head']] as const
  for (const [field, kind] of parts) {
    const e = BY_SKU.get(a[field])
    if (e?.kind !== kind) return { field, reason: 'unknown' }
    if (!holdsWorldSku(e.sku, held)) return { field, reason: 'not_owned' }
  }
  return null
}

// ---- rooms -----------------------------------------------------------------------------------------------------------

export type RoomProblem =
  | { reason: 'unknown_sku' | 'wrong_kind' | 'not_owned' | 'unknown_variant'; sku: string }
  | { reason: 'duplicate_id' | 'out_of_bounds'; id: string }
  | { reason: 'too_many' | 'too_many_copies'; sku?: string }

/**
 * Why a layout cannot be saved by an account holding `held`, or null. `held: null` skips ownership (built-in rooms).
 * Bounds: the centre of every item is inside the shell (wall pieces sit on the wall plane, so the walls themselves count).
 */
export function roomProblem(room: WorldRoomLayout, held: ReadonlySet<string> | null): RoomProblem | null {
  const shell = WORLD_SHELLS[room.shell]
  const owns = (sku: string) => held === null || holdsWorldSku(sku, held)
  const finishes: [string, WorldCatalogKind][] = [[room.finish.floor, 'floor'], [room.finish.wall, 'wall'], [room.finish.mood, 'mood']]
  if (room.finish.accentWall !== null) finishes.push([room.finish.accentWall, 'wall'])
  for (const [sku, kind] of finishes) {
    const e = BY_SKU.get(sku)
    if (!e) return { reason: 'unknown_sku', sku }
    if (e.kind !== kind) return { reason: 'wrong_kind', sku }
    if (!owns(sku)) return { reason: 'not_owned', sku }
  }
  if (room.items.length > WORLD_ROOM_MAX_ITEMS) return { reason: 'too_many' }
  const ids = new Set<string>()
  const copies = new Map<string, number>()
  for (const it of room.items) {
    const def = worldItem(it.sku)
    if (!def) return BY_SKU.has(it.sku) ? { reason: 'wrong_kind', sku: it.sku } : { reason: 'unknown_sku', sku: it.sku }
    if (!owns(it.sku)) return { reason: 'not_owned', sku: it.sku }
    if (it.variant !== undefined && !def.variants?.some((v) => v.id === it.variant)) return { reason: 'unknown_variant', sku: it.sku }
    if (ids.has(it.id)) return { reason: 'duplicate_id', id: it.id }
    ids.add(it.id)
    const n = (copies.get(it.sku) ?? 0) + 1
    if (n > WORLD_ITEM_MAX_COPIES) return { reason: 'too_many_copies', sku: it.sku }
    copies.set(it.sku, n)
    if (Math.abs(it.x) > shell.width / 2 + 0.01 || Math.abs(it.z) > shell.depth / 2 + 0.01 || it.y > shell.height) return { reason: 'out_of_bounds', id: it.id }
  }
  return null
}

/** Seat ids (`<item id>:<n>`) of a layout. */
export function roomSeats(room: Pick<WorldRoomLayout, 'items'>): Set<string> {
  const seats = new Set<string>()
  for (const it of room.items) {
    const n = worldItem(it.sku)?.seats?.length ?? 0
    for (let i = 0; i < n; i++) seats.add(`${it.id}:${i}`)
  }
  return seats
}

/** Where a seat is in the room: position, the way the person faces, and its height. Null when the seat is not there. */
export function seatPlace(room: Pick<WorldRoomLayout, 'items'>, seat: string): { x: number; y: number; z: number; yaw: number } | null {
  const [id, n] = seat.split(':')
  const it = room.items.find((i) => i.id === id)
  const s = it && worldItem(it.sku)?.seats?.[Number(n)]
  if (!it || !s) return null
  const cos = Math.cos(it.rot), sin = Math.sin(it.rot)
  return { x: it.x + s[0] * cos + s[1] * sin, y: it.y + s[3], z: it.z - s[0] * sin + s[1] * cos, yaw: it.rot + s[2] }
}

const HALF_PI = Math.PI / 2
const place = (id: string, sku: string, x: number, z: number, rot = 0, y = 0, variant?: string): WorldPlacedItem =>
  ({ id, sku, x, y, z, rot, ...(variant ? { variant } : {}) })

/**
 * The room every account starts with: only `base` pieces, already somewhere good to be. Window wall on +Z, the screen on
 * the +X wall with the sofa facing it, a table to sit around on the -X side.
 */
export const STARTER_ROOM: WorldRoomLayout = {
  shell: 'loft',
  finish: { floor: 'f_carvalho', wall: 'p_gesso_branco', accentWall: 'p_gesso_grafite', mood: 'm_hora_azul' },
  items: [
    place('tv', 'w_tv_parede', 4.97, 0.4, -HALF_PI, 0.95),
    place('apa', 'w_aparador_ripado', 4.66, 0.4, -HALF_PI),
    place('tap', 'w_tapete_la', 2.2, 0.4, HALF_PI, 0, 'marfim'),
    place('sofa', 'w_sofa_trio', 0.95, 0.4, HALF_PI, 0, 'areia'),
    place('cen', 'w_mesa_centro_concreto', 2.55, 0.4, HALF_PI),
    place('pol', 'w_poltrona_nordica', 2.7, 2.55, Math.PI + 0.45),
    place('puf', 'w_pufe_couro', 2.75, -1.55, 0.3),
    place('lat', 'w_mesa_lateral', 0.95, -1.35, HALF_PI),
    place('lum', 'w_luminaria_piso', 0.55, 2.2, 0),
    place('vas1', 'w_vaso_bojudo', 0.95, -1.35, 0, 0.55),
    place('her', 'w_planta_hera', 4.45, 3.35, 0),
    place('cal', 'w_planta_calocasia', -0.9, 3.4, 0.8),
    place('mesa', 'w_mesa_redonda', -3.1, 1.7, 0),
    place('cad1', 'w_cadeira_jantar', -3.1, 2.45, Math.PI),
    place('cad2', 'w_cadeira_jantar', -3.85, 1.7, HALF_PI),
    place('cad3', 'w_cadeira_jantar', -2.35, 1.7, -HALF_PI),
    place('pen', 'w_pendente_globo', -3.1, 1.7, 0, 2.25),
    place('suc', 'w_suculenta', -3.1, 1.7, 0, 0.75),
    place('est', 'w_estante_aco', 1.7, -3.72, 0),
    place('nic', 'w_nichos', 3.25, -3.79, 0),
    place('enc', 'w_enciclopedia', 3.25, -3.79, 0, 1.56),
    place('vas2', 'w_vaso_gota', 3.6, -3.79, 0, 1.56),
    place('con', 'w_console', -0.6, -3.76, 0),
    place('ret', 'w_porta_retrato_a', -0.85, -3.76, 0.2, 0.53),
    place('vas3', 'w_vaso_prisma', -0.35, -3.76, 0, 0.53),
    place('tela', 'w_tela_abstrata', -0.6, -3.98, 0, 1.2, 'mare'),
    place('qua', 'w_quadro_retrato', -4.98, -0.6, HALF_PI, 1.25),
    place('rel', 'w_relogio', -4.98, 0.5, HALF_PI, 1.75),
    place('ces', 'w_cesto', 4.4, -2.9, 0.4),
  ],
}

/** The shared room: two places to sit and talk, a long table, the big screen. Uses pieces of every tier. */
export const LOUNGE_ROOM: WorldRoomLayout = {
  shell: 'lounge',
  finish: { floor: 'f_nogueira', wall: 'p_gesso_areia', accentWall: 'p_madeira', mood: 'm_hora_azul' },
  items: [
    // Screen wall (+X) and the main seats in front of it.
    place('tv', 'w_tv_cinema', 6.97, 0, -HALF_PI, 0.95),
    place('apa', 'w_aparador_ripado', 6.66, 0, -HALF_PI),
    place('tap', 'w_tapete_grande', 3.6, 0, HALF_PI, 0, 'cinza'),
    place('sofa', 'w_sofa_canto', 1.95, 0.35, HALF_PI, 0, 'grafite'),
    place('cen', 'w_mesa_centro_marmore', 3.9, 0, 0),
    place('lou1', 'w_poltrona_lounge', 4.3, 2.75, Math.PI + 0.5),
    place('lou2', 'w_poltrona_lounge', 4.3, -2.75, -0.5),
    place('lum1', 'w_luminaria_piso', 1.35, 2.75, 0),
    place('bal', 'w_baleia_bronze', 6.66, -0.85, -HALF_PI, 0.68),
    place('vasa', 'w_vaso_moringa', 6.66, 0.95, 0, 0.68),
    // Second group by the windows (+Z).
    place('tap2', 'w_tapete_juta', -2.4, 3.1, 0),
    place('che', 'w_sofa_chesterfield', -2.4, 4.2, Math.PI),
    place('pol1', 'w_poltrona_nordica', -3.9, 2.7, HALF_PI + 0.35),
    place('pol2', 'w_poltrona_nordica', -0.9, 2.7, -HALF_PI - 0.35),
    place('cen2', 'w_mesa_centro_concreto', -2.4, 2.95, 0),
    place('xad', 'w_xadrez', -2.4, 2.95, 0.2, 0.39),
    place('her', 'w_planta_hera', 0.6, 4.4, 0),
    place('cal', 'w_planta_calocasia', -5.4, 4.3, 0.6),
    // Long table on the -X side.
    place('mesa', 'w_mesa_jantar', -4.4, -1.6, HALF_PI),
    place('cad1', 'w_cadeira_jantar', -5.25, -2.3, HALF_PI),
    place('cad2', 'w_cadeira_jantar', -5.25, -1.6, HALF_PI),
    place('cad3', 'w_cadeira_jantar', -5.25, -0.9, HALF_PI),
    place('cad4', 'w_cadeira_jantar', -3.55, -2.3, -HALF_PI),
    place('cad5', 'w_cadeira_jantar', -3.55, -1.6, -HALF_PI),
    place('cad6', 'w_cadeira_jantar', -3.55, -0.9, -HALF_PI),
    place('pen', 'w_pendente_linear', -4.4, -1.6, HALF_PI, 2.9),
    place('cha', 'w_jogo_cha', -4.4, -1.6, HALF_PI, 0.75),
    // Back wall (-Z): shelves, art, a console.
    place('est', 'w_estante_aco_dupla', 2.6, -4.6, 0),
    place('bus', 'w_busto_marmore', 5.3, -4.72, 0.3, 0.76),
    place('ped', 'w_pedestal', 5.3, -4.72, 0),
    place('tela', 'w_tela_grande', -0.9, -4.97, 0, 1.15, 'noturno'),
    place('con', 'w_console', -0.9, -4.74, 0),
    place('vasb', 'w_vaso_gota', -1.15, -4.74, 0, 0.53),
    place('ind', 'w_luminaria_industrial', -0.6, -4.74, 0, 0.53),
    place('ban1', 'w_banqueta', 0.9, -4.3, 0),
    place('uku', 'w_ukulele', -6.98, 1.4, HALF_PI, 1.3),
    place('qua', 'w_quadro_paisagem', -6.98, 2.6, HALF_PI, 1.35),
  ],
}
