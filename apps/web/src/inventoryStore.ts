/**
 * Inventory store — backed by /api/inventory-state (singleton per account).
 *
 * Reads are synchronous off an in-memory cache hydrated by initInventory()
 * after auth. Writes update the cache and schedule a debounced PUT to the
 * server, so spam-saves from the inventory page don't hammer the network.
 */

import { getAccessToken, fetchWithAuth } from './crmAuth'
import { createVersionedFlusher, versionedSave, legacyMigrationEnabled } from './syncGuard'
import { setMaterialPriceSource, normalizeItemName } from './materialCalculator'
import { cloudStorage } from './cloudStorage'
import { LOCAL_API_ORIGIN } from './apiOrigin'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')
const INV_EVT = 'fencepro:inventory:updated'
const INV_MIGRATION_FLAG = 'fencepro_inventory_db_migrated_v1'

interface InventoryStateBlob {
  items: any[]
  bundles: any[]
  locations: any[]
  stockLevels: any[]
  transactions: any[]
}

let invCache: InventoryStateBlob = { items: [], bundles: [], locations: [], stockLevels: [], transactions: [] }
let invInitPromise: Promise<void> | null = null
let invHydrated = false

async function invCall<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T }> {
  const token = getAccessToken()
  if (!token) return { ok: false }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/inventory-state`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return { ok: false }
    const json = await res.json().catch(() => ({}))
    if (!json?.success) return { ok: false }
    return { ok: true, data: json.data as T }
  } catch { return { ok: false } }
}

function invEmit() { try { window.dispatchEvent(new CustomEvent(INV_EVT)) } catch {} }

// The whole inventory is one server record. It is only written after it has
// loaded, and every save is version checked: if another tab or device saved
// first, this tab's change is put on top of the newest copy (see syncGuard).
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const pickInventory = (d: any): InventoryStateBlob => ({
  items: arr(d?.items), bundles: arr(d?.bundles), locations: arr(d?.locations),
  stockLevels: arr(d?.stockLevels), transactions: arr(d?.transactions),
})
const invFlusher = createVersionedFlusher<InventoryStateBlob>({
  name: 'Inventory',
  isHydrated: () => invHydrated,
  get: () => invCache,
  apply: next => { invCache = pickInventory(next); costIndexFor = null; invEmit() },
  save: (state, version) => versionedSave(`${AUTH_API}/api/inventory-state`, 'PUT', { ...state }, version, pickInventory),
})
function scheduleFlush() { invFlusher.schedule() }

const INV_LEGACY_KEYS = ['fencepro_inventory', 'fencepro_bundles', 'fencepro_inv_locations', 'fencepro_inv_stock', 'fencepro_inv_transactions']

/** Optional, opt in. Old browser data only moves up if the server has no inventory at all. */
async function migrateLocalInventoryOnce(server: InventoryStateBlob, version: number): Promise<InventoryStateBlob | null> {
  if (!legacyMigrationEnabled()) return null
  if (localStorage.getItem(INV_MIGRATION_FLAG) === '1') return null
  if (!getAccessToken()) return null
  const serverHasData = server.items.length || server.bundles.length || server.locations.length || server.stockLevels.length || server.transactions.length
  if (serverHasData) { localStorage.setItem(INV_MIGRATION_FLAG, '1'); return null }
  try {
    const blob: InventoryStateBlob = {
      items: JSON.parse(localStorage.getItem('fencepro_inventory') || '[]'),
      bundles: JSON.parse(localStorage.getItem('fencepro_bundles') || '[]'),
      locations: JSON.parse(localStorage.getItem('fencepro_inv_locations') || '[]'),
      stockLevels: JSON.parse(localStorage.getItem('fencepro_inv_stock') || '[]'),
      transactions: JSON.parse(localStorage.getItem('fencepro_inv_transactions') || '[]'),
    }
    const hasData = blob.items.length || blob.bundles.length || blob.locations.length || blob.stockLevels.length || blob.transactions.length
    if (!hasData) { localStorage.setItem(INV_MIGRATION_FLAG, '1'); return null }
    const r = await invCall<InventoryStateBlob>('PUT', { ...blob, baseVersion: version })
    if (!r.ok) return null
    localStorage.setItem(INV_MIGRATION_FLAG, '1')
    return blob
  } catch { return null }
}

export function initInventory(): Promise<void> {
  if (invHydrated) return Promise.resolve()
  if (invInitPromise) return invInitPromise
  invInitPromise = (async () => {
    const r = await invCall<InventoryStateBlob>('GET')
    if (!r.ok || !r.data) return
    let next: InventoryStateBlob = {
      items: Array.isArray(r.data.items) ? r.data.items : [],
      bundles: Array.isArray(r.data.bundles) ? r.data.bundles : [],
      locations: Array.isArray(r.data.locations) ? r.data.locations : [],
      stockLevels: Array.isArray(r.data.stockLevels) ? r.data.stockLevels : [],
      transactions: Array.isArray(r.data.transactions) ? r.data.transactions : [],
    }
    let version = typeof (r.data as any).version === 'number' ? (r.data as any).version : 0
    const migrated = await migrateLocalInventoryOnce(next, version)
    if (migrated) { next = migrated; version++ }
    invCache = next
    invFlusher.loaded(next, version)
    invHydrated = true
    invEmit()
    // Old browser copies are only cleared once they have been moved up.
    if (legacyMigrationEnabled() && localStorage.getItem(INV_MIGRATION_FLAG) === '1') {
      try { for (const k of INV_LEGACY_KEYS) localStorage.removeItem(k) } catch {}
    }
  })().finally(() => { if (!invHydrated) invInitPromise = null })
  return invInitPromise
}

/** True once inventory has loaded from the server. */
export function isInventoryHydrated(): boolean { return invHydrated }

export const INVENTORY_UPDATED_EVENT = INV_EVT

export interface InventoryItem {
  id: string
  name: string
  sku?: string
  barcodes?: string[]
  unitCost: number
  category: string
  supplier?: string
  unitOfMeasure?: string
  status?: 'active' | 'inactive' | 'discontinued'
  // Stock tracking
  qtyOnHand?: number
  reorderPoint?: number
  reorderQty?: number
  maxQty?: number
  locationId?: string
}

export interface Bundle {
  id: string
  name: string
  description: string
  items: BundleItem[]
}

export interface BundleItem {
  inventoryId: string
  qty: number
  scaleWithSections: boolean
}

const DEFAULT_INVENTORY: InventoryItem[] = [
  { id: 'tear-gate',    name: 'Tear Out Haul-Away Gate',                                         unitCost: 27.00,  category: 'Tear Out' },
  { id: 'tear-fence',   name: 'Tear Out Haul-Away Fence',                                        unitCost: 9.50,   category: 'Tear Out' },
  { id: 'al-g-44',      name: "Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"",                        unitCost: 168.83, category: 'Aluminum' },
  { id: 'al-g-45',      name: "Alum, 3-Rail, Emily, Gate, 4' x 5', 48\"",                        unitCost: 183.69, category: 'Aluminum' },
  { id: 'al-g-46',      name: "Alum, 3-Rail, Emily, Gate, 4' x 6', 48\"",                        unitCost: 196.38, category: 'Aluminum' },
  { id: 'clb-g-44',     name: "Chainlink, Black, Gate, 1-3/8\", 4' x 4' (.065)",                 unitCost: 123.95, category: 'Chainlink Black' },
  { id: 'clb-g-45',     name: "Chainlink, Black, Gate, 1-3/8\", 4' x 5' (.065)",                 unitCost: 133.69, category: 'Chainlink Black' },
  { id: 'clb-g-46',     name: "Chainlink, Black, Gate, 1-3/8\", 4' x 6' (.065)",                 unitCost: 143.42, category: 'Chainlink Black' },
  { id: 'clb-g-54',     name: "Chainlink, Black, Gate, 1-3/8\", 5' x 4' (.065)",                 unitCost: 138.46, category: 'Chainlink Black' },
  { id: 'clb-g-55',     name: "Chainlink, Black, Gate, 1-3/8\", 5' x 5' (.065)",                 unitCost: 173.51, category: 'Chainlink Black' },
  { id: 'clb-g-56',     name: "Chainlink, Black, Gate, 1-3/8\", 5' x 6' (.065)",                 unitCost: 194.50, category: 'Chainlink Black' },
  { id: 'clb-g-64',     name: "Chainlink, Black, Gate, 1-3/8\", 6' x 4' (.065)",                 unitCost: 154.66, category: 'Chainlink Black' },
  { id: 'clb-g-65',     name: "Chainlink, Black, Gate, 1-3/8\", 6' x 5' (.065)",                 unitCost: 175.27, category: 'Chainlink Black' },
  { id: 'clb-g-66',     name: "Chainlink, Black, Gate, 1-3/8\", 6' x 6' (.065)",                 unitCost: 197.35, category: 'Chainlink Black' },
  { id: 'clg-g-44',     name: "Chainlink, Galv, Gate, 1-3/8\", 4' x 4' (.055)",                  unitCost: 85.00,  category: 'Chainlink Galv' },
  { id: 'clg-g-45',     name: "Chainlink, Galv, Gate, 1-3/8\", 4' x 5' (.055)",                  unitCost: 90.28,  category: 'Chainlink Galv' },
  { id: 'clg-g-46',     name: "Chainlink, Galv, Gate, 1-3/8\", 4' x 6' (.055)",                  unitCost: 99.51,  category: 'Chainlink Galv' },
  { id: 'clg-g-54',     name: "Chainlink, Galv, Gate, 1-3/8\", 5' x 4' (.055)",                  unitCost: 88.85,  category: 'Chainlink Galv' },
  { id: 'clg-g-55',     name: "Chainlink, Galv, Gate, 1-3/8\", 5' x 5' (.055)",                  unitCost: 102.45, category: 'Chainlink Galv' },
  { id: 'clg-g-56',     name: "Chainlink, Galv, Gate, 1-3/8\", 5' x 6' (.055)",                  unitCost: 115.67, category: 'Chainlink Galv' },
  { id: 'clg-g-64',     name: "Chainlink, Galv, Gate, 1-3/8\", 6' x 4' (.055)",                  unitCost: 114.86, category: 'Chainlink Galv' },
  { id: 'clg-g-65',     name: "Chainlink, Galv, Gate, 1-3/8\", 6' x 5' (.055)",                  unitCost: 130.08, category: 'Chainlink Galv' },
  { id: 'clg-g-66',     name: "Chainlink, Galv, Gate, 1-3/8\", 6' x 6' (.055)",                  unitCost: 146.41, category: 'Chainlink Galv' },
  { id: 'misc-conc',    name: 'Misc, Concrete',                                                   unitCost: 6.25,   category: 'Misc' },
  { id: 'nd-donut',     name: 'ND, Donut',                                                        unitCost: 3.19,   category: 'Vinyl White' },
  { id: 'pipe-pt40',    name: "Pipe, PT40, Galv, 2-1/2\" x 8'",                                  unitCost: 19.50,  category: 'Vinyl White' },
  { id: 'al-ipost-cp',  name: "I-Post, 2\" x 6' (CP)",                                           unitCost: 23.26,  category: 'Aluminum' },
  { id: 'al-ipost-ep',  name: "I-Post, 2\" x 6' (EP / LP)",                                      unitCost: 26.60,  category: 'Aluminum' },
  { id: 'al-sec-3r',    name: "Alum, Emily 3R, Sec, 48\" x 6'",                                  unitCost: 54.88,  category: 'Aluminum' },
  { id: 'al-cp-3r',     name: "Emily 3R 48\", CP x 6'",                                          unitCost: 14.78,  category: 'Aluminum' },
  { id: 'al-ep-3r',     name: "Emily 3R 48\", EP x 6'",                                          unitCost: 14.78,  category: 'Aluminum' },
  { id: 'al-lp-3r',     name: "Emily 3R 48\", LP x 6'",                                          unitCost: 14.78,  category: 'Aluminum' },
  { id: 'clb-fab-48',   name: "Res, Fabric, 48\", Blk, KK (9)",                                  unitCost: 116.16, category: 'Chainlink Black' },
  { id: 'clb-fab-60',   name: "Res, Fabric, 60\", Blk, KK (9)",                                  unitCost: 145.20, category: 'Chainlink Black' },
  { id: 'clb-fab-72',   name: "Res, Fabric, 72\", Blk, KK (9)",                                  unitCost: 174.24, category: 'Chainlink Black' },
  { id: 'clb-tp-8',     name: "Pipe, Blk, 1-5/8\" X 8' (SS40)",                                 unitCost: 21.50,  category: 'Chainlink Black' },
  { id: 'clb-tp-9',     name: "Pipe, Blk, 1-5/8\" X 9' (SS40)",                                 unitCost: 24.19,  category: 'Chainlink Black' },
  { id: 'clb-tp-10',    name: "Pipe, Blk, 1-5/8\" X 10' (SS40)",                                unitCost: 26.87,  category: 'Chainlink Black' },
  { id: 'clb-rail',     name: "Pipe, Blk, 1-3/8\" x 10'6\" (.055)",                             unitCost: 13.75,  category: 'Chainlink Black' },
  { id: 'clb-tb-48',    name: "Black, Tension Bar, 48\"",                                        unitCost: 4.25,   category: 'Chainlink Black' },
  { id: 'clb-tb-60',    name: "Black, Tension Bar, 60\"",                                        unitCost: 5.45,   category: 'Chainlink Black' },
  { id: 'clb-tb-72',    name: "Black, Tension Bar, 72\"",                                        unitCost: 4.62,   category: 'Chainlink Black' },
  { id: 'clb-pp-8',     name: "Pipe, Blk, 2-1/2\" X 8' (SS40)",                                 unitCost: 44.07,  category: 'Chainlink Black' },
  { id: 'clb-pp-9',     name: "Pipe, Blk, 2-1/2\" X 9' (SS40)",                                 unitCost: 49.58,  category: 'Chainlink Black' },
  { id: 'clb-pp-10',    name: "Pipe, Blk, 2-1/2\" X 10' (SS40)",                                unitCost: 55.08,  category: 'Chainlink Black' },
  { id: 'clg-fab-48',   name: "Fabric, Galv, 48\" KK (11.5)",                                    unitCost: 113.43, category: 'Chainlink Galv' },
  { id: 'clg-fab-60',   name: "Fabric, Galv, 60\" KK (11.5)",                                    unitCost: 137.50, category: 'Chainlink Galv' },
  { id: 'clg-fab-72',   name: "Fabric, Galv, 72\" KK (11.5)",                                    unitCost: 166.37, category: 'Chainlink Galv' },
  { id: 'clg-tp-8',     name: "Pipe, Galv, 1-5/8\" X 8' (SS40)",                                unitCost: 16.49,  category: 'Chainlink Galv' },
  { id: 'clg-tp-9',     name: "Pipe, Galv, 1-5/8\" X 9' (SS40)",                                unitCost: 18.55,  category: 'Chainlink Galv' },
  { id: 'clg-tp-10',    name: "Pipe, Galv, 1-5/8\" X 10' (SS40)",                               unitCost: 20.61,  category: 'Chainlink Galv' },
  { id: 'clg-rail',     name: "Pipe, Galv, 1-3/8\" X 10' 6\" (SS40)",                           unitCost: 10.84,  category: 'Chainlink Galv' },
  { id: 'clg-tb-48',    name: "G, Tension Bar, 48\"",                                            unitCost: 3.01,   category: 'Chainlink Galv' },
  { id: 'clg-tb-60',    name: "G, Tension Bar, 60\"",                                            unitCost: 3.75,   category: 'Chainlink Galv' },
  { id: 'clg-tb-72',    name: "G, Tension Bar, 72\"",                                            unitCost: 4.00,   category: 'Chainlink Galv' },
  { id: 'clg-pp-8',     name: "Pipe, Galv, 2-1/2\" X 8' (SS40)",                                unitCost: 28.13,  category: 'Chainlink Galv' },
  { id: 'clg-pp-9',     name: "Pipe, Galv, 2-1/2\" X 9' (SS40)",                                unitCost: 34.76,  category: 'Chainlink Galv' },
  { id: 'clg-pp-10',    name: "Pipe, Galv, 2-1/2\" X 10' (SS40)",                               unitCost: 34.99,  category: 'Chainlink Galv' },
  { id: 'wv-cp-78',     name: "*Vinyl, White, Post, Corner, 5\" x 5\" x 78\"",                   unitCost: 11.17,  category: 'Vinyl White' },
  { id: 'wv-ep-78',     name: "*Vinyl, White, Post, End, 5\" x 5\" x 78\"",                      unitCost: 11.17,  category: 'Vinyl White' },
  { id: 'wv-lp-78',     name: "*Vinyl, White, Post, Line, 5\" x 5\" x 78\"",                     unitCost: 11.17,  category: 'Vinyl White' },
  { id: 'wv-bp-102',    name: "*Vinyl, White, Post, Blank, 5\" x 5\" x 102\"",                   unitCost: 13.64,  category: 'Vinyl White' },
  { id: 'wv-cp-102',    name: "*Vinyl, White, Post, Corner, 5\" x 5\" x 102\"",                  unitCost: 13.64,  category: 'Vinyl White' },
  { id: 'wv-ep-102',    name: "*Vinyl, White, Post, End, 5\" x 5\" x 102\"",                     unitCost: 13.64,  category: 'Vinyl White' },
  { id: 'wv-lp-102',    name: "*Vinyl, White, Post, Line, 5\" x 5\" x 102\"",                    unitCost: 17.49,  category: 'Vinyl White' },
  { id: 'wv-picket',    name: "*Vinyl, White, Picket, 62-1/4\"",                                 unitCost: 2.71,   category: 'Vinyl White' },
  { id: 'wv-rail-6',    name: "*Vinyl, White, Rail, 6'",                                         unitCost: 5.98,   category: 'Vinyl White' },
  { id: 'wv-rail-8',    name: "*Vinyl, White, Rail, 8'",                                         unitCost: 9.26,   category: 'Vinyl White' },
  { id: 'wv-utrim',     name: "*Vinyl, White, U-Trim, 59-1/4\"",                                 unitCost: 1.62,   category: 'Vinyl White' },
  { id: 'wv-g-handle',  name: "*Vinyl, Gate, Handle",                                            unitCost: 5.98,   category: 'Vinyl White' },
  { id: 'tv-rail-8',    name: "*Vinyl, Tan, Rail, 8'",                                           unitCost: 10.18,  category: 'Vinyl Tan' },
  { id: 'tv-cp-78',     name: "*Vinyl, Tan, Post, Corner, 5\" x 5\" x 78\"",                     unitCost: 12.90,  category: 'Vinyl Tan' },
  { id: 'tv-ep-78',     name: "*Vinyl, Tan, Post, End, 5\" x 5\" x 78\"",                        unitCost: 12.90,  category: 'Vinyl Tan' },
  { id: 'tv-lp-78',     name: "*Vinyl, Tan, Post, Line, 5\" x 5\" x 78\"",                       unitCost: 12.90,  category: 'Vinyl Tan' },
  { id: 'tv-bp-102',    name: "*Vinyl, Tan, Post, Blank, 5\" x 5\" x 102\"",                     unitCost: 16.38,  category: 'Vinyl Tan' },
  { id: 'tv-cp-102',    name: "*Vinyl, Tan, Post, Corner, 5\" x 5\" x 102\"",                    unitCost: 19.24,  category: 'Vinyl Tan' },
  { id: 'tv-ep-102',    name: "*Vinyl, Tan, Post, End, 5\" x 5\" x 102\"",                       unitCost: 19.24,  category: 'Vinyl Tan' },
  { id: 'tv-lp-102',    name: "*Vinyl, Tan, Post, Line, 5\" x 5\" x 102\"",                      unitCost: 19.24,  category: 'Vinyl Tan' },
  { id: 'tv-picket',    name: "*Vinyl, Tan, Picket, 62-1/4\"",                                   unitCost: 3.22,   category: 'Vinyl Tan' },
  { id: 'tv-rail-6',    name: "*Vinyl, Tan, Rail, 6'",                                           unitCost: 7.98,   category: 'Vinyl Tan' },
  { id: 'tv-utrim',     name: "*Vinyl, Tan, U-Trim, 59-1/4\"",                                   unitCost: 1.85,   category: 'Vinyl Tan' },
  { id: 'wv-insert',    name: "Vinyl, Rail Insert, 8' ",                                         unitCost: 8.00,   category: 'Vinyl White' },
  { id: 'al-cap-2',     name: "Alum, Cap, 2\" (NW230NL-26)",                                     unitCost: 1.25,   category: 'Aluminum' },
  { id: 'al-hinge-sc',  name: "Alum, Gate, Hinge, Self-Closing",                                 unitCost: 33.36,  category: 'Aluminum' },
  { id: 'al-latch-aq',  name: "Alum, Gate, Latch, AQUA , Black, 20\"",                           unitCost: 50.43,  category: 'Aluminum' },
  { id: 'clb-bb',       name: "Black, Band, Brace, 2-3/8\", 3/4\"",                              unitCost: 0.75,   category: 'Chainlink Black' },
  { id: 'clb-bt',       name: "Black, Band, Tension, 2-3/8\" x 3/4\"",                           unitCost: 0.75,   category: 'Chainlink Black' },
  { id: 'clb-cl',       name: "Black, Cap, Loop, AL, 1-5/8\" x 1-3/8\"",                         unitCost: 1.14,   category: 'Chainlink Black' },
  { id: 'clb-cp',       name: "Black, Cap, Post, AL, 2-3/8\"",                                   unitCost: 1.01,   category: 'Chainlink Black' },
  { id: 'clb-col',      name: "Black, Collar, PS, 1-3/8\" (Set of 2)",                           unitCost: 1.63,   category: 'Chainlink Black' },
  { id: 'clb-fk1',      name: "Black, Fork, PS, 1-3/8\" ",                                       unitCost: 1.53,   category: 'Chainlink Black' },
  { id: 'clb-fk2',      name: "Black, Fork, PS, 2-1/2\"",                                        unitCost: 1.98,   category: 'Chainlink Black' },
  { id: 'clb-hf',       name: "Black, Hinge, Female, 1-3/8\" x 5/8\"",                           unitCost: 1.24,   category: 'Chainlink Black' },
  { id: 'clb-hm',       name: "Black, Hinge, Male, 2-3/8\"",                                     unitCost: 2.01,   category: 'Chainlink Black' },
  { id: 'clb-re',       name: "Black, Rail End, AL, Offset, 1-3/8\"",                             unitCost: 0.75,   category: 'Chainlink Black' },
  { id: 'clg-bb',       name: "G, Band, Brace, PS, 2-3/8\", 3/4",                                unitCost: 0.69,   category: 'Chainlink Galv' },
  { id: 'clg-bt',       name: "G, Band, Tension, PS, 2-3/8\" x 3/4\"",                           unitCost: 0.64,   category: 'Chainlink Galv' },
  { id: 'clg-cl',       name: "G, Cap, Loop, AL, 1-5/8\" x 1-3/8\"",                             unitCost: 0.79,   category: 'Chainlink Galv' },
  { id: 'clg-cp',       name: "G, Cap, Post, AL, 2-3/8\"",                                       unitCost: 0.96,   category: 'Chainlink Galv' },
  { id: 'clg-col',      name: "G, Collar, PS, 1-3/8\" (Set of 2)",                               unitCost: 1.29,   category: 'Chainlink Galv' },
  { id: 'clg-fk1',      name: "G, Fork, PS, 1-3/8\"",                                            unitCost: 1.18,   category: 'Chainlink Galv' },
  { id: 'clg-fk2',      name: "G, Fork, PS, 2-1/2\"",                                            unitCost: 1.53,   category: 'Chainlink Galv' },
  { id: 'clg-hf',       name: "G, Hinge, Female, 1-3/8\" x 5/8\"",                               unitCost: 0.83,   category: 'Chainlink Galv' },
  { id: 'clg-hm',       name: "G, Hinge, Male, PS, 2-3/8\"",                                     unitCost: 0.83,   category: 'Chainlink Galv' },
  { id: 'clg-re',       name: "G, Rail End, AL, Offset, 1-3/8\"",                                 unitCost: 0.60,   category: 'Chainlink Galv' },
  { id: 'clg-dr',       name: "G, Drop Rod, 24\"",                                                unitCost: 6.88,   category: 'Chainlink Galv' },
  { id: 'clb-dr-24',    name: "Drop Rod, 24\", Black",                                            unitCost: 30.48,  category: 'Chainlink Black' },
  { id: 'clb-dr-48',    name: "Drop Rod, 48\", Black",                                            unitCost: 48.01,  category: 'Chainlink Black' },
  { id: 'wv-g-brace',   name: "*Vinyl, Gate, Brace",                                             unitCost: 36.37,  category: 'Vinyl White' },
  { id: 'wv-g-hinge',   name: "*Vinyl, Gate, Hinge",                                             unitCost: 29.03,  category: 'Vinyl White' },
  { id: 'al-latch',     name: "Alum, Gate, Latch",                                               unitCost: 21.25,  category: 'Aluminum' },
  { id: 'wv-g-latch',   name: "*Vinyl, Gate, Latch",                                             unitCost: 20.46,  category: 'Vinyl White' },
  { id: 'tv-upright',   name: "*Vinyl, Tan, Upright",                                            unitCost: 9.69,   category: 'Vinyl Tan' },
  { id: 'wv-upright',   name: "*Vinyl, White, Upright",                                          unitCost: 8.75,   category: 'Vinyl White' },
  { id: 'wv-g-pchan',   name: "*Vinyl, Gate, P-Channel, 6'",                                     unitCost: 12.30,  category: 'Vinyl White' },
  { id: 'wv-g-hbeam6',  name: "*Vinyl, Gate, H-Beam, 6'",                                        unitCost: 22.80,  category: 'Vinyl White' },
  { id: 'wv-g-hbeam8',  name: "*Vinyl, Gate, H-Beam, 8'",                                        unitCost: 29.60,  category: 'Vinyl White' },
  { id: 'tv-g-cap',     name: "Vinyl, Tan, Cap, Gate",                                           unitCost: 1.00,   category: 'Vinyl Tan' },
  { id: 'wv-g-cap',     name: "*Vinyl, White, Cap, Gate",                                        unitCost: 1.00,   category: 'Vinyl White' },
  { id: 'tv-cap-post',  name: "Vinyl, Tan, Cap, 5\"x5\"",                                        unitCost: 1.00,   category: 'Vinyl Tan' },
  { id: 'wv-cap-post',  name: "*Vinyl, White, Cap, 5\"x5\"",                                     unitCost: 1.00,   category: 'Vinyl White' },
  { id: 'wv-hex-3',     name: "*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)",                       unitCost: 0.12,   category: 'Vinyl White' },
  { id: 'wv-hex-hb',    name: "*Vinyl, Hex, 1/4 x 3/4\" (H-Beam)",                              unitCost: 0.05,   category: 'Vinyl White' },
  { id: 'wv-truss',     name: "*Vinyl, Truss, 8 x 3/4\" (U-Trim)",                               unitCost: 0.03,   category: 'Vinyl White' },
  { id: 'wv-donutpin',  name: "**Vinyl, Donut Pin",                                              unitCost: 0.10,   category: 'Vinyl White' },
  { id: 'wv-rivet',     name: "*Vinyl, White, Rivet, 1\"",                                       unitCost: 0.12,   category: 'Vinyl White' },
  { id: 'tv-rivet',     name: "*Vinyl, Tan, Rivet, 1\"",                                         unitCost: 0.20,   category: 'Vinyl Tan' },
  { id: 'al-hex',       name: "Alum, Hex, 1/4\"",                                                unitCost: 0.17,   category: 'Aluminum' },
  { id: 'clb-b2',       name: "Black, Bolt, 3/8\" x 2\" w/ Nut ",                                unitCost: 0.41,   category: 'Chainlink Black' },
  { id: 'clb-b3',       name: "Black, Bolt, 3/8\" x 3\" w/ Nut",                                 unitCost: 0.53,   category: 'Chainlink Black' },
  { id: 'clb-b5',       name: "Black, Bolt, 5/16 x 1-1/4\" w/ Nut",                              unitCost: 0.18,   category: 'Chainlink Black' },
  { id: 'clg-b2',       name: "G, Bolt, 3/8\" x 2\" w/ Nut",                                     unitCost: 0.34,   category: 'Chainlink Galv' },
  { id: 'clg-b3',       name: "G, Bolt, 3/8\" x 3\" w/ Nut",                                     unitCost: 0.41,   category: 'Chainlink Galv' },
  { id: 'clg-b5',       name: "G, Bolt, 5/16 x 1-1/4\" w/ Nut",                                  unitCost: 0.15,   category: 'Chainlink Galv' },
  { id: 'clb-ht',       name: "Chainlink, Black, Hardware, Hook Ties, 6-1/2\" x 9ga, AL (100)",  unitCost: 14.00,  category: 'Chainlink Black' },
  { id: 'clg-ht',       name: "Chainlink, Galv, Hardware, Hook Ties, 6-1/2\" x 9ga (100)",       unitCost: 11.00,  category: 'Chainlink Galv' },
  { id: 'clb-hr',       name: "Black, Hog Ring, 9GA, Alum",                                      unitCost: 0.02,   category: 'Chainlink Black' },
  { id: 'clg-hr',       name: "G, Hog Ring, 9GA, Alum",                                          unitCost: 0.02,   category: 'Chainlink Galv' },
  { id: 'clb-tw',       name: "Black, Wire, Tension, 9GA",                                       unitCost: 0.11,   category: 'Chainlink Black' },
  { id: 'clg-tw',       name: "G, Wire, Tension, 9GA",                                           unitCost: 0.06,   category: 'Chainlink Galv' },
  { id: 'misc-gk',      name: "Misc, Gate Kit, No Hardware",                                     unitCost: 0.00,   category: 'Misc' },
  { id: 'misc-6sec',    name: "Misc, 6' Section",                                                unitCost: 0.00,   category: 'Misc' },
  { id: 'misc-cp',      name: "Misc, Corner Post",                                               unitCost: 0.00,   category: 'Misc' },
  { id: 'misc-ep',      name: "Misc, End Post",                                                  unitCost: 0.00,   category: 'Misc' },
  { id: 'misc-lp',      name: "Misc, Line Post",                                                 unitCost: 0.00,   category: 'Misc' },
  { id: 'cm-fab',       name: "Comm, G, Fabric, 72\" KT (9)",                                    unitCost: 258.75, category: 'Commercial' },
  { id: 'cm-term',      name: "Comm, G, Term, Plated, 2-1/2\" X 6' (SS40)",                     unitCost: 59.00,  category: 'Commercial' },
  { id: 'cm-pp10',      name: "Pipe, Galv,  2-1/2\" X 10' (SS40)",                              unitCost: 33.75,  category: 'Commercial' },
  { id: 'cm-lp12',      name: "Pipe, Galv, 2\" X 12' (SS40)",                                   unitCost: 36.13,  category: 'Commercial' },
  { id: 'cm-rail21',    name: "Pipe, Galv, 1-5/8\" X 21' (SS40)",                               unitCost: 39.92,  category: 'Commercial' },
  { id: 'cm-cap-post',  name: "Comm, G, Cap, Post, PS, 2-3/8\"",                                unitCost: 2.76,   category: 'Commercial' },
  { id: 'cm-cap-loop',  name: "Comm, G, Cap, Loop, PS, 2\" x 1-5/8\"",                          unitCost: 2.01,   category: 'Commercial' },
  { id: 'cm-re',        name: "Comm, G, Rail End, PS, 1-5/8\" ",                                unitCost: 1.85,   category: 'Commercial' },
  { id: 'cm-tb',        name: "Comm, G, Tension Bar, 72\" x 3/4\"",                             unitCost: 4.75,   category: 'Commercial' },
  { id: 'cm-barb-arm',  name: "Comm, G, Barb Arm, PS, 1-7/8\" x 1-5/8\"",                      unitCost: 4.75,   category: 'Commercial' },
  { id: 'cm-pp10b',     name: "Pipe, Galv, 2\" X 10' (SS40)",                                   unitCost: 32.50,  category: 'Commercial' },
  { id: 'cm-ht',        name: "Chainlink, Galv, Hardware, Hook Ties, 8-1/4\" x 9ga, AL (100)",  unitCost: 12.00,  category: 'Commercial' },
  { id: 'cm-dr',        name: "Comm, G, Com Drop Rod Assy.",                                     unitCost: 21.25,  category: 'Commercial' },
  { id: 'cm-bw',        name: "Comm, G, Barbed Wire, OK, 12.5Ga",                               unitCost: 0.09,   category: 'Commercial' },
  { id: 'cm-sleeve',    name: "Comm, G, Hardware, sleeve, 1-5/8\"",                             unitCost: 2.01,   category: 'Commercial' },
  { id: 'nd-pipe',      name: "ND, Pipe, 2-1/2\" x 10'6\" (Non-Prime) (SS40)",                  unitCost: 29.80,  category: 'Vinyl White' },
  { id: 'vw8-cp',       name: "V , W, Post, 8' Privacy, CP, 5\" x 5\"",                         unitCost: 24.56,  category: 'Vinyl White' },
  { id: 'vw8-ep',       name: "V , W, Post, 8' Privacy, EP, 5\" x 5\"",                         unitCost: 24.56,  category: 'Vinyl White' },
  { id: 'vw8-lp',       name: "V , W, Post, 8' Privacy, LP, 5\" x 5\"",                         unitCost: 24.56,  category: 'Vinyl White' },
  { id: 'vw8-sec-6',    name: "V , W, Picket Section 8' x 6' Privacy",                          unitCost: 108.68, category: 'Vinyl White' },
  { id: 'vw8-sec-8',    name: "V , W, Picket Section 8' x 8' Privacy",                          unitCost: 143.25, category: 'Vinyl White' },
  { id: 'vw8-g-4',      name: "V , W, Privacy Gate 8 x 4",                                      unitCost: 399.00, category: 'Vinyl White' },
  { id: 'vw8-g-5',      name: "V , W, Privacy, Gate 8 x 5",                                     unitCost: 423.00, category: 'Vinyl White' },
  { id: 'vw8-g-6',      name: "V , W, Privacy, Gate 8 x 6",                                     unitCost: 454.00, category: 'Vinyl White' },
  { id: 'vt8-cp',       name: "V , T, Post, 8' Privacy, CP, 5\" x 5\"",                         unitCost: 27.50,  category: 'Vinyl Tan' },
  { id: 'vt8-ep',       name: "V , T, Post, 8' Privacy, EP, 5\" x 5\"",                         unitCost: 27.50,  category: 'Vinyl Tan' },
  { id: 'vt8-lp',       name: "V , T, Post, 8' Privacy, LP, 5\" x 5\"",                         unitCost: 27.50,  category: 'Vinyl Tan' },
  { id: 'vt8-sec-6',    name: "V , T, Picket Section 8' x 6' Privacy",                          unitCost: 124.98, category: 'Vinyl Tan' },
  { id: 'vt8-sec-8',    name: "V , T, Picket Section 8' x 8' Privacy",                          unitCost: 164.74, category: 'Vinyl Tan' },
  { id: 'vt8-g-4',      name: "V , T, Privacy Gate 8 x 4",                                      unitCost: 458.00, category: 'Vinyl Tan' },
  { id: 'vt8-g-5',      name: "V , T, Privacy, Gate 8 x 5",                                     unitCost: 486.00, category: 'Vinyl Tan' },
  { id: 'vt8-g-6',      name: "V , T, Privacy, Gate 8 x 6",                                     unitCost: 522.00, category: 'Vinyl Tan' },
  { id: 'al-ind-sec',   name: "Alum, Ind, Sec, 6' x 8'",                                        unitCost: 211.62, category: 'Aluminum' },
  { id: 'al-post3-cp',  name: "Alum, Post 3\" x 8', CP",                                        unitCost: 71.93,  category: 'Aluminum' },
  { id: 'al-post3-ep',  name: "Alum, Post 3\" x 8', EP",                                        unitCost: 71.93,  category: 'Aluminum' },
  { id: 'al-post3-lp',  name: "Alum, Post 3\" x 8', LP",                                        unitCost: 71.93,  category: 'Aluminum' },
  { id: 'al-cap-3',     name: "Alum, Cap, 3\"",                                                  unitCost: 2.50,   category: 'Aluminum' },
  { id: 'clr-fab-48',   name: "Gr, Fabric, 48\" KK (9)",                                         unitCost: 122.85, category: 'Chainlink Green' },
  { id: 'clr-fab-60',   name: "Gr, Fabric, 60\" KK (9)",                                         unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-fab-72',   name: "Gr, Fabric, 72\" KK (9)",                                         unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-tp-8',     name: "Pipe, Grn, 1-5/8\" X 8' (.055)",                                  unitCost: 13.63,  category: 'Chainlink Green' },
  { id: 'clr-tp-9',     name: "Pipe, Grn, 1-5/8\" X 9' (.055)",                                  unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-tp-106',   name: "Pipe, Grn, 1-5/8\" X 10'6'' (.055)",                              unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-rail',     name: "Pipe, Grn, 1-3/8\" X 21' (.055)",                                 unitCost: 28.40,  category: 'Chainlink Green' },
  { id: 'clr-tb-48',    name: "Gr, Tension Bar, 48\"",                                            unitCost: 3.45,   category: 'Chainlink Green' },
  { id: 'clr-tb-60',    name: "Gr, Tension Bar, 60\"",                                            unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-tb-72',    name: "Gr, Tension Bar, 72\"",                                            unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-pp-8',     name: "Pipe, Grn, 2-1/2\" X 8' (.055)",                                  unitCost: 21.65,  category: 'Chainlink Green' },
  { id: 'clr-pp-9',     name: "Pipe, Grn, 2-1/2\" X 9' (.055)",                                  unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-pp-10',    name: "Pipe, Grn, 2-1/2\" X 10' (.055)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-bb',       name: "Gr, Band, Brace, PS, 2-3/8\", 3/4\"",                             unitCost: 1.25,   category: 'Chainlink Green' },
  { id: 'clr-bt',       name: "Gr, Band, Tension, PS, 2-3/8\" x 3/4\"",                          unitCost: 1.22,   category: 'Chainlink Green' },
  { id: 'clr-cl',       name: "Gr, Cap, Loop, AL, 1-5/8\" x 1-3/8\"",                            unitCost: 1.89,   category: 'Chainlink Green' },
  { id: 'clr-cp',       name: "Gr, Cap, Post, AL, 2-3/8\"",                                      unitCost: 1.45,   category: 'Chainlink Green' },
  { id: 'clr-col',      name: "Gr, Collar, PS, 1-3/8\" (Set of 2)",                              unitCost: 3.45,   category: 'Chainlink Green' },
  { id: 'clr-fk1',      name: "Gr, Fork, PS, 1-3/8\" ",                                          unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-fk2',      name: "Gr, Fork, PS, 2-1/2\"",                                           unitCost: 3.48,   category: 'Chainlink Green' },
  { id: 'clr-hf',       name: "Gr, Hinge, Female, 1-3/8\" x 5/8\"",                              unitCost: 3.75,   category: 'Chainlink Green' },
  { id: 'clr-hm',       name: "Gr, Hinge, Male, PS, 2-3/8\"",                                    unitCost: 4.45,   category: 'Chainlink Green' },
  { id: 'clr-re',       name: "Gr, Rail End, AL, Offset, 1-3/8\"",                               unitCost: 1.30,   category: 'Chainlink Green' },
  { id: 'clr-b2',       name: "Gr, Bolt, 3/8\" x 2\" w/ Nut ",                                   unitCost: 0.89,   category: 'Chainlink Green' },
  { id: 'clr-b3',       name: "Gr, Bolt, 3/8\" x 3\" w/ Nut",                                    unitCost: 0.89,   category: 'Chainlink Green' },
  { id: 'clr-b5',       name: "Gr, Bolt, 5/16 x 1-1/4\" w/ Nut",                                 unitCost: 0.26,   category: 'Chainlink Green' },
  { id: 'clr-ht',       name: "Chainlink, Green, Hardware, Hook Ties, 6-1/2\" x 9ga (100)",      unitCost: 13.00,  category: 'Chainlink Green' },
  { id: 'clr-hr',       name: "Gr, Hog Ring, 9GA, Alum",                                         unitCost: 0.14,   category: 'Chainlink Green' },
  { id: 'clr-tw',       name: "Gr, Wire, Tension, 9GA",                                          unitCost: 0.15,   category: 'Chainlink Green' },
  { id: 'clr-g-44',     name: "Gate, Grn, 4 x 4 (1-3/8\" .065)",                                 unitCost: 175.22, category: 'Chainlink Green' },
  { id: 'clr-g-45',     name: "Gate, Grn, 4 x 5 (1-3/8\" .065)",                                 unitCost: 186.28, category: 'Chainlink Green' },
  { id: 'clr-g-46',     name: "Gate, Grn, 4 x 6 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-g-54',     name: "Gate, Grn, 5 x 4 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-g-55',     name: "Gate, Grn, 5 x 5 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-g-56',     name: "Gate, Grn, 5 x 6 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-g-64',     name: "Gate, Grn, 6 x 4 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-g-65',     name: "Gate, Grn, 6 x 5 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'clr-g-66',     name: "Gate, Grn, 6 x 6 (1-3/8\" .065)",                                 unitCost: 0.00,   category: 'Chainlink Green' },
  { id: 'al-2r-g-44',   name: "Gate, Emily 2R, 4 x 4",                                           unitCost: 168.83, category: 'Aluminum' },
  { id: 'al-2r-g-45',   name: "Gate, Emily 2R, 4 x 5",                                           unitCost: 183.69, category: 'Aluminum' },
  { id: 'al-2r-g-46',   name: "Gate, Emily 2R, 4 x 6",                                           unitCost: 0.00,   category: 'Aluminum' },
  { id: 'al-2r-sec',    name: "Emily 2R 48\", Panel, 48\" x 6'",                                 unitCost: 56.06,  category: 'Aluminum' },
  { id: 'al-2r-cp',     name: "Emily 2R 48\", CP x 6'",                                          unitCost: 17.04,  category: 'Aluminum' },
  { id: 'al-2r-ep',     name: "Emily 2R 48\", EP x 6'",                                          unitCost: 17.04,  category: 'Aluminum' },
  { id: 'al-2r-lp',     name: "Emily 2R 48\", LP x 6'",                                          unitCost: 17.04,  category: 'Aluminum' },
  { id: 'al-pup-g-44',  name: "Alum, Emily 3R-Pup, Gate, 4 x 4",                                 unitCost: 232.99, category: 'Aluminum' },
  { id: 'al-pup-g-45',  name: "Alum, Emily 3R-Pup , Gate, 4 x 5",                                unitCost: 255.41, category: 'Aluminum' },
  { id: 'al-pup-g-46',  name: "Alum, Emily 3R-Pup, Gate, 4 x 6",                                 unitCost: 0.00,   category: 'Aluminum' },
  { id: 'al-pup-sec',   name: "Alum, Emily 3R-Pup, Sec, 48\" x 6'",                              unitCost: 129.79, category: 'Aluminum' },
  { id: 'al-pup-cp',    name: "Alum, Emily 3R-Pup, Post 2\" x 6', CP",                           unitCost: 19.80,  category: 'Aluminum' },
  { id: 'al-pup-ep',    name: "Alum, Emily 3R-Pup, Post 2\" x 6', EP",                           unitCost: 19.80,  category: 'Aluminum' },
  { id: 'al-pup-lp',    name: "Alum, Emily 3R-Pup, Post 2\" x 6', LP",                           unitCost: 19.80,  category: 'Aluminum' },
  { id: 'ag-tg-4',      name: "Ag, Tube Gate, Galv, 4' x 4' (6GG4)",                             unitCost: 99.99,  category: 'Agricultural' },
  { id: 'ag-tg-6',      name: "Ag, Tube Gate, Galv, 4' x 6' (6GG6)",                             unitCost: 109.99, category: 'Agricultural' },
  { id: 'ag-tg-8',      name: "Ag, Tube Gate, Galv, 4' x 8' (6GG8)",                             unitCost: 99.99,  category: 'Agricultural' },
  { id: 'ag-tg-10',     name: "Ag, Tube Gate, Galv, 4' x 10' (6GG10)",                           unitCost: 119.99, category: 'Agricultural' },
  { id: 'ag-tg-12',     name: "Ag, Tube Gate, Galv, 4' x 12' (6GG12)",                           unitCost: 129.99, category: 'Agricultural' },
  { id: 'ag-tg-14',     name: "Ag, Tube Gate, Galv, 4' x 14' (6GG14)",                           unitCost: 149.99, category: 'Agricultural' },
  { id: 'ag-tg-16',     name: "Ag, Tube Gate, Galv,  4' x 16' (6GG16)",                          unitCost: 169.99, category: 'Agricultural' },
  { id: 'ag-tg-18',     name: "Ag, Tube Gate, Galv, 4' x 18' (6GG18)",                           unitCost: 199.99, category: 'Agricultural' },
  { id: 'ag-tg-20',     name: "Ag, Tube Gate, Galv, 4' x 20' (6GG20)",                           unitCost: 219.99, category: 'Agricultural' },
  { id: 'ag-latch',     name: "Ag, Gate, Hardware, 2 Way Latch",                                  unitCost: 23.39,  category: 'Agricultural' },
  { id: 'ag-wm-4',      name: "Ag, Wire Mesh Gate, 4' x 4'",                                     unitCost: 166.69, category: 'Agricultural' },
  { id: 'ag-wm-6',      name: "Ag, Wire Mesh Gate, 4' x 6' ",                                    unitCost: 176.66, category: 'Agricultural' },
  { id: 'ag-wm-8',      name: "Ag, Wire Mesh Gate, 4' x 8' ",                                    unitCost: 193.62, category: 'Agricultural' },
  { id: 'ag-wm-10',     name: "Ag, Wire Mesh Gate, 4' x 10' ",                                   unitCost: 169.99, category: 'Agricultural' },
  { id: 'ag-wm-12',     name: "Ag, Wire Mesh Gate, 4' x 12'",                                    unitCost: 233.11, category: 'Agricultural' },
  { id: 'ag-wm-14',     name: "Ag, Wire Mesh Gate, 4' x 14' ",                                   unitCost: 219.99, category: 'Agricultural' },
  { id: 'ag-wm-16',     name: "Ag, Wire Mesh Gate, 4' x 16' ",                                   unitCost: 239.99, category: 'Agricultural' },
  { id: 'cmb-fab',      name: "Comm, Blk, Fabric, 72\" KT (9)",                                   unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-term',     name: "Comm, Blk, Term, 2-1/2\" X 10' (SS40)",                           unitCost: 43.90,  category: 'Commercial' },
  { id: 'cmb-lp10',     name: "Comm, Blk, Line, 2\" X 10' (SS40)",                               unitCost: 26.50,  category: 'Commercial' },
  { id: 'cmb-rail21',   name: "Comm, Blk, Rail, 1-5/8\" X 21' (SS40)",                           unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-cap-post', name: "Comm, Blk, Cap, Post, PS, 2-3/8\"",                               unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-cap-loop', name: "Comm, Blk, Cap, Loop, PS, 2\" x 1-5/8\"",                         unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-re',       name: "Comm, Blk, Rail End, PS, 1-5/8\" ",                               unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-tb',       name: "Comm, Blk, Tension Bar, 72\" x 3/4\"",                            unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-barb-arm', name: "Comm, Blk, Barb Arm, PS, 1-7/8\" x 1-5/8\"",                     unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-lp106',    name: "Comm, Blk, Line, 2\" X 10'6\" (SS40)",                            unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-ht',       name: "Chainlink, Black, Hardware, Hook Ties, 8-1/4\" x 9ga, AL (100)",  unitCost: 13.00,  category: 'Commercial' },
  { id: 'cmb-dr',       name: "Comm, Blk, Com Drop Rod Assy.",                                    unitCost: 0.00,   category: 'Commercial' },
  { id: 'cmb-sleeve',   name: "Comm, Blk, Hardware, sleeve, 1-5/8\"",                            unitCost: 0.00,   category: 'Commercial' },
  { id: 'swag-bag',     name: "Swag Bag",                                                         unitCost: 0.00,   category: 'Misc' },
  { id: 'yard-sign',    name: "Yard Sign",                                                        unitCost: 0.00,   category: 'Misc' },
  { id: 'fence-sign',   name: "Fence Sign",                                                       unitCost: 0.00,   category: 'Misc' },
]

const DEFAULT_BUNDLES: Bundle[] = []
const INV_KEY    = 'fencepro_inventory'
const BUNDLE_KEY = 'fencepro_bundles'

export function getInventory(): InventoryItem[] {
  return invCache.items.length > 0 ? (invCache.items as InventoryItem[]) : DEFAULT_INVENTORY
}

export function saveInventory(items: InventoryItem[]): void {
  invCache.items = items
  costIndexFor = null // costs may have changed, even if the array was edited in place
  invEmit()
  scheduleFlush()
}

export function resetInventory(): void {
  saveInventory(DEFAULT_INVENTORY)
}

export function getBundles(): Bundle[] {
  return invCache.bundles.length > 0 ? (invCache.bundles as Bundle[]) : DEFAULT_BUNDLES
}

export function saveBundles(bundles: Bundle[]): void {
  invCache.bundles = bundles
  invEmit()
  scheduleFlush()
}

export function getPriceMap(): Record<string, number> {
  const inv = getInventory()
  const map: Record<string, number> = {}
  for (const item of inv) { map[item.name] = item.unitCost }
  return map
}

// ── Inventory is the cost source for every material calculation ──────────────
// The lookup is rebuilt only when the items array itself changes (saveInventory
// and initInventory both replace it), so a cost edited on the Inventory page is
// what the very next quote uses.
let costIndexFor: InventoryItem[] | null = null
let costIndex = new Map<string, number>()

export function getInventoryUnitCost(itemName: string): number | undefined {
  const inv = getInventory()
  if (inv !== costIndexFor) {
    costIndex = new Map()
    for (const item of inv) {
      if (item.status === 'inactive' || item.status === 'discontinued') continue
      const cost = Number(item.unitCost)
      costIndex.set(normalizeItemName(item.name), Number.isFinite(cost) ? cost : 0)
    }
    costIndexFor = inv
  }
  return costIndex.get(normalizeItemName(itemName))
}

setMaterialPriceSource(getInventoryUnitCost)

/* ═══════════════════════════════════════════════
   STOCK LEVELS, TRANSACTIONS, LOCATIONS, SUPPLIERS
   ═══════════════════════════════════════════════ */

// ── Locations ──

export interface InventoryLocation {
  id: string
  name: string
  address?: string
  type: 'warehouse' | 'yard' | 'truck' | 'virtual'
  isActive: boolean
}

const LOC_KEY = 'fencepro_inv_locations'

const DEFAULT_LOCATIONS: InventoryLocation[] = [
  { id: 'loc-yard', name: 'Main Yard', type: 'yard', isActive: true },
  { id: 'loc-truck1', name: 'Truck 1', type: 'truck', isActive: true },
]

export function getLocations(): InventoryLocation[] {
  return invCache.locations.length > 0 ? (invCache.locations as InventoryLocation[]) : DEFAULT_LOCATIONS
}

export function saveLocations(locs: InventoryLocation[]): void {
  invCache.locations = locs
  invEmit()
  scheduleFlush()
}

// ── Stock Levels (per item per location) ──

export interface StockLevel {
  itemId: string
  locationId: string
  quantity: number
  minQuantity: number
  maxQuantity: number
  reorderPoint: number
  reorderQty: number
  lastUpdated: string
}

const STOCK_KEY = 'fencepro_inv_stock'

export function getStockLevels(): StockLevel[] {
  return invCache.stockLevels as StockLevel[]
}

export function saveStockLevels(levels: StockLevel[]): void {
  invCache.stockLevels = levels
  invEmit()
  scheduleFlush()
}

/** Get stock for a specific item across all locations */
export function getItemStock(itemId: string): { locationId: string; quantity: number }[] {
  return getStockLevels().filter(s => s.itemId === itemId).map(s => ({ locationId: s.locationId, quantity: s.quantity }))
}

/** Get total quantity on hand for an item */
export function getTotalOnHand(itemId: string): number {
  return getStockLevels().filter(s => s.itemId === itemId).reduce((sum, s) => sum + s.quantity, 0)
}

/** Upsert stock level for item+location */
export function setStockLevel(itemId: string, locationId: string, quantity: number): void {
  const levels = getStockLevels()
  const idx = levels.findIndex(s => s.itemId === itemId && s.locationId === locationId)
  if (idx >= 0) {
    levels[idx].quantity = quantity
    levels[idx].lastUpdated = new Date().toISOString()
  } else {
    levels.push({ itemId, locationId, quantity, minQuantity: 0, maxQuantity: 0, reorderPoint: 0, reorderQty: 0, lastUpdated: new Date().toISOString() })
  }
  saveStockLevels(levels)
}

/** Get items below reorder point at any location */
export function getLowStockItems(): { itemId: string; locationId: string; quantity: number; reorderPoint: number }[] {
  const levels = getStockLevels()
  return levels.filter(s => s.reorderPoint > 0 && s.quantity <= s.reorderPoint)
    .map(s => ({ itemId: s.itemId, locationId: s.locationId, quantity: s.quantity, reorderPoint: s.reorderPoint }))
}

// ── Transactions (immutable log) ──

export type TransactionType = 'stock_in' | 'stock_out' | 'adjustment' | 'transfer' | 'pull_sheet'

export interface InventoryTransaction {
  id: string
  itemId: string
  itemName: string
  locationId: string
  type: TransactionType
  quantityDelta: number       // positive = in, negative = out
  quantityAfter: number
  unitCost?: number
  referenceId?: string        // quote id, PO id, etc.
  referenceType?: string      // 'quote', 'po', 'manual'
  notes: string
  createdAt: string
  createdBy?: string
  // Transfer-specific
  toLocationId?: string
  // Reversal tracking
  isReversalOf?: string
  reversedBy?: string
}

const TXN_KEY = 'fencepro_inv_transactions'

export function getTransactions(): InventoryTransaction[] {
  return invCache.transactions as InventoryTransaction[]
}

export function saveTransactions(txns: InventoryTransaction[]): void {
  invCache.transactions = txns
  invEmit()
  scheduleFlush()
}

const uid = () => Math.random().toString(36).slice(2, 9)

/** Record a stock-in transaction and update stock level */
export function stockIn(itemId: string, locationId: string, qty: number, opts: {
  unitCost?: number; notes?: string; referenceId?: string; referenceType?: string
} = {}): InventoryTransaction {
  const levels = getStockLevels()
  const existing = levels.find(s => s.itemId === itemId && s.locationId === locationId)
  const currentQty = existing?.quantity ?? 0
  const newQty = currentQty + qty

  setStockLevel(itemId, locationId, newQty)

  const items = getInventory()
  const item = items.find(i => i.id === itemId)

  const txn: InventoryTransaction = {
    id: uid(),
    itemId,
    itemName: item?.name || itemId,
    locationId,
    type: 'stock_in',
    quantityDelta: qty,
    quantityAfter: newQty,
    unitCost: opts.unitCost,
    referenceId: opts.referenceId,
    referenceType: opts.referenceType,
    notes: opts.notes || '',
    createdAt: new Date().toISOString(),
  }

  const txns = getTransactions()
  saveTransactions([txn, ...txns])
  return txn
}

/** Record a stock-out transaction and update stock level */
export function stockOut(itemId: string, locationId: string, qty: number, opts: {
  notes?: string; referenceId?: string; referenceType?: string; type?: TransactionType
} = {}): InventoryTransaction {
  const levels = getStockLevels()
  const existing = levels.find(s => s.itemId === itemId && s.locationId === locationId)
  const currentQty = existing?.quantity ?? 0
  const newQty = currentQty - qty

  setStockLevel(itemId, locationId, newQty)

  const items = getInventory()
  const item = items.find(i => i.id === itemId)

  const txn: InventoryTransaction = {
    id: uid(),
    itemId,
    itemName: item?.name || itemId,
    locationId,
    type: opts.type || 'stock_out',
    quantityDelta: -qty,
    quantityAfter: newQty,
    referenceId: opts.referenceId,
    referenceType: opts.referenceType,
    notes: opts.notes || '',
    createdAt: new Date().toISOString(),
  }

  const txns = getTransactions()
  saveTransactions([txn, ...txns])
  return txn
}

/** Batch stock-out from a pull sheet (when a quote is sold/job staged) */
export function pullFromInventory(pullSheet: { item: string; qty: number }[], locationId: string, quoteId: string): InventoryTransaction[] {
  const items = getInventory()
  const txns: InventoryTransaction[] = []

  for (const line of pullSheet) {
    // Match by name (pull sheet uses item names)
    const invItem = items.find(i => i.name === line.item)
    if (!invItem) continue

    const txn = stockOut(invItem.id, locationId, line.qty, {
      referenceId: quoteId,
      referenceType: 'quote',
      type: 'pull_sheet',
      notes: `Pull sheet for quote ${quoteId.slice(0, 6)}`,
    })
    txns.push(txn)
  }

  return txns
}

/** Reverse a transaction (creates a reversal entry, does not delete) */
export function reverseTransaction(txnId: string, notes: string): InventoryTransaction | null {
  const txns = getTransactions()
  const original = txns.find(t => t.id === txnId)
  if (!original || original.reversedBy) return null

  // Create reversal
  const reversalQty = -original.quantityDelta
  const levels = getStockLevels()
  const existing = levels.find(s => s.itemId === original.itemId && s.locationId === original.locationId)
  const currentQty = existing?.quantity ?? 0
  const newQty = currentQty + reversalQty

  setStockLevel(original.itemId, original.locationId, newQty)

  const reversal: InventoryTransaction = {
    id: uid(),
    itemId: original.itemId,
    itemName: original.itemName,
    locationId: original.locationId,
    type: 'adjustment',
    quantityDelta: reversalQty,
    quantityAfter: newQty,
    notes: `Reversal: ${notes}`,
    createdAt: new Date().toISOString(),
    isReversalOf: txnId,
  }

  // Mark original as reversed
  const updated = txns.map(t => t.id === txnId ? { ...t, reversedBy: reversal.id } : t)
  saveTransactions([reversal, ...updated])
  return reversal
}

/** Find an inventory item by any of its barcodes (or by SKU as fallback) */
export function findItemByBarcode(barcode: string, items?: InventoryItem[]): InventoryItem | null {
  const list = items ?? getInventory()
  const code = barcode.trim()
  if (!code) return null
  for (const item of list) {
    if (item.barcodes && item.barcodes.some(b => b.trim() === code)) return item
    if (item.sku && item.sku.trim() === code) return item
  }
  return null
}

// ── Suppliers ──

export interface Supplier {
  id: string
  name: string
  contactName?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  isActive: boolean
}

const SUPPLIER_KEY = 'fencepro_inv_suppliers'

export function getSuppliers(): Supplier[] {
  try {
    const raw = cloudStorage.getItem(SUPPLIER_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveSuppliers(suppliers: Supplier[]): void {
  cloudStorage.setItem(SUPPLIER_KEY, JSON.stringify(suppliers))
}

// ── Inventory Summary Helpers ──

export function getInventorySummary(): {
  totalItems: number
  totalValue: number
  lowStockCount: number
  outOfStockCount: number
  categoryCounts: Record<string, number>
} {
  const items = getInventory()
  const levels = getStockLevels()

  let totalValue = 0
  let lowStockCount = 0
  let outOfStockCount = 0
  const categoryCounts: Record<string, number> = {}

  for (const item of items) {
    const totalQty = levels.filter(s => s.itemId === item.id).reduce((sum, s) => sum + s.quantity, 0)
    totalValue += totalQty * item.unitCost
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1

    // Per-location check: an item is low-stock if ANY location is at or below its own reorder point
    const itemLevels = levels.filter(s => s.itemId === item.id)
    if (itemLevels.some(s => s.reorderPoint > 0 && s.quantity <= s.reorderPoint)) lowStockCount++
    if (itemLevels.length > 0 && totalQty === 0) outOfStockCount++
  }

  return {
    totalItems: items.length,
    totalValue,
    lowStockCount,
    outOfStockCount,
    categoryCounts,
  }
}