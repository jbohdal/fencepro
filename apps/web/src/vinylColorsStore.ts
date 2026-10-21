/**
 * Settings → Price List → Vinyl Colors talks to /api/vinyl-colors: the server
 * makes the color, its fences, kits and catalog items in one transaction
 * (portal lib/vinylColors.ts), then this reads Settings and Inventory again so
 * the new fences are in the quote builder right away. Nothing is kept in the
 * browser.
 */

import { sendJson } from './syncHttp'
import { refreshBusinessState } from './businessStateStore'
import { refreshInventory } from './inventoryStore'
import type { VinylColorInput } from './vinylColorForm'

export interface ColorRecord {
  key: string
  label: string
  createdAt: string
  createdBy: string
  undoUntil: string
  created: {
    items: Array<{ id: string; name: string; cents: number | null; includedIn?: string }>
    priceHistoryIds: string[]
    styles: Array<{ name: string; label: string; madeFrom: string }>
    kits: Array<{ id: string; styleName: string; lines: Record<string, number> }>
    option: { key: string; label: string }
  }
  edits?: Array<{ at: string; by: string; priced: Array<{ name: string; cents: number; prevCents: number | null }>; added: string[]; archived: string[] }>
  archivedAt?: string | null
}

export type ColorAnswer<T> = { ok: true; data: T } | { ok: false; error: string; usedBy?: Array<{ id: string; what: string }> }

async function send<T>(method: string, path: string, body?: unknown): Promise<ColorAnswer<T>> {
  const r = await sendJson(method, path, body, 60_000)
  if (!r.result.ok) return { ok: false, error: r.result.error || (r.status === 0 ? 'No signal right now. Nothing was changed; try again when there is signal.' : 'It did not save. Nothing was changed.'), ...(Array.isArray(r.json?.usedBy) ? { usedBy: r.json.usedBy } : {}) }
  // Settings and Inventory changed on the server: read them again before saying it is done.
  if (method !== 'GET') await Promise.all([refreshBusinessState(), refreshInventory()])
  return { ok: true, data: r.result.data as T }
}

export const loadColorRecords = () => send<{ records: ColorRecord[] }>('GET', '/api/vinyl-colors')
export const addVinylColor = (input: VinylColorInput) => send<{ record: ColorRecord; message: string }>('POST', '/api/vinyl-colors', { input })
export const saveVinylColor = (key: string, input: VinylColorInput) => send<{ record: ColorRecord; message: string; priced: number }>('PUT', `/api/vinyl-colors/${encodeURIComponent(key)}`, { input })
export const undoVinylColor = (key: string) => send<{ removed: { styles: string[]; kits: string[]; items: string[]; priceHistory: number } }>('POST', `/api/vinyl-colors/${encodeURIComponent(key)}/undo`)
export const removeVinylColor = (key: string) => send<{ styles: string[]; items: string[] }>('POST', `/api/vinyl-colors/${encodeURIComponent(key)}/remove`)
export const restoreVinylColor = (key: string) => send<{ styles: string[]; items: string[] }>('POST', `/api/vinyl-colors/${encodeURIComponent(key)}/restore`)
