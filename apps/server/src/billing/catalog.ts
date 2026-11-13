/**
 * Versioned product catalog: the single source of plans, prices, cosmetics, collections, bundles and Casa
 * contributions. Upserted into `products` at startup (Billing.syncCatalog); a retired or removed SKU goes inactive
 * there (never deleted: orders reference it). Prices and wave dates are the owner's to approve: one edit here.
 * Changing a price or a feature: edit here, bump CATALOG_VERSION, note why in docs/business/monetization.md.
 * Existing subscriptions keep the price they were sold at (`subscriptions.amount_cents`).
 * v2 (docs/business/growth-plan.md §2–§3): Coleção 01 "Hora Azul", Plus v2 wardrobe, bundles, one-time Plus, Casa;
 * the v1 "oceano" items are retired (kept equippable by anyone who owns one).
 * v3: the "Ateliê" collection of Alga Worlds (furniture, finishes and avatar parts; names and tiers come from
 * packages/shared/src/worlds-catalog.ts, the prices live here).
 */
import {
  PLUS_BADGES, PLUS_PASS_PRODUCT_ID, WORLD_COLLECTION, WORLD_PAID_SKUS, worldEntry,
  type Collection, type PlusBadge, type CosmeticType, type PlanId, type PlanPerk, type PlanSummary, type Product, type SpaceUpgradePerk, type StreamPreset,
  type WorldCatalogKind,
} from '@alga/shared'

export const CATALOG_VERSION = 3

const MiB = 1024 * 1024
const FREE_PRESETS: StreamPreset[] = ['720p30', '720p60', '1080p30']

/** `maxAttachmentBytes: null` = the server's MAX_ATTACHMENT_BYTES (the free cap). Voice is the same for every plan (D12). */
export const PLANS: Record<PlanId, { name: string; streamPresets: StreamPreset[]; maxAttachmentBytes: number | null; perks: PlanPerk[] }> = {
  free: { name: 'Grátis', streamPresets: FREE_PRESETS, maxAttachmentBytes: null, perks: [] },
  plus: {
    name: 'Alga Plus', streamPresets: [...FREE_PRESETS, '1080p60', '1440p60', '2160p30'], maxAttachmentBytes: 100 * MiB,
    perks: ['hd_streaming', 'large_attachments', 'wardrobe', 'tenure_badge', 'animated_banner', 'app_accents', 'priority_support', 'annual_item', 'friend_passes'],
  },
}

/** Higher rank wins when a user somehow holds two plans. */
export const PLAN_RANK: Record<PlanId, number> = { free: 0, plus: 1 }

export function planSummary(id: PlanId, defaultAttachmentBytes: number): PlanSummary {
  const p = PLANS[id]
  return {
    id,
    name: p.name,
    streamPresets: [...p.streamPresets],
    // A plan never gets less than the free cap, even if the server raises MAX_ATTACHMENT_BYTES above it.
    maxAttachmentBytes: Math.max(p.maxAttachmentBytes ?? 0, defaultAttachmentBytes),
    perks: [...p.perks],
  }
}

/** Largest attachment cap of any plan: the multipart parser's global ceiling. */
export const maxPlanAttachmentBytes = (defaultBytes: number) =>
  Math.max(...Object.keys(PLANS).map((id) => planSummary(id as PlanId, defaultBytes).maxAttachmentBytes))

/** Collections and their waves. A wave opens at `opensAt` (null = not scheduled): its items and bundles go on sale. */
export const COLLECTIONS: (Omit<Collection, 'waves'> & { waves: { wave: number; opensAt: string | null }[] })[] = [
  {
    id: 'hora_azul', name: 'Hora Azul',
    description: 'Coleção 01: o quarto de hora depois do pôr do sol, quando o céu fica índigo e as janelas acendem.',
    // Wave 2 (auras, sounds, reactions, frames) opened early by the owner on 2026-11-08 (bundles go on sale with it).
    waves: [{ wave: 1, opensAt: '2026-11-01T00:00:00-03:00' }, { wave: 2, opensAt: '2026-11-08T00:00:00-03:00' }],
  },
  // Alga Worlds: one wave, on sale from the day the catalog got it.
  { id: WORLD_COLLECTION.id, name: WORLD_COLLECTION.name, description: WORLD_COLLECTION.description, waves: [{ wave: 1, opensAt: '2026-11-13T00:00:00-03:00' }] },
]

