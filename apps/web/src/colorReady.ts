/**
 * Tells Jonathan when a color he added in Settings → Fence styles becomes
 * fully priced (its last part priced in Inventory, or its last piece price
 * entered) and so switches on for quoting by itself.
 */

import { getConfig } from './configStore'
import { INVENTORY_UPDATED_EVENT } from './inventoryStore'
import { BUSINESS_STATE_UPDATED_EVENT } from './businessStateStore'
import { catalogOf, colorDimOf, colorStatus } from './fenceCatalog'
import { toast } from './toast'

let started = false
let last: Map<string, boolean> | null = null

function readiness(): Map<string, boolean> {
  const cfg = getConfig()
  const out = new Map<string, boolean>()
  for (const m of catalogOf(cfg).materials) {
    const dim = colorDimOf(m)
    for (const o of dim?.options ?? []) {
      if (!o.copiedFrom || !o.color || o.archived) continue
      out.set(`${m.key}:${o.key}`, colorStatus(cfg.fenceStyles, m, o).ready)
    }
  }
  return out
}

function check() {
  let now: Map<string, boolean>
  try { now = readiness() } catch { return }
  if (last) {
    const cfg = getConfig()
    for (const [key, ready] of now) {
      if (!ready || last.get(key) !== false) continue
      const [mk, ok] = key.split(':')
      const m = catalogOf(cfg).materials.find(x => x.key === mk)
      const o = colorDimOf(m)?.options.find(x => x.key === ok)
      toast.success(`${o?.label ?? ok} ${m?.label.toLowerCase() ?? ''} is now available for quoting`, 'Every price it needs is in, so it switched on by itself.')
    }
  }
  last = now
}

export function startColorReadyWatch() {
  if (started) return
  started = true
  window.addEventListener(INVENTORY_UPDATED_EVENT, () => check())
  window.addEventListener(BUSINESS_STATE_UPDATED_EVENT, () => check())
  check()
}
