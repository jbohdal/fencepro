/**
 * Farm fence (Jonathan, Nov 5 2026): a material like any other, in the same
 * Inventory, Fence Styles, Material Kits, yard drawing, quote builder,
 * pricing, proposals, pull sheets, Sales Orders and job costing. Priced the
 * same way: cost ÷ (1 − Overhead − Target Profit), the $350 minimum, whole
 * dollars; a sent quote keeps its prices.
 *
 *   Styles     1 Board + No Climb (1 row of boards), 3 Board + No Climb (3
 *              rows), 4 Board (4 rows, wire a choice: no wire, Red Brand or
 *              Hutchison Western; Nov 5 answer), Crossbuck + No Climb (a top
 *              and a bottom row and an X in every span). Target spacing 8 ft
 *              (Crossbuck 7.5 ft): a style's section width.
 *   Choices    post 6" (default) or 5" round treated posts; wire Red Brand
 *              (default) or Hutchison Western no climb 2x4 12.5 ga 48".
 *              Proposals offer Good = Hutchison + 5", Better = Red Brand + 6"
 *              (the Farm tier set; tiers.ts reads post and wire as one grade).
 *
 * The math (per run from the yard drawing, then summed):
 *   spans      per run ceil(run ÷ target spacing) (sectionCount.sectionsForRun);
 *              actual spacing = run ÷ spans, never wider than the target
 *   posts      the job's corners and ends (gate posts among them) and each
 *              run's spans − 1 line posts: spans for a closed loop, spans + 1
 *              for one open run, as every fence counts them
 *   boards     a 16 ft board covers 2 spans: ceil(spans ÷ 2) a run per row
 *              (KitCounts.sectionPair), times the rows
 *   X boards   one 16 ft board cut in half makes the X of one span: one a span
 *   wire       (Nov 5 2026, his second answer) every run is ONE continuous
 *              piece, never joined mid run; runs end at corners, ends and gate
 *              posts. A short run may be cut from what is left on a roll only
 *              if the whole run fits there; a run longer than a roll is the
 *              only place two rolls meet (one splice each). The runs are
 *              fitted into the fewest rolls (packWireRolls), and the pull
 *              sheet says which runs come from which roll and where the
 *              splices are. No splice mode.
 *   H braces   one at every corner, end and gate post (their post kits)
 *   gates      one tube gate of the full opening width (the smallest tube gate
 *              in Inventory at least that wide), up to the widest in Inventory;
 *              wider than that, two leaves (farmGates). A hinge set a leaf and
 *              a latch a gate.
 *
 * Staples, board screws, brace parts, the hinge set and a 5 ft gate start at
 * $0 for Jonathan to price; a style is held until every part of its kit has a
 * price, then quotes by itself (fenceCatalog.ts resolveFenceStyles). The
 * counts of those parts are a start for him to set in Material Kits.
 *
 * Pure; the server adds it once per company (lib/farmSeed.ts).
 */

import type { FenceStyle } from './configStore'
import { normalizeItemName } from './materialCalculator'
import { KIT_KINDS, type KitKind, type KitSet } from './materialKits'
import type { ChoiceDim, FenceCatalog, MaterialDef } from './fenceCatalog'

export const FARM_TAG = 'farm'
/** Shelf prices of Nov 4 2026 (Tractor Supply, farmstore.com); Inventory carries them + 7.22% estimated tax (no tax line). */
export const FARM_PRICED_ON = '2026-11-04'
export const EST_TAX = 1.0722

export const FARM_STYLES = [
  { key: 'nc1', label: '1 Board + No Climb', rows: 1, spacing: 8, x: false, wires: ['redbrand', 'hutch'] },
  { key: 'nc3', label: '3 Board + No Climb', rows: 3, spacing: 8, x: false, wires: ['redbrand', 'hutch'] },
  { key: 'b4', label: '4 Board', rows: 4, spacing: 8, x: false, wires: ['none', 'redbrand', 'hutch'] },
  { key: 'xb', label: 'Crossbuck + No Climb', rows: 2, spacing: 7.5, x: true, wires: ['redbrand', 'hutch'] },
] as const
export type FarmStyleKey = typeof FARM_STYLES[number]['key']

