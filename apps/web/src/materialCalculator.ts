// apps/web/src/materialCalculator.ts
// Replicates the exact logic from EZ-Quote Hidden sheet and EZ-Quote Form
// Calculates a full bill of materials for any fence job
//
// COSTS: every part cost is read from Inventory at calculation time through
// the registered price source (see setMaterialPriceSource; inventoryStore
// registers itself on load). The dollar figure passed to add() is only a
// fallback for a part that is missing from Inventory, and any use of a
// fallback is reported back as a warning so it never happens silently.

import { sectionsForRun, calculateLinePostsPerRun } from './sectionCount'

/** Returns the Inventory unit cost for a part name, or undefined if the part
 *  is not in Inventory. */
export type MaterialPriceSource = (itemName: string) => number | undefined

let priceSource: MaterialPriceSource | null = null

/** Register (or clear) where part costs come from. Called by inventoryStore. */
export function setMaterialPriceSource(fn: MaterialPriceSource | null): void {
  priceSource = fn
}

/** Part names are matched ignoring case and whitespace, because the price
 *  book has names like "V , W, Privacy Gate 8 x 4" and trailing spaces. */
export function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

/** Build a price source from a plain name → cost map (Inventory price map). */
export function priceSourceFromMap(map: Record<string, number>): MaterialPriceSource {
  const norm = new Map<string, number>()
  for (const [name, cost] of Object.entries(map)) norm.set(normalizeItemName(name), cost)
  return (itemName: string) => norm.get(normalizeItemName(itemName))
}

/** Inventory as a price source: active items by name (ignoring case and spaces); inactive and discontinued items are left out. */
export function inventoryPriceSource(items: ReadonlyArray<{ name: string; unitCost: unknown; status?: string }>): MaterialPriceSource {
  const index = new Map<string, number>()
  for (const item of items) {
    if (item.status === 'inactive' || item.status === 'discontinued') continue
    const cost = Number(item.unitCost)
    index.set(normalizeItemName(item.name), Number.isFinite(cost) ? cost : 0)
  }
  return (itemName: string) => index.get(normalizeItemName(itemName))
}

/** Run `fn` with a different price source, then put the old one back. */
export function withPriceSource<T>(fn: MaterialPriceSource | null, run: () => T): T {
  const was = priceSource
  priceSource = fn
  try { return run() } finally { priceSource = was }
}

// ── Material kits ─────────────────────────────────────────────────────────────
// Quotes read their parts from material kits per style (materialKits.ts
// registers itself here). With no kit engine, or a style it has no kit for,
// the parts lists below are used: they are also the check the kits are tested
// against, and where the built in kits are derived from.

/** How many of each kit a job takes. */
export interface KitCounts {
  section: number
  /** Auto mix styles: sections on runs built with 8 ft rails. */
  section8: number
  line: number
  corner: number
  end: number
  /** One blank post at the center of every double gate. */
  blank: number
  /** Walk gates with no kit of their own width: 4 ft, a typed count (no width), or a width the takeoff sheet has no row for. */
  walkGate: number
  /** Double gates with no kit of their own width: 8 ft, a typed count, or a width with no sheet row. */
  dblGate: number
  /**
   * Gates by width (chain link, TAKEOFF_RULES "Walk Gate - 5'" ... "Dbl Gate - 12'"):
   * walk gates 5 or 6 ft wide, double gates 10 or 12 ft wide. A kit set with no
   * kit for one of these uses its walk gate (4 ft) / double gate (8 ft) kit.
   */
  walkGate5?: number
  walkGate6?: number
  dblGate10?: number
  dblGate12?: number
  /** 1 when the job has any gate / any walk gate / any double gate, else 0 (the sheet's anyAddOn rows: once per job). */
  anyGate?: number
  anyWalkGate?: number
  anyDblGate?: number
  perFoot: number
  perJob: number
  /** Gate widths the takeoff sheet has no row for (priced as the 4 ft / 8 ft gate), named on the quote. */
  gateNotes?: string[]
}
export interface KitLine {
  part: string; qty: number; fallbackCost: number
  /** Job lot colors only: the cost per unit is set (0 for a part a piece price covers), not read from Inventory. */
  unitCost?: number
  /** Job lot colors only: a piece price line (section, post, gate), not a part to pull or order. */
  piece?: boolean
}

/**
 * Job lot pricing for one style (a color priced by the piece from a supplier's
 * job lot quote; see fenceCatalog.ts). Prices are dollars here, converted from
 * the integer cents saved in Settings. `covers` names the parts each piece
 * price includes; those parts stay on the pull sheet at $0 and the piece is
 * charged instead, kit by kit, so a part is never charged twice.
 */
export interface StyleJobLot {
  color: string
  supplier: string
  /** YYYY-MM-DD */
  quotedOn: string
  /** Which section price a section kit uses on a locked width style (its panel width); auto mix: 6 ft rail runs use '6', 8 ft runs '8'. */
  width: number | 'auto'
  /** Price of one section by panel width in feet ('6', '8', ...). */
  sections: Record<string, number>
  corner?: number
  end?: number
  line?: number
  blank?: number
  walkGate?: number
  dblGate?: number
  covers: { section: string[]; post: string[]; walkGate: string[]; dblGate: string[] }
  /**
   * A color whose supplier sells the section as a kit (Settings → Price List →
   * Vinyl Colors, per section): the section line is this catalog item by panel
   * width ("*Vinyl, Chai Gray, Section, 6x8"), priced from Inventory, and the
   * parts it includes are listed at $0.
   */
  sectionNames?: Record<string, string>
  /**
   * Each gate leaf is built from one section kit of this width (like White's
   * gate leaf takes a 6 ft section's parts): the section line counts one per
   * walk gate and two per double gate, and the leaf's kit parts are $0.
   */
  leafWidth?: string
  /** Made by the Vinyl Colors form: sold as a section kit, no supplier job lot quote. */
  kit?: boolean
  /**
   * 8 ft tall vinyl (Jonathan, Oct 21, 2026): one price per section and one
   * per post, from the style's own prices in Settings → Price List
   * (FenceStyle.pieceCents), no supplier quote. Every part of a section kit
   * and of a post kit is covered (coversAll); gates are priced from their parts.
   */
  tall?: boolean
  /**
   * 8 ft tall: where its prices came from (fenceCatalog.ts tallPriceStatus).
   * Section: typed in Settings, or the whole 8 ft section in Inventory
   * (sectionItem). Post: typed in Settings, or its kit's parts at Inventory prices.
   */
  tallSource?: { section?: 'settings' | 'inventory'; post?: 'settings' | 'parts'; sectionItem?: string }
  /** These piece prices cover every part of their kits (no part list to tick). */
  coversAll?: Array<keyof StyleJobLot['covers']>
  /** What a piece price line starts with (default "Job lot, {color}"). */
  label?: string
}

export type KitEngine = (styleKey: string, counts: KitCounts, notes: () => string[], jobLot?: StyleJobLot) => { lines: KitLine[]; warnings: string[] } | null

let kitEngine: KitEngine | null = null
export function setKitEngine(fn: KitEngine | null): void { kitEngine = fn }

function fromKits(styleKey: string, counts: KitCounts, tearOutSections: number, tearOutGates: number, notes: () => string[], jobLot?: StyleJobLot): MaterialResult | null {
  const r = kitEngine ? (jobLot ? kitEngine(styleKey, counts, notes, jobLot) : kitEngine(styleKey, counts, notes)) : null
  if (!r) return null
  const col = makeCollector()
  col.add('Tear Out Haul-Away Fence', tearOutSections, 9.50)
  col.add('Tear Out Haul-Away Gate', tearOutGates, 27.00)
  for (const l of r.lines) {
    if (l.unitCost !== undefined) col.addSet(l.part, l.qty, l.unitCost, !!l.piece)
    else col.add(l.part, l.qty, l.fallbackCost)
  }
  col.warnings.push(...r.warnings)
  return col.finish()
}

/** The style notes the parts lists give (new or unconfirmed lists), without the Inventory warnings. */
function legacyNotes(run: () => MaterialResult): string[] {
  return withPriceSource(() => 1, run).warnings
}

/** The Inventory cost for one part, or undefined when it is not in Inventory (or no Inventory is loaded). */
export function inventoryCost(itemName: string): number | undefined {
  const inv = priceSource ? priceSource(itemName) : undefined
  return typeof inv === 'number' && Number.isFinite(inv) ? inv : undefined
}

/** Current Inventory cost for one part, with a fallback when it is missing. */
export function materialUnitCost(itemName: string, fallback = 0): number {
  const inv = priceSource ? priceSource(itemName) : undefined
  return typeof inv === 'number' && Number.isFinite(inv) ? inv : fallback
}

export interface MaterialResult {
  items: LineItem[]
  /** Gaps the estimator needs to see before quoting: parts missing from
   *  Inventory, parts carried at $0, styles with no parts list. */
  warnings: string[]
}

interface Collector {
  items: LineItem[]
  warnings: string[]
  add: (item: string, qty: number, fallbackCost?: number) => void
  /** Job lot colors: a line whose cost is set, not read from Inventory. */
  addSet: (item: string, qty: number, unitCost: number, piece: boolean) => void
  finish: () => MaterialResult
}

function makeCollector(): Collector {
  const items: LineItem[] = []
  const warnings: string[] = []
  const missing = new Set<string>()
  const zero = new Set<string>()

  function add(item: string, qty: number, fallbackCost = 0) {
    if (!(qty > 0)) return
    const inv = priceSource ? priceSource(item) : undefined
    const fromInventory = typeof inv === 'number' && Number.isFinite(inv)
    const unitCost = fromInventory ? (inv as number) : fallbackCost
    if (priceSource) {
      // Live mode: keep every part on the pull sheet even at $0 so the crew
      // still pulls it, and say why the cost is off.
      if (!fromInventory) missing.add(item)
      else if (!(unitCost > 0)) zero.add(item)
    } else if (!(unitCost > 0)) {
      return
    }
    items.push({
      item,
      qty: round2(qty),
      unitCost,
      total: round2(qty * unitCost),
      costSource: fromInventory ? 'inventory' : 'builtin',
    })
  }

  function addSet(item: string, qty: number, unitCost: number, piece: boolean) {
    if (!(qty > 0)) return
    items.push({ item, qty: round2(qty), unitCost, total: round2(qty * unitCost), costSource: 'jobLot', ...(piece ? { jobLotPiece: true } : {}) })
  }

  function finish(): MaterialResult {
    if (missing.size > 0) {
      warnings.push(
        `${missing.size} part${missing.size === 1 ? ' is' : 's are'} not in Inventory, so a built in cost was used: ${[...missing].join('; ')}. Add ${missing.size === 1 ? 'it' : 'them'} to Inventory to control the cost.`,
      )
    }
    if (zero.size > 0) {
      warnings.push(
        `${zero.size} part${zero.size === 1 ? ' is' : 's are'} in Inventory at $0.00: ${[...zero].join('; ')}.`,
      )
    }
    return { items, warnings }
  }

  return { items, warnings, add, addSet, finish }
}

