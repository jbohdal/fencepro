/**
 * Wood fence (Jonathan, Oct 30 2026, standing rule; replaces the Oct 19 rule
 * that priced wood as white vinyl × 115%, which was a mistake):
 *
 *   Materials  priced from each wood style's own material kit, real wood
 *              parts in Inventory (pressure treated posts, 2x4 rails,
 *              pickets, nails, concrete, a steel gate frame), exactly like any
 *              other style.
 *   Labor      the White Vinyl dig set 6'x8' privacy install labor × the Wood
 *              factor (Settings → Moves and Repairs, default 115%).
 *   Repairs    moves and repairs on a wood fence: the White Vinyl rates × the
 *              Wood factor, as before (moveRepair.ts woodWork).
 *
 * Wood is 6 ft tall, dig set in concrete, 8 ft sections, in three styles
 * (Stockade, Board on Board, Shadow Box), each in two picket grades: PT Pine
 * (regular pressure treated pine, Good) and Alta Premium (Alta Premium
 * Treated Dog-Ear, Better). Six style rows, each with its own kit; the grades
 * differ only in the picket. Proposals offer the two grades as Good and Better
 * through the Wood tier set (tiers.ts: a tier's "color" is the picket grade
 * for wood, proposalOptions.ts styleParts).
 *
 *   Wood Stockade, 6 ft tall, 8 ft panels, Dig set, PT Pine pickets   wood/stockade/6/pine/ds/8
 *   ... Alta Premium pickets                                         wood/stockade/6/premium/ds/8
 *   Board on Board: wood/bob/6/{pine,premium}/ds/8; Shadow Box: wood/sb/6/{pine,premium}/ds/8
 *
 * The four "Privacy" wood styles made on Oct 19 stay as rows, held because
 * their choices (Privacy, No dig, 6 ft panels) are archived in the choice
 * tree; saved quotes on them keep their saved prices (heldQuote.ts).
 *
 * A wood style is held ("Wood is waiting for prices on N parts in
 * Inventory") until every part of its kit has a price, then it is available
 * for quoting by itself, with no other step (fenceCatalog.ts
 * resolveFenceStyles). The server adds the styles, kits and parts once
 * (lib/woodSeed.ts) and archives (never deletes) the white vinyl parts that
 * had been renamed as wood and the kits made from them.
 *
 * Pure: the server's seed (lib/woodSeed.ts) runs planWood and
 * planWoodRealKits through the estimate bundle.
 */

import type { FenceStyle } from './configStore'
import { normalizeItemName } from './materialCalculator'
import { KIT_KINDS, type KitKind, type KitSet } from './materialKits'
import type { ChoiceDim, FenceCatalog, MaterialDef } from './fenceCatalog'

export const DEFAULT_WOOD_FACTOR_PCT = 115

/** The White Vinyl style every wood style's install labor (× the Wood factor) comes from. */
export const WOOD_LABOR_FROM = "WV-DS 6'x8' Privacy"

/** The Oct 19 wood styles (kept as rows, held) → the White Vinyl style each one's labor comes from. */
export const WOOD_OLD_OF: Record<string, string> = {
  'wood/privacy/6/nd/6': "WV-ND 6'x6' Privacy",
  'wood/privacy/6/nd/8': "WV-ND 6'x8' Privacy",
  'wood/privacy/6/ds/6': "WV-DS 6'x6' Privacy",
  'wood/privacy/6/ds/8': "WV-DS 6'x8' Privacy",
}

/** The wood styles built for real (Oct 30 2026): choice key, label, and pickets in one 8 ft section. */
export const WOOD_STYLES = [
  { key: 'stockade', label: 'Stockade', pickets: 17 },
  { key: 'bob', label: 'Board on Board', pickets: 22 },
  { key: 'sb', label: 'Shadow Box', pickets: 22 },
] as const
export type WoodStyleKey = typeof WOOD_STYLES[number]['key']