export const POST_5 = 'Farm, Round Post, Treated, 5" x 8\''
export const POST_6 = 'Farm, Round Post, Treated, 6" x 8\''
export const BOARD = "Farm, Corral Board, Treated Pine, 1x6x16'"
/** The same board, cut in half for the crossbuck X: its own line on the pull sheet, at the board's price. */
export const X_BOARD = "Farm, Corral Board, Treated Pine, 1x6x16', cut in half for X"
export const WIRE_RB = 'Farm, No Climb Wire, 2x4, 12.5 ga, 48", Red Brand, 200 ft roll'
export const WIRE_HW = 'Farm, No Climb Wire, 2x4, 12.5 ga, 48", Hutchison Western, 200 ft roll'
export const WIRE_HW_100 = 'Farm, No Climb Wire, 2x4, 12.5 ga, 48", Hutchison Western, 100 ft roll'
export const STAPLE = 'Farm, Fence Staple, 1-3/4" Galv (each)'
export const BOARD_SCREW = 'Farm, Board Screw, 3" Galv Exterior (each)'
export const BRACE_RAIL = "Farm, H Brace Rail, Treated, 4\" x 8'"
export const BRACE_PIN = 'Farm, H Brace Pin (each)'
export const BRACE_WIRE = 'Farm, H Brace Wire, 12.5 ga (one brace)'
export const GATE_HINGE = 'Farm, Gate Hinge Set (one leaf)'
export const GATE_4 = "Ag, Tube Gate, Galv, 4' x 4' (6GG4)"
export const GATE_5 = "Ag, Tube Gate, Galv, 4' x 5'"
export const GATE_6 = "Ag, Tube Gate, Galv, 4' x 6' (6GG6)"
export const GATE_LATCH = 'Ag, Gate, Hardware, 2 Way Latch'
/** The agricultural tube gates (4 ft tall), by width in feet, as named in Inventory. */
export const TUBE_GATES: Array<{ ft: number; part: string }> = [
  { ft: 4, part: GATE_4 }, { ft: 5, part: GATE_5 }, { ft: 6, part: GATE_6 },
  { ft: 8, part: "Ag, Tube Gate, Galv, 4' x 8' (6GG8)" }, { ft: 10, part: "Ag, Tube Gate, Galv, 4' x 10' (6GG10)" },
  { ft: 12, part: "Ag, Tube Gate, Galv, 4' x 12' (6GG12)" }, { ft: 14, part: "Ag, Tube Gate, Galv, 4' x 14' (6GG14)" },
  { ft: 16, part: "Ag, Tube Gate, Galv,  4' x 16' (6GG16)" }, { ft: 18, part: "Ag, Tube Gate, Galv, 4' x 18' (6GG18)" },
  { ft: 20, part: "Ag, Tube Gate, Galv, 4' x 20' (6GG20)" },
]
/** Wire roll length in feet (both wires come in 200 ft rolls). */
export const ROLL_FT = 200

export const FARM_POSTS = [
  { key: '6', label: '6" round posts', part: POST_6, diameterIn: 6 },
  { key: '5', label: '5" round posts', part: POST_5, diameterIn: 5 },
] as const
export const FARM_WIRES = [
  { key: 'redbrand', label: 'Red Brand no climb', part: WIRE_RB as string | null },
  { key: 'hutch', label: 'Hutchison Western no climb', part: WIRE_HW as string | null },
  { key: 'none', label: 'No wire', part: null as string | null },
] as const

/** A farm style's internal name: farm/nc3/6/redbrand. */
export const farmStyleName = (style: string, post: string, wire: string) => `farm/${style}/${post}/${wire}`
export const farmKitId = (style: string, post: string, wire: string) => `kit_farm_${style}_${post}_${wire}`
export const FARM_COMBOS = FARM_STYLES.flatMap(s => FARM_POSTS.flatMap(p => s.wires.map(w => ({ style: s, post: p, wire: FARM_WIRES.find(x => x.key === w)! }))))
export const FARM_STYLE_NAMES = FARM_COMBOS.map(c => farmStyleName(c.style.key, c.post.key, c.wire.key))

export const FARM_NAME_TEMPLATE = 'Farm Fence, {style}, {post}, {wire}'
export const FARM_MATERIAL: MaterialDef = {
  key: 'farm', label: 'Farm fence', category: 'Farm',
  nameTemplate: FARM_NAME_TEMPLATE,
  // Off the website instant quote until Jonathan switches it on (Nov 5 2026).
  website: false,
  dims: [
    { key: 'style', label: 'Style', options: FARM_STYLES.map(s => ({ key: s.key, label: s.label })) },
    { key: 'post', label: 'Posts', options: FARM_POSTS.map(p => ({ key: p.key, label: p.label })) },
    { key: 'wire', label: 'Wire', options: FARM_WIRES.map(w => ({ key: w.key, label: w.label })) } as ChoiceDim,
  ],
}