const waveOpen = (collectionId: string | undefined, wave: number | undefined, now: number) => {
  if (!collectionId) return true
  const at = COLLECTIONS.find((c) => c.id === collectionId)?.waves.find((w) => w.wave === wave)?.opensAt
  return at != null && new Date(at).getTime() <= now
}

export const collectionsView = (now = Date.now()): Collection[] =>
  COLLECTIONS.map((c) => ({ ...c, waves: c.waves.map((w) => ({ ...w, open: waveOpen(c.id, w.wave, now) })) }))

/** Reference USD price per BRL price point (no USD checkout yet). */
const USD: Record<number, number> = {
  500: 149, 590: 199, 690: 229, 790: 249, 990: 299, 1000: 299, 1290: 349, 1490: 499, 1690: 449, 1990: 599,
  2290: 599, 2690: 699, 3590: 949, 4790: 1249, 14900: 4990, 19900: 5990,
}
const usd = (brl: number) => USD[brl] ?? Math.round(brl / 3.3)

const plan = (id: string, interval: 'month' | 'year', brl: number, name: string, description: string, billing?: 'one_time'): Product => ({
  id, kind: 'plan', planId: 'plus', interval, name, description, priceBrlCents: brl, priceUsdCents: usd(brl), purchasable: true,
  ...(billing ? { billing, giftable: true } : {}),
})

/** A Coleção 01 item: sold for `brl`, or 0 = only in the Plus wardrobe. */
const ha = (id: string, cosmeticType: CosmeticType, wave: 1 | 2, brl: number, name: string, description: string, hero = false): Product => ({
  id, kind: 'cosmetic', cosmeticType, name, description, priceBrlCents: brl, priceUsdCents: brl ? usd(brl) : 0,
  collectionId: 'hora_azul', wave, ...(hero ? { hero } : {}),
  ...(brl ? { purchasable: true, giftable: true } : { purchasable: false, includedIn: ['plus'] as PlanId[] }),
})

const bundle = (id: string, brl: number, name: string, description: string, items: string[]): Product => ({
  id, kind: 'bundle', name, description, priceBrlCents: brl, priceUsdCents: usd(brl), purchasable: true, giftable: true,
  collectionId: 'hora_azul', items,
})

const casa = (id: string, brl: number, days: number): Product => ({
  id, kind: 'space_upgrade', name: `Casa: +${days} dias`, description: `Acende a Casa do espaço por mais ${days} dias. Sem renovação automática.`,
  priceBrlCents: brl, priceUsdCents: usd(brl), purchasable: true, days,
})

/** Ateliê: BRL price of every `store` SKU of the worlds catalog (`plus` ones are not sold: they come with the plan). */
const WORLD_PRICES: Record<string, number> = {
  w_sofa_canto: 1290, w_poltrona_lounge: 990, w_sofa_chesterfield: 990, w_mesa_centro_marmore: 790, w_estante_aco_dupla: 790,
  w_luminaria_industrial: 590, w_tela_grande: 790, w_busto_marmore: 590, w_xadrez: 590, w_jogo_cha: 590, w_baleia_bronze: 790,
  w_ukulele: 590, w_boombox: 590, w_console_jogos: 590, w_tapete_grande: 790, w_tv_cinema: 1290,
  f_pedra: 790, p_madeira: 790,
  a_bronze: 990, a_obsidiana: 790, o_alfaiataria: 990, o_veludo: 790, h_chapeu: 590, h_oculos_sol: 590,
}
const ROOM_PIECE = 'Peça para a sua sala no Alga Worlds. Fica na sua conta.'
const ROOM_FINISH = 'Acabamento para a sua sala no Alga Worlds. Fica na sua conta.'
const AVATAR_PART = 'Peça para o seu manequim no Alga Worlds. Fica na sua conta.'
const WORLD_DESCRIPTIONS: Record<WorldCatalogKind, string> = {
  item: ROOM_PIECE, floor: ROOM_FINISH, wall: ROOM_FINISH, mood: ROOM_FINISH,
  avatar_finish: AVATAR_PART, avatar_outfit: AVATAR_PART, avatar_head: AVATAR_PART,
}

