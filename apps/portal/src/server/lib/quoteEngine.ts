/**
 * Server-side Quote Engine
 *
 * Ported from apps/web/src/materialCalculator.ts + configStore.ts + QuoteBuilder.tsx
 * Uses the exact same formulas so Botpress quotes match CRM quotes.
 *
 * Price = COGS / MagicNumber
 * MagicNumber = 1 - overhead% - profit% (stored as style.margin)
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuoteInput {
  fenceStyle: string
  runs: number[]          // individual run lengths in feet
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections?: number
  tearOutGates?: number
  adjLaborHrs?: number    // additional labor hours
  priceAdjust?: number    // -0.20 to +0.20
  hasSalesman?: boolean
}

export interface LineItem {
  item: string
  qty: number
  unitCost: number
  total: number
}

export interface QuoteResult {
  // Job details
  fenceStyle: string
  fenceStyleDisplay: string
  category: string
  totalFootage: number
  sections: number
  // Cost breakdown
  materialCost: number
  laborCost: number
  tearOutCost: number
  totalCOGS: number
  // Pricing
  basePrice: number
  adjustedPrice: number
  commissionAmount: number
  finalPrice: number
  pricePerFoot: number
  // Margins
  grossMargin: number
  grossMarginPct: number
  marginStatus: 'good' | 'warning' | 'danger'
  // Labor
  manHours: number
  // Materials
  pullSheet: LineItem[]
}

// ── Fence Style Config (same as configStore.ts) ──────────────────────────────

interface FenceStyle {
  id: string
  name: string
  category: string
  margin: number
  sectionsPerMH: number
  panelWidth: number
  mhPerWalkGate: number
  mhPerDblGate: number
}

const FENCE_STYLES: FenceStyle[] = [
  { id: '1',  name: "WV-ND 6'x6' Privacy",    category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '2',  name: "WV-ND 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '3',  name: "WV-ND 8'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '4',  name: "WV-ND 8'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '5',  name: "WV-ND Bell 4'x6'",        category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.25, panelWidth: 4,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '6',  name: "WV-DS 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '7',  name: "WV-DS 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '8',  name: "WV-DS 8'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '9',  name: "WV-DS 8'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '10', name: "TV-ND 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '11', name: "TV-ND 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '12', name: "TV-DS 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '13', name: "TV-DS 6'x8' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '14', name: "CL - 4' Galv",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '15', name: "CL - 5' Galv",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '16', name: "CL - 6' Galv",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '17', name: "CL - 4' Black",           category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '18', name: "CL - 5' Black",           category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '19', name: "CL - 6' Black",           category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '20', name: "CL - Com 6'",             category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '21', name: "CL - Com 6'+1'",          category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '22', name: "CL - Com 6'+1' Black",    category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '23', name: "Alum - ND - Emily - 48",  category: 'Aluminum',   margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '24', name: "Alum - DS - Emily - 48",  category: 'Aluminum',   margin: 0.62, sectionsPerMH: 1.2,  panelWidth: 6,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '25', name: "Alum - DS - Ind Abigail", category: 'Aluminum',   margin: 0.58, sectionsPerMH: 1.2,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
  { id: '26', name: "Durafence",               category: 'Other',      margin: 0.64, sectionsPerMH: 1.0,  panelWidth: 8,  mhPerWalkGate: 2.4, mhPerDblGate: 4.8 },
]

// ── Pricing constants ────────────────────────────────────────────────────────

const MAN_HOUR_RATE = 22
const TEAR_OUT_FENCE = 9.50
const TEAR_OUT_GATE = 27.00
const MARGIN_GOOD = 0.34
const MARGIN_WARNING = 0.27

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100 }

function isVinylWhiteND(s: string) { return s === "WV-ND 6'x6' Privacy" || s === "WV-ND 6'x8' Privacy" || s === "WV-ND Bell 4'x6'" }
function isVinylTanND(s: string) { return s === "TV-ND 6'x6' Privacy" || s === "TV-ND 6'x8' Privacy" }
function isVinylWhiteDS(s: string) { return s === "WV-DS 6'x6' Privacy" || s === "WV-DS 6'x8' Privacy" }
function isVinyl6x6(s: string) { return s.includes("6'x6'") || s.includes("Bell") }
function isVinyl6x8(s: string) { return s.includes("6'x8'") }
function isChainlink(s: string) { return s.startsWith("CL -") }
function isChainlinkGalv(s: string) { return s === "CL - 4' Galv" || s === "CL - 5' Galv" || s === "CL - 6' Galv" }
function isChainlinkBlack(s: string) { return s === "CL - 4' Black" || s === "CL - 5' Black" || s === "CL - 6' Black" }
function isCommercial(s: string) { return s.includes("Com 6'") }
function isAlumND(s: string) { return s === "Alum - ND - Emily - 48" }
function isAlumDS(s: string) { return s === "Alum - DS - Emily - 48" }
function is8Wide(s: string) { return s.includes("8'x6'") || s.includes("8'x8'") || s === "Durafence" }
function isDurafence(s: string) { return s === "Durafence" }
function clHeight(s: string): 4 | 5 | 6 { if (s.includes("4'")) return 4; if (s.includes("5'")) return 5; return 6 }

function sectionsPerRun(ft: number, style: string): number {
  if (ft <= 0) return 0
  if (isChainlink(style)) return ft % 10 === 0 ? ft / 10 : Math.ceil(ft / 10)
  if (is8Wide(style) || isDurafence(style)) return ft % 8 === 0 ? ft / 8 : Math.ceil(ft / 8)
  return ft % 6 === 0 ? ft / 6 : Math.ceil(ft / 6)
}

function totalSections(runs: number[], style: string): number {
  return runs.reduce((sum, ft) => sum + sectionsPerRun(ft, style), 0)
}

function linePostsPerRun(ft: number, style: string): number {
  const secs = sectionsPerRun(ft, style)
  return secs > 1 ? secs - 1 : 0
}

function totalLinePosts(runs: number[], style: string): number {
  return runs.reduce((sum, ft) => sum + linePostsPerRun(ft, style), 0)
}

function fabricRolls(totalFt: number): number { return Math.ceil(totalFt / 50) }

// ── Material Calculator (exact port) ─────────────────────────────────────────

function calculateMaterials(input: QuoteInput): LineItem[] {
  const s = input.fenceStyle
  const { runs, corners, ends, walkGates, dblGates } = input
  const tearOutSections = input.tearOutSections || 0
  const tearOutGates = input.tearOutGates || 0

  const sections = totalSections(runs, s)
  const linePosts = totalLinePosts(runs, s)
  const totalFootage = runs.reduce((a, b) => a + b, 0)
  const totalPostCount = corners + ends + linePosts
  const blankPosts = dblGates

  const items: LineItem[] = []
  function add(item: string, qty: number, unitCost: number) {
    if (qty > 0 && unitCost > 0) {
      items.push({ item, qty: round2(qty), unitCost, total: round2(qty * unitCost) })
    }
  }

  // Tear-out
  add('Tear Out Haul-Away Fence', tearOutSections, TEAR_OUT_FENCE)
  add('Tear Out Haul-Away Gate', tearOutGates, TEAR_OUT_GATE)

  // ── VINYL WHITE NO-DIG (WV-ND) ──
  if (isVinylWhiteND(s)) {
    const totalGatePanels = walkGates + dblGates * 2
    const allPosts = totalPostCount + blankPosts
    add("*Vinyl, White, Post, Corner, 5\" x 5\" x 78\"", corners, 11.17)
    add("*Vinyl, White, Post, End, 5\" x 5\" x 78\"", ends, 11.17)
    add("*Vinyl, White, Post, Line, 5\" x 5\" x 78\"", linePosts, 11.17)
    add("*Vinyl, White, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 13.64)
    add('ND, Donut', totalPostCount * 2, 3.19)
    add("Pipe, PT40, Galv, 2-1/2\" x 8'", totalPostCount, 19.50)
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
    add("Misc, Concrete", dblGates, 6.25)
    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", allPosts * 3, 0.123)
    add("**Vinyl, Donut Pin", allPosts * 4, 0.10)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", panelCount * 6, 0.03)
    add("*Vinyl, White, Cap, 5\"x5\"", allPosts, 1.00)
    const gateOpenings = walkGates + dblGates * 2
    if (gateOpenings > 0) add("*Vinyl, Gate, Handle", gateOpenings * 2, 5.98)
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

  // ── VINYL TAN NO-DIG (TV-ND) ──
  if (isVinylTanND(s)) {
    add("*Vinyl, Tan, Post, Corner, 5\" x 5\" x 78\"", corners, 12.90)
    add("*Vinyl, Tan, Post, End, 5\" x 5\" x 78\"", ends, 12.90)
    add("*Vinyl, Tan, Post, Line, 5\" x 5\" x 78\"", linePosts, 12.90)
    add("*Vinyl, Tan, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 16.38)
    add('ND, Donut', totalPostCount * 2 - blankPosts * 2, 3.19)
    add("Pipe, PT40, Galv, 2-1/2\" x 8'", corners + ends + linePosts, 19.50)
    if (isVinyl6x6(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", (sections + walkGates) * 11, 3.22)
      add("*Vinyl, Tan, Rail, 6'", 2 * (sections + walkGates), 7.98)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * (sections + walkGates), 1.85)
    }
    if (isVinyl6x8(s)) {
      add("*Vinyl, Tan, Picket, 62-1/4\"", (sections + walkGates) * 16, 3.22)
      add("*Vinyl, Tan, Rail, 8'", 2 * (sections + walkGates), 10.18)
      add("*Vinyl, Tan, U-Trim, 59-1/4\"", 2 * (sections + walkGates), 1.85)
      add("Vinyl, Rail Insert, 8' ", sections + walkGates, 8.00)
    }
    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 3, 0.123)
    add("**Vinyl, Donut Pin", totalPostCount * 4, 0.10)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * (sections + walkGates), 0.03)
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

  // ── VINYL WHITE DIG-SET (WV-DS) ──
  if (isVinylWhiteDS(s)) {
    add("*Vinyl, White, Post, Corner, 5\" x 5\" x 102\"", corners, 13.64)
    add("*Vinyl, White, Post, End, 5\" x 5\" x 102\"", ends, 13.64)
    add("*Vinyl, White, Post, Line, 5\" x 5\" x 102\"", linePosts, 17.49)
    add("*Vinyl, White, Post, Blank, 5\" x 5\" x 102\"", blankPosts, 13.64)
    add('Misc, Concrete', Math.ceil(corners + ends + linePosts + blankPosts + dblGates * 2), 6.25)
    if (isVinyl6x6(s)) {
      add("*Vinyl, White, Picket, 62-1/4\"", (sections + walkGates) * 11, 2.71)
      add("*Vinyl, White, Rail, 6'", 2 * (sections + walkGates), 5.98)
      add("*Vinyl, White, U-Trim, 59-1/4\"", 2 * (sections + walkGates), 1.62)
    }
    if (isVinyl6x8(s)) {
      add("*Vinyl, White, Picket, 62-1/4\"", (sections + walkGates) * 15, 2.71)
      add("*Vinyl, White, Rail, 8'", 2 * (sections + walkGates), 9.26)
      add("*Vinyl, White, U-Trim, 59-1/4\"", 2 * (sections + walkGates), 1.62)
      add("Vinyl, Rail Insert, 8' ", sections + walkGates, 8.00)
    }
    add("*Vinyl, Hex, 1/4 x 3\" (Rail Ties/Bottom)", totalPostCount * 2, 0.123)
    add("*Vinyl, Truss, 8 x 3/4\" (U-Trim)", 6 * (sections + walkGates), 0.03)
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

  // ── CHAINLINK GALVANIZED ──
  if (isChainlinkGalv(s)) {
    const h = clHeight(s)
    const fabricCost = h === 4 ? 113.43 : h === 5 ? 137.50 : 166.37
    const fabricKey = h === 4 ? "Fabric, Galv, 48\" KK (11.5)" : h === 5 ? "Fabric, Galv, 60\" KK (11.5)" : "Fabric, Galv, 72\" KK (11.5)"
    add(fabricKey, fabricRolls(totalFootage), fabricCost)
    const termPipeCost = h === 4 ? 16.49 : h === 5 ? 18.55 : 20.61
    const termPipeKey = h === 4 ? "Pipe, Galv, 1-5/8\" X 8' (SS40)" : h === 5 ? "Pipe, Galv, 1-5/8\" X 9' (SS40)" : "Pipe, Galv, 1-5/8\" X 10' (SS40)"
    add(termPipeKey, ends, termPipeCost)
    add("Pipe, Galv, 1-3/8\" X 10' 6\" (SS40)", Math.ceil(totalFootage / 10), 10.84)
    const tensionBarCost = h === 4 ? 3.01 : h === 5 ? 3.75 : 4.00
    const tensionBarKey = h === 4 ? "G, Tension Bar, 48\"" : h === 5 ? "G, Tension Bar, 60\"" : "G, Tension Bar, 72\""
    add(tensionBarKey, corners * 2 + ends, tensionBarCost)
    const termPostCost = h === 4 ? 28.13 : h === 5 ? 34.76 : 34.99
    const termPostKey = h === 4 ? "Pipe, Galv, 2-1/2\" X 8' (SS40)" : h === 5 ? "Pipe, Galv, 2-1/2\" X 9' (SS40)" : "Pipe, Galv, 2-1/2\" X 10' (SS40)"
    add(termPostKey, corners + ends, termPostCost)
    const hookTies = Math.ceil((totalFootage * 5 + linePosts * (h - 1)) / 100)
    add("Chainlink, Galv, Hardware, Hook Ties, 6-1/2\" x 9ga (100)", hookTies, 11.00)
    add("G, Hog Ring, 9GA, Alum", sections * 5, 0.02)
    add("G, Wire, Tension, 9GA", totalFootage + 5, 0.062)
    add("G, Band, Brace, PS, 2-3/8\", 3/4", (ends + corners * 2) * 2, 0.69)
    const tensionBands = h === 4 ? corners * 6 + ends * 3 : h === 5 ? corners * 8 + ends * 4 : corners * 10 + ends * 5
    add("G, Band, Tension, PS, 2-3/8\" x 3/4\"", tensionBands, 0.64)
    add("G, Cap, Loop, AL, 1-5/8\" x 1-3/8\"", linePosts, 0.79)
    add("G, Cap, Post, AL, 2-3/8\"", corners + ends, 0.96)
    add("G, Rail End, AL, Offset, 1-3/8\"", corners * 2 + ends, 0.60)
    const bolts5 = h === 4 ? corners * 10 + ends * 5 : h === 5 ? corners * 12 + ends * 6 : corners * 14 + ends * 7
    add("G, Bolt, 5/16 x 1-1/4\" w/ Nut", bolts5, 0.15)
    if (walkGates > 0) {
      add("Chainlink, Galv, Gate, 1-3/8\", 4' x 4' (.055)", walkGates, 85.00)
      add("G, Hinge, Female, 1-3/8\" x 5/8\"", walkGates * 2, 0.83)
      add("G, Hinge, Male, PS, 2-3/8\"", walkGates * 2, 0.83)
      add("G, Fork, PS, 1-3/8\"", walkGates * 2, 1.18)
      add("G, Collar, PS, 1-3/8\" (Set of 2)", walkGates * 2, 1.29)
      add("G, Drop Rod, 24\"", walkGates, 6.88)
      add("G, Bolt, 3/8\" x 2\" w/ Nut", walkGates * 2, 0.34)
      add("G, Bolt, 3/8\" x 3\" w/ Nut", walkGates * 2, 0.41)
    }
    if (dblGates > 0) {
      add("Chainlink, Galv, Gate, 1-3/8\", 4' x 4' (.055)", dblGates * 2, 85.00)
      add("G, Hinge, Female, 1-3/8\" x 5/8\"", dblGates * 4, 0.83)
      add("G, Hinge, Male, PS, 2-3/8\"", dblGates * 4, 0.83)
      add("G, Fork, PS, 2-1/2\"", dblGates * 2, 1.53)
      add("G, Drop Rod, 24\"", dblGates * 2, 6.88)
    }
  }

  // ── CHAINLINK BLACK ──
  if (isChainlinkBlack(s)) {
    const h = clHeight(s)
    const fabricCost = h === 4 ? 116.16 : h === 5 ? 145.20 : 174.24
    const fabricKey = h === 4 ? "Res, Fabric, 48\", Blk, KK (9)" : h === 5 ? "Res, Fabric, 60\", Blk, KK (9)" : "Res, Fabric, 72\", Blk, KK (9)"
    add(fabricKey, fabricRolls(totalFootage), fabricCost)
    const termPipeCost = h === 4 ? 21.50 : h === 5 ? 24.19 : 26.87
    const termPipeKey = h === 4 ? "Pipe, Blk, 1-5/8\" X 8' (SS40)" : h === 5 ? "Pipe, Blk, 1-5/8\" X 9' (SS40)" : "Pipe, Blk, 1-5/8\" X 10' (SS40)"
    add(termPipeKey, ends, termPipeCost)
    add("Pipe, Blk, 1-3/8\" x 10'6\" (.055)", Math.ceil(totalFootage / 10), 13.75)
    const tensionBarCost = h === 4 ? 4.25 : h === 5 ? 5.45 : 4.62
    const tensionBarKey = h === 4 ? "Black, Tension Bar, 48\"" : h === 5 ? "Black, Tension Bar, 60\"" : "Black, Tension Bar, 72\""
    add(tensionBarKey, corners * 2 + ends, tensionBarCost)
    const termPostCost = h === 4 ? 44.07 : h === 5 ? 49.58 : 55.08
    const termPostKey = h === 4 ? "Pipe, Blk, 2-1/2\" X 8' (SS40)" : h === 5 ? "Pipe, Blk, 2-1/2\" X 9' (SS40)" : "Pipe, Blk, 2-1/2\" X 10' (SS40)"
    add(termPostKey, corners + ends, termPostCost)
    const hookTies = Math.ceil((totalFootage * 5 + linePosts * (h - 1)) / 100)
    add("Chainlink, Black, Hardware, Hook Ties, 6-1/2\" x 9ga, AL (100)", hookTies, 14.00)
    add("Black, Hog Ring, 9GA, Alum", sections * 5, 0.02)
    add("Black, Wire, Tension, 9GA", totalFootage + 5, 0.11)
    add("Black, Band, Brace, 2-3/8\", 3/4\"", (ends + corners * 2) * 2, 0.75)
    const tensionBands = h === 4 ? corners * 6 + ends * 3 : h === 5 ? corners * 8 + ends * 4 : corners * 10 + ends * 5
    add("Black, Band, Tension, 2-3/8\" x 3/4\"", tensionBands, 0.75)
    add("Black, Cap, Loop, AL, 1-5/8\" x 1-3/8\"", linePosts, 1.14)
    add("Black, Cap, Post, AL, 2-3/8\"", corners + ends, 1.01)
    add("Black, Rail End, AL, Offset, 1-3/8\"", corners * 2 + ends, 0.75)
    const bolts5 = h === 4 ? corners * 10 + ends * 5 : h === 5 ? corners * 12 + ends * 6 : corners * 14 + ends * 7
    add("Black, Bolt, 5/16 x 1-1/4\" w/ Nut", bolts5, 0.18)
    if (walkGates > 0) {
      add("Chainlink, Black, Gate, 1-3/8\", 4' x 4' (.065)", walkGates, 123.95)
      add("Black, Hinge, Female, 1-3/8\" x 5/8\"", walkGates * 2, 1.24)
      add("Black, Hinge, Male, 2-3/8\"", walkGates * 2, 2.01)
      add("Black, Fork, PS, 1-3/8\" ", walkGates * 2, 1.53)
      add("Black, Collar, PS, 1-3/8\" (Set of 2)", walkGates * 2, 1.63)
      add("Drop Rod, 24\", Black", walkGates, 30.48)
      add("Black, Bolt, 3/8\" x 2\" w/ Nut ", walkGates * 2, 0.41)
      add("Black, Bolt, 3/8\" x 3\" w/ Nut", walkGates * 2, 0.53)
    }
    if (dblGates > 0) {
      add("Chainlink, Black, Gate, 1-3/8\", 4' x 4' (.065)", dblGates * 2, 123.95)
      add("Black, Hinge, Female, 1-3/8\" x 5/8\"", dblGates * 4, 1.24)
      add("Black, Hinge, Male, 2-3/8\"", dblGates * 4, 2.01)
      add("Black, Fork, PS, 2-1/2\"", dblGates * 2, 1.98)
      add("Drop Rod, 48\", Black", dblGates * 2, 48.01)
    }
  }

  // ── COMMERCIAL CHAINLINK ──
  if (isCommercial(s)) {
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

  // ── ALUMINUM NO-DIG ──
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

  // ── ALUMINUM DIG-SET ──
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

  return items
}

// ── Main Quote Calculator ────────────────────────────────────────────────────

export function calculateQuote(input: QuoteInput): QuoteResult {
  const style = FENCE_STYLES.find(s => s.name === input.fenceStyle)
  if (!style) throw new Error(`Unknown fence style: ${input.fenceStyle}`)

  const sections = totalSections(input.runs, input.fenceStyle)
  const totalFootage = input.runs.reduce((a, b) => a + b, 0)

  // Labor
  const baseMH = sections / style.sectionsPerMH
    + input.walkGates * style.mhPerWalkGate
    + input.dblGates * style.mhPerDblGate
  const adjustedMH = baseMH + (input.adjLaborHrs || 0)
  const laborCost = round2(adjustedMH * MAN_HOUR_RATE)

  // Materials
  const pullSheet = calculateMaterials(input)
  const materialCost = round2(pullSheet.reduce((sum, i) => sum + i.total, 0))

  // Tear-out
  const tearOutCost = round2(
    (input.tearOutSections || 0) * TEAR_OUT_FENCE
    + (input.tearOutGates || 0) * TEAR_OUT_GATE
  )

  // COGS
  const totalCOGS = round2(laborCost + materialCost + tearOutCost)

  // Pricing: Price = COGS / MagicNumber
  const basePrice = round2(style.margin > 0 ? totalCOGS / style.margin : 0)
  const adjustedPrice = round2(basePrice * (1 + (input.priceAdjust || 0)))

  // Commission
  const commPct = input.hasSalesman ? 0.10 : 0
  const commissionAmount = round2(adjustedPrice * commPct)

  // Margin
  const grossMargin = round2(adjustedPrice - totalCOGS - commissionAmount)
  const grossMarginPct = adjustedPrice > 0 ? round2(grossMargin / adjustedPrice) : 0

  // Margin status
  let marginStatus: 'good' | 'warning' | 'danger' = 'danger'
  if (grossMarginPct >= MARGIN_GOOD) marginStatus = 'good'
  else if (grossMarginPct >= MARGIN_WARNING) marginStatus = 'warning'

  return {
    fenceStyle: input.fenceStyle,
    fenceStyleDisplay: style.name,
    category: style.category,
    totalFootage,
    sections,
    materialCost,
    laborCost,
    tearOutCost,
    totalCOGS,
    basePrice,
    adjustedPrice,
    commissionAmount,
    finalPrice: adjustedPrice,
    pricePerFoot: totalFootage > 0 ? round2(adjustedPrice / totalFootage) : 0,
    grossMargin,
    grossMarginPct,
    marginStatus,
    manHours: round2(adjustedMH),
    pullSheet,
  }
}

/** Get all available fence styles for the bot to display */
export function getAvailableStyles(): { name: string; category: string }[] {
  return FENCE_STYLES.map(s => ({ name: s.name, category: s.category }))
}

/** Simple estimate from just fence type + footage (for Botpress quick estimate) */
export function quickEstimate(fenceStyle: string, linearFootage: number, walkGates = 1, dblGates = 0): QuoteResult {
  // Create a simple single-run job
  return calculateQuote({
    fenceStyle,
    runs: [linearFootage],
    corners: 4,       // typical residential lot
    ends: 2,
    walkGates,
    dblGates,
  })
}