type Line = { part: string; qty: number }
type KitSpec = Partial<Record<KitKind, Line[]>>

/**
 * One farm style's kit. Posts, boards, the X and the wire are Jonathan's
 * rules; the staple, screw, brace and hinge counts are a start, set by him in
 * Inventory > Material Kits:
 *   a post (line, corner, end, gate)  the post; 8 staples where there is wire
 *   corner, end and gate posts       an H brace each: a brace rail, 2 brace
 *                                    pins and a brace wire
 *   every 2 spans of a run           a board per row, 6 screws a board
 *   every span (Crossbuck)           a board cut in half for the X, 4 screws
 *   per foot                         wire at 1 roll per 200 ft, fitted
 *                                    run by run into whole rolls (packWireRolls)
 *   gates (not kit lines)            by opening width (farmGates): a tube
 *                                    gate a leaf, a hinge set a leaf, a latch
 */
export function farmKit(style: typeof FARM_STYLES[number], post: typeof FARM_POSTS[number], wire: typeof FARM_WIRES[number]): KitSpec {
  const staples = wire.part ? [{ part: STAPLE, qty: 8 }] : []
  const line = [{ part: post.part, qty: 1 }, ...staples]
  const braced = [...line, { part: BRACE_RAIL, qty: 1 }, { part: BRACE_PIN, qty: 2 }, { part: BRACE_WIRE, qty: 1 }]
  return {
    line, corner: braced, end: braced, gatePost: braced,
    sectionPair: [{ part: BOARD, qty: style.rows }, { part: BOARD_SCREW, qty: 6 * style.rows }],
    ...(style.x ? { section: [{ part: X_BOARD, qty: 1 }, { part: BOARD_SCREW, qty: 4 }] } : {}),
    ...(wire.part ? { perFoot: [{ part: wire.part, qty: 1 / ROLL_FT }] } : {}),
    // Gates are not kit lines: each opening's tube gate, hinge sets and latch come from its width (farmGates).
  }
}

export function farmKitSet(style: typeof FARM_STYLES[number], post: typeof FARM_POSTS[number], wire: typeof FARM_WIRES[number], now = new Date().toISOString()): KitSet {
  const spec = farmKit(style, post, wire)
  const kits: KitSet['kits'] = {}
  for (const k of KIT_KINDS) if (spec[k]?.length) kits[k] = spec[k]!.map(p => ({ part: p.part, qty: p.qty, fallbackCost: 0 }))
  return {
    id: farmKitId(style.key, post.key, wire.key), name: `Farm Fence, ${style.label}, ${post.label}, ${wire.label}`, styleName: farmStyleName(style.key, post.key, wire.key),
    kits, roundUp: wire.part ? [wire.part] : [], updatedAt: now, madeFor: FARM_TAG,
  }
}

/** Inventory dollars at the cent, from a shelf price + 7.22% estimated tax ($29.99 → $32.16). */
export const withEstTax = (shelf: number) => Math.round(shelf * EST_TAX * 100) / 100

/**
 * The farm parts: shelf price (null: $0 for Jonathan to price), supplier, the
 * supplier's item number, and a quantity break. A part already in Inventory
 * by name is reused as it is (the tube gates and the latch).
 */
export const FARM_PARTS: Array<{ part: string; shelf: number | null; supplier?: string; vendorItemNumber?: string; qtyBreak?: { minQty: number; pctOff: number }; priceFromBoard?: boolean }> = [
  { part: POST_5, shelf: 19.99, supplier: 'Tractor Supply', vendorItemNumber: '4041090' },
  { part: POST_6, shelf: 29.99, supplier: 'Tractor Supply', vendorItemNumber: '4041105', qtyBreak: { minQty: 25, pctOff: 5 } },
  { part: BOARD, shelf: 19.99, supplier: 'Tractor Supply', vendorItemNumber: '4053194' },
  { part: X_BOARD, shelf: 19.99, supplier: 'Tractor Supply', vendorItemNumber: '4053194', priceFromBoard: true },
  { part: WIRE_RB, shelf: 414.99, supplier: 'Tractor Supply', vendorItemNumber: '3610692' },
  { part: WIRE_HW, shelf: 349.99, supplier: 'farmstore.com' },
  { part: WIRE_HW_100, shelf: 179.0, supplier: 'farmstore.com' },
  { part: STAPLE, shelf: null }, { part: BOARD_SCREW, shelf: null },
  { part: BRACE_RAIL, shelf: null }, { part: BRACE_PIN, shelf: null }, { part: BRACE_WIRE, shelf: null },
  { part: GATE_HINGE, shelf: null }, { part: GATE_5, shelf: null },
  { part: GATE_4, shelf: null }, { part: GATE_6, shelf: null }, { part: GATE_LATCH, shelf: null },
]

