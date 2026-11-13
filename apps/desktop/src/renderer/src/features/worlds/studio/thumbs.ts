// Pictures of the placeable items, drawn by the engine itself (scripts/worlds-thumbs.mjs → dev/thumbs.ts). They ship with
// this screen's chunk, so the inventory and the store show at once, before any 3D file is fetched.
const files = import.meta.glob<string>('../thumbs/*.webp', { eager: true, query: '?url', import: 'default' })

const BY_SKU = new Map<string, string>()
for (const [path, url] of Object.entries(files)) {
  const m = /([a-z0-9_]+)\.webp$/.exec(path)
  if (m) BY_SKU.set(m[1]!, url)
}

export const thumbOf = (sku: string): string | undefined => BY_SKU.get(sku)
