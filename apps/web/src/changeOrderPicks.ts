/**
 * The change order pick list (Jonathan, Oct 22 2026: "a pick list from the
 * catalog and the Repair price list for change order lines, plus custom
 * lines"). Pure: the server runs it through the estimate bundle (estimate.ts
 * changeOrderPicksFor) on the company's Settings, Inventory and kits, so a
 * Salesman's phone gets prices only, never a cost.
 *
 *   Add to the fence   sections, a walk gate, a double gate (by width where
 *                      the style's gates go by width: chain link), priced as
 *                      a new quote prices those pieces (moveRepair.ts
 *                      priceAddedPieces; Jonathan, Oct 30 2026: "Added
 *                      sections and gates on a change order should price the
 *                      same as on a new quote")
 *   Repair price list  every repair item (and pulling an old post), priced for
 *                      the job's style exactly as a repair quote prices it
 *                      (moveRepair.ts priceChangeOrderPick); gate items for a
 *                      walk gate and for a double gate. Replace a section and
 *                      Replace a gate are new pieces too: priced as a new
 *                      quote prices them, with the new quote's tear out
 *   Catalog            every Inventory item in use with a cost, priced as a
 *                      repair prices the parts it uses
 *
 * On a wood job (Oct 30 2026) the parts are the wood style's own kit and
 * Inventory costs, and labor is wood labor (White Vinyl × the Wood factor):
 * moveRepair.ts woodWork.
 *
 * Each item's price is for a quantity of one; pickPrice prices a quantity.
 */

import { priceChangeOrderPick, moveRepairSettings, postTypeOf, footerCounts, workKit, FOOTER_DIG_SET_REASON, PICK_REPAIR_KEYS, PICK_LABEL, REPAIR_HINT, type ChangeOrderPick, type PickRepairKey, type WorkResult } from './moveRepair'
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
  /** Not offered for this job, and why (the concrete footer on a dig set job: FOOTER_DIG_SET_REASON); it cannot be picked. */
  off?: string
}

export interface PickList {
  fenceStyle: string
  styleLabel: string
  /** The job's style is not in Settings: nothing can be priced from it. */
  noStyle: boolean
  items: PickItem[]
}

/** The job's style now, whether it has a salesman (commission), and the gates it has now (once per job gate parts are not charged again). */
export interface PickInput { fenceStyle: string; hasSalesman: boolean; walkGates?: number; dblGates?: number }
type InvItem = { id?: unknown; name?: unknown; unitCost?: unknown; status?: unknown; category?: unknown }

const GATE_KEYS = new Set<PickRepairKey>(['rehangGate', 'replaceGate'])

/** Gate widths offered by name where a style's gates go by width (chain link): walk 4, 5, 6 ft; double 8, 10, 12 ft. */
const WALK_WIDTHS = [4, 5, 6], DBL_WIDTHS = [8, 10, 12]

/** "add:section", "add:walk" or "add:walk:5", "add:double:10": the words for an added piece. */
function addLabel(piece: 'section' | 'walk' | 'double', width: number | null): string {
  if (piece === 'section') return 'Add a section'
  const w = width ? `${width} ft ` : ''
  return piece === 'walk' ? `Add a ${w}walk gate` : `Add ${width === 8 ? 'an' : 'a'} ${w}double gate`
}