type Item = { id: string; name: string; unitCost: number; [k: string]: unknown }
export interface FarmState { fenceStyles: FenceStyle[]; fenceCatalog?: FenceCatalog | null; items: Item[]; kits: KitSet[] }
export interface FarmPlan { state: FarmState; styles: string[]; kits: string[]; items: string[]; catalog: boolean }

/**
 * Add farm fence to a company's saved Settings and Inventory: the material in
 * a saved choice tree (the default tree has it), its 18 styles (the Target
 * Profit and man hour rates of White Vinyl dig set 6'x8', as wood took them;
 * the sub rate per foot is Jonathan's to set in Fence Styles), a kit for each,
 * and the parts missing from Inventory. Anything already there is left alone:
 * run twice, the second run changes nothing.
 */
export function planFarm(st0: FarmState, now = new Date().toISOString()): FarmPlan {
  const st: FarmState = JSON.parse(JSON.stringify(st0))
  const out: FarmPlan = { state: st, styles: [], kits: [], items: [], catalog: false }
  if (st.fenceCatalog && Array.isArray(st.fenceCatalog.materials) && !st.fenceCatalog.materials.some(m => m.key === 'farm')) {
    st.fenceCatalog.materials.push(JSON.parse(JSON.stringify(FARM_MATERIAL)))
    out.catalog = true
  }
  const from = st.fenceStyles.find(s => s.name === "WV-DS 6'x8' Privacy")
  for (const c of FARM_COMBOS) {
    const name = farmStyleName(c.style.key, c.post.key, c.wire.key)
    if (!st.fenceStyles.some(s => s.name === name)) {
      st.fenceStyles.push({
        id: `fs_${name.replace(/\//g, '_')}`, name, category: 'Farm', margin: from?.margin ?? 0.6,
        ...(typeof from?.targetProfitPct === 'number' ? { targetProfitPct: from.targetProfitPct } : {}),
        sectionsPerMH: from?.sectionsPerMH ?? 1, panelWidth: c.style.spacing, mhPerWalkGate: from?.mhPerWalkGate ?? 2, mhPerDblGate: from?.mhPerDblGate ?? 4,
        isActive: true, material: 'farm', choices: { style: c.style.key, post: c.post.key, wire: c.wire.key },
      })
      out.styles.push(name)
    }
    if (!st.kits.some(k => k.id === farmKitId(c.style.key, c.post.key, c.wire.key) || (k.styleName === name && !k.archived))) {
      st.kits.push(farmKitSet(c.style, c.post, c.wire, now))
      out.kits.push(name)
    }
  }
  const have = new Set(st.items.map(i => normalizeItemName(i.name)))
  for (const p of FARM_PARTS) {
    const key = normalizeItemName(p.part)
    if (have.has(key)) continue
    have.add(key)
    const unitCost = p.shelf == null ? 0 : withEstTax(p.shelf)
    st.items.push({
      id: `inv_farm_${key.replace(/[^a-z0-9]+/g, '_')}`, name: p.part, unitCost, category: /^Ag,/.test(p.part) ? 'Agricultural' : 'Farm', status: 'active', madeFor: FARM_TAG,
      ...(p.supplier ? { supplier: p.supplier } : {}), ...(p.vendorItemNumber ? { vendorItemNumber: p.vendorItemNumber } : {}),
      ...(p.qtyBreak ? { qtyBreak: p.qtyBreak } : {}),
      ...(unitCost > 0 ? { priceUpdatedAt: FARM_PRICED_ON, priceImported: false } : {}),
      ...(p.priceFromBoard ? { priceFrom: { part: BOARD, cents: Math.round(unitCost * 100), on: FARM_PRICED_ON, words: 'From the corral board until it has its own price' } } : {}),
    })
    out.items.push(p.part)
  }
  return out
}