/** The picket grades: Good (regular pressure treated pine) and Better (Alta Premium), one picket part each, used by all three styles. */
export const WOOD_GRADES = [
  { key: 'pine', label: 'PT Pine', picket: "Wood, Picket, PT Pine, 1x6x6'", tier: 'Good' },
  { key: 'premium', label: 'Alta Premium', picket: "Wood, Picket, Alta Premium Treated Dog-Ear, 1x6x6'", tier: 'Better' },
] as const
export type WoodGradeKey = typeof WOOD_GRADES[number]['key']

/** A real wood style's internal name: wood/stockade/6/pine/ds/8. */
export const woodStyleName = (style: string, grade: string) => `wood/${style}/6/${grade}/ds/8`
export const woodKitId = (style: string, grade: string) => `kit_wood_real_${style}_6_${grade}_ds_8`
export const WOOD_REAL_STYLES = WOOD_STYLES.flatMap(s => WOOD_GRADES.map(g => woodStyleName(s.key, g.key)))

/** Every wood style internal name → the White Vinyl style its labor comes from. */
export const WOOD_OF: Record<string, string> = {
  ...WOOD_OLD_OF,
  ...Object.fromEntries(WOOD_REAL_STYLES.map(n => [n, WOOD_LABOR_FROM])),
}

/** Inventory items and kit sets added for the real wood kits are tagged with this. */
export const WOOD_REAL_TAG = 'wood-real'
/** The Oct 19 kits and parts (white vinyl renamed as wood) were tagged with this; archived Oct 30. */
export const WOOD_OLD_TAG = 'wood'

/** The picket grade choice (between Height and Install). It reads at the end of the plain name; the Oct 19 rows have none. */
export const WOOD_PICKET_DIM: ChoiceDim = {
  key: 'picket', label: 'Pickets',
  options: WOOD_GRADES.map(g => ({ key: g.key, label: g.label, nameText: `, ${g.label} pickets` })),
}
export const WOOD_NAME_TEMPLATE = 'Wood {style}, {height} tall, {width}, {install}{picket}'

/**
 * The wood material in the choice tree (Settings → Fence styles). Privacy, No
 * dig and 6 ft panels are archived (Oct 30 2026), so the Oct 19 styles on them
 * are held and kept, never deleted.
 */
export const WOOD_MATERIAL: MaterialDef = {
  key: 'wood', label: 'Wood', category: 'Wood',
  nameTemplate: WOOD_NAME_TEMPLATE,
  dims: [
    { key: 'style', label: 'Style', options: [{ key: 'privacy', label: 'Privacy', archived: true }, ...WOOD_STYLES.map(s => ({ key: s.key, label: s.label }))] },
    { key: 'height', label: 'Height', options: [{ key: '6', label: '6 ft' }] },
    WOOD_PICKET_DIM,
    { key: 'install', label: 'Install', options: [{ key: 'nd', label: 'No dig', archived: true }, { key: 'ds', label: 'Dig set' }] },
    { key: 'width', label: 'Panel width', options: [{ key: '6', label: '6 ft', nameText: '6 ft panels', archived: true }, { key: '8', label: '8 ft', nameText: '8 ft panels' }] },
  ],
}

/** The choice tree options archived for wood: [dimension, option]. */
export const WOOD_ARCHIVED_OPTIONS: Array<[string, string]> = [['style', 'privacy'], ['install', 'nd'], ['width', '6']]

const POST_LINE = "Wood, PT Post, Line, 4x4x8'"
const POST_CORNER = "Wood, PT Post, Corner, 4x4x8'"
const POST_END = "Wood, PT Post, End, 4x4x8'"
const POST_GATE = "Wood, PT Post, Gate, 6x6x8'"
const RAIL = "Wood, PT Rail, 2x4x8'"
const PICKET_NAIL = 'Wood, Picket Nail, 1-3/4" x .090 15° 304 SS Ring Shank'
const FRAMING_NAIL = 'Wood, Framing Nail, 3" x .120 21° Galv Ring Shank'
const FRAME_SCREW = 'Wood, Screw, Self-Tapping, Picket to Steel Gate Frame'
const FRAME = 'Wood, Steel Gate Frame (hinges included)'
const LATCH = 'Wood, Gate Latch'
/** Parts already in Inventory with a price, reused as they are (the drop rod is the one 8 ft tall vinyl double gates use, TAKEOFF_RULES). */
const CONCRETE = 'Misc, Concrete'
const DROP_ROD = 'Drop Rod, 48", Black'