export interface JobInputs {
  fenceStyle: string
  runs: number[]          // individual run lengths in feet
  corners: number         // number of corner posts
  ends: number            // number of end posts
  walkGates: number       // count of walk gates
  dblGates: number        // count of double gates
  tearOutSections: number
  tearOutGates: number
  /** A color priced by the piece (job lot). */
  jobLot?: StyleJobLot
  /** Styles made in Settings (generated names, no parts list by name): the section width their kits are counted at. */
  sectionWidth?: number
  /** Line posts beyond the runs' own (sections − 1 per run): vinyl tees from the yard layout (yardLayout.ts VINYL_TEE_POST). */
  extraLinePosts?: number
  /** Each gate's width in feet, from the yard drawing (yardLayout.ts gateWidthsOf). Used only when it has one width for every gate. */
  gateWidths?: GateWidths | null
}

/** Each gate's opening width in feet, one entry per gate. */
export interface GateWidths { walk: number[]; dbl: number[] }

/**
 * Gates by the widths the takeoff sheet has rows for (TAKEOFF_RULES chain link
 * gate rows: "Walk Gate - 4'/5'/6'", "Dbl Gate - 8'/10'/12'"; a double gate is
 * two leaves of half its width). A typed gate count has no width: a walk gate
 * is 4 ft and a double gate 8 ft (two 4 ft leaves), as the parts lists always
 * priced them. A width the sheet has no row for is priced the same way and
 * named in `notes`. Widths are used only when there is one for every gate.
 */
export function gateSizes(walkGates: number, dblGates: number, widths?: GateWidths | null): {
  walk4: number; walk5: number; walk6: number; dbl8: number; dbl10: number; dbl12: number; notes: string[]
} {
  const out = { walk4: walkGates, walk5: 0, walk6: 0, dbl8: dblGates, dbl10: 0, dbl12: 0, notes: [] as string[] }
  const ok = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every(x => typeof x === 'number' && Number.isFinite(x) && x > 0)
  if (!widths || !ok(widths.walk, walkGates) || !ok(widths.dbl, dblGates)) return out
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05
  const ft = (w: number) => `${Math.round(w * 100) / 100} ft`
  for (const w of widths.walk) {
    if (near(w, 5)) { out.walk5++; out.walk4-- }
    else if (near(w, 6)) { out.walk6++; out.walk4-- }
    else if (!near(w, 4)) out.notes.push(`a ${ft(w)} walk gate (the takeoff sheet has 4, 5 and 6 ft; priced as a 4 ft gate)`)
  }
  for (const w of widths.dbl) {
    if (near(w, 10)) { out.dbl10++; out.dbl8-- }
    else if (near(w, 12)) { out.dbl12++; out.dbl8-- }
    else if (!near(w, 8)) out.notes.push(`a ${ft(w)} double gate (the takeoff sheet has 8, 10 and 12 ft; priced as an 8 ft gate, two 4 ft leaves)`)
  }
  return out
}

/** The gate part of a job's kit counts: gates by width, and the once per job flags. */
export function gateCounts(walkGates: number, dblGates: number, widths?: GateWidths | null): Pick<KitCounts, 'walkGate' | 'dblGate' | 'walkGate5' | 'walkGate6' | 'dblGate10' | 'dblGate12' | 'anyGate' | 'anyWalkGate' | 'anyDblGate' | 'gateNotes'> {
  const g = gateSizes(walkGates, dblGates, widths)
  return {
    walkGate: g.walk4, dblGate: g.dbl8, walkGate5: g.walk5, walkGate6: g.walk6, dblGate10: g.dbl10, dblGate12: g.dbl12,
    anyGate: walkGates + dblGates > 0 ? 1 : 0, anyWalkGate: walkGates > 0 ? 1 : 0, anyDblGate: dblGates > 0 ? 1 : 0,
    ...(g.notes.length ? { gateNotes: g.notes } : {}),
  }
}

export interface LineItem {
  item: string
  qty: number
  unitCost: number
  total: number
  /** Where unitCost came from. Absent on quotes saved before this field.
   *  'jobLot': a color priced by the piece: a part a piece price covers ($0
   *  here, its cost is in the piece line) or the piece line itself. */
  costSource?: 'inventory' | 'builtin' | 'jobLot' | 'wood'
  /** A job lot piece price line (section, post, gate): money only, not a part to pull or order. */
  jobLotPiece?: boolean
  /** Money only, not a part to pull or order: wood's material (white vinyl × the Wood factor, wood.ts). Wood parts themselves are listed at $0 ('wood'). */
  moneyOnly?: boolean
}

// ── Section width and count per run ───────────────────────────────────────────
// Matches EZ-Quote Form C10:C24 formulas exactly. Per-run, never total/panel.
// Vinyl and aluminum names read height x width: 6'x8' is 6 tall, 8 wide.
function panelLengthForStyle(style: string): number {
  if (isChainlink(style)) return 10
  // 8 ft tall privacy: the section width is the second number in the name
  // (8'x6' = 8 tall, 6 wide).
  const tall = vinyl8Tall(style)
  if (tall) return tall.width
  // 6 tall, 8 wide: 8' rails, 15 pickets and an insert per section.
  if (isVinyl6x8(style)) return 8
  // Industrial Abigail is bought as 6' x 8' sections (6 tall, 8 wide).
  if (isAlumIndAbigail(style)) return 8
  if (is8Wide(style) || isDurafence(style)) return 8
  // 6ft wide: vinyl 6x6, Bell 4'x6', Aluminum Emily
  return 6
}

/**
 * Section width in feet for a fence style. The one width used everywhere a
 * section is counted: the quote builder, bundles, the quote drawer and the
 * pull sheet. A style with a parts list gets the width its parts are bought
 * at; any other style uses the width saved for it in Settings.
 */
export function sectionWidthForStyle(styleName: string, savedWidth?: number): number {
  if (styleHasPartsList(styleName) || isDurafence(styleName)) return panelLengthForStyle(styleName)
  return typeof savedWidth === 'number' && savedWidth > 0 ? savedWidth : 6
}

function sectionsPerRun(ft: number, style: string): number {
  return sectionsForRun(ft, panelLengthForStyle(style))
}

function totalSections(runs: number[], style: string): number {
  return runs.reduce((sum, ft) => sum + sectionsPerRun(ft, style), 0)
}

// ── Line posts per run ────────────────────────────────────────────────────────
// Matches Hidden!H32:H46 — each run contributes (sections - 1) line posts
function totalLinePosts(runs: number[], style: string): number {
  const perRun = runs.map(ft => sectionsPerRun(ft, style))
  return calculateLinePostsPerRun(perRun).reduce((s, n) => s + n, 0)
}

// ── Style classification helpers ──────────────────────────────────────────────
function isVinylWhiteND(s: string) {
  return s === "WV-ND 6'x6' Privacy" || s === "WV-ND 6'x8' Privacy" ||
         s === "WV-ND Bell 4'x6'"
}
function isVinylWhiteDS(s: string) {
  return s === "WV-DS 6'x6' Privacy" || s === "WV-DS 6'x8' Privacy"
}
function isVinylTanND(s: string) {
  return s === "TV-ND 6'x6' Privacy" || s === "TV-ND 6'x8' Privacy"
}
function isVinylTanDS(s: string) {
  return s === "TV-DS 6'x6' Privacy" || s === "TV-DS 6'x8' Privacy"
}
function isVinyl6x6(s: string) {
  return s.includes("6'x6'") || s.includes("Bell")
}
function isVinyl6x8(s: string) { return s.includes("6'x8'") }
function isVinyl8x6(s: string) { return s.includes("8'x6'") }
function isVinyl8x8(s: string) { return s.includes("8'x8'") }
function isVinylND(s: string) { return s.startsWith("WV-ND") || s.startsWith("TV-ND") }
function isChainlinkGalv(s: string) {
  return s === "CL - 4' Galv" || s === "CL - 5' Galv" || s === "CL - 6' Galv"
}
function isChainlinkBlack(s: string) {
  return s === "CL - 4' Black" || s === "CL - 5' Black" || s === "CL - 6' Black"
}
function isChainlink(s: string) {
  return s.startsWith("CL -")
}
function isCommercial(s: string) {
  return s.includes("Com 6'")
}
function isAlumND(s: string) { return s === "Alum - ND - Emily - 48" }
function isAlumDS(s: string) { return s === "Alum - DS - Emily - 48" }
function isAlumAlum(s: string) { return s.startsWith("Alum") }
function is8Wide(s: string) {
  return s.includes("8'x6'") || s.includes("8'x8'") || s === "Durafence"
}
function isDurafence(s: string) { return s === "Durafence" }
function isAlumIndAbigail(s: string) { return s.includes('Ind Abigail') }
/**
 * One 8 ft tall vinyl privacy section, every color, no dig and dig set
 * (Jonathan, Oct 21, 2026), by panel width: top and bottom rails and a mid
 * rail of the panel's width, 4 ft pickets, 4 ft U channels, and on an 8 ft
 * wide panel two rail inserts (White's "Vinyl, Rail Insert, 8'", shared by
 * every color). The section's piece price covers them all.
 */