/**
 * Farm kits saved before the gate rule (Nov 5 2026) carry gate kit lines (a
 * 4, 5 or 6 ft tube gate a leaf); gates now go by the opening's width
 * (farmGates) and those lines are not read. They are taken off the farm kits
 * so Material Kits shows what prices. Other kits are not touched.
 */
export function planFarmGates(kits0: KitSet[], now = new Date().toISOString()): { kits: KitSet[]; changed: string[] } {
  const kits: KitSet[] = JSON.parse(JSON.stringify(kits0))
  const changed: string[] = []
  const gateKinds: KitKind[] = ['walkGate', 'dblGate', 'walkGate5', 'walkGate6', 'dblGate10', 'dblGate12']
  for (const k of kits) {
    if (k.madeFor !== FARM_TAG) continue
    const had = gateKinds.filter(g => k.kits[g])
    if (!had.length) continue
    for (const g of had) delete k.kits[g]
    k.updatedAt = now
    changed.push(k.styleName ?? k.name)
  }
  return { kits, changed }
}

// ── The run math the quote builder shows the staff ───────────────────────────

/** The farm style (style key, post, wire) of a fence style, or null. */
export function farmOf(s: { material?: string; choices?: Record<string, string> | null } | null | undefined) {
  if (s?.material !== 'farm' || !s.choices) return null
  const style = FARM_STYLES.find(x => x.key === s.choices!.style)
  const post = FARM_POSTS.find(x => x.key === s.choices!.post)
  const wire = FARM_WIRES.find(x => x.key === s.choices!.wire)
  return style && post && wire ? { style, post, wire } : null
}

/** "7' 5\"" (feet and whole inches, rounded to the nearest inch). */
export function feetInches(ft: number): string {
  let f = Math.floor(ft), i = Math.round((ft - f) * 12)
  if (i === 12) { f += 1; i = 0 }
  return `${f}' ${i}"`
}

export interface FarmRun { ft: number; spans: number; spacingFt: number; spacingText: string; boardsPerRow: number }
/** Each run: its spans at the target spacing, the actual spacing, and the 16 ft boards a row takes. */
export function farmRuns(runs: number[], targetFt: number): FarmRun[] {
  return runs.filter(ft => ft > 0).map(ft => {
    const spans = ft % targetFt === 0 ? ft / targetFt : Math.ceil(ft / targetFt)
    const spacingFt = ft / spans
    return { ft, spans, spacingFt, spacingText: feetInches(spacingFt), boardsPerRow: Math.ceil(spans / 2) }
  })
}