/** A sold or plan-included SKU of the worlds catalog: the name comes from there, so the two never drift. */
const world = (sku: string): Product => {
  const e = worldEntry(sku)!
  const brl = e.tier === 'store' ? WORLD_PRICES[sku] : 0
  if (brl === undefined) throw new Error(`billing catalog: no price for the world SKU ${sku}`)
  return {
    id: sku, kind: 'cosmetic', world: true, name: e.name, description: WORLD_DESCRIPTIONS[e.kind],
    priceBrlCents: brl, priceUsdCents: brl ? usd(brl) : 0, collectionId: WORLD_COLLECTION.id, wave: 1, ...(e.hero ? { hero: true } : {}),
    // Not giftable yet: the gift reveal cannot draw 3D items.
    giftable: false,
    ...(e.tier === 'store' ? { purchasable: true } : { purchasable: false, includedIn: ['plus'] as PlanId[] }),
  }
}

const retired = (id: string, cosmeticType: CosmeticType, name: string, brl: number): Product => ({
  id, kind: 'cosmetic', cosmeticType, name, description: 'Item da coleção anterior: não é mais vendido.', priceBrlCents: brl,
  priceUsdCents: usd(brl), purchasable: false, retired: true,
})

export const PRODUCTS: Product[] = [
  plan('plus_monthly', 'month', 1490, 'Alga Plus — mensal',
    'Transmissão em 1080p60, 1440p60 e 4K30, anexos de até 100 MB e o guarda-roupa Plus. Renova sozinho todo mês.'),
  plan('plus_yearly', 'year', 14900, 'Alga Plus — anual',
    'O mesmo que o mensal, cobrado uma vez por ano (2 meses de desconto), e 1 item da Coleção 01 que fica na sua conta.'),
  plan('plus_monthly_once', 'month', 1490, 'Alga Plus — 1 mês (pagamento único)',
    '1 mês de Plus, sem renovação. Pix ou cartão. Também serve de presente.', 'one_time'),
  plan('plus_yearly_once', 'year', 14900, 'Alga Plus — 12 meses (pagamento único)',
    '12 meses de Plus no Pix, sem renovação, com o item anual. Também serve de presente.', 'one_time'),
  {
    id: PLUS_PASS_PRODUCT_ID, kind: 'plan', planId: 'plus', name: 'Convite Plus (7 dias)',
    description: 'Presente de um assinante: 7 dias de Plus. Não é vendido.', priceBrlCents: 0, priceUsdCents: 0, purchasable: false,
  },

  // ---- Coleção 01 "Hora Azul" (growth-plan §3.4). Wave 1 = HA-01..15 and HA-26..28; wave 2 = HA-16..25.
  ha('deco_ha_halo_vidro', 'avatar_decoration', 1, 1290, 'Halo de vidro', 'Um anel aberto de vidro, com reflexo às 11 h.', true),
  ha('deco_ha_orbita', 'avatar_decoration', 1, 990, 'Órbita', 'Duas órbitas finas e uma conta de luz.'),
  ha('deco_ha_constelacao', 'avatar_decoration', 1, 990, 'Constelação', 'Sete estrelas que acendem em sequência.'),
  ha('deco_ha_fita_seda', 'avatar_decoration', 1, 1290, 'Fita de seda', 'Uma fita índigo com um brilho que corre uma vez.'),
  ha('deco_ha_traco_grafite', 'avatar_decoration', 1, 690, 'Traço de grafite', 'Um traço de lápis feito à mão.'),
  ha('effect_ha_hora_azul', 'profile_effect', 1, 1690, 'Hora azul', 'O céu passa do crepúsculo à noite ao abrir o perfil.', true),
  ha('effect_ha_poeira_luz', 'profile_effect', 1, 1290, 'Poeira de luz', 'Partículas que sobem e assentam, únicas para cada pessoa.'),
  ha('effect_ha_cortina_vidro', 'profile_effect', 1, 1290, 'Cortina de vidro', 'Lâminas de vidro giram e revelam o perfil.'),
  ha('nameplate_ha_crepusculo', 'nameplate', 1, 790, 'Crepúsculo', 'Gradiente índigo com a linha do horizonte.', true),
  ha('nameplate_ha_vidro_fosco', 'nameplate', 1, 590, 'Vidro fosco', 'Vidro fosco discreto, combina com tudo.'),
  ha('nameplate_ha_fio_luz', 'nameplate', 1, 690, 'Fio de luz', 'Uma linha fina que um ponto de luz percorre.'),
  ha('nameplate_ha_nanquim', 'nameplate', 1, 590, 'Nanquim', 'Uma mancha de tinta feita à mão.'),
  ha('theme_ha_noite_indigo', 'profile_theme', 1, 790, 'Noite índigo', 'O cartão em céu noturno.'),
  ha('theme_ha_porcelana', 'profile_theme', 1, 990, 'Porcelana', 'Um cartão claro num app escuro.'),
  ha('theme_ha_nevoa_lavanda', 'profile_theme', 1, 790, 'Névoa lavanda', 'Névoa suave de lilás e índigo.'),
  ha('aura_ha_respiro', 'voice_aura', 2, 1290, 'Respiro', 'Dois anéis que respiram com a sua voz.', true),
  ha('aura_ha_prisma', 'voice_aura', 2, 1290, 'Prisma', 'Um anel que gira com a energia da fala.'),
  ha('aura_ha_ondas', 'voice_aura', 2, 990, 'Ondas', 'Anéis que seguem o ritmo da sua fala.'),
  ha('aura_ha_frondes', 'voice_aura', 2, 0, 'Frondes', 'O sinal discreto de quem apoia o Alga Meet.'),
  ha('sound_ha_toque_vidro', 'entrance_sound', 2, 590, 'Toque de vidro', 'Duas notas de sino de vidro ao entrar.'),
  ha('sound_ha_corda', 'entrance_sound', 2, 690, 'Corda', 'Um arpejo de violão de nylon ao entrar.'),
  ha('sound_ha_sopro', 'entrance_sound', 2, 590, 'Sopro', 'Ar e um sino suave ao entrar.'),
  ha('reactions_ha_hora_azul', 'call_reactions', 2, 990, 'Reações Hora Azul', '8 reações na chamada, em vidro e luz.'),
  ha('frame_ha_cinema', 'stream_frame', 2, 1290, 'Moldura Cinema', 'Uma moldura de estreia para quem assiste à sua transmissão.', true),
  ha('frame_ha_vidro', 'stream_frame', 2, 990, 'Moldura de vidro', 'Um chanfro de vidro em volta da transmissão.'),
  ha('icon_ha_noite', 'app_icon', 1, 0, 'Ícone Noite', 'Frondes claras sobre o céu noturno. Só você vê.'),
  ha('icon_ha_porcelana', 'app_icon', 1, 0, 'Ícone Porcelana', 'Frondes em grafite sobre porcelana. Só você vê.'),
  ha('icon_ha_crepusculo', 'app_icon', 1, 590, 'Ícone Crepúsculo', 'Frondes no degradê do horizonte. Só você vê.'),

  // ---- Plus wardrobe: app accent colors (validated in the design system; the accessibility themes stay free).
  // A monthly wardrobe item is a cosmetic with includedIn: ['plus'] and includedFrom: '<first day of its month>'.
  ...([['accent_lavanda', 'Lavanda'], ['accent_ardosia', 'Ardósia'], ['accent_grafite', 'Grafite']] as const).map(([id, name]): Product => ({
    id, kind: 'cosmetic', cosmeticType: 'app_accent', name: `Cor ${name}`, description: 'Cor de destaque do app. Só você vê.',
    priceBrlCents: 0, priceUsdCents: 0, purchasable: false, includedIn: ['plus'],
  })),

  // ---- Bundles (growth-plan §3.5): every one has a wave-2 item, so they open with wave 2.
  bundle('bundle_ha_hora_azul', 4790, 'Conjunto Hora Azul', 'Os 5 heróis da coleção.',
    ['deco_ha_halo_vidro', 'effect_ha_hora_azul', 'nameplate_ha_crepusculo', 'aura_ha_respiro', 'frame_ha_cinema']),
  bundle('bundle_ha_vidro', 3590, 'Conjunto Vidro', 'Tudo o que é de vidro.',
    ['deco_ha_halo_vidro', 'effect_ha_cortina_vidro', 'nameplate_ha_vidro_fosco', 'sound_ha_toque_vidro', 'frame_ha_vidro']),
  bundle('bundle_ha_kit_chamada', 2290, 'Kit de chamada', 'Para quem vive na call.',
    ['aura_ha_respiro', 'sound_ha_corda', 'reactions_ha_hora_azul']),
  bundle('bundle_ha_kit_transmissao', 2690, 'Kit de quem transmite', 'Para a noite de cinema.',
    ['aura_ha_prisma', 'reactions_ha_hora_azul', 'frame_ha_cinema']),

  // ---- Ateliê (Alga Worlds): one product per paid SKU of the worlds catalog. No cosmeticType: nothing here goes in a
  // profile slot; they are placed in a room or worn by the 3D figure (src/worlds.ts).
  ...WORLD_PAID_SKUS.map(world),

  // ---- Casa contributions (growth-plan §2.3): any member 18+ adds days; no auto-renewal, no tiers.
  casa('casa_7d', 500, 7),
  casa('casa_15d', 1000, 15),
  casa('casa_30d', 1990, 30),
  casa('casa_365d', 19900, 365),

  // ---- Catalog v1 "oceano" (teal identity retired by D10b; nothing sold in production): off sale, still equippable when owned.
  retired('deco_folha_de_alga', 'avatar_decoration', 'Folha de alga', 990),
  retired('deco_coral', 'avatar_decoration', 'Coral', 990),
  retired('theme_noite_paulistana', 'profile_theme', 'Noite paulistana', 790),
  retired('effect_bioluminescencia', 'profile_effect', 'Bioluminescência', 1290),
  retired('nameplate_cardume', 'nameplate', 'Cardume', 590),
  retired('theme_plus_mare', 'profile_theme', 'Tema Maré', 0),
  retired('nameplate_plus_correnteza', 'nameplate', 'Placa Correnteza', 0),
]

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id)

