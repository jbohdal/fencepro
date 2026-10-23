/**
 * The change order pick list (Jonathan, Oct 22 2026: "a pick list from the
 * catalog and the Repair price list for change order lines, plus custom
 * lines"). Pure: the server runs it through the estimate bundle (estimate.ts
 * changeOrderPicksFor) on the company's Settings, Inventory and kits, so a
 * Salesman's phone gets prices only, never a cost.
 *
 *   Repair price list  every repair item (and pulling an old post), priced for
 *                      the job's style exactly as a repair quote prices it
 *                      (moveRepair.ts priceChangeOrderPick); gate items for a
 *                      walk gate and for a double gate
 *   Catalog            every Inventory item in use with a cost, priced as a
 *                      repair prices the parts it uses
 *
 * Each item's price is for a quantity of one; pickPrice prices a quantity.
 */

import { priceChangeOrderPick, moveRepairSettings, PICK_REPAIR_KEYS, PICK_LABEL, REPAIR_HINT, type ChangeOrderPick, type PickRepairKey, type WorkResult } from './moveRepair'
import { quoteStyles } from './quoteJob'
import type { AppConfig } from './configStore'

export interface PickItem {
  /** "repair:<key>[:walk|double]" or "catalog:<Inventory item id>": what the line keeps as its source. */
  source: string
  group: 'repair' | 'catalog'
  label: string
  /** Inventory category, or the repair item's hint. */
  detail: string
  /** The price of one, whole dollars in cents. */
  unitCents: number
  warnings: string[]
}

export interface PickList {
  fenceStyle: string
  styleLabel: string
  /** The job's style is not in Settings: nothing can be priced from it. */
  noStyle: boolean
  items: PickItem[]
}

export interface PickInput { fenceStyle: string; hasSalesman: boolean }
type InvItem = { id?: unknown; name?: unknown; unitCost?: unknown; status?: unknown; category?: unknown }

const GATE_KEYS = new Set<PickRepairKey>(['rehangGate', 'replaceGate'])

/** "repair:replaceGate:double" → the pick; "catalog:<id>" → the Inventory item's name. */
export function pickOf(source: string, inventory: InvItem[]): { pick: ChangeOrderPick; label: string } | null {
  const [kind, key, gate] = String(source || '').split(':')
  if (kind === 'repair') {
    if (!PICK_REPAIR_KEYS.includes(key as PickRepairKey)) return null
    const k = key as PickRepairKey
    if (GATE_KEYS.has(k) && gate !== 'walk' && gate !== 'double') return null
    const gateKind = gate === 'double' ? 'double' as const : 'walk' as const
    return { pick: { kind: 'repair', key: k, ...(GATE_KEYS.has(k) ? { gateKind } : {}) }, label: GATE_KEYS.has(k) ? `${PICK_LABEL[k]} (${gateKind === 'double' ? 'double gate' : 'walk gate'})` : PICK_LABEL[k] }
  }
  if (kind === 'catalog') {
    const id = String(source).slice('catalog:'.length)
    const it = inventory.find(i => String(i.id ?? '') === id && usable(i))
    return it ? { pick: { kind: 'part', part: String(it.name) }, label: String(it.name).replace(/^\*+/, '') } : null
  }
  return null
}

const usable = (i: InvItem) => typeof i.name === 'string' && i.name.trim() !== '' && i.status !== 'inactive' && i.status !== 'discontinued' && Number(i.unitCost) > 0

function common(cfg: AppConfig, input: PickInput, overheadPct: number) {
  const style = quoteStyles(cfg, input.fenceStyle).find(s => s.name === input.fenceStyle)
  return style ? { style, pricing: cfg.pricing, overrides: {}, settings: moveRepairSettings(cfg), overheadPct, hasSalesman: !!input.hasSalesman, priceAdjust: 0, extraLaborHrs: 0 } : null
}

/** The whole list for the job's style, each priced for one. */
export function pickList(cfg: AppConfig, inventory: InvItem[], input: PickInput, overheadPct: number): PickList {
  const c = common(cfg, input, overheadPct)
  const styleLabel = (c?.style as { label?: string } | undefined)?.label || input.fenceStyle
  if (!c) return { fenceStyle: input.fenceStyle, styleLabel, noStyle: true, items: [] }
  const items: PickItem[] = []
  const one = (source: string, group: PickItem['group'], detail: string) => {
    const p = pickOf(source, inventory)
    if (!p) return
    const r = priceChangeOrderPick(c, p.pick, 1)
    items.push({ source, group, label: p.label, detail, unitCents: r.priceCents, warnings: r.warnings })
  }
  for (const k of PICK_REPAIR_KEYS) {
    const hint = k === 'pullPost' ? 'Pull labor and disposal per post (Settings → Moves and Repairs)' : REPAIR_HINT[k]
    if (GATE_KEYS.has(k)) { one(`repair:${k}:walk`, 'repair', hint); one(`repair:${k}:double`, 'repair', hint) }
    else one(`repair:${k}`, 'repair', hint)
  }
  const seen = new Set<string>()
  for (const i of inventory) {
    if (!usable(i) || i.id === undefined || i.id === null || seen.has(String(i.id))) continue
    seen.add(String(i.id))
    one(`catalog:${String(i.id)}`, 'catalog', typeof i.category === 'string' ? i.category : '')
  }
  return { fenceStyle: input.fenceStyle, styleLabel, noStyle: false, items }
}

/** One pick at a quantity: its price and the line's words. Null when the source or the style is unknown. */
export function pickPrice(cfg: AppConfig, inventory: InvItem[], input: PickInput, overheadPct: number, source: string, qty: number): { priceCents: number; label: string; qty: number; warnings: string[] } | null {
  const c = common(cfg, input, overheadPct)
  const p = pickOf(source, inventory)
  if (!c || !p) return null
  const n = Math.max(1, Math.min(10_000, Math.round(Number(qty) || 1)))
  const r: WorkResult = priceChangeOrderPick(c, p.pick, n)
  return { priceCents: r.priceCents, label: p.label, qty: n, warnings: r.warnings }
}