export interface RollPlan {
  /** Each roll: the pieces cut from it (run number from 1, in drawing order, and feet) and the feet left. */
  rolls: Array<{ pieces: Array<{ run: number; ft: number }>; leftFt: number }>
  /** Where two rolls meet: only inside a run longer than a roll, one per extra roll it takes. */
  splices: Array<{ run: number }>
  leftFt: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * The fewest wire rolls for these runs (Jonathan, Nov 5 2026): every run one
 * continuous piece; a run fits on a roll's leftover only whole; a run longer
 * than a roll takes full rolls and the rest from one more roll, spliced (the
 * only splices). The pieces (short runs and long runs' last parts) are packed
 * exactly for up to 18 pieces (branch and bound), first fit decreasing above.
 */
export function packWireRolls(runs: number[], rollFt = ROLL_FT): RollPlan {
  const eps = 1e-6
  const rolls: RollPlan['rolls'] = []
  const splices: RollPlan['splices'] = []
  const pieces: Array<{ run: number; ft: number }> = []
  runs.filter(x => x > 0).forEach((ft, i) => {
    const run = i + 1
    let left = ft
    // A run longer than a roll: whole rolls, then the rest spliced on.
    while (left > rollFt + eps) { rolls.push({ pieces: [{ run, ft: rollFt }], leftFt: 0 }); left = r2(left - rollFt); splices.push({ run }) }
    pieces.push({ run, ft: r2(left) })
  })
  const order = [...pieces].sort((a, b) => b.ft - a.ft || a.run - b.run)
  let best: number[][] | null = null
  if (order.length <= 18) {
    const lower = Math.ceil(order.reduce((t, p) => t + p.ft, 0) / rollFt - eps)
    const bins: number[][] = [], room: number[] = []
    const dfs = (k: number) => {
      if (best && bins.length >= best.length) return
      if (k === order.length) { best = bins.map(b => [...b]); return }
      const seen = new Set<number>()
      for (let b = 0; b < bins.length; b++) {
        if (room[b] + eps < order[k].ft || seen.has(room[b])) continue
        seen.add(room[b])
        bins[b].push(k); room[b] = r2(room[b] - order[k].ft)
        dfs(k + 1)
        bins[b].pop(); room[b] = r2(room[b] + order[k].ft)
        if (best && best.length === Math.max(lower, 1)) return
      }
      bins.push([k]); room.push(r2(rollFt - order[k].ft))
      dfs(k + 1)
      bins.pop(); room.pop()
    }
    dfs(0)
  } else {
    const bins: number[][] = [], room: number[] = []
    order.forEach((p, k) => { const b = room.findIndex(r => r + eps >= p.ft); if (b >= 0) { bins[b].push(k); room[b] = r2(room[b] - p.ft) } else { bins.push([k]); room.push(r2(rollFt - p.ft)) } })
    best = bins
  }
  for (const b of (best ?? []) as number[][]) {
    const ps = b.map(k => order[k]).sort((x, y) => x.run - y.run)
    rolls.push({ pieces: ps, leftFt: r2(rollFt - ps.reduce((t, p) => t + p.ft, 0)) })
  }
  return { rolls, splices, leftFt: r2(rolls.reduce((t, r) => t + r.leftFt, 0)) }
}

/** The pull sheet's words: which runs come from which roll, and the splices. */
export function rollPlanText(plan: RollPlan): string {
  const ft = (n: number) => `${r2(n)} ft`
  const rolls = plan.rolls.map((r, i) => `Roll ${i + 1}: ${r.pieces.map(p => `run ${p.run} ${ft(p.ft)}`).join(' + ')}${r.leftFt > 0 ? ` (${ft(r.leftFt)} left)` : ''}`)
  const runs = [...new Set(plan.splices.map(s => s.run))]
  const sp = plan.splices.length ? ` ${plan.splices.length} splice${plan.splices.length === 1 ? '' : 's'}: ${runs.map(r => `run ${r}${plan.splices.filter(s => s.run === r).length > 1 ? ` (${plan.splices.filter(s => s.run === r).length})` : ''}`).join(', ')} (longer than a roll).` : ' No splices.'
  return `${rolls.join('. ')}.${sp}`
}

/**
 * The gates of a farm fence (Jonathan, Nov 5 2026): each opening one tube gate
 * of its full width (the smallest one in Inventory at least that wide), up to
 * the widest in Inventory; wider than that, two leaves, each the smallest one
 * at least half the opening. `has` says whether a part is in Inventory. A
 * hinge set a leaf, a latch a gate.
 */
export function farmGates(openingsFt: number[], has: (part: string) => boolean): { lines: Array<{ part: string; qty: number }>; notes: string[] } {
  const gates = TUBE_GATES.filter(g => has(g.part))
  const out = new Map<string, number>(), notes: string[] = []
  const add = (part: string, n: number) => out.set(part, (out.get(part) ?? 0) + n)
  if (!gates.length) return { lines: [], notes: openingsFt.length ? ['No tube gates in Inventory: the gates are not priced.'] : [] }
  const widest = gates[gates.length - 1]
  const fit = (ft: number) => gates.find(g => g.ft + 1e-9 >= ft)
  for (const w of openingsFt) {
    if (!(w > 0)) continue
    const one = fit(w)
    if (one) { add(one.part, 1); add(GATE_HINGE, 1); add(GATE_LATCH, 1); continue }
    const leaf = fit(w / 2) ?? widest
    if (!fit(w / 2)) notes.push(`A ${r2(w)} ft opening is wider than two ${widest.ft} ft gates: priced as two ${widest.ft} ft leaves. Check the gate.`)
    add(leaf.part, 2); add(GATE_HINGE, 2); add(GATE_LATCH, 1)
  }
  return { lines: [...out].map(([part, qty]) => ({ part, qty })), notes }
}

/**
 * The crossbuck X spacing helper: a 16 ft board cut in half is 96" long; set
 * across an opening (the clear height between the top and bottom boards, in
 * inches) it spans a clear gap of √(96² − opening²) between posts, so posts on
 * centers sit that gap + the post diameter apart. 36" → 89", 42" → 86", 48" → 83".
 */
export function crossbuckGap(openingIn: number, postDiameterIn: number): { clearIn: number; centersIn: number } | null {
  if (!(openingIn > 0) || openingIn >= 96) return null
  const clearIn = Math.sqrt(96 * 96 - openingIn * openingIn)
  return { clearIn, centersIn: clearIn + postDiameterIn }
}