/** "repair:replaceGate:double" → the pick; "add:walk:5" → a 5 ft walk gate added; "catalog:<id>" → the Inventory item's name. */
export function pickOf(source: string, inventory: InvItem[]): { pick: ChangeOrderPick; label: string } | null {
  const [kind, key, gate] = String(source || '').split(':')
  if (kind === 'add') {
    if (key !== 'section' && key !== 'walk' && key !== 'double') return null
    if (key === 'section' && gate !== undefined) return null
    const width = gate === undefined ? null : Number(gate)
    if (width !== null && !(Number.isInteger(width) && width >= 3 && width <= 20)) return null
    return { pick: { kind: 'add', piece: key, ...(width ? { widthFt: width } : {}) }, label: addLabel(key, width) }
  }
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

/**
 * Why a pick is not offered for the job's style, or null. The concrete footer
 * is for no dig posts only (Jonathan, Oct 29 2026: "Dig set rates already
 * cover the concrete"); a change order's old posts are the job's style's.
 */
function offFor(pick: ChangeOrderPick, style: Parameters<typeof postTypeOf>[0]): string | null {
  return pick.kind === 'repair' && pick.key === 'footerDisposal' && !footerCounts(postTypeOf(style)) ? FOOTER_DIG_SET_REASON : null
}

const usable = (i: InvItem) => typeof i.name === 'string' && i.name.trim() !== '' && i.status !== 'inactive' && i.status !== 'discontinued' && Number(i.unitCost) > 0

function common(cfg: AppConfig, input: PickInput, overheadPct: number) {
  const style = quoteStyles(cfg, input.fenceStyle).find(s => s.name === input.fenceStyle)
  return style ? { style, pricing: cfg.pricing, overrides: {}, settings: moveRepairSettings(cfg), overheadPct, hasSalesman: !!input.hasSalesman, priceAdjust: 0, extraLaborHrs: 0 } : null
}

/** The job a picked section or gate is added to: its gates now and the rail optimizer settings. */
const jobOf = (cfg: AppConfig, input: PickInput) => ({
  walkGates: Math.max(0, Math.round(Number(input.walkGates) || 0)), dblGates: Math.max(0, Math.round(Number(input.dblGates) || 0)),
  ...(cfg.railOptimizer ? { optimizer: cfg.railOptimizer } : {}),
})

const ADD_HINT = {
  section: 'New fence, priced as a new quote: the section, its line post and install labor',
  walk: 'Priced as a new quote: the gate, the 2 posts it hangs on and gate labor',
  double: 'Priced as a new quote: the gate, the 2 posts it hangs on and gate labor',
}
const REPLACE_HINT: Partial<Record<PickRepairKey, string>> = {
  replaceSection: 'Tear out and a new section on the posts there, priced as a new quote',
  replaceGate: 'Tear out and a new gate on the posts there, priced as a new quote',
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
    const off = offFor(p.pick, c.style)
    if (off) { items.push({ source, group, label: p.label, detail, unitCents: 0, warnings: [], off }); return }
    const r = priceChangeOrderPick(c, p.pick, 1, job)
    items.push({ source, group, label: p.label, detail, unitCents: r.priceCents, warnings: r.warnings })
  }
  const job = jobOf(cfg, input)
  // Sections and gates added, first: by width where the style's gates go by width (chain link), else one walk and one double gate.
  one('add:section', 'repair', ADD_HINT.section)
  const kit = workKit(c.style)
  const byWidth = !!kit && (['walkGate5', 'walkGate6', 'dblGate10', 'dblGate12'] as const).some(k => kit.kits[k]?.length)
  if (byWidth) {
    for (const w of WALK_WIDTHS) one(`add:walk:${w}`, 'repair', ADD_HINT.walk)
    for (const w of DBL_WIDTHS) one(`add:double:${w}`, 'repair', ADD_HINT.double)
  } else { one('add:walk', 'repair', ADD_HINT.walk); one('add:double', 'repair', ADD_HINT.double) }
  for (const k of PICK_REPAIR_KEYS) {
    const hint = k === 'pullPost' ? 'Pull labor and disposal per post (Settings → Moves and Repairs)' : REPLACE_HINT[k] ?? REPAIR_HINT[k]
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
  // Not offered for this job (a concrete footer on dig set): never priced, whatever a phone sends.
  if (!c || !p || offFor(p.pick, c.style)) return null
  const n =Math.max(1, Math.min(10_000, Math.round(Number(qty) || 1)))
  const r: WorkResult = priceChangeOrderPick(c, p.pick, n, jobOf(cfg, input))
  return { priceCents: r.priceCents, label: p.label, qty: n, warnings: r.warnings }
}