/** Pickets on one gate leaf: the style's pickets per foot (pickets in 8 ft ÷ 8) × the leaf width, rounded up per leaf. */
export const leafPickets = (sectionPickets: number, leafFt: number) => Math.ceil((sectionPickets / 8) * leafFt - 1e-9)

type KitSpec = Partial<Record<KitKind, Array<{ part: string; qty: number }>>>

function kitFor(s: typeof WOOD_STYLES[number], g: typeof WOOD_GRADES[number]): KitSpec {
  const post = (part: string, concrete: number) => [{ part, qty: 1 }, { part: CONCRETE, qty: concrete }]
  // A gate: a steel frame a leaf (hinges included), the pickets screwed to it, 4 self-tapping screws a picket, one latch.
  const gate = (leaves: number, leafFt: number) => {
    const p = leaves * leafPickets(s.pickets, leafFt)
    return [{ part: FRAME, qty: leaves }, { part: g.picket, qty: p }, { part: FRAME_SCREW, qty: 4 * p }, { part: LATCH, qty: 1 }]
  }
  return {
    line: post(POST_LINE, 1),
    corner: post(POST_CORNER, 1),
    end: post(POST_END, 1),
    gatePost: post(POST_GATE, 2),
    section: [{ part: RAIL, qty: 3 }, { part: g.picket, qty: s.pickets }, { part: PICKET_NAIL, qty: 6 * s.pickets }, { part: FRAMING_NAIL, qty: 12 }],
    walkGate: gate(1, 4), walkGate5: gate(1, 5), walkGate6: gate(1, 6),
    dblGate: gate(2, 4), dblGate10: gate(2, 5), dblGate12: gate(2, 6),
    anyDblGate: [{ part: DROP_ROD, qty: 1 }],
  }
}

/**
 * The real wood kits, one per style and picket grade (6 ft tall, dig set, 8
 * ft sections): what one of each kind takes. Set Oct 30 2026 from Jonathan's
 * list; he can edit every quantity in Inventory > Material Kits, and that
 * saved kit is what quotes use. The two grades of a style are the same kit
 * but for the picket part.
 *
 *   Posts       line, corner and end: one 4x4x8' pressure treated post and a
 *               bag of concrete; a gate post (each side of a gate, in place of
 *               an end post) a 6x6x8' and two bags. No blank post: a double
 *               gate closes on a drop rod, not a center post.
 *   Section     3 2x4x8' rails; pickets (Stockade 17, Board on Board 22,
 *               Shadow Box 22); 6 picket nails a picket; 12 framing nails
 *               (the rails).
 *   Gates       a steel gate frame a leaf, hinges included (no rails, brace,
 *               hinges or nails); pickets at the style's pickets per foot,
 *               rounded up per leaf (Stockade 4/5/6 ft: 9/11/13; Board on
 *               Board and Shadow Box: 11/14/17); 4 self-tapping screws a
 *               picket; one latch a gate. A double gate is two leaves (8 ft:
 *               two 4 ft, 10 ft: two 5 ft, 12 ft: two 6 ft).
 *   Drop rod    one a job with any double gate (TAKEOFF_RULES: Wood DS styles,
 *               "Drop Rod, 48", Black", anyAddOn of the double gates).
 *   Caps        none.
 */
export const WOOD_KITS: Record<string, KitSpec> = Object.fromEntries(
  WOOD_STYLES.flatMap(s => WOOD_GRADES.map(g => [woodStyleName(s.key, g.key), kitFor(s, g)])),
)