export const TALL_VINYL_SECTION: Record<6 | 8, { rails: number; midRails: number; pickets: number; uChannels: number; railInserts: number }> = {
  6: { rails: 2, midRails: 1, pickets: 22, uChannels: 4, railInserts: 0 },
  8: { rails: 2, midRails: 1, pickets: 30, uChannels: 4, railInserts: 2 },
}
/** The catalog items of an 8 ft tall section, by color ("White", "Tan", "Chai Gray"). */
export const TALL_PART_NAME = {
  rail: (color: string, width: number | string) => `*Vinyl, ${color}, Rail, ${width}'`,
  midRail: (color: string, width: number | string) => `*Vinyl, ${color}, Mid Rail, ${width}'`,
  picket: (color: string) => `*Vinyl, ${color}, Picket, 4'`,
  uChannel: (color: string) => `*Vinyl, ${color}, U Channel, 4'`,
}
export const TALL_RAIL_INSERT = "Vinyl, Rail Insert, 8'"

/** 8 ft tall vinyl privacy ("WV-ND 8'x6' Privacy"): color, install, width. */
function vinyl8Tall(s: string): { white: boolean; noDig: boolean; width: 6 | 8 } | null {
  const m = s.match(/^(WV|TV)-(ND|DS) 8'x([68])'/)
  if (!m) return null
  return { white: m[1] === 'WV', noDig: m[2] === 'ND', width: m[3] === '8' ? 8 : 6 }
}

/**
 * White's and Tan's whole 8 ft tall section in Inventory ("V , W, Picket
 * Section 8' x 6' Privacy"): the section's price when no section price is
 * typed in Settings → Price List → 8 ft tall vinyl (fenceCatalog.ts
 * tallPriceStatus). Its parts stay on the pull sheet at $0.
 */
export function tallWholeSectionItem(styleName: string): string | undefined {
  const t = vinyl8Tall(styleName)
  return t ? `${t.white ? 'V , W' : 'V , T'}, Picket Section 8' x ${t.width}' Privacy` : undefined
}

/** Whether the calculator has a parts list for this style name. */
export function styleHasPartsList(s: string): boolean {
  return isVinylWhiteND(s) || isVinylWhiteDS(s) || isVinylTanND(s) || isVinylTanDS(s)
    || !!vinyl8Tall(s) || isChainlinkGalv(s) || isChainlinkBlack(s) || isCommercial(s)
    || isAlumND(s) || isAlumDS(s) || isAlumIndAbigail(s)
}

function clHeight(s: string): 4 | 5 | 6 {
  if (s.includes("4'")) return 4
  if (s.includes("5'")) return 5
  return 6
}

/** TAKEOFF_RULES gate leaf costs (workbook), by finish, fence height and leaf width: only the fallback when Inventory has no price. */
const CHAIN_GATE_COST: Record<'galv' | 'black', Record<4 | 5 | 6, Record<4 | 5 | 6, number>>> = {
  galv: { 4: { 4: 85.00, 5: 90.28, 6: 99.51 }, 5: { 4: 88.85, 5: 102.45, 6: 115.67 }, 6: { 4: 114.86, 5: 130.08, 6: 146.41 } },
  black: { 4: { 4: 123.95, 5: 133.69, 6: 143.42 }, 5: { 4: 138.46, 5: 173.51, 6: 194.50 }, 6: { 4: 154.66, 5: 175.27, 6: 197.35 } },
}

/**
 * Chain link gates and their hardware, row by row from TAKEOFF_RULES.md
 * (Jonathan, Oct 26, 2026: "Chain link: follow the sheet"; docs/DECISIONS.md):
 *
 *   Chainlink, {Galv|Black}, Gate, 1-3/8", {h}' x {w}'
 *                       1 per walk gate {w} ft, 2 per double gate {2w} ft
 *                       (walk 4/5/6 ft, double 8/10/12 ft = two 4/5/6 ft leaves;
 *                       no width known = 4 ft walk, 8 ft double, see gateSizes)
 *   Hinge, Female       2 per walk gate, 6 per double gate
 *   Hinge, Male         2 per walk gate, 4 per double gate
 *   Fork, PS, 1-3/8"    1 per job with any double gate   anyAddOn(["Dbl Gate - ..."])
 *   Fork, PS, 2-1/2"    1 per job with any walk gate     anyAddOn(["Walk Gate - ..."])
 *   Collar (Set of 2)   1 per job with any gate          anyAddOn([every gate])
 *   Drop rod            1 per job with any double gate: galvanized "G, Drop Rod, 24"",
 *                       black 4 and 5 ft "Drop Rod, 24", Black", black 6 ft
 *                       "Drop Rod, 48", Black", commercial "Comm, G, Com Drop Rod Assy."
 *   Bolt, 3/8" x 3"     2*gateCount: 2 per walk gate, 4 per double gate
 *   Bolt, 3/8" x 2"     the sheet's cell is an unresolved reference ($C$132 / $C$142):
 *                       kept as the parts list had it (2 per walk gate; commercial
 *                       2 per end post) until Jonathan gives the count.
 *
 * Commercial has no gate leaf row on the sheet, so no gate leaf is listed (as before).
 */
function chainLinkGates(
  add: (item: string, qty: number, fallbackCost?: number) => void,
  finish: 'galv' | 'black' | 'commercial', h: 4 | 5 | 6, walkGates: number, dblGates: number, widths?: GateWidths | null,
): void {
  const g = gateSizes(walkGates, dblGates, widths)
  const gateCount = walkGates + dblGates * 2
  const anyGate = walkGates + dblGates > 0 ? 1 : 0, anyWalk = walkGates > 0 ? 1 : 0, anyDbl = dblGates > 0 ? 1 : 0
  if (finish !== 'commercial') {
    const leaf = (w: 4 | 5 | 6) => finish === 'galv'
      ? `Chainlink, Galv, Gate, 1-3/8", ${h}' x ${w}' (.055)`
      : `Chainlink, Black, Gate, 1-3/8", ${h}' x ${w}' (.065)`
    add(leaf(4), g.walk4 + g.dbl8 * 2, CHAIN_GATE_COST[finish][h][4])
    add(leaf(5), g.walk5 + g.dbl10 * 2, CHAIN_GATE_COST[finish][h][5])
    add(leaf(6), g.walk6 + g.dbl12 * 2, CHAIN_GATE_COST[finish][h][6])
  }
  const black = finish === 'black'
  add(black ? 'Black, Hinge, Female, 1-3/8" x 5/8"' : 'G, Hinge, Female, 1-3/8" x 5/8"', walkGates * 2 + dblGates * 6, black ? 1.24 : 0.83)
  add(black ? 'Black, Hinge, Male, 2-3/8"' : 'G, Hinge, Male, PS, 2-3/8"', walkGates * 2 + dblGates * 4, black ? 2.01 : 0.83)
  add(black ? 'Black, Fork, PS, 1-3/8"' : 'G, Fork, PS, 1-3/8"', anyDbl, black ? 1.53 : 1.18)
  add(black ? 'Black, Fork, PS, 2-1/2"' : 'G, Fork, PS, 2-1/2"', anyWalk, black ? 1.98 : 1.53)
  add(black ? 'Black, Collar, PS, 1-3/8" (Set of 2)' : 'G, Collar, PS, 1-3/8" (Set of 2)', anyGate, black ? 1.63 : 1.29)
  if (finish === 'galv') add('G, Drop Rod, 24"', anyDbl, 6.88)
  else if (finish === 'black') add(h === 6 ? 'Drop Rod, 48", Black' : 'Drop Rod, 24", Black', anyDbl, h === 6 ? 48.01 : 30.48)
  else add('Comm, G, Com Drop Rod Assy.', anyDbl, 21.25)
  if (finish !== 'commercial') add(black ? 'Black, Bolt, 3/8" x 2" w/ Nut' : 'G, Bolt, 3/8" x 2" w/ Nut', walkGates * 2, black ? 0.41 : 0.34)
  add(black ? 'Black, Bolt, 3/8" x 3" w/ Nut' : 'G, Bolt, 3/8" x 3" w/ Nut', gateCount * 2, black ? 0.53 : 0.41)
}

/**
 * Residential chain link hook ties per section (Jonathan, Oct 2026): 3 on the
 * line post at 4 ft tall plus 1 for every foot of extra height, and 6 on the
 * top rail between line posts: 9 at 4 ft, 10 at 5 ft, 11 at 6 ft. Sections
 * are counted per run (10 ft max), so a run has line posts + 1 sections.
 * Until Oct 2026 ties were counted 5 per foot plus (height - 1) per line post.
 * Commercial chain link keeps its own count.
 */
export function chainHookTiesPerSection(h: number): number {
  return 3 + (h - 4) + 6
}
/** Hook ties come in boxes of 100: the job's ties, rounded up to whole boxes once per job. */
function chainHookTieBoxes(sections: number, h: number): number {
  return Math.ceil(sections * chainHookTiesPerSection(h) / 100)
}

// ── Fabric rolls ──────────────────────────────────────────────────────────────
// Chainlink fabric: total footage / 50 feet per roll, ceiling
function fabricRolls(totalFt: number): number {
  return Math.ceil(totalFt / 50)
}
function totalFt(runs: number[]): number {
  return runs.reduce((s, r) => s + r, 0)
}

// ── Main material calculator ──────────────────────────────────────────────────
export function calculateMaterials(inputs: JobInputs): LineItem[] {
  return calculateMaterialsDetailed(inputs).items
}

/** Same as calculateMaterials, plus the warnings the estimator should see. Parts come from the style's material kits. */
export function calculateMaterialsDetailed(inputs: JobInputs): MaterialResult {
  const { fenceStyle: s, runs, corners, ends, walkGates, dblGates } = inputs
  const w = inputs.sectionWidth
  const perRun = w ? runs.map(ft => sectionsForRun(ft, w)) : null
  const counts: KitCounts = {
    section: perRun ? perRun.reduce((t, n) => t + n, 0) : totalSections(runs, s), section8: 0,
    line: (perRun ? calculateLinePostsPerRun(perRun).reduce((t, n) => t + n, 0) : totalLinePosts(runs, s)) + extraLines(inputs.extraLinePosts), corner: corners, end: ends,
    blank: dblGates, ...gateCounts(walkGates, dblGates, inputs.gateWidths), perFoot: totalFt(runs), perJob: 1,
  }
  return fromKits(s, counts, inputs.tearOutSections, inputs.tearOutGates, () => legacyNotes(() => legacyCalculateMaterialsDetailed(inputs)), inputs.jobLot)
    ?? legacyCalculateMaterialsDetailed(inputs)
}

