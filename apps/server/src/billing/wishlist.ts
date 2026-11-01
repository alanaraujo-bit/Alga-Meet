/**
 * Wishlist (growth-plan §2.4): up to WISHLIST_MAX cosmetics/bundles, seen only by friends (in the gift window), never
 * announced. On by default for 18+, off for 16–17 (users.wishlist_visible null = that default).
 */
import { WISHLIST_MAX, type Wishlist } from '@alga/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import { isFriend } from '../access.js'
import type { Db } from '../db/index.js'
import { users, wishlists, type UserRow } from '../db/schema.js'
import { conflict, notFound } from '../errors.js'
import { ageBracketOf } from '../legal.js'
import type { Billing } from './billing.js'
import { productById } from './catalog.js'

const visibleOf = (u: UserRow) => u.wishlistVisible ?? ageBracketOf(u) !== 'teen'

async function view(db: Db, billing: Billing, u: UserRow): Promise<Wishlist> {
  const [rows, owned] = await Promise.all([
    db.select({ productId: wishlists.productId }).from(wishlists).where(eq(wishlists.userId, u.id)).orderBy(asc(wishlists.createdAt), asc(wishlists.productId)),
    billing.owned(u.id),
  ])
  // A bundle stays until every item in it is owned; bought/gifted items drop out on their own.
  const has = (id: string) => (productById(id)?.items ?? [id]).every((i) => owned.has(i))
  return { userId: u.id, items: rows.map((r) => r.productId).filter((id) => !has(id)), visible: visibleOf(u) }
}

export const wishlistOf = (db: Db, billing: Billing, u: UserRow) => view(db, billing, u)

export async function addToWishlist(db: Db, billing: Billing, u: UserRow, productId: string): Promise<Wishlist> {
  const p = productById(productId)
  if (!p || p.retired || !p.purchasable || (p.kind !== 'cosmetic' && p.kind !== 'bundle')) throw notFound('Produto não encontrado.')
  const current = await view(db, billing, u)
  if (current.items.includes(productId)) return current
  if ((await billing.owned(u.id)).has(productId)) throw conflict('Você já tem este item.')
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, u.id)).for('update')
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(wishlists).where(eq(wishlists.userId, u.id))
    if ((n?.n ?? 0) >= WISHLIST_MAX) throw conflict(`A lista de desejos tem no máximo ${WISHLIST_MAX} itens.`)
    await tx.insert(wishlists).values({ userId: u.id, productId }).onConflictDoNothing()
  })
  return view(db, billing, u)
}

export async function removeFromWishlist(db: Db, billing: Billing, u: UserRow, productId: string): Promise<Wishlist> {
  await db.delete(wishlists).where(and(eq(wishlists.userId, u.id), eq(wishlists.productId, productId)))
  return view(db, billing, u)
}

export async function setWishlistVisible(db: Db, billing: Billing, u: UserRow, visible: boolean): Promise<Wishlist> {
  const [row] = await db.update(users).set({ wishlistVisible: visible }).where(eq(users.id, u.id)).returning()
  return view(db, billing, row!)
}

/** GET /users/:id/wishlist: friends only, and only when visible; otherwise 404 (nothing to tell apart). */
export async function friendWishlist(db: Db, billing: Billing, viewerId: string, ownerId: string): Promise<Wishlist> {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId))
  if (!owner || (viewerId !== ownerId && (!visibleOf(owner) || !await isFriend(db, viewerId, ownerId)))) throw notFound('Lista de desejos não encontrada.')
  return view(db, billing, owner)
}
