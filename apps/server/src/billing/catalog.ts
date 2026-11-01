/**
 * Versioned product catalog: the single source of plans, prices and cosmetics. Upserted into `products` at startup
 * (Billing.syncCatalog); a SKU removed here goes inactive there (never deleted: orders reference it).
 * Changing a price or a feature: edit here, bump CATALOG_VERSION, note why in docs/business/monetization.md.
 * Existing subscriptions keep the price they were sold at (`subscriptions.amount_cents`).
 */
import type { PlanId, PlanSummary, Product, StreamPreset } from '@alga/shared'

export const CATALOG_VERSION = 1

const MiB = 1024 * 1024
const FREE_PRESETS: StreamPreset[] = ['720p30', '720p60', '1080p30']

/** `maxAttachmentBytes: null` = the server's MAX_ATTACHMENT_BYTES (the free cap). Voice is the same for every plan (D12). */
export const PLANS: Record<PlanId, { name: string; streamPresets: StreamPreset[]; maxAttachmentBytes: number | null }> = {
  free: { name: 'Grátis', streamPresets: FREE_PRESETS, maxAttachmentBytes: null },
  plus: { name: 'Alga Plus', streamPresets: [...FREE_PRESETS, '1080p60', '1440p60', '2160p30'], maxAttachmentBytes: 100 * MiB },
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
  }
}

/** Largest attachment cap of any plan: the multipart parser's global ceiling. */
export const maxPlanAttachmentBytes = (defaultBytes: number) =>
  Math.max(...Object.keys(PLANS).map((id) => planSummary(id as PlanId, defaultBytes).maxAttachmentBytes))

const plan = (id: string, interval: 'month' | 'year', brl: number, usd: number, name: string, description: string): Product =>
  ({ id, kind: 'plan', planId: 'plus', interval, name, description, priceBrlCents: brl, priceUsdCents: usd, purchasable: true })

const cosmetic = (
  id: string, cosmeticType: NonNullable<Product['cosmeticType']>, name: string, description: string,
  brl: number, usd: number, includedIn?: PlanId[],
): Product => ({
  id, kind: 'cosmetic', cosmeticType, name, description, priceBrlCents: brl, priceUsdCents: usd,
  ...(includedIn ? { includedIn } : {}), purchasable: brl > 0,
})

export const PRODUCTS: Product[] = [
  plan('plus_monthly', 'month', 1490, 499, 'Alga Plus — mensal',
    'Transmissão em 1080p60, 1440p60 e 4K30, anexos de até 100 MB e a coleção Plus de cosméticos.'),
  plan('plus_yearly', 'year', 14900, 4990, 'Alga Plus — anual',
    'O mesmo que o mensal, cobrado uma vez por ano (2 meses de desconto).'),

  // Included while subscribed to Plus; not sold separately.
  cosmetic('theme_plus_mare', 'profile_theme', 'Tema Maré', 'Gradiente verde-água no perfil.', 0, 0, ['plus']),
  cosmetic('nameplate_plus_correnteza', 'nameplate', 'Placa Correnteza', 'Fundo animado discreto atrás do nome.', 0, 0, ['plus']),

  // Sold individually, owned for good.
  cosmetic('deco_folha_de_alga', 'avatar_decoration', 'Folha de alga', 'Moldura de folhas em volta do avatar.', 990, 299),
  cosmetic('deco_coral', 'avatar_decoration', 'Coral', 'Moldura de coral com brilho suave.', 990, 299),
  cosmetic('theme_noite_paulistana', 'profile_theme', 'Noite paulistana', 'Tema escuro com tons de neon do perfil.', 790, 249),
  cosmetic('effect_bioluminescencia', 'profile_effect', 'Bioluminescência', 'Partículas de luz ao abrir o perfil.', 1290, 349),
  cosmetic('nameplate_cardume', 'nameplate', 'Cardume', 'Peixinhos passando atrás do nome.', 590, 199),
]

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id)