/** On sale now: purchasable, not retired, and its wave (each item's, for a bundle) is open. */
export function isAvailable(p: Product, now = Date.now()): boolean {
  if (!p.purchasable || p.retired) return false
  if (p.kind === 'bundle') return (p.items ?? []).every((id) => { const i = productById(id); return !!i && waveOpen(i.collectionId, i.wave, now) })
  return waveOpen(p.collectionId, p.wave, now)
}

/** Plan-included cosmetics right now (the Plus wardrobe grows with includedFrom). */
export const includedIn = (planId: PlanId, now: number) =>
  PRODUCTS.filter((p) => p.includedIn?.includes(planId) && !p.retired && (!p.includedFrom || new Date(p.includedFrom).getTime() <= now))

/**
 * "Completar o conjunto": bundle price × (value of the missing items ÷ value of all), rounded down to ,90
 * (growth-plan §3.5). Integer cents throughout.
 */
export function bundlePriceCents(bundle: Product, missing: string[]): number {
  const value = (ids: string[]) => ids.reduce((sum, id) => sum + (productById(id)?.priceBrlCents ?? 0), 0)
  const total = value(bundle.items ?? [])
  if (!total || !missing.length) return 0
  const raw = Math.floor(bundle.priceBrlCents * value(missing) / total)
  return Math.max(90, Math.floor((raw - 90) / 100) * 100 + 90)
}

/** Casa perks (phase 2: cost ≈ 0). Cinema only with CASA_CINEMA (off until the bandwidth deal, growth-plan §2.3). */
export const spaceUpgradePerks = (cinema: boolean): SpaceUpgradePerk[] =>
  ['animated_banner', 'animated_icon', 'tone', 'vanity_invite', 'event_cover', 'monthly_recap', 'badge', ...(cinema ? ['cinema' as const] : [])]

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000
/** Months of Plus in `ms`, with 3 days of slack so a 28-day February still counts as a month. */
export const monthsOf = (ms: number) => Math.floor((ms + 3 * 24 * 60 * 60 * 1000) / MONTH_MS)

/** PublicUser.plusBadge from the users.plus_since cache (set only while a paid Plus is active). */
export function plusBadgeOf(plusSince: Date | null, plan: PlanId, now = Date.now()): PlusBadge | undefined {
  if (plan !== 'plus' || !plusSince) return undefined
  const months = monthsOf(now - plusSince.getTime())
  return [...PLUS_BADGES].reverse().find((b) => months >= b)
}