/** The parts lists as they were before material kits: the test check, and where the built in kits come from. */
export function legacyCalculateMaterialsDetailed(inputs: JobInputs): MaterialResult {
  const { fenceStyle: s, runs, corners, ends, walkGates, dblGates,
          tearOutSections, tearOutGates } = inputs

  const sections = totalSections(runs, s)
  const linePosts = totalLinePosts(runs, s) + extraLines(inputs.extraLinePosts)
  const totalFootage = totalFt(runs)
  const totalPostCount = corners + ends + linePosts
  // blank posts = double gate count (posts between double gate panels)
  const blankPosts = dblGates

  const col = makeCollector()
  const { add, warnings } = col

  // ── Tear-out ────────────────────────────────────────────────────────────────
  add('Tear Out Haul-Away Fence', tearOutSections, 9.50)
  add('Tear Out Haul-Away Gate', tearOutGates, 27.00)

  if (!styleHasPartsList(s)) {
    warnings.push(
      `"${s}" has no parts list, so no fence material is included. Set the price by hand or use a per foot price.`,
    )
    return col.finish()
  }

  // ── VINYL WHITE NO-DIG (WV-ND) ──────────────────────────────────────────────
  // All formulas verified against EZ-Quote PDF (1-section and 31-section jobs)
  if (isVinylWhiteND(s)) {
    const totalGatePanels = walkGates + dblGates * 2  // each dbl gate = 2 panels
    const allPosts = totalPostCount + blankPosts        // includes blank posts between dbl panels

    // Posts
    add("*Vinyl, White, Post, Corner, 5\" x 5\" x 78\"", corners, 11.17)
    add("*Vinyl, White, Post, End, 5\" x 5\" x 78\"", ends, 11.17)
    add("*Vinyl, White, Post, Line, 5\" x 5\" x 78\"", linePosts, 11.17)
    add("*Vinyl, White, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 13.64)

    // ND donuts: 2 per non-blank post
    add('ND, Donut', totalPostCount * 2, 3.19)
    // PT40 pipe: 1 per non-blank post
    add("Pipe, PT40, Galv, 2-1/2\" x 8'", totalPostCount, 19.50)

    // Panel goods: sections + all gate panels
    const panelCount = sections + totalGatePanels
    if (isVinyl6x6(s)) {
      add("*Vinyl, White, Picket, 62-1/4\"", panelCount * 11, 2.71)
      add("*Vinyl, White, Rail, 6'", panelCount * 2, 5.98)
      add("*Vinyl, White, U-Trim, 59-1/4\"", panelCount * 2, 1.62)
    }
    if (isVinyl6x8(s)) {
      add("*Vinyl, White, Picket, 62-1/4\"", panelCount * 15, 2.71)
      add("*Vinyl, White, Rail, 8'", panelCount * 2, 9.26)
      add("*Vinyl, White, U-Trim, 59-1/4\"", panelCount * 2, 1.62)
      add("Vinyl, Rail Insert, 8'", panelCount, 8.00)
    }

    // Concrete: 1 bag per double gate (removable center post)
    add("Misc, Concrete", dblGates, 6.25)
    // Hardware per all posts (including blank)
    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", allPosts * 3, 0.123)
    add("**Vinyl, Donut Pin", allPosts * 4, 0.10)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", panelCount * 6, 0.03)
    add("*Vinyl, White, Cap, 5\"x5\"", allPosts, 1.00)

    // Gate hardware
    // Handles & latches: dbl gate = 2 panels = 2 openings each
    const gateOpenings = walkGates + dblGates * 2
    if (gateOpenings > 0) {
      add("*Vinyl, Gate, Handle", gateOpenings * 2, 5.98)
    }
    // Bell 4'x6' gates (TAKEOFF_RULES rows that list "WV-ND Bell 4'x6'"; Jonathan, Oct 21, 2026:
    // "A Bell gate is built from a gate kit (hardware and uprights) plus one fence section"):
    // each leaf takes one section of the parts above (panelCount, the "Misc, 6' Section" row
    // gateCount + totalSections, priced as 6'x6' privacy for now), one "Misc, Gate Kit, No Hardware"
    // ("One kit builds one leaf": 1 per walk gate, 2 per double gate; Jonathan's correction to the
    // sheet's gateCount*2, docs/DECISIONS.md), and the shared vinyl gate rows: handle, H-beam 6',
    // brace, hinge, latch, upright, rivet. The Bell is not in the P-channel, gate cap, H-beam hex or
    // H-beam 8' rows.
    const bell = s === "WV-ND Bell 4'x6'"
    if (bell && gateOpenings > 0) add("Misc, Gate Kit, No Hardware", gateOpenings, 57.00)
    // Walk gate hardware
    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add("*Vinyl, Gate, Brace", walkGates, 36.37)
      add("*Vinyl, Gate, Hinge", walkGates, 29.03)
      add("*Vinyl, Gate, Latch", walkGates, 20.46)
      if (!bell) add("*Vinyl, White, Cap, Gate", walkGates * 2, 1.00)
      add("*Vinyl, White, Upright", walkGates * 2, 8.75)
      if (!bell) add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      if (!bell) add("*Vinyl, Hex, 1/4 x 3/4\" (H-Beam)", walkGates * 6, 0.05)
      add("*Vinyl, White, Rivet, 1\"", walkGates * 50, 0.12)
    }
    // Double gate hardware — each dbl gate = 2 panels
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", dblGates * 2, 22.80)
      if (!bell) add("*Vinyl, Gate, H-Beam, 8'", dblGates, 29.60)
      add("*Vinyl, Gate, Brace", dblGates * 2, 36.37)
      add("*Vinyl, Gate, Hinge", dblGates * 2, 29.03)
      add("*Vinyl, Gate, Latch", dblGates * 2, 20.46)
      if (!bell) add("*Vinyl, White, Cap, Gate", dblGates * 4, 1.00)
      add("*Vinyl, White, Upright", dblGates * 4, 8.75)
      if (!bell) add("*Vinyl, Gate, P-Channel, 6'", dblGates * 2, 12.30)
      if (!bell) add("*Vinyl, Hex, 1/4 x 3/4\" (H-Beam)", dblGates * 12, 0.05)
      add("*Vinyl, White, Rivet, 1\"", dblGates * 100, 0.12)
    }
  }

  // ── VINYL TAN NO-DIG (TV-ND) ────────────────────────────────────────────────
  if (isVinylTanND(s)) {
    add("*Vinyl, Tan, Post, Corner, 5\" x 5\" x 78\"", corners, 12.90)
    add("*Vinyl, Tan, Post, End, 5\" x 5\" x 78\"", ends, 12.90)
    add("*Vinyl, Tan, Post, Line, 5\" x 5\" x 78\"", linePosts, 12.90)
    add("*Vinyl, Tan, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 16.38)
    // 2 per post, as on white. The blank post is set in concrete and is not in
    // totalPostCount, so nothing more comes off for a double gate (the old
    // "- blankPosts * 2" took it off twice; Jonathan, Oct 2026).
    add('ND, Donut', totalPostCount * 2, 3.19)
    add("Pipe, PT40, Galv, 2-1/2\" x 8'", corners + ends + linePosts, 19.50)

    // Panel goods: sections plus every gate leaf (a double gate is two leaves).
    const tanPanels = sections + walkGates + dblGates * 2
    if (isVinyl6x6(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanPanels * 11, 3.22)
      add("*Vinyl, Tan, Rail, 6'", 2 * tanPanels, 7.98)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanPanels, 1.85)
    }
    if (isVinyl6x8(s)) {
      // 15 pickets per 8 ft wide section, as White and Chai Gray (Jonathan, Oct 21, 2026; was 16).
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanPanels * 15, 3.22)
      add("*Vinyl, Tan, Rail, 8'", 2 * tanPanels, 10.18)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanPanels, 1.85)
      add("Vinyl, Rail Insert, 8' ", tanPanels, 8.00)
    }

    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 3, 0.123)
    add("**Vinyl, Donut Pin", totalPostCount * 4, 0.10)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * tanPanels, 0.03)
    add("Vinyl, Tan, Cap, 5\"x5\"", totalPostCount, 1.00)

    // TAKEOFF_RULES "*Vinyl, Gate, Handle": gateCount*2, a double gate counting as two (Jonathan, Oct 20, 2026).
    add("*Vinyl, Gate, Handle", (walkGates + dblGates * 2) * 2, 5.98)

    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add("*Vinyl, Gate, Brace", walkGates, 36.37)
      add("*Vinyl, Gate, Hinge", walkGates, 29.03)
      add("*Vinyl, Gate, Latch", walkGates, 20.46)
      add("Vinyl, Tan, Cap, Gate", walkGates * 2, 1.00)
      add("*Vinyl, Tan, Upright", walkGates, 9.69)
      add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      add("*Vinyl, Tan, Rivet, 1\"", walkGates * 50, 0.20)
    }
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 8'", dblGates, 29.60)
      add("*Vinyl, Gate, Brace", dblGates * 2, 36.37)
      add("*Vinyl, Gate, Hinge", dblGates * 2, 29.03)
      add("*Vinyl, Gate, Latch", dblGates, 20.46)
      add("Vinyl, Tan, Cap, Gate", dblGates * 4, 1.00)
      add("*Vinyl, Tan, Upright", dblGates * 2, 9.69)
      add("*Vinyl, Tan, Rivet, 1\"", dblGates * 100, 0.20)
    }
  }

  // ── VINYL WHITE DIG-SET (WV-DS) ─────────────────────────────────────────────
  if (isVinylWhiteDS(s)) {
    // DS uses 102" (taller) posts set in concrete
    add("*Vinyl, White, Post, Corner, 5\" x 5\" x 102\"", corners, 13.64)
    add("*Vinyl, White, Post, End, 5\" x 5\" x 102\"", ends, 13.64)
    add("*Vinyl, White, Post, Line, 5\" x 5\" x 102\"", linePosts, 17.49)
    add("*Vinyl, White, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 13.64)
    // TAKEOFF_RULES "Misc, Concrete", WV-DS row: ceil(postCount+blankPosts+2*dblGates+2*walkGates)
    // (2 bags per walk gate added Oct 20, 2026, Jonathan: follow TAKEOFF_RULES).
    add('Misc, Concrete',
      Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2 + walkGates * 2), 6.25)

    // Panel goods: sections plus every gate leaf (a double gate is two leaves).
    const dsPanels = sections + walkGates + dblGates * 2
    if (isVinyl6x6(s)) {
      add("*Vinyl, White, Picket, 62-1/4\"", dsPanels * 11, 2.71)
      add("*Vinyl, White, Rail, 6'", 2 * dsPanels, 5.98)
      add("*Vinyl, White, U-Trim, 59-1/4\"", 2 * dsPanels, 1.62)
    }
    if (isVinyl6x8(s)) {
      add("*Vinyl, White, Picket, 62-1/4\"", dsPanels * 15, 2.71)
      add("*Vinyl, White, Rail, 8'", 2 * dsPanels, 9.26)
      add("*Vinyl, White, U-Trim, 59-1/4\"", 2 * dsPanels, 1.62)
      add("Vinyl, Rail Insert, 8' ", dsPanels, 8.00)
    }

    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 2, 0.123)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * dsPanels, 0.03)
    add("*Vinyl, White, Cap, 5\"x5\"", totalPostCount, 1.00)

    // TAKEOFF_RULES "*Vinyl, Gate, Handle": gateCount*2, a double gate counting as two (Jonathan, Oct 20, 2026).
    add("*Vinyl, Gate, Handle", (walkGates + dblGates * 2) * 2, 5.98)

    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add("*Vinyl, Gate, Brace", walkGates, 36.37)
      add("*Vinyl, Gate, Hinge", walkGates, 29.03)
      add("*Vinyl, Gate, Latch", walkGates, 20.46)
      add("*Vinyl, White, Cap, Gate", walkGates * 2, 1.00)
      add("*Vinyl, White, Upright", walkGates, 8.75)
      add("*Vinyl, White, Rivet, 1\"", walkGates * 50, 0.12)
    }
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 8'", dblGates * 3, 29.60)
      add("*Vinyl, Gate, Brace", dblGates * 2, 36.37)
      add("*Vinyl, Gate, Hinge", dblGates * 2, 29.03)
      add("*Vinyl, Gate, Latch", dblGates, 20.46)
      add("*Vinyl, White, Cap, Gate", dblGates * 4, 1.00)
      add("*Vinyl, White, Upright", dblGates * 2, 8.75)
      add("*Vinyl, White, Rivet, 1\"", dblGates * 100, 0.12)
    }
  }

  // ── VINYL TAN DIG-SET (TV-DS) ───────────────────────────────────────────────
  // Mirrors the white dig-set list with the tan parts. This style had no parts
  // list before, so it quoted with $0 material.
  if (isVinylTanDS(s)) {
    add("*Vinyl, Tan, Post, Corner, 5\" x 5\" x 102\"", corners, 19.24)
    add("*Vinyl, Tan, Post, End, 5\" x 5\" x 102\"", ends, 19.24)
    add("*Vinyl, Tan, Post, Line, 5\" x 5\" x 102\"", linePosts, 19.24)
    add("*Vinyl, Tan, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 16.38)
    // TAKEOFF_RULES "Misc, Concrete", TV-DS row: ceil(postCount+blankPosts+2*dblGates+2*walkGates)
    // (2 bags per walk gate added Oct 20, 2026, Jonathan: follow TAKEOFF_RULES).
    add('Misc, Concrete',
      Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2 + walkGates * 2), 6.25)

    const tanDsPanels = sections + walkGates + dblGates * 2
    if (isVinyl6x6(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanDsPanels * 11, 3.22)
      add("*Vinyl, Tan, Rail, 6'", 2 * tanDsPanels, 7.98)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanDsPanels, 1.85)
    }
    if (isVinyl6x8(s)) {
      // 15 pickets per 8 ft wide section (Jonathan, Oct 21, 2026; was 16).
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanDsPanels * 15, 3.22)
      add("*Vinyl, Tan, Rail, 8'", 2 * tanDsPanels, 10.18)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanDsPanels, 1.85)
      add("Vinyl, Rail Insert, 8' ", tanDsPanels, 8.00)
    }

    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 2, 0.123)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * tanDsPanels, 0.03)
    add("Vinyl, Tan, Cap, 5\"x5\"", totalPostCount, 1.00)

    // TAKEOFF_RULES "*Vinyl, Gate, Handle": gateCount*2, a double gate counting as two (Jonathan, Oct 20, 2026).
    add("*Vinyl, Gate, Handle", (walkGates + dblGates * 2) * 2, 5.98)

    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add("*Vinyl, Gate, Brace", walkGates, 36.37)
      add("*Vinyl, Gate, Hinge", walkGates, 29.03)
      add("*Vinyl, Gate, Latch", walkGates, 20.46)
      add("Vinyl, Tan, Cap, Gate", walkGates * 2, 1.00)
      // TAKEOFF_RULES "*Vinyl, Tan, Upright": 2 per walk gate; "*Vinyl, Gate, P-Channel, 6'": 1 per walk gate.
      add("*Vinyl, Tan, Upright", walkGates * 2, 9.69)
      add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      add("*Vinyl, Tan, Rivet, 1\"", walkGates * 50, 0.20)
    }
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 8'", dblGates * 3, 29.60)
      add("*Vinyl, Gate, Brace", dblGates * 2, 36.37)
      add("*Vinyl, Gate, Hinge", dblGates * 2, 29.03)
      // TAKEOFF_RULES "*Vinyl, Gate, Latch": 2 per double gate; "*Vinyl, Tan, Upright": 4 per
      // double gate; "*Vinyl, Gate, P-Channel, 6'": 2 per double gate (Jonathan, Oct 20, 2026).
      add("*Vinyl, Gate, Latch", dblGates * 2, 20.46)
      add("Vinyl, Tan, Cap, Gate", dblGates * 4, 1.00)
      add("*Vinyl, Tan, Upright", dblGates * 4, 9.69)
      add("*Vinyl, Gate, P-Channel, 6'", dblGates * 2, 12.30)
      add("*Vinyl, Tan, Rivet, 1\"", dblGates * 100, 0.20)
    }
    warnings.push('Tan dig set uses the white dig set parts list with tan parts. Check the pull sheet against how you build it.')
  }

  // ── VINYL 8 FT TALL PRIVACY (WV/TV, ND/DS, 8'x6' and 8'x8') ──────────────────
  // 8 ft privacy posts and complete 8 x 4 gates. Each section's parts are
  // listed (Jonathan, Oct 21, 2026; TALL_VINYL_SECTION): they and the posts'
  // parts are covered by the style's section and post piece prices
  // (fenceCatalog.ts tallJobLot), so the pull sheet shows them at $0. Until
  // Oct 21, 2026 a section was one assembled "Picket Section 8' x 6'" item.
  const tall = vinyl8Tall(s)
  if (tall) {
    const V = tall.white ? 'V , W' : 'V , T'
    const C = tall.white ? 'White' : 'Tan'
    const postCost = tall.white ? 24.56 : 27.50
    const sec = TALL_VINYL_SECTION[tall.width]
    add(TALL_PART_NAME.rail(C, tall.width), sections * sec.rails, tall.white ? (tall.width === 8 ? 9.26 : 5.98) : (tall.width === 8 ? 10.18 : 7.98))
    add(TALL_PART_NAME.midRail(C, tall.width), sections * sec.midRails, 0)
    add(TALL_PART_NAME.picket(C), sections * sec.pickets, 0)
    add(TALL_PART_NAME.uChannel(C), sections * sec.uChannels, 0)
    add(TALL_RAIL_INSERT, sections * sec.railInserts, 8.00)
    add(`${V}, Post, 8' Privacy, CP, 5" x 5"`, corners, postCost)
    add(`${V}, Post, 8' Privacy, EP, 5" x 5"`, ends, postCost)
    add(`${V}, Post, 8' Privacy, LP, 5" x 5"`, linePosts, postCost)
    add(tall.white ? '*Vinyl, White, Cap, 5"x5"' : 'Vinyl, Tan, Cap, 5"x5"', totalPostCount, 1.00)

    if (tall.noDig) {
      add('ND, Donut', totalPostCount * 2, 3.19)
      add("Pipe, PT40, Galv, 2-1/2\" x 8'", totalPostCount, 19.50)
    } else {
      // Taller post, deeper hole: 2 bags per post. Walk gates take 2 bags each too
      // (TAKEOFF_RULES "Misc, Concrete" WV-DS / TV-DS row: white on Oct 20, 2026, tan
      // 8'x6' and 8'x8' the same day; Jonathan).
      add('Misc, Concrete', totalPostCount * 2 + walkGates * 2, 6.25)
    }

    const gateLeaves = walkGates + dblGates * 2
    add(`${V}, Privacy Gate 8 x 4`, gateLeaves, tall.white ? 399.00 : 458.00)
    add('*Vinyl, Gate, Hinge', gateLeaves, 29.03) // a pair of hinges per leaf (Jonathan, Oct 25, 2026: hinges come as a pair; 2 per leaf at every height)
    add('*Vinyl, Gate, Latch', walkGates + dblGates, 20.46)
    add('*Vinyl, Gate, Handle', gateLeaves * 2, 5.98)
    add(tall.white ? '*Vinyl, White, Cap, Gate' : 'Vinyl, Tan, Cap, Gate', gateLeaves * 2, 1.00)
    warnings.push(
      `8 ft privacy parts list is new and unconfirmed: 8' x ${tall.width}' sections from their parts, 8 ft posts${tall.noDig ? ", the same 8' no dig pipe as 6 ft fence" : ', 2 bags of concrete per post'}, and 4 ft wide gate leaves. Check the pull sheet before you quote.`,
    )
  }

  // ── CHAINLINK GALVANIZED ─────────────────────────────────────────────────────
  if (isChainlinkGalv(s)) {
    const h = clHeight(s)
    const fabricKey = h === 4
      ? "Fabric, Galv, 48\" KK (11.5)"
      : h === 5
      ? "Fabric, Galv, 60\" KK (11.5)"
      : "Fabric, Galv, 72\" KK (11.5)"
    const fabricCost = h === 4 ? 113.43 : h === 5 ? 137.50 : 166.37
    add(fabricKey, fabricRolls(totalFootage), fabricCost)

    // Line posts: 1-5/8" Schedule 40 (SS40) pipe, one per line post
    // (TAKEOFF_RULES: linePosts). Chain link sections are 10 ft, so each run
    // has ceil(run / 10) - 1 line posts, evenly spaced. Until Oct 2026 this
    // pipe was counted per end post, so line posts had no pipe.
    const linePipeCost = h === 4 ? 16.49 : h === 5 ? 18.55 : 20.61
    const linePipeKey = h === 4
      ? "Pipe, Galv, 1-5/8\" X 8' (SS40)"
      : h === 5
      ? "Pipe, Galv, 1-5/8\" X 9' (SS40)"
      : "Pipe, Galv, 1-5/8\" X 10' (SS40)"
    add(linePipeKey, linePosts, linePipeCost)

    const railKey = "Pipe, Galv, 1-3/8\" X 10' 6\" (SS40)"
    add(railKey, Math.ceil(totalFootage / 10), 10.84)

    const tensionBarKey = h === 4
      ? "G, Tension Bar, 48\""
      : h === 5
      ? "G, Tension Bar, 60\""
      : "G, Tension Bar, 72\""
    const tensionBarCost = h === 4 ? 3.01 : h === 5 ? 3.75 : 4.00
    add(tensionBarKey, corners * 2 + ends, tensionBarCost)

    const termPostCost = h === 4 ? 28.13 : h === 5 ? 34.76 : 34.99
    const termPostKey = h === 4
      ? "Pipe, Galv, 2-1/2\" X 8' (SS40)"
      : h === 5
      ? "Pipe, Galv, 2-1/2\" X 9' (SS40)"
      : "Pipe, Galv, 2-1/2\" X 10' (SS40)"
    add(termPostKey, corners + ends, termPostCost)

    // Hook ties (Jonathan, Oct 2026): counted per section, not by footage.
    // Boxes of 100, rounded up once per job.
    add("Chainlink, Galv, Hardware, Hook Ties, 6-1/2\" x 9ga (100)", chainHookTieBoxes(sections, h), 11.00)

    // Hog rings: sections * 5
    add("G, Hog Ring, 9GA, Alum", sections * 5, 0.02)

    // Tension wire: footage + 5
    add("G, Wire, Tension, 9GA", totalFootage + 5, 0.062)

    // Hardware per section
    add("G, Band, Brace, PS, 2-3/8\", 3/4", (ends + corners * 2) * 2, 0.69)
    const tensionBands = h === 4
      ? corners * 6 + ends * 3
      : h === 5
      ? corners * 8 + ends * 4
      : corners * 10 + ends * 5
    add("G, Band, Tension, PS, 2-3/8\" x 3/4\"", tensionBands, 0.64)
    add("G, Cap, Loop, AL, 1-5/8\" x 1-3/8\"", linePosts, 0.79)
    add("G, Cap, Post, AL, 2-3/8\"", corners + ends, 0.96)
    add("G, Rail End, AL, Offset, 1-3/8\"", corners * 2 + ends, 0.60)

    const bolts5 = h === 4
      ? corners * 10 + ends * 5
      : h === 5
      ? corners * 12 + ends * 6
      : corners * 14 + ends * 7
    add("G, Bolt, 5/16 x 1-1/4\" w/ Nut", bolts5, 0.15)

    chainLinkGates(add, 'galv', h, walkGates, dblGates, inputs.gateWidths)
  }

  // ── CHAINLINK BLACK ──────────────────────────────────────────────────────────
  if (isChainlinkBlack(s)) {
    const h = clHeight(s)
    const fabricKey = h === 4
      ? "Res, Fabric, 48\", Blk, KK (9)"
      : h === 5
      ? "Res, Fabric, 60\", Blk, KK (9)"
      : "Res, Fabric, 72\", Blk, KK (9)"
    const fabricCost = h === 4 ? 116.16 : h === 5 ? 145.20 : 174.24
    add(fabricKey, fabricRolls(totalFootage), fabricCost)

    // Line posts: 1-5/8" Schedule 40 (SS40) pipe, one per line post (see galvanized).
    const linePipeCost = h === 4 ? 21.50 : h === 5 ? 24.19 : 26.87
    const linePipeKey = h === 4
      ? "Pipe, Blk, 1-5/8\" X 8' (SS40)"
      : h === 5
      ? "Pipe, Blk, 1-5/8\" X 9' (SS40)"
      : "Pipe, Blk, 1-5/8\" X 10' (SS40)"
    add(linePipeKey, linePosts, linePipeCost)

    add("Pipe, Blk, 1-3/8\" x 10'6\" (.055)", Math.ceil(totalFootage / 10), 13.75)

    const tensionBarKey = h === 4
      ? "Black, Tension Bar, 48\""
      : h === 5
      ? "Black, Tension Bar, 60\""
      : "Black, Tension Bar, 72\""
    const tensionBarCost = h === 4 ? 4.25 : h === 5 ? 5.45 : 4.62
    add(tensionBarKey, corners * 2 + ends, tensionBarCost)

    const termPostCost = h === 4 ? 44.07 : h === 5 ? 49.58 : 55.08
    const termPostKey = h === 4
      ? "Pipe, Blk, 2-1/2\" X 8' (SS40)"
      : h === 5
      ? "Pipe, Blk, 2-1/2\" X 9' (SS40)"
      : "Pipe, Blk, 2-1/2\" X 10' (SS40)"
    add(termPostKey, corners + ends, termPostCost)

    // Hook ties per section, boxes of 100 (see galvanized).
    add("Chainlink, Black, Hardware, Hook Ties, 6-1/2\" x 9ga, AL (100)", chainHookTieBoxes(sections, h), 14.00)

    add("Black, Hog Ring, 9GA, Alum", sections * 5, 0.02)
    add("Black, Wire, Tension, 9GA", totalFootage + 5, 0.11)

    add("Black, Band, Brace, 2-3/8\", 3/4\"", (ends + corners * 2) * 2, 0.75)
    const tensionBands = h === 4
      ? corners * 6 + ends * 3
      : h === 5
      ? corners * 8 + ends * 4
      : corners * 10 + ends * 5
    add("Black, Band, Tension, 2-3/8\" x 3/4\"", tensionBands, 0.75)
    add("Black, Cap, Loop, AL, 1-5/8\" x 1-3/8\"", linePosts, 1.14)
    add("Black, Cap, Post, AL, 2-3/8\"", corners + ends, 1.01)
    add("Black, Rail End, AL, Offset, 1-3/8\"", corners * 2 + ends, 0.75)

    const bolts5 = h === 4
      ? corners * 10 + ends * 5
      : h === 5
      ? corners * 12 + ends * 6
      : corners * 14 + ends * 7
    add("Black, Bolt, 5/16 x 1-1/4\" w/ Nut", bolts5, 0.18)

    chainLinkGates(add, 'black', h, walkGates, dblGates, inputs.gateWidths)
  }

  // ── COMMERCIAL CHAINLINK ─────────────────────────────────────────────────────
  if (isCommercial(s)) {
    if (s.includes('Black') || s.includes('Green')) {
      warnings.push(
        `"${s}" is priced with galvanized commercial fabric and pipe. There is no commercial grade color fabric in the parts list, so add the color premium by hand.`,
      )
    }
    add("Comm, G, Fabric, 72\" KT (9)", fabricRolls(totalFootage), 258.75)
    add("Comm, G, Term, Plated, 2-1/2\" X 6' (SS40)", corners + ends, 59.00)
    add("Pipe, Galv,  2-1/2\" X 10' (SS40)", corners + ends, 33.75)
    add("Pipe, Galv, 2\" X 12' (SS40)", linePosts, 36.13)
    add("Pipe, Galv, 1-5/8\" X 21' (SS40)", Math.ceil(totalFootage / 20), 39.92)
    add("Comm, G, Cap, Post, PS, 2-3/8\"", corners + ends, 2.76)
    add("Comm, G, Cap, Loop, PS, 2\" x 1-5/8\"", linePosts, 2.01)
    add("Comm, G, Rail End, PS, 1-5/8\" ", corners * 2 + ends, 1.85)
    add("Comm, G, Tension Bar, 72\" x 3/4\"", corners * 2 + ends, 4.75)
    add("G, Band, Brace, PS, 2-3/8\", 3/4", (ends + corners * 2) * 2, 0.69)
    const commTensionBands = corners * 10 + ends * 5
    add("G, Band, Tension, PS, 2-3/8\" x 3/4\"", commTensionBands, 0.64)
    const commHookTies = Math.ceil((totalFootage * 5 + linePosts * 5) / 100)
    add("Chainlink, Galv, Hardware, Hook Ties, 8-1/4\" x 9ga, AL (100)", commHookTies, 12.00)
    add("G, Hog Ring, 9GA, Alum", sections * 5, 0.02)
    add("G, Wire, Tension, 9GA", totalFootage + 5, 0.062)
    add("G, Bolt, 5/16 x 1-1/4\" w/ Nut", corners * 14 + ends * 7, 0.15)
    add("G, Bolt, 3/8\" x 2\" w/ Nut", ends * 2, 0.34)

    if (s.includes("+1'")) {
      add("Comm, G, Barb Arm, PS, 1-7/8\" x 1-5/8\"", linePosts, 4.75)
      add("Comm, G, Barbed Wire, OK, 12.5Ga", (totalFootage + 5) * 3, 0.09)
    }

    // Gate hardware from the sheet's rows that list CL - Com 6' / Com 6'+1' (hinges, forks,
    // collar, 3/8" x 3" bolts, Com Drop Rod once per job with a double gate). No gate leaf row.
    chainLinkGates(add, 'commercial', 6, walkGates, dblGates, inputs.gateWidths)
  }

  // ── ALUMINUM NO-DIG (Alum - ND - Emily - 48) ────────────────────────────────
  if (isAlumND(s)) {
    add("Alum, Emily 3R, Sec, 48\" x 6'", sections, 54.88)
    add("I-Post, 2\" x 6' (CP)", corners, 23.26)
    add("I-Post, 2\" x 6' (EP / LP)", ends + linePosts, 26.60)
    add("Emily 3R 48\", CP x 6'", corners, 14.78)
    add("Emily 3R 48\", EP x 6'", ends, 14.78)
    add("Emily 3R 48\", LP x 6'", linePosts, 14.78)
    add("Alum, Cap, 2\" (NW230NL-26)", totalPostCount, 1.25)
    add("Alum, Hex, 1/4\"", sections * 6 + (walkGates + dblGates) * 24, 0.17)

    if (walkGates > 0) {
      add("Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"", walkGates, 168.83)
      add("Alum, Gate, Hinge, Self-Closing", walkGates * 2, 33.36)
      add("Alum, Gate, Latch, AQUA , Black, 20\"", walkGates, 50.43)
    }
    if (dblGates > 0) {
      add("Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"", dblGates * 2, 168.83)
      add("Alum, Gate, Hinge, Self-Closing", dblGates * 4, 33.36)
      add("Alum, Gate, Latch", dblGates, 21.25)
    }
  }

  // ── ALUMINUM DIG-SET (Alum - DS - Emily - 48) ───────────────────────────────
  if (isAlumDS(s)) {
    add("Alum, Emily 3R, Sec, 48\" x 6'", sections, 54.88)
    add("Emily 3R 48\", CP x 6'", corners, 14.78)
    add("Emily 3R 48\", EP x 6'", ends, 14.78)
    add("Emily 3R 48\", LP x 6'", linePosts, 14.78)
    add("Misc, Concrete", Math.ceil(totalPostCount * 0.5), 6.25)
    add("Alum, Cap, 2\" (NW230NL-26)", totalPostCount, 1.25)
    add("Alum, Hex, 1/4\"", sections * 6 + (walkGates + dblGates) * 24, 0.17)

    if (walkGates > 0) {
      add("Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"", walkGates, 168.83)
      add("Alum, Gate, Hinge, Self-Closing", walkGates * 2, 33.36)
      add("Alum, Gate, Latch, AQUA , Black, 20\"", walkGates, 50.43)
    }
    if (dblGates > 0) {
      add("Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"", dblGates * 2, 168.83)
      add("Alum, Gate, Hinge, Self-Closing", dblGates * 4, 33.36)
      add("Alum, Gate, Latch", dblGates, 21.25)
    }
  }

  // ── ALUMINUM INDUSTRIAL ABIGAIL (dig set, 6 ft tall, 8 ft sections) ──────────
  // New and unconfirmed parts list; this style quoted with $0 material before.
  if (isAlumIndAbigail(s)) {
    add("Alum, Ind, Sec, 6' x 8'", sections, 211.62)
    add("Alum, Post 3\" x 8', CP", corners, 71.93)
    add("Alum, Post 3\" x 8', EP", ends, 71.93)
    add("Alum, Post 3\" x 8', LP", linePosts, 71.93)
    add('Alum, Cap, 3"', totalPostCount, 2.50)
    add('Misc, Concrete', totalPostCount * 2, 6.25)
    add('Alum, Hex, 1/4"', sections * 6 + (walkGates + dblGates) * 24, 0.17)
    warnings.push(
      walkGates + dblGates > 0
        ? 'Industrial Abigail parts list is new and unconfirmed, and there is no Abigail gate in the parts list, so gate material is not included. Add the gate cost by hand.'
        : 'Industrial Abigail parts list is new and unconfirmed. Check the pull sheet before you quote.',
    )
  }

  return col.finish()
}

export function totalMaterialCost(items: LineItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.total, 0))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ════════════════════════════════════════════════════════════════════════════
// Mixed-rail material calculator (Milestone B)
//
// For auto-mix umbrella styles ("WV-Auto ND Privacy", "WV-Auto DS Privacy",
// "TV-Auto DS Privacy").
// Each run independently uses 6ft or 8ft rails per the optimizer (or override).
// Panel goods (rails, u-trim, pickets, stiffener) are computed per-run with
// the matching 6x6 or 6x8 unit cost; post / hardware / gate counts come from
// total post counts and don't change with the mix.
// ════════════════════════════════════════════════════════════════════════════

export type RailWidth = '6ft' | '8ft'

export interface MixedRunInput {
  ft: number
  rail: RailWidth
}

export interface MixedJobInputs {
  installMethod: 'no-dig' | 'dig-set'
  colorFamily: 'white' | 'tan'
  runs: MixedRunInput[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  /** Styles made from Settings (a color added later): the kit set to read, by the style's own internal name. */
  kitKey?: string
  /** A color priced by the piece (job lot). */
  jobLot?: StyleJobLot
  /** Line posts beyond the runs' own (sections − 1 per run): vinyl tees from the yard layout (yardLayout.ts VINYL_TEE_POST). */
  extraLinePosts?: number
}

/** Whole line posts to add (a missing or bad count adds none). */
function extraLines(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** Section count for a single run at the chosen rail width. */
function sectionsForMixedRun(ft: number, rail: RailWidth): number {
  const panel = rail === '8ft' ? 8 : 6
  if (ft <= 0) return 0
  return ft % panel === 0 ? ft / panel : Math.ceil(ft / panel)
}

export function calculateMixedMaterials(input: MixedJobInputs): LineItem[] {
  return calculateMixedMaterialsDetailed(input).items
}

/** The kit set an auto mix job reads (white no dig, white dig set, tan dig set; tan no dig is used only for the 6/8 hint on tan styles). */
export function mixedKitKey(installMethod: 'no-dig' | 'dig-set', colorFamily: 'white' | 'tan'): string {
  return `${colorFamily === 'white' ? 'WV' : 'TV'}-Auto ${installMethod === 'no-dig' ? 'ND' : 'DS'} Privacy`
}

/** Same as calculateMixedMaterials, plus the warnings the estimator should see. Parts come from the material kits. */
export function calculateMixedMaterialsDetailed(input: MixedJobInputs): MaterialResult {
  let section = 0, section8 = 0, line = 0
  for (const r of input.runs) {
    const sec = sectionsForMixedRun(r.ft, r.rail)
    if (r.rail === '8ft') section8 += sec
    else section += sec
    if (sec > 1) line += sec - 1
  }
  line += extraLines(input.extraLinePosts)
  const counts: KitCounts = {
    section, section8, line, corner: input.corners, end: input.ends, blank: input.dblGates,
    ...gateCounts(input.walkGates, input.dblGates), perFoot: input.runs.reduce((t, r) => t + r.ft, 0), perJob: 1,
  }
  if (input.kitKey) {
    // A style made from Settings has only its kits; the old white / tan lists are not its parts.
    const own = fromKits(input.kitKey, counts, input.tearOutSections, input.tearOutGates, () => [], input.jobLot)
    if (own) return own
    const col = makeCollector()
    col.add('Tear Out Haul-Away Fence', input.tearOutSections, 9.50)
    col.add('Tear Out Haul-Away Gate', input.tearOutGates, 27.00)
    col.warnings.push(`"${input.kitKey}" has no material kit yet, so no fence material is included. Set its parts in Inventory > Material Kits.`)
    return col.finish()
  }
  return fromKits(mixedKitKey(input.installMethod, input.colorFamily), counts, input.tearOutSections, input.tearOutGates, () => [])
    ?? legacyCalculateMixedMaterialsDetailed(input)
}

/** The auto mix parts list as it was before material kits (test check and source of the built in kits). */
export function legacyCalculateMixedMaterialsDetailed(input: MixedJobInputs): MaterialResult {
  const { installMethod, colorFamily, runs, corners, ends,
          walkGates, dblGates, tearOutSections, tearOutGates } = input

  // Per-run + aggregate section counts split by rail width.
  let sections6 = 0
  let sections8 = 0
  let linePosts = 0
  for (const r of runs) {
    const sec = sectionsForMixedRun(r.ft, r.rail)
    if (r.rail === '8ft') sections8 += sec
    else sections6 += sec
    if (sec > 1) linePosts += sec - 1
  }
  linePosts += extraLines(input.extraLinePosts)
  // Gate leaves take panel goods like a section, as on the locked styles (a
  // double gate is two leaves). They use the 8 ft kit only when every run is
  // 8 ft, so an all 6 or all 8 job matches the 6'x6' or 6'x8' style exactly.
  const gateLeaves = walkGates + dblGates * 2
  if (gateLeaves > 0) {
    if (sections8 > 0 && sections6 === 0) sections8 += gateLeaves
    else sections6 += gateLeaves
  }
  const totalSections = sections6 + sections8
  const totalPostCount = corners + ends + linePosts
  const blankPosts = dblGates
  const allPosts = totalPostCount + blankPosts
  const isWhite = colorFamily === 'white'
  const isTan = colorFamily === 'tan'
  const isND = installMethod === 'no-dig'
  const isDS = installMethod === 'dig-set'

  const col = makeCollector()
  const { add } = col

  // ── Tear-out (same as existing branches) ──
  add('Tear Out Haul-Away Fence', tearOutSections, 9.50)
  add('Tear Out Haul-Away Gate', tearOutGates, 27.00)

  // ── Posts ──
  if (isWhite && isND) {
    add('*Vinyl, White, Post, Corner, 5" x 5" x 78"', corners, 11.17)
    add('*Vinyl, White, Post, End, 5" x 5" x 78"', ends, 11.17)
    add('*Vinyl, White, Post, Line, 5" x 5" x 78"', linePosts, 11.17)
    add('*Vinyl, White, Post, Blank, 5" x 5" x 102"', blankPosts, 13.64)
    add('ND, Donut', totalPostCount * 2, 3.19)
    add('Pipe, PT40, Galv, 2-1/2" x 8\'', totalPostCount, 19.50)
  } else if (isWhite && isDS) {
    add('*Vinyl, White, Post, Corner, 5" x 5" x 102"', corners, 13.64)
    add('*Vinyl, White, Post, End, 5" x 5" x 102"', ends, 13.64)
    add('*Vinyl, White, Post, Line, 5" x 5" x 102"', linePosts, 17.49)
    add('*Vinyl, White, Post, Blank, 5" x 5" x 102"', blankPosts, 13.64)
    // TAKEOFF_RULES WV-DS concrete: 2 bags per walk gate too (Jonathan, Oct 20, 2026).
    add('Misc, Concrete', Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2 + walkGates * 2), 6.25)
  } else if (isTan && isND) {
    add('*Vinyl, Tan, Post, Corner, 5" x 5" x 78"', corners, 12.90)
    add('*Vinyl, Tan, Post, End, 5" x 5" x 78"', ends, 12.90)
    add('*Vinyl, Tan, Post, Line, 5" x 5" x 78"', linePosts, 12.90)
    add('*Vinyl, Tan, Post, Blank, 5" x 5" x 102"', blankPosts, 16.38)
    add('ND, Donut', totalPostCount * 2, 3.19) // as white: the blank post is set in concrete, not in totalPostCount
    add('Pipe, PT40, Galv, 2-1/2" x 8\'', corners + ends + linePosts, 19.50)
  } else if (isTan && isDS) {
    // As the TV-DS 6'x6' / 6'x8' list: 102" tan posts set in concrete.
    add('*Vinyl, Tan, Post, Corner, 5" x 5" x 102"', corners, 19.24)
    add('*Vinyl, Tan, Post, End, 5" x 5" x 102"', ends, 19.24)
    add('*Vinyl, Tan, Post, Line, 5" x 5" x 102"', linePosts, 19.24)
    add('*Vinyl, Tan, Post, Blank, 5" x 5" x 102"', blankPosts, 16.38)
    // TAKEOFF_RULES TV-DS concrete: 2 bags per walk gate too (Jonathan, Oct 20, 2026).
    add('Misc, Concrete', Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2 + walkGates * 2), 6.25)
  }

  // ── Panel goods, split by rail width ──
  // 6'x6' panels: 11 pickets, 2 × 6' rails, 2 × u-trim. No stiffener.
  // 6'x8' panels: 15 pickets (tan too, Oct 21, 2026), 2 × 8' rails, 2 × u-trim, 1 stiffener.
  // U-trim is the same SKU; quantity proportional to (sections × 2).
  if (isWhite) {
    if (sections6 > 0) {
      add('*Vinyl, White, Picket, 62-1/4"', sections6 * 11, 2.71)
      add("*Vinyl, White, Rail, 6'", sections6 * 2, 5.98)
    }
    if (sections8 > 0) {
      add('*Vinyl, White, Picket, 62-1/4"', sections8 * 15, 2.71)
      add("*Vinyl, White, Rail, 8'", sections8 * 2, 9.26)
      add("Vinyl, Rail Insert, 8'", sections8, 8.00)
    }
    add('*Vinyl, White, U-Trim, 59-1/4"', totalSections * 2, 1.62)
  } else if (isTan) {
    if (sections6 > 0) {
      add('*Vinyl, Tan, Picket, 62-1/4"', sections6 * 11, 3.22)
      add("*Vinyl, Tan, Rail, 6'", sections6 * 2, 7.98)
    }
    if (sections8 > 0) {
      // 15 pickets per 8 ft wide section (Jonathan, Oct 21, 2026; was 16).
      add('*Vinyl, Tan, Picket, 62-1/4"', sections8 * 15, 3.22)
      add("*Vinyl, Tan, Rail, 8'", sections8 * 2, 10.18)
      add("Vinyl, Rail Insert, 8'", sections8, 8.00)
    }
    add('*Vinyl, Tan, U-Trim, 59-1/4"', totalSections * 2, 1.85)
  }

  // ── Hardware (post-count derived; same across rail widths) ──
  if (isWhite && isND) {
    add('*Vinyl, Hex, 1/4 x 3" (Rail Ties/Bottom)', allPosts * 3, 0.123)
    add('**Vinyl, Donut Pin', allPosts * 4, 0.10)
    add('*Vinyl, Truss, 8 x 3/4" (U-Trim)', totalSections * 6, 0.03)
    add('*Vinyl, White, Cap, 5"x5"', allPosts, 1.00)
    add('Misc, Concrete', dblGates, 6.25) // ND uses concrete only at double-gate posts
  } else if (isWhite && isDS) {
    add('*Vinyl, Hex, 1/4 x 3" (Rail Ties/Bottom)', totalPostCount * 2, 0.123)
    add('*Vinyl, Truss, 8 x 3/4" (U-Trim)', totalSections * 6, 0.03)
    add('*Vinyl, White, Cap, 5"x5"', totalPostCount, 1.00)
  } else if (isTan && isND) {
    add('*Vinyl, Hex, 1/4 x 3" (Rail Ties/Bottom)', totalPostCount * 3, 0.123)
    add('**Vinyl, Donut Pin', totalPostCount * 4, 0.10)
    add('*Vinyl, Truss, 8 x 3/4" (U-Trim)', totalSections * 6, 0.03)
    add('Vinyl, Tan, Cap, 5"x5"', totalPostCount, 1.00)
  } else if (isTan && isDS) {
    add('*Vinyl, Hex, 1/4 x 3" (Rail Ties/Bottom)', totalPostCount * 2, 0.123)
    add('*Vinyl, Truss, 8 x 3/4" (U-Trim)', totalSections * 6, 0.03)
    add('Vinyl, Tan, Cap, 5"x5"', totalPostCount, 1.00)
  }

  // ── Gate hardware (style-name agnostic; uses installMethod + color) ──
  const gateOpenings = walkGates + dblGates * 2
  // TAKEOFF_RULES "*Vinyl, Gate, Handle": gateCount*2 on every WV/TV ND/DS privacy style
  // (white no dig had it; dig set and tan added Oct 20, 2026, Jonathan).
  if (gateOpenings > 0) {
    add('*Vinyl, Gate, Handle', gateOpenings * 2, 5.98)
  }
  if (isWhite) {
    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add('*Vinyl, Gate, Brace', walkGates, 36.37)
      add('*Vinyl, Gate, Hinge', walkGates, 29.03)
      add('*Vinyl, Gate, Latch', walkGates, 20.46)
      add('*Vinyl, White, Cap, Gate', walkGates * 2, 1.00)
      add('*Vinyl, White, Upright', walkGates * (isND ? 2 : 1), 8.75)
      add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      if (isND) add('*Vinyl, Hex, 1/4 x 3/4" (H-Beam)', walkGates * 6, 0.05)
      add('*Vinyl, White, Rivet, 1"', walkGates * 50, 0.12)
    }
    if (dblGates > 0) {
      if (isND) {
        add("*Vinyl, Gate, H-Beam, 6'", dblGates * 2, 22.80)
        add("*Vinyl, Gate, H-Beam, 8'", dblGates, 29.60)
      } else {
        add("*Vinyl, Gate, H-Beam, 8'", dblGates * 3, 29.60)
      }
      add('*Vinyl, Gate, Brace', dblGates * 2, 36.37)
      add('*Vinyl, Gate, Hinge', dblGates * 2, 29.03)
      add('*Vinyl, Gate, Latch', dblGates * (isND ? 2 : 1), 20.46)
      add('*Vinyl, White, Cap, Gate', dblGates * 4, 1.00)
      add('*Vinyl, White, Upright', dblGates * (isND ? 4 : 2), 8.75)
      if (isND) {
        add("*Vinyl, Gate, P-Channel, 6'", dblGates * 2, 12.30)
        add('*Vinyl, Hex, 1/4 x 3/4" (H-Beam)', dblGates * 12, 0.05)
      }
      add('*Vinyl, White, Rivet, 1"', dblGates * 100, 0.12)
    }
  } else if (isTan && isND) {
    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add('*Vinyl, Gate, Brace', walkGates, 36.37)
      add('*Vinyl, Gate, Hinge', walkGates, 29.03)
      add('*Vinyl, Gate, Latch', walkGates, 20.46)
      add('Vinyl, Tan, Cap, Gate', walkGates * 2, 1.00)
      add('*Vinyl, Tan, Upright', walkGates, 9.69)
      add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      add('*Vinyl, Tan, Rivet, 1"', walkGates * 50, 0.20)
    }
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 8'", dblGates, 29.60)
      add('*Vinyl, Gate, Brace', dblGates * 2, 36.37)
      add('*Vinyl, Gate, Hinge', dblGates * 2, 29.03)
      add('*Vinyl, Gate, Latch', dblGates, 20.46)
      add('Vinyl, Tan, Cap, Gate', dblGates * 4, 1.00)
      add('*Vinyl, Tan, Upright', dblGates * 2, 9.69)
      add('*Vinyl, Tan, Rivet, 1"', dblGates * 100, 0.20)
    }
  } else if (isTan && isDS) {
    // The TV-DS gate lines, as TAKEOFF_RULES (Jonathan, Oct 20, 2026): 2 uprights and
    // 1 P-channel per walk gate; 2 latches, 4 uprights and 2 P-channels per double gate.
    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add('*Vinyl, Gate, Brace', walkGates, 36.37)
      add('*Vinyl, Gate, Hinge', walkGates, 29.03)
      add('*Vinyl, Gate, Latch', walkGates, 20.46)
      add('Vinyl, Tan, Cap, Gate', walkGates * 2, 1.00)
      add('*Vinyl, Tan, Upright', walkGates * 2, 9.69)
      add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      add('*Vinyl, Tan, Rivet, 1"', walkGates * 50, 0.20)
    }
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 8'", dblGates * 3, 29.60)
      add('*Vinyl, Gate, Brace', dblGates * 2, 36.37)
      add('*Vinyl, Gate, Hinge', dblGates * 2, 29.03)
      add('*Vinyl, Gate, Latch', dblGates * 2, 20.46)
      add('Vinyl, Tan, Cap, Gate', dblGates * 4, 1.00)
      add('*Vinyl, Tan, Upright', dblGates * 4, 9.69)
      add("*Vinyl, Gate, P-Channel, 6'", dblGates * 2, 12.30)
      add('*Vinyl, Tan, Rivet, 1"', dblGates * 100, 0.20)
    }
  }
  if (isTan && isDS) col.warnings.push('Tan dig set uses the white dig set parts list with tan parts. Check the pull sheet against how you build it.')

  return col.finish()
}

/** Helper: total section count (per-run sum) for a mixed-rail job. */
export function mixedTotalSections(runs: MixedRunInput[]): number {
  return runs.reduce((sum, r) => sum + sectionsForMixedRun(r.ft, r.rail), 0)
}