/**
 * The new wood parts, in the order they are added to Inventory, with their
 * cost (Inventory dollars, whole cents as Inventory keeps them) and which
 * wood styles use each. Costs are Jonathan's shelf prices × 1.0722 (no tax
 * line on his prices: +7.22% estimated tax, his standing rule), Oct 30 2026;
 * the two nails are sub-cent each (picket nail 89/1200 = $0.0742 → $0.0796,
 * framing nail 154/4000 = $0.0385 → $0.0413) and are kept at the nearest
 * cent like every other part. Two are his cost as given, no tax added (his
 * correction the same day): the steel gate frame $350.00 and the self-tapping
 * screw $0.09. With every part priced, the six wood styles are available for
 * quoting as soon as the one-time step adds them.
 */
export const WOOD_PARTS: Array<{ part: string; unitCost: number; shelf: number | null; styles: string[] }> = [
  { part: POST_LINE, unitCost: 11.34, shelf: 10.58, styles: WOOD_REAL_STYLES },
  { part: POST_CORNER, unitCost: 11.34, shelf: 10.58, styles: WOOD_REAL_STYLES },
  { part: POST_END, unitCost: 11.34, shelf: 10.58, styles: WOOD_REAL_STYLES },
  { part: POST_GATE, unitCost: 39.33, shelf: 36.68, styles: WOOD_REAL_STYLES },
  { part: RAIL, unitCost: 5.23, shelf: 4.88, styles: WOOD_REAL_STYLES },
  { part: WOOD_GRADES[0].picket, unitCost: 2.77, shelf: 2.58, styles: WOOD_STYLES.map(s => woodStyleName(s.key, 'pine')) },
  { part: WOOD_GRADES[1].picket, unitCost: 3.95, shelf: 3.68, styles: WOOD_STYLES.map(s => woodStyleName(s.key, 'premium')) },
  { part: PICKET_NAIL, unitCost: 0.08, shelf: 89 / 1200, styles: WOOD_REAL_STYLES },
  { part: FRAMING_NAIL, unitCost: 0.04, shelf: 154 / 4000, styles: WOOD_REAL_STYLES },
  { part: FRAME_SCREW, unitCost: 0.09, shelf: null, styles: WOOD_REAL_STYLES },
  { part: LATCH, unitCost: 31.82, shelf: 29.68, styles: WOOD_REAL_STYLES },
  { part: FRAME, unitCost: 350, shelf: null, styles: WOOD_REAL_STYLES },
]
/** The day the costs above were set (Inventory's "Price last updated"). */
export const WOOD_PRICED_ON = '2026-10-30'

/** One real wood style's kit set, ready to save with Inventory. */
export function woodRealKitSet(style: WoodStyleKey, grade: WoodGradeKey, now = new Date().toISOString()): KitSet {
  const s = WOOD_STYLES.find(x => x.key === style)!
  const g = WOOD_GRADES.find(x => x.key === grade)!
  const name = woodStyleName(style, grade)
  const kits: KitSet['kits'] = {}
  for (const k of KIT_KINDS) {
    const parts = WOOD_KITS[name][k]
    if (parts?.length) kits[k] = parts.map(p => ({ part: p.part, qty: p.qty, fallbackCost: 0 }))
  }
  return { id: woodKitId(style, grade), name: `Wood ${s.label}, 6 ft tall, 8 ft panels, Dig set, ${g.label} pickets`, styleName: name, kits, roundUp: [], updatedAt: now, madeFor: WOOD_REAL_TAG }
}

/** The Wood factor as a multiplier (1.15), from Settings; 115% when blank or not a sensible number. */
export function woodFactorOf(cfg: { moveRepair?: { woodFactorPct?: number | null } | null } | null | undefined): number {
  const p = cfg?.moveRepair?.woodFactorPct
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p / 100 : DEFAULT_WOOD_FACTOR_PCT / 100
}

/**
 * "*Vinyl, White, Picket, 62-1/4"" → "Wood, Picket, 62-1/4"": how a move or
 * repair on a wood fence names the white vinyl parts it is priced from
 * (moveRepair.ts woodWork); a part that is not white vinyl stays as it is.
 */
export function woodPartName(part: string): string {
  const segs = part.split(',').map(s => s.trim())
  const isVinyl = (s: string) => /^\**vinyl$/i.test(s) || /^v$/i.test(s)
  const isWhite = (s: string) => /^(white|w)$/i.test(s)
  if (!segs.some(isWhite)) return part
  const rest = segs.filter(s => !isVinyl(s) && !isWhite(s) && s !== '')
  return ['Wood', ...rest].join(', ')
}

