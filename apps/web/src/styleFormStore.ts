/**
 * Settings → Fence Styles → Add style and Settings → Price List talk to
 * /api/fence-style-forms: the server makes the style, its fences, kits and
 * parts in one transaction (portal lib/styleForms.ts), then this reads
 * Settings and Inventory again so the new fences are in the quote builder
 * right away. Nothing is kept in the browser.
 */

import { sendJson } from './syncHttp'
import { refreshBusinessState } from './businessStateStore'
import { refreshInventory } from './inventoryStore'
import type { StyleFormInput } from './styleForm'

export type StyleAnswer<T> = { ok: true; data: T } | { ok: false; error: string; usedBy?: Array<{ id: string; what: string }> }

async function send<T>(method: string, path: string, body?: unknown): Promise<StyleAnswer<T>> {
  const r = await sendJson(method, path, body, 60_000)
  if (!r.result.ok) return { ok: false, error: r.result.error || (r.status === 0 ? 'No signal right now. Nothing was changed; try again when there is signal.' : 'It did not save. Nothing was changed.'), ...(Array.isArray(r.json?.usedBy) ? { usedBy: r.json.usedBy } : {}) }
  if (method !== 'GET') await Promise.all([refreshBusinessState(), refreshInventory()])
  return { ok: true, data: r.result.data as T }
}

const at = (material: string, key: string) => `/api/fence-style-forms/${encodeURIComponent(material)}/${encodeURIComponent(key)}`
export const addStyle = (input: StyleFormInput) => send<{ record: { key: string; label: string }; message: string; waiting: string[] }>('POST', '/api/fence-style-forms', { input })
export const saveStyle = (material: string, key: string, input: StyleFormInput) => send<{ record: { key: string; label: string }; message: string; waiting: string[] }>('PUT', at(material, key), { input })
export const styleArchiveCheck = (material: string, key: string) => send<{ fences: number; usedBy: Array<{ id: string; what: string }>; blocking: Array<{ id: string; what: string }> }>('GET', `${at(material, key)}/archive-check`)
export const archiveStyle = (material: string, key: string) => send<{ styles: string[]; items: string[]; kits: string[] }>('POST', `${at(material, key)}/remove`)
export const restoreStyle = (material: string, key: string) => send<{ styles: string[]; items: string[]; kits: string[] }>('POST', `${at(material, key)}/restore`)
export const saveStylePrices = (prices: Array<{ part: string; cents: number }>) => send<{ priced: Array<{ name: string; cents: number; prevCents: number | null }> }>('PUT', '/api/fence-style-forms/prices', { prices })
