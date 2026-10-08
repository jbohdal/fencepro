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

  return { items, warnings, add, finish }
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
}

export interface LineItem {
  item: string
  qty: number
  unitCost: number
  total: number
  /** Where unitCost came from. Absent on quotes saved before this field. */
  costSource?: 'inventory' | 'builtin'
}

// ── Section count per run ─────────────────────────────────────────────────────
// Matches EZ-Quote Form C10:C24 formulas exactly. Per-run, never total/panel.
function panelLengthForStyle(style: string): number {
  if (isChainlink(style)) return 10
  // 8 ft tall privacy is bought as assembled sections, so the section width is
  // the second number in the name (8'x6' = 8 tall, 6 wide).
  const tall = vinyl8Tall(style)
  if (tall) return tall.width
  if (is8Wide(style) || isDurafence(style)) return 8
  // 6ft wide: vinyl 6x6, 6x8, Bell, Aluminum Emily (6x6 panel)
  return 6
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
/** 8 ft tall vinyl privacy ("WV-ND 8'x6' Privacy"): color, install, width. */
function vinyl8Tall(s: string): { white: boolean; noDig: boolean; width: 6 | 8 } | null {
  const m = s.match(/^(WV|TV)-(ND|DS) 8'x([68])'/)
  if (!m) return null
  return { white: m[1] === 'WV', noDig: m[2] === 'ND', width: m[3] === '8' ? 8 : 6 }
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

/** Same as calculateMaterials, plus the warnings the estimator should see. */
export function calculateMaterialsDetailed(inputs: JobInputs): MaterialResult {
  const { fenceStyle: s, runs, corners, ends, walkGates, dblGates,
          tearOutSections, tearOutGates } = inputs

  const sections = totalSections(runs, s)
  const linePosts = totalLinePosts(runs, s)
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
    // Walk gate hardware
    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add("*Vinyl, Gate, Brace", walkGates, 36.37)
      add("*Vinyl, Gate, Hinge", walkGates, 29.03)
      add("*Vinyl, Gate, Latch", walkGates, 20.46)
      add("*Vinyl, White, Cap, Gate", walkGates * 2, 1.00)
      add("*Vinyl, White, Upright", walkGates * 2, 8.75)
      add("*Vinyl, Gate, P-Channel, 6'", walkGates, 12.30)
      add("*Vinyl, Hex, 1/4 x 3/4\" (H-Beam)", walkGates * 6, 0.05)
      add("*Vinyl, White, Rivet, 1\"", walkGates * 50, 0.12)
    }
    // Double gate hardware — each dbl gate = 2 panels
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", dblGates * 2, 22.80)
      add("*Vinyl, Gate, H-Beam, 8'", dblGates, 29.60)
      add("*Vinyl, Gate, Brace", dblGates * 2, 36.37)
      add("*Vinyl, Gate, Hinge", dblGates * 2, 29.03)
      add("*Vinyl, Gate, Latch", dblGates * 2, 20.46)
      add("*Vinyl, White, Cap, Gate", dblGates * 4, 1.00)
      add("*Vinyl, White, Upright", dblGates * 4, 8.75)
      add("*Vinyl, Gate, P-Channel, 6'", dblGates * 2, 12.30)
      add("*Vinyl, Hex, 1/4 x 3/4\" (H-Beam)", dblGates * 12, 0.05)
      add("*Vinyl, White, Rivet, 1\"", dblGates * 100, 0.12)
    }
  }

  // ── VINYL TAN NO-DIG (TV-ND) ────────────────────────────────────────────────
  if (isVinylTanND(s)) {
    add("*Vinyl, Tan, Post, Corner, 5\" x 5\" x 78\"", corners, 12.90)
    add("*Vinyl, Tan, Post, End, 5\" x 5\" x 78\"", ends, 12.90)
    add("*Vinyl, Tan, Post, Line, 5\" x 5\" x 78\"", linePosts, 12.90)
    add("*Vinyl, Tan, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 16.38)
    add('ND, Donut', totalPostCount * 2 - blankPosts * 2, 3.19)
    add("Pipe, PT40, Galv, 2-1/2\" x 8'", corners + ends + linePosts, 19.50)

    // Panel goods: sections plus every gate leaf (a double gate is two leaves).
    const tanPanels = sections + walkGates + dblGates * 2
    if (isVinyl6x6(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanPanels * 11, 3.22)
      add("*Vinyl, Tan, Rail, 6'", 2 * tanPanels, 7.98)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanPanels, 1.85)
    }
    if (isVinyl6x8(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanPanels * 16, 3.22)
      add("*Vinyl, Tan, Rail, 8'", 2 * tanPanels, 10.18)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanPanels, 1.85)
      add("Vinyl, Rail Insert, 8' ", tanPanels, 8.00)
    }

    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 3, 0.123)
    add("**Vinyl, Donut Pin", totalPostCount * 4, 0.10)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * tanPanels, 0.03)
    add("Vinyl, Tan, Cap, 5\"x5\"", totalPostCount, 1.00)

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
    // Concrete: all posts + blank posts + 2 per double gate
    add('Misc, Concrete',
      Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2), 6.25)

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
    add('Misc, Concrete',
      Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2), 6.25)

    const tanDsPanels = sections + walkGates + dblGates * 2
    if (isVinyl6x6(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanDsPanels * 11, 3.22)
      add("*Vinyl, Tan, Rail, 6'", 2 * tanDsPanels, 7.98)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanDsPanels, 1.85)
    }
    if (isVinyl6x8(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", tanDsPanels * 16, 3.22)
      add("*Vinyl, Tan, Rail, 8'", 2 * tanDsPanels, 10.18)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * tanDsPanels, 1.85)
      add("Vinyl, Rail Insert, 8' ", tanDsPanels, 8.00)
    }

    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 2, 0.123)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * tanDsPanels, 0.03)
    add("Vinyl, Tan, Cap, 5\"x5\"", totalPostCount, 1.00)

    if (walkGates > 0) {
      add("*Vinyl, Gate, H-Beam, 6'", walkGates * 2, 22.80)
      add("*Vinyl, Gate, Brace", walkGates, 36.37)
      add("*Vinyl, Gate, Hinge", walkGates, 29.03)
      add("*Vinyl, Gate, Latch", walkGates, 20.46)
      add("Vinyl, Tan, Cap, Gate", walkGates * 2, 1.00)
      add("*Vinyl, Tan, Upright", walkGates, 9.69)
      add("*Vinyl, Tan, Rivet, 1\"", walkGates * 50, 0.20)
    }
    if (dblGates > 0) {
      add("*Vinyl, Gate, H-Beam, 8'", dblGates * 3, 29.60)
      add("*Vinyl, Gate, Brace", dblGates * 2, 36.37)
      add("*Vinyl, Gate, Hinge", dblGates * 2, 29.03)
      add("*Vinyl, Gate, Latch", dblGates, 20.46)
      add("Vinyl, Tan, Cap, Gate", dblGates * 4, 1.00)
      add("*Vinyl, Tan, Upright", dblGates * 2, 9.69)
      add("*Vinyl, Tan, Rivet, 1\"", dblGates * 100, 0.20)
    }
    warnings.push('Tan dig set uses the white dig set parts list with tan parts. Check the pull sheet against how you build it.')
  }

  // ── VINYL 8 FT TALL PRIVACY (WV/TV, ND/DS, 8'x6' and 8'x8') ──────────────────
  // Assembled picket sections, 8 ft privacy posts, complete 8 x 4 gates. These
  // styles had no parts list before, so they quoted with $0 material.
  const tall = vinyl8Tall(s)
  if (tall) {
    const V = tall.white ? 'V , W' : 'V , T'
    const secCost = tall.white ? (tall.width === 8 ? 143.25 : 108.68) : (tall.width === 8 ? 164.74 : 124.98)
    const postCost = tall.white ? 24.56 : 27.50
    add(`${V}, Picket Section 8' x ${tall.width}' Privacy`, sections, secCost)
    add(`${V}, Post, 8' Privacy, CP, 5" x 5"`, corners, postCost)
    add(`${V}, Post, 8' Privacy, EP, 5" x 5"`, ends, postCost)
    add(`${V}, Post, 8' Privacy, LP, 5" x 5"`, linePosts, postCost)
    add(tall.white ? '*Vinyl, White, Cap, 5"x5"' : 'Vinyl, Tan, Cap, 5"x5"', totalPostCount, 1.00)

    if (tall.noDig) {
      add('ND, Donut', totalPostCount * 2, 3.19)
      add("Pipe, PT40, Galv, 2-1/2\" x 8'", totalPostCount, 19.50)
    } else {
      // Taller post, deeper hole: 2 bags per post.
      add('Misc, Concrete', totalPostCount * 2, 6.25)
    }

    const gateLeaves = walkGates + dblGates * 2
    add(`${V}, Privacy Gate 8 x 4`, gateLeaves, tall.white ? 399.00 : 458.00)
    add('*Vinyl, Gate, Hinge', gateLeaves * 2, 29.03)
    add('*Vinyl, Gate, Latch', walkGates + dblGates, 20.46)
    add('*Vinyl, Gate, Handle', gateLeaves * 2, 5.98)
    add(tall.white ? '*Vinyl, White, Cap, Gate' : 'Vinyl, Tan, Cap, Gate', gateLeaves * 2, 1.00)
    warnings.push(
      `8 ft privacy parts list is new and unconfirmed: assembled 8' x ${tall.width}' sections, 8 ft posts${tall.noDig ? ", the same 8' no dig pipe as 6 ft fence" : ', 2 bags of concrete per post'}, and 4 ft wide gate leaves. Check the pull sheet before you quote.`,
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

    const termPipeCost = h === 4 ? 16.49 : h === 5 ? 18.55 : 20.61
    const termPipeKey = h === 4
      ? "Pipe, Galv, 1-5/8\" X 8' (SS40)"
      : h === 5
      ? "Pipe, Galv, 1-5/8\" X 9' (SS40)"
      : "Pipe, Galv, 1-5/8\" X 10' (SS40)"
    add(termPipeKey, ends, termPipeCost)

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

    // Hook ties: footage * 5 + line posts * (h - 1), per 100
    const hookTies = Math.ceil((totalFootage * 5 + linePosts * (h - 1)) / 100)
    add("Chainlink, Galv, Hardware, Hook Ties, 6-1/2\" x 9ga (100)", hookTies, 11.00)

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

    // Gates match the fence height and are 4 ft wide per leaf.
    const galvGate = `Chainlink, Galv, Gate, 1-3/8", ${h}' x 4' (.055)`
    const galvGateCost = h === 4 ? 85.00 : h === 5 ? 88.85 : 114.86
    if (walkGates > 0) {
      add(galvGate, walkGates, galvGateCost)
      add("G, Hinge, Female, 1-3/8\" x 5/8\"", walkGates * 2, 0.83)
      add("G, Hinge, Male, PS, 2-3/8\"", walkGates * 2, 0.83)
      add("G, Fork, PS, 1-3/8\"", walkGates * 2, 1.18)
      add("G, Collar, PS, 1-3/8\" (Set of 2)", walkGates * 2, 1.29)
      add("G, Drop Rod, 24\"", walkGates, 6.88)
      add("G, Bolt, 3/8\" x 2\" w/ Nut", walkGates * 2, 0.34)
      add("G, Bolt, 3/8\" x 3\" w/ Nut", walkGates * 2, 0.41)
    }
    if (dblGates > 0) {
      add(galvGate, dblGates * 2, galvGateCost)
      add("G, Hinge, Female, 1-3/8\" x 5/8\"", dblGates * 4, 0.83)
      add("G, Hinge, Male, PS, 2-3/8\"", dblGates * 4, 0.83)
      add("G, Fork, PS, 2-1/2\"", dblGates * 2, 1.53)
      add("G, Drop Rod, 24\"", dblGates * 2, 6.88)
    }
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

    const termPipeCost = h === 4 ? 21.50 : h === 5 ? 24.19 : 26.87
    const termPipeKey = h === 4
      ? "Pipe, Blk, 1-5/8\" X 8' (SS40)"
      : h === 5
      ? "Pipe, Blk, 1-5/8\" X 9' (SS40)"
      : "Pipe, Blk, 1-5/8\" X 10' (SS40)"
    add(termPipeKey, ends, termPipeCost)

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

    const hookTies = Math.ceil((totalFootage * 5 + linePosts * (h - 1)) / 100)
    add("Chainlink, Black, Hardware, Hook Ties, 6-1/2\" x 9ga, AL (100)", hookTies, 14.00)

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

    // Gates match the fence height and are 4 ft wide per leaf.
    const blackGate = `Chainlink, Black, Gate, 1-3/8", ${h}' x 4' (.065)`
    const blackGateCost = h === 4 ? 123.95 : h === 5 ? 138.46 : 154.66
    if (walkGates > 0) {
      add(blackGate, walkGates, blackGateCost)
      add("Black, Hinge, Female, 1-3/8\" x 5/8\"", walkGates * 2, 1.24)
      add("Black, Hinge, Male, 2-3/8\"", walkGates * 2, 2.01)
      add("Black, Fork, PS, 1-3/8\" ", walkGates * 2, 1.53)
      add("Black, Collar, PS, 1-3/8\" (Set of 2)", walkGates * 2, 1.63)
      add("Drop Rod, 24\", Black", walkGates, 30.48)
      add("Black, Bolt, 3/8\" x 2\" w/ Nut ", walkGates * 2, 0.41)
      add("Black, Bolt, 3/8\" x 3\" w/ Nut", walkGates * 2, 0.53)
    }
    if (dblGates > 0) {
      add(blackGate, dblGates * 2, blackGateCost)
      add("Black, Hinge, Female, 1-3/8\" x 5/8\"", dblGates * 4, 1.24)
      add("Black, Hinge, Male, 2-3/8\"", dblGates * 4, 2.01)
      add("Black, Fork, PS, 2-1/2\"", dblGates * 2, 1.98)
      add("Drop Rod, 48\", Black", dblGates * 2, 48.01)
    }
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
    add("G, Bolt, 3/8\" x 3\" w/ Nut", (walkGates + dblGates) * 2, 0.41)

    if (s.includes("+1'")) {
      add("Comm, G, Barb Arm, PS, 1-7/8\" x 1-5/8\"", linePosts, 4.75)
      add("Comm, G, Barbed Wire, OK, 12.5Ga", (totalFootage + 5) * 3, 0.09)
    }

    if (dblGates > 0 || walkGates > 0) {
      add("Comm, G, Com Drop Rod Assy.", dblGates + walkGates, 21.25)
    }
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
// For auto-mix umbrella styles ("WV-Auto ND Privacy", "WV-Auto DS Privacy").
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

/** Same as calculateMixedMaterials, plus the warnings the estimator should see. */
export function calculateMixedMaterialsDetailed(input: MixedJobInputs): MaterialResult {
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
    add('Misc, Concrete', Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2), 6.25)
  } else if (isTan && isND) {
    add('*Vinyl, Tan, Post, Corner, 5" x 5" x 78"', corners, 12.90)
    add('*Vinyl, Tan, Post, End, 5" x 5" x 78"', ends, 12.90)
    add('*Vinyl, Tan, Post, Line, 5" x 5" x 78"', linePosts, 12.90)
    add('*Vinyl, Tan, Post, Blank, 5" x 5" x 102"', blankPosts, 16.38)
    add('ND, Donut', totalPostCount * 2 - blankPosts * 2, 3.19)
    add('Pipe, PT40, Galv, 2-1/2" x 8\'', corners + ends + linePosts, 19.50)
  }

  // ── Panel goods, split by rail width ──
  // 6'x6' panels: 11 pickets, 2 × 6' rails, 2 × u-trim. No stiffener.
  // 6'x8' panels: 15 pickets, 2 × 8' rails, 2 × u-trim, 1 stiffener.
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
      add('*Vinyl, Tan, Picket, 62-1/4"', sections8 * 16, 3.22)
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
  }

  // ── Gate hardware (style-name agnostic; uses installMethod + color) ──
  const gateOpenings = walkGates + dblGates * 2
  if (isWhite && isND && gateOpenings > 0) {
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
  }

  return col.finish()
}

/** Helper: total section count (per-run sum) for a mixed-rail job. */
export function mixedTotalSections(runs: MixedRunInput[]): number {
  return runs.reduce((sum, r) => sum + sectionsForMixedRun(r.ft, r.rail), 0)
}