type Item = { id: string; name: string; unitCost: number; [k: string]: unknown }

export interface WoodState {
  fenceStyles: FenceStyle[]
  /** The saved choice tree, when Jonathan has one saved (missing: the default tree, which already has wood). */
  fenceCatalog?: FenceCatalog | null
  items: Item[]
  kits: KitSet[]
}

export interface WoodPlan { state: WoodState; styles: string[]; items: string[]; kits: string[]; catalog: boolean }

/**
 * The six real wood styles (copying the White Vinyl dig set 6'x8' privacy
 * style's Target Profit % and man hour rates), their kit sets (unless a
 * style already has a kit in use) and any of their parts missing from
 * Inventory, at the costs above. A part already in Inventory by name is
 * reused as it is. Changes `st`.
 */
function addRealWood(st: WoodState, now: string): { styles: string[]; kits: string[]; items: string[] } {
  const out = { styles: [] as string[], kits: [] as string[], items: [] as string[] }
  const vinyl = st.fenceStyles.find(s => s.name === WOOD_LABOR_FROM)
  for (const w of WOOD_STYLES) for (const g of WOOD_GRADES) {
    const name = woodStyleName(w.key, g.key)
    if (!st.fenceStyles.some(s => s.name === name)) {
      if (!vinyl) continue
      st.fenceStyles.push({
        id: `fs_${name.replace(/\//g, '_')}`, name, category: 'Wood', margin: vinyl.margin,
        ...(typeof vinyl.targetProfitPct === 'number' ? { targetProfitPct: vinyl.targetProfitPct } : {}),
        sectionsPerMH: vinyl.sectionsPerMH, panelWidth: 8, mhPerWalkGate: vinyl.mhPerWalkGate, mhPerDblGate: vinyl.mhPerDblGate,
        isActive: true, material: 'wood', choices: { style: w.key, height: '6', picket: g.key, install: 'ds', width: '8' }, woodOf: WOOD_LABOR_FROM,
      })
      out.styles.push(name)
    }
    if (!st.kits.some(k => k.id === woodKitId(w.key, g.key) || (k.styleName === name && !k.archived))) {
      st.kits.push(woodRealKitSet(w.key, g.key, now))
      out.kits.push(name)
    }
  }
  if (!st.fenceStyles.some(s => WOOD_REAL_STYLES.includes(s.name))) return out
  const have = new Set(st.items.map(i => normalizeItemName(i.name)))
  const parts = [...WOOD_PARTS, { part: CONCRETE, unitCost: 0 }, { part: DROP_ROD, unitCost: 0 }]
  for (const { part, unitCost } of parts) {
    const key = normalizeItemName(part)
    if (have.has(key)) continue
    have.add(key)
    st.items.push({
      id: `inv_wood_real_${key.replace(/[^a-z0-9]+/g, '_')}`, name: part, unitCost, category: /^Wood,/.test(part) ? 'Wood' : 'Misc', status: 'active', madeFor: WOOD_REAL_TAG,
      ...(unitCost > 0 ? { priceUpdatedAt: WOOD_PRICED_ON, priceImported: false } : {}),
    })
    out.items.push(part)
  }
  return out
}

/** Bring a saved wood material up to Oct 30 2026: the three styles and the picket grades as choices, Privacy, No dig and 6 ft panels archived, wood on. Changes `m`; returns what changed, in words. */
function updateWoodMaterial(m: MaterialDef): string[] {
  const out: string[] = []
  const styleDim = m.dims.find(d => d.key === 'style')
  if (styleDim) for (const w of WOOD_STYLES) {
    if (!styleDim.options.some(o => o.key === w.key)) { styleDim.options.push({ key: w.key, label: w.label }); out.push(`${w.label} added`) }
  }
  if (!m.dims.some(d => d.key === 'picket')) {
    const at = m.dims.findIndex(d => d.key === 'height')
    m.dims.splice(at >= 0 ? at + 1 : m.dims.length, 0, JSON.parse(JSON.stringify(WOOD_PICKET_DIM)))
    out.push('Pickets (PT Pine, Alta Premium) added')
  }
  if (m.nameTemplate !== WOOD_NAME_TEMPLATE) { m.nameTemplate = WOOD_NAME_TEMPLATE; out.push('name reads the pickets') }
  for (const [dim, key] of WOOD_ARCHIVED_OPTIONS) {
    const opt = m.dims.find(d => d.key === dim)?.options.find(o => o.key === key)
    if (opt && !opt.archived) { opt.archived = true; out.push(`${opt.label} (${dim}) archived`) }
  }
  if (m.quotable === false) { delete m.quotable; out.push('Wood turned back on (held until its parts are priced)') }
  return out
}

/**
 * Add wood to saved Settings and Inventory for a company that has none: the
 * six wood styles, the wood material in a saved choice tree, and their kits
 * with their parts in Inventory. Never a renamed vinyl part or kit (Oct 30
 * 2026). Anything already there is left alone, so running it twice changes
 * nothing the second time.
 */
export function planWood(st0: WoodState, now = new Date().toISOString()): WoodPlan {
  const st: WoodState = JSON.parse(JSON.stringify(st0))
  const out: WoodPlan = { state: st, styles: [], items: [], kits: [], catalog: false }
  if (st.fenceCatalog && Array.isArray(st.fenceCatalog.materials) && !st.fenceCatalog.materials.some(m => m.key === 'wood')) {
    st.fenceCatalog.materials.push(JSON.parse(JSON.stringify(WOOD_MATERIAL)))
    out.catalog = true
  }
  const real = addRealWood(st, now)
  out.styles = real.styles
  out.kits = real.kits
  out.items = real.items
  return out
}

export interface WoodRealPlan {
  state: WoodState
  /** Inventory items archived: the white vinyl parts renamed as wood (Oct 19). */
  archivedItems: string[]
  /** Kit sets archived: the ones made from vinyl kits (Oct 19). */
  archivedKits: string[]
  /** The real wood styles added to Settings. */
  addedStyles: string[]
  /** The real kit sets added (their styles). */
  addedKits: string[]
  /** New parts added to Inventory. */
  addedItems: string[]
  /** What changed in the saved choice tree, in words. */
  catalog: string[]
}

/**
 * The Oct 30 2026 change on a company's saved Settings and Inventory, once:
 *   - every Inventory item made for the Oct 19 wood (madeFor 'wood', a white
 *     vinyl part renamed as wood) archived, never deleted;
 *   - the Oct 19 wood kit sets (madeFor 'wood') archived;
 *   - the six real wood styles, their kits and their new parts added at
 *     Jonathan's costs (a part already in Inventory by name is reused);
 *   - in a saved choice tree: the three styles and the picket grades added,
 *     wood's Privacy, No dig and 6 ft panel options archived, and the wood
 *     material turned back on (the parts' prices hold it now).
 * Pure; the server runs it once per company (lib/woodSeed.ts).
 */
export function planWoodRealKits(st0: WoodState, now = new Date().toISOString()): WoodRealPlan {
  const st: WoodState = JSON.parse(JSON.stringify(st0))
  const out: WoodRealPlan = { state: st, archivedItems: [], archivedKits: [], addedStyles: [], addedKits: [], addedItems: [], catalog: [] }
  for (const i of st.items) {
    if (i.madeFor !== WOOD_OLD_TAG || i.status === 'archived') continue
    i.status = 'archived'
    out.archivedItems.push(i.name)
  }
  for (const k of st.kits) {
    if (k.madeFor !== WOOD_OLD_TAG || k.archived) continue
    k.archived = true
    k.updatedAt = now
    out.archivedKits.push(k.styleName ?? k.name)
  }
  const real = addRealWood(st, now)
  out.addedStyles = real.styles
  out.addedKits = real.kits
  out.addedItems = real.items
  const m = st.fenceCatalog?.materials?.find(x => x.key === 'wood')
  if (m) out.catalog = updateWoodMaterial(m)
  return out
}
