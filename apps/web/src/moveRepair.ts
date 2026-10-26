/**
 * Fence moves and repairs: the price of carefully taking a fence down and
 * putting it back up on a new line, or of fixing what broke, for every style,
 * from the style's own numbers (its material kits, its sub install rate or
 * hourly crew rate, its Target Margin) and the rates in Settings → Moves and
 * Repairs. Pure: no React, no storage, no network; QuoteBuilder renders what
 * this returns and tests call it directly.
 *
 * Money is integer cents throughout (each line is rounded to the cent once).
 *
 * MOVE (spec items a to h)
 *   a  careful removal      old sections × sub rate per section × Removal multiplier (1.5),
 *                           old gates × gate sub rate × Gate removal multiplier (1.5)
 *   b  pull old posts       old posts × (pull labor + disposal), no dig and dig set apart
 *   c  all new posts        the style's post kits (line, corner, end, blank) on the new line,
 *                           with new setting material; post caps reused unless "New post caps"
 *   d  reinstall            reused sections × the same install rate as a new fence
 *   e  damage allowance     ceil(reused sections × Damage %) × the section kit
 *   f  gates                every gate rehung with a new hardware kit (hinges and latch);
 *                           "Replace gate" uses the full gate kit
 *   g  longer new line      extra sections priced like a new fence (kits and install labor)
 *   h  shorter new line     leftover sections hauled away at the tear out rate per section
 *   Price = (materials + labor + disposal) ÷ (1 − Target Margin), Target Margin = the style's,
 *   or Overhead % + Repair Profit % when that is set.
 *
 * REPAIR: a price list per style, each item made from kits plus labor
 *   (labor = the sub rate per section, post or gate × the item's multiplier).
 *
 * Wood (wood.ts) is priced on its white vinyl style and its material and labor
 * are multiplied by the Wood factor.
 */

import { calculatePrice, resolveSubRate, adjustedPrice, adjustmentOf, refusedNote, type PricingSettings, type QuotePricingOverrides } from './pricingEngine'
import { inventoryCost, sectionWidthForStyle, type LineItem } from './materialCalculator'
import { kitSetFor, type KitPart, type KitSet } from './materialKits'
import { sectionsForRun, calculateLinePostsPerRun } from './sectionCount'
import type { QuoteStyle } from './quoteCalc'
import { woodPartName } from './wood'

// ── Settings ─────────────────────────────────────────────────────────────────

export type JobType = 'new' | 'move' | 'repair'
export type PostType = 'nd' | 'ds'
// The repair items' names, and a repair's or move's work in words: one file for the server and the app.
import { REPAIR_ITEMS, REPAIR_LABEL, workScope, workSummary, type RepairItemKey } from '../../portal/src/server/lib/workWords'
export { REPAIR_ITEMS, REPAIR_LABEL, workScope, workSummary, type RepairItemKey }

export interface MoveRepairSettings {
  /** Careful removal labor = install rate per section × this. */
  removalMultiplier: number
  /** Gate removal labor = gate install rate × this. */
  gateRemovalMultiplier: number
  /** Per post, integer cents; null = not set yet (the quote warns and counts $0). */
  pullNdLaborCents: number | null
  pullNdDisposalCents: number | null
  pullDsLaborCents: number | null
  pullDsDisposalCents: number | null
  /** % of reused sections that need new panel parts on a move. */
  damagePctDefault: number
  /** Per style (internal name): its own damage %. */
  damagePctByStyle: Record<string, number>
  /** Blank: each style's own Target Profit %. */
  repairProfitPct: number | null
  /** Minimum job price, integer cents. */
  minimumJobCents: number
  /** Also apply the minimum to new fences (off by default). */
  minimumAppliesToNew: boolean
  /** Wood is priced at the matching white vinyl × this % (115). */
  woodFactorPct: number
  /** Labor multiplier per repair item (× the install rate per section, post or gate). */
  itemMultipliers: Record<Exclude<RepairItemKey, 'haulDebris'>, number>
  /** Photos needed before a move or repair proposal can be sent. */
  photosRequired: number
}

export const DEFAULT_MOVE_REPAIR: MoveRepairSettings = {
  removalMultiplier: 1.5,
  gateRemovalMultiplier: 1.5,
  pullNdLaborCents: null,
  pullNdDisposalCents: null,
  pullDsLaborCents: null,
  pullDsDisposalCents: null,
  damagePctDefault: 15,
  damagePctByStyle: {},
  repairProfitPct: null,
  minimumJobCents: 35000,
  minimumAppliesToNew: false,
  woodFactorPct: 115,
  itemMultipliers: { resetPost: 1.5, replacePost: 1.5, repairSection: 1, replaceSection: 1.5, rehangGate: 1, replaceGate: 1.5 },
  photosRequired: 2,
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nonNeg = (v: unknown, d: number) => { const n = num(v); return n !== null && n >= 0 ? n : d }

/** Settings → Moves and Repairs with every default filled in. */
export function moveRepairSettings(cfg: { moveRepair?: Partial<MoveRepairSettings> | null } | null | undefined): MoveRepairSettings {
  const s = cfg?.moveRepair ?? {}
  const d = DEFAULT_MOVE_REPAIR
  const cents = (v: unknown) => { const n = num(v); return n !== null && n >= 0 ? Math.round(n) : null }
  const im = (s.itemMultipliers ?? {}) as Partial<MoveRepairSettings['itemMultipliers']>
  return {
    removalMultiplier: nonNeg(s.removalMultiplier, d.removalMultiplier),
    gateRemovalMultiplier: nonNeg(s.gateRemovalMultiplier, d.gateRemovalMultiplier),
    pullNdLaborCents: cents(s.pullNdLaborCents),
    pullNdDisposalCents: cents(s.pullNdDisposalCents),
    pullDsLaborCents: cents(s.pullDsLaborCents),
    pullDsDisposalCents: cents(s.pullDsDisposalCents),
    damagePctDefault: Math.min(100, nonNeg(s.damagePctDefault, d.damagePctDefault)),
    damagePctByStyle: s.damagePctByStyle && typeof s.damagePctByStyle === 'object' ? { ...s.damagePctByStyle } : {},
    repairProfitPct: num(s.repairProfitPct),
    minimumJobCents: Math.round(nonNeg(s.minimumJobCents, d.minimumJobCents)),
    minimumAppliesToNew: !!s.minimumAppliesToNew,
    woodFactorPct: num(s.woodFactorPct) !== null && (s.woodFactorPct as number) > 0 ? (s.woodFactorPct as number) : d.woodFactorPct,
    itemMultipliers: Object.fromEntries(Object.entries(d.itemMultipliers).map(([k, v]) => [k, nonNeg(im[k as keyof typeof im], v)])) as MoveRepairSettings['itemMultipliers'],
    photosRequired: Math.round(nonNeg(s.photosRequired, d.photosRequired)),
  }
}

/** The settings still blank (shown on the Settings page and in reports). */
export function blankSettings(s: MoveRepairSettings): string[] {
  const out: string[] = []
  if (s.pullNdLaborCents === null) out.push('Pull labor per post, no dig')
  if (s.pullNdDisposalCents === null) out.push('Disposal per post, no dig')
  if (s.pullDsLaborCents === null) out.push('Pull labor per post, dig set (concrete)')
  if (s.pullDsDisposalCents === null) out.push('Disposal per post, dig set (concrete)')
  if (s.repairProfitPct === null) out.push('Repair Profit % (blank uses each style\'s Target Profit %)')
  return out
}

/** Damage % for a style: its own, else the default. */
export function damagePctFor(s: MoveRepairSettings, styleName: string): number {
  const v = s.damagePctByStyle[styleName]
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100, v) : s.damagePctDefault
}

// ── Who sees costs ───────────────────────────────────────────────────────────

/** The internal breakdown (every cost line): owner, admins, managers, the office and the Salesman (costs.view, Oct 25, 2026); never the crew or a customer. */
export function seesCosts(role: string | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'manager' || role === 'office_staff' || role === 'sales_rep'
}

// ── Parts ────────────────────────────────────────────────────────────────────

/** Post caps (reused on a move unless "New post caps"); gate caps are part of the gate. */
export const isCap = (part: string) => /\bcap\b/i.test(part) && !/gate/i.test(part)
/** What sets a post: pipe and donuts (no dig) or concrete (dig set). */
export const isSetting = (part: string) => /donut|pt40|concrete/i.test(part)
/** A gate's hardware kit: hinges and latch (chain link's latch is the fork). */
export const isGateHardware = (part: string) => /hinge|latch|\bfork\b/i.test(part)
/** Small hardware a reinstalled chain link or aluminum section gets new: ties, hog rings, screws, bolts, brackets. */
export const isSectionHardware = (part: string) => /\btie|hog ring|\bhex\b|bolt|screw|bracket|clip/i.test(part)
/** Chain link damage allowance: fabric and top rail. */
const isFabricOrRail = (part: string) => /fabric|pipe/i.test(part)
/** Chain link hook ties (counted per section, in the section kit). */
const isHookTie = (part: string) => /hook tie/i.test(part)

type Bag = Map<string, number>
const addTo = (bag: Bag, parts: KitPart[] | undefined, n: number, keep: (p: string) => boolean = () => true) => {
  if (!(n > 0)) return
  for (const p of parts ?? []) if (keep(p.part)) bag.set(p.part, (bag.get(p.part) ?? 0) + p.qty * n)
}

export interface CostLine {
  key: string
  /** Shown as the group heading on the internal breakdown. */
  label: string
  kind: 'material' | 'labor' | 'disposal'
  cents: number
  /** "17 sections × $23.00 × 1.5" */
  math: string
  /** A rate that is not set: counted $0 and warned. */
  missing?: boolean
  /** Parts behind a material line. */
  parts?: LineItem[]
}

export interface StyleRates {
  laborMode: 'subcontractor' | 'hourly' | 'flat'
  /** Dollars, per section, walk gate, double gate. null = no rate set. */
  perSection: number | null
  perWalkGate: number | null
  perDblGate: number | null
  /** How the section rate was found, for the breakdown. */
  sectionText: string
  /** Tear out per section and per gate, dollars (haul away + tear out + sub tear out), as a new fence's tear out is charged. */
  tearOutSection: number
  tearOutGate: number
  tearOutText: string
  tearOutGateText: string
}

const usd = (n: number) => `$${n.toFixed(2)}`

/** Install rates for a style, the way a new fence of that style is charged (sub per section or per foot × width, or hourly). */
export function styleRates(style: QuoteStyle, pricing: PricingSettings, o: QuotePricingOverrides = {}): StyleRates {
  const mode = o.laborMode ?? pricing.laborMode ?? 'hourly'
  const width = workWidth(style)
  const haul = inventoryCost('Tear Out Haul-Away Fence') ?? 9.5
  const haulGate = inventoryCost('Tear Out Haul-Away Gate') ?? 27
  const t = Number(pricing.tearOutFence) || 0, tg = Number(pricing.tearOutGate) || 0
  const subT = mode === 'subcontractor' ? Number(pricing.subTearOutSection) || 0 : 0
  const subTG = mode === 'subcontractor' ? Number(pricing.subTearOutGate) || 0 : 0
  const tearOut = {
    tearOutSection: haul + t + subT, tearOutGate: haulGate + tg + subTG,
    tearOutText: `haul away ${usd(haul)} + tear out ${usd(t)}${mode === 'subcontractor' ? ` + sub tear out ${usd(subT)}` : ''}`,
    tearOutGateText: `haul away ${usd(haulGate)} + tear out ${usd(tg)}${mode === 'subcontractor' ? ` + sub tear out ${usd(subTG)}` : ''}`,
  }
  if (mode === 'subcontractor') {
    const unit = o.subUnit ?? pricing.subUnit ?? 'foot'
    const rate = resolveSubRate(style, pricing, o.subRate)
    const per = rate > 0 ? (unit === 'section' ? rate : rate * width) : null
    const g = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
    return {
      laborMode: 'subcontractor', perSection: per, perWalkGate: g(pricing.subWalkGate), perDblGate: g(pricing.subDblGate),
      sectionText: rate > 0 ? (unit === 'section' ? `sub ${usd(rate)}/section` : `sub ${usd(rate)}/ft × ${width} ft`) : 'no sub rate',
      ...tearOut,
    }
  }
  const mh = Number(pricing.manHourRate) || 0
  const spm = Number(style.sectionsPerMH) || 0
  return {
    laborMode: 'hourly', perSection: spm > 0 && mh > 0 ? mh / spm : null,
    perWalkGate: mh > 0 ? (style.mhPerWalkGate ?? 2.4) * mh : null, perDblGate: mh > 0 ? (style.mhPerDblGate ?? 4.8) * mh : null,
    sectionText: spm > 0 ? `hourly ${usd(mh)}/hr ÷ ${spm} sections per man hour` : 'no man hour rate',
    ...tearOut,
  }
}

/** Section width a move or repair is counted at. Auto mix styles count 6 ft panels (pick an 8 ft panel style for 8 ft). */
export function workWidth(style: QuoteStyle): number {
  return style.autoRailMix ? 6 : sectionWidthForStyle(style.name, style.panelWidth)
}

/** The style's install method: from the style, else its name or choices; dig set when not known. */
export function postTypeOf(style: QuoteStyle & { choices?: Record<string, string> }): PostType {
  const s = style.woodBase ?? style
  if (s.installMethod) return s.installMethod === 'no-dig' ? 'nd' : 'ds'
  if (/(^|[\s-])ND([\s-]|$)/.test(s.name)) return 'nd'
  if ((style as { choices?: Record<string, string> }).choices?.install === 'nd') return 'nd'
  return 'ds'
}

/** The kit set a style's moves and repairs read (wood: its vinyl style's; auto mix: its own). */
export function workKit(style: QuoteStyle): KitSet | null {
  const key = style.kitKey || style.name
  const k = kitSetFor(key)
  return k && k !== 'archived' && !k.mismatch ? k : null
}

/** Price a bag of parts from Inventory (fallback cost when missing, warned), rounded up where the kit says. */
function priceBag(bag: Bag, kit: KitSet, missing: Set<string>, zeroCost = false): { cents: number; items: LineItem[] } {
  const up = new Set(kit.roundUp)
  const fallback = new Map<string, number>()
  for (const parts of Object.values(kit.kits)) for (const p of parts ?? []) if (!fallback.has(p.part)) fallback.set(p.part, p.fallbackCost)
  let cents = 0
  const items: LineItem[] = []
  for (const [part, q0] of bag) {
    const exact = Math.round(q0 * 1e6) / 1e6
    const qty = up.has(part) ? Math.ceil(exact) : exact
    if (!(qty > 0)) continue
    const inv = inventoryCost(part)
    if (inv === undefined && !zeroCost) missing.add(part)
    const unit = zeroCost ? 0 : inv ?? fallback.get(part) ?? 0
    const c = Math.round(qty * unit * 100)
    cents += c
    items.push({ item: part, qty: Math.round(qty * 100) / 100, unitCost: unit, total: c / 100, costSource: zeroCost ? 'wood' : inv === undefined ? 'builtin' : 'inventory' })
  }
  return { cents, items }
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface MoveInputs {
  oldFt: number
  /** Blank: ceil(old ft ÷ section width). */
  oldSections?: number | null
  oldWalkGates: number
  oldDblGates: number
  /** Blank: old sections + old gates + 1 (a straight line). */
  oldPosts?: number | null
  oldPostType: PostType
  newPostCaps: boolean
  /** 0 to 100; blank: the style's (Settings). */
  damagePct?: number | null
  /** Gates on the new line to replace with a whole new gate kit, by index (walk gates first, then double gates). */
  replaceGates?: boolean[]
  /** Optional: the old line drawn dashed on the site plan, along a side of the new line, this many feet inside it. */
  oldLinePlan?: { sideId: string; offsetFt: number } | null
}

export interface RepairInputs {
  what: 'leaning' | 'storm' | 'gate' | 'other'
  items: Partial<Record<RepairItemKey, number>>
  /** "Repair a section": the parts each section gets (default: the whole section kit). */
  repairParts?: Array<{ part: string; qty: number }> | null
  postType: PostType
  newPostCaps: boolean
  /** Gate items are for a walk gate or a double gate. */
  gateKind: 'walk' | 'double'
  /** Tree or storm: tree and debris cleared before we start (or added as an item). */
  debrisCleared?: boolean
  /** Sections tapped on the site plan ("run:index"). */
  tapped?: string[]
}

export interface NewLine {
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
}

export interface WorkCommon {
  style: QuoteStyle
  pricing: PricingSettings
  overrides?: QuotePricingOverrides
  settings: MoveRepairSettings
  /** Overhead % in use (for Repair Profit %). */
  overheadPct: number
  hasSalesman: boolean
  priceAdjust: number
  extraLaborHrs: number
}

export interface WorkResult {
  type: 'move' | 'repair'
  lines: CostLine[]
  materialCents: number
  laborCents: number
  disposalCents: number
  costCents: number
  /** 1 − Target Margin used. */
  costFactor: number
  targetMarginPct: number
  /** Where the margin came from. */
  marginFrom: string
  /** Cost ÷ factor. */
  basePriceCents: number
  priceCents: number
  /** Cents the price was rounded down by to the whole dollar (out of profit). */
  roundingCents: number
  /** The price with no ± dollar adjustment (cents): the proposal's list price. */
  listCents: number
  /** The ± dollar adjustment applied (cents, out of profit); 0 when none or refused. */
  adjustmentCents: number
  adjustmentRefused: boolean
  commissionCents: number
  grossMarginCents: number
  gmPct: number
  minimumApplied: boolean
  minimumCents: number
  /** Price was typed by hand. */
  manual: boolean
  /** New material only: the pull sheet. */
  pullSheet: LineItem[]
  warnings: string[]
  /** Plain words for the customer. */
  description: string
  /** For the crew packet. */
  crew: string[]
  /** Any new post goes in the ground: an 811 ticket is needed. */
  needs811: boolean
  sections: number
  footage: number
  manHours: number
  wood?: { factor: number; vinylMaterialCents: number; vinylLaborCents: number; base: string }
}

// ── Move ─────────────────────────────────────────────────────────────────────

function newLineCounts(line: NewLine, width: number) {
  const perRun = line.runs.map(ft => sectionsForRun(ft, width))
  const sections = perRun.reduce((t, n) => t + n, 0)
  const linePosts = calculateLinePostsPerRun(perRun.filter(n => n > 0)).reduce((t, n) => t + n, 0)
  return { perRun, sections, linePosts, footage: line.runs.reduce((t, n) => t + (n > 0 ? n : 0), 0) }
}

/**
 * Old line facts with blanks filled in. The footage is fence only (gates not
 * counted). Each gate splits the line, so sections are counted per run (the
 * line in gates + 1 equal runs, each rounded up), the way a new line is; posts
 * are one per section plus one to end each run.
 */
export function oldLine(m: MoveInputs, width: number) {
  const gates = (m.oldWalkGates || 0) + (m.oldDblGates || 0)
  const runs = gates + 1
  const sections = typeof m.oldSections === 'number' && m.oldSections >= 0 ? Math.round(m.oldSections) : m.oldFt > 0 ? runs * sectionsForRun(m.oldFt / runs, width) : 0
  const posts = typeof m.oldPosts === 'number' && m.oldPosts >= 0 ? Math.round(m.oldPosts) : sections > 0 ? sections + runs : 0
  return { sections, posts }
}

interface Acc {
  lines: CostLine[]
  warnings: string[]
  missingRates: string[]
  missingParts: Set<string>
  pull: Bag
}

function line(acc: Acc, l: CostLine) { if (l.cents !== 0 || l.missing || l.math) acc.lines.push(l) }

function laborLine(acc: Acc, key: string, label: string, qty: number, rate: number | null, mult: number, unit: string, rateText: string, missingName: string) {
  if (!(qty > 0)) return
  if (rate === null) acc.missingRates.push(missingName)
  const r = rate ?? 0
  line(acc, { key, label, kind: 'labor', cents: Math.round(qty * r * mult * 100), math: `${qty} ${unit} × ${usd(r)}${mult !== 1 ? ` × ${mult}` : ''} (${rateText})`, ...(rate === null ? { missing: true } : {}) })
}

function materialLine(acc: Acc, kit: KitSet, key: string, label: string, bag: Bag, math: string) {
  if (bag.size === 0) return
  const { cents, items } = priceBag(bag, kit, acc.missingParts)
  if (!items.length) return
  for (const i of items) acc.pull.set(i.item, (acc.pull.get(i.item) ?? 0) + i.qty)
  line(acc, { key, label, kind: 'material', cents, math, parts: items })
}

function pullPosts(acc: Acc, s: MoveRepairSettings, n: number, type: PostType, keyPrefix: string) {
  if (!(n > 0)) return
  const nd = type === 'nd'
  const labor = nd ? s.pullNdLaborCents : s.pullDsLaborCents
  const disp = nd ? s.pullNdDisposalCents : s.pullDsDisposalCents
  const t = nd ? 'no dig' : 'dig set, concrete'
  if (labor === null) acc.missingRates.push(`pull labor per post (${t})`)
  if (disp === null) acc.missingRates.push(`disposal per post (${t})`)
  line(acc, { key: `${keyPrefix}pull`, label: `Pull old posts (${t})`, kind: 'labor', cents: n * (labor ?? 0), math: `${n} posts × ${usd((labor ?? 0) / 100)}`, ...(labor === null ? { missing: true } : {}) })
  line(acc, { key: `${keyPrefix}disposal`, label: `Disposal of old posts (${t})`, kind: 'disposal', cents: n * (disp ?? 0), math: `${n} posts × ${usd((disp ?? 0) / 100)}`, ...(disp === null ? { missing: true } : {}) })
}

/**
 * One section's parts for damage and repairs: the section kit plus its share
 * of per foot parts (no posts). Chain link: fabric and top rail, and on a
 * repaired section its hook ties too (the move's damage allowance leaves the
 * ties out: every reinstalled section already gets new ties).
 */
function sectionParts(kit: KitSet, width: number, chain: boolean, ties = false): Bag {
  const b: Bag = new Map()
  const keep = (p: string) => !chain || isFabricOrRail(p) || (ties && isHookTie(p))
  addTo(b, kit.kits.section, 1, keep)
  addTo(b, kit.kits.perFoot, width, keep)
  return b
}
const scale = (b: Bag, n: number): Bag => new Map([...b].map(([k, v]) => [k, v * n]))

export function priceMove(c: WorkCommon, m: MoveInputs, nl: NewLine): WorkResult {
  if (c.style.woodBase) return woodWork(c, w => priceMove(w, m, nl))
  const { style, settings: s } = c
  const kit = workKit(style)
  const width = workWidth(style)
  const rates = styleRates(style, c.pricing, c.overrides)
  const acc: Acc = { lines: [], warnings: [], missingRates: [], missingParts: new Set(), pull: new Map() }
  const old = oldLine(m, width)
  const nw = newLineCounts(nl, width)
  const chain = style.category === 'Chainlink' || style.category === 'Commercial'
  const alum = style.category === 'Aluminum'
  const reused = Math.min(old.sections, nw.sections)
  const extra = Math.max(0, nw.sections - old.sections)
  const leftover = Math.max(0, old.sections - nw.sections)
  const oldGates = { walk: m.oldWalkGates || 0, dbl: m.oldDblGates || 0 }
  const reWalk = Math.min(oldGates.walk, nl.walkGates), reDbl = Math.min(oldGates.dbl, nl.dblGates)
  const addWalk = Math.max(0, nl.walkGates - oldGates.walk), addDbl = Math.max(0, nl.dblGates - oldGates.dbl)
  const goneWalk = Math.max(0, oldGates.walk - nl.walkGates), goneDbl = Math.max(0, oldGates.dbl - nl.dblGates)
  const replace = m.replaceGates ?? []
  const repl = { walk: 0, dbl: 0 }
  for (let i = 0; i < reWalk; i++) if (replace[i]) repl.walk++
  for (let i = 0; i < reDbl; i++) if (replace[nl.walkGates + i]) repl.dbl++
  const damagePct = Math.min(100, Math.max(0, typeof m.damagePct === 'number' && Number.isFinite(m.damagePct) ? m.damagePct : damagePctFor(s, style.name)))
  const damaged = Math.ceil(reused * damagePct / 100 - 1e-9)

  // a. Careful removal
  laborLine(acc, 'removal', 'Careful removal of the old fence', old.sections, rates.perSection, s.removalMultiplier, 'sections', rates.sectionText, 'section (install rate)')
  laborLine(acc, 'removalWalk', 'Careful removal of walk gates', oldGates.walk, rates.perWalkGate, s.gateRemovalMultiplier, 'walk gates', 'walk gate rate', 'walk gate')
  laborLine(acc, 'removalDbl', 'Careful removal of double gates', oldGates.dbl, rates.perDblGate, s.gateRemovalMultiplier, 'double gates', 'double gate rate', 'double gate')
  // b. Pull old posts and dispose of them
  pullPosts(acc, s, old.posts, m.oldPostType, '')

  if (!kit) acc.warnings.push(`"${style.label || style.name}" has no material kit in use, so no new material is priced. Check Inventory > Material Kits.`)
  else {
    // c. All new posts, with new setting material; caps reused unless asked.
    const posts: Bag = new Map(), setting: Bag = new Map(), caps: Bag = new Map()
    const counts: Array<[keyof KitSet['kits'], number]> = [['line', nw.linePosts], ['corner', nl.corners], ['end', nl.ends], ['blank', nl.dblGates]]
    for (const [k, n] of counts) {
      addTo(posts, kit.kits[k], n, p => !isSetting(p) && !isCap(p))
      addTo(setting, kit.kits[k], n, isSetting)
      if (m.newPostCaps) addTo(caps, kit.kits[k], n, isCap)
    }
    const postCount = nw.linePosts + nl.corners + nl.ends + nl.dblGates
    materialLine(acc, kit, 'newPosts', 'All new posts on the new line', posts, `${postCount} posts (${nw.linePosts} line, ${nl.corners} corner, ${nl.ends} end and gate${nl.dblGates ? `, ${nl.dblGates} center of double gate` : ''}) from the post kits`)
    materialLine(acc, kit, 'setting', postTypeOf(style) === 'nd' ? 'New setting material (pipe and donuts)' : 'New setting material (concrete)', setting, `post kits' setting parts for ${postCount} posts`)
    if (m.newPostCaps) materialLine(acc, kit, 'caps', 'New post caps', caps, `${postCount} posts`)
    // Chain link and aluminum: every reinstalled section gets new small hardware
    // (chain link: its hook ties, per section in the section kit, and hog rings).
    if (chain || alum) {
      const hw: Bag = new Map()
      addTo(hw, kit.kits.section, reused, isSectionHardware)
      addTo(hw, kit.kits.perFoot, Math.min(m.oldFt, nw.footage), isSectionHardware)
      materialLine(acc, kit, 'hardware', chain ? 'New ties and hog rings' : 'New panel hardware', hw, `${reused} reinstalled sections`)
    }
    // e. Damage allowance
    if (damaged > 0) materialLine(acc, kit, 'damage', `Damage allowance (${damagePct}% of ${reused} sections)`, scale(sectionParts(kit, width, chain), damaged), `ceil(${reused} × ${damagePct}%) = ${damaged} sections × the section kit${chain ? ' (fabric and top rail)' : ''}`)
    // f. Gates: new hardware on every rehung gate; a replaced gate gets its whole kit.
    const hwBag: Bag = new Map()
    addTo(hwBag, kit.kits.walkGate, reWalk - repl.walk, isGateHardware)
    addTo(hwBag, kit.kits.dblGate, reDbl - repl.dbl, isGateHardware)
    materialLine(acc, kit, 'gateHardware', 'New gate hardware (hinges and latch)', hwBag, `${reWalk - repl.walk + reDbl - repl.dbl} rehung gate${reWalk - repl.walk + reDbl - repl.dbl === 1 ? '' : 's'}`)
    const gateBag: Bag = new Map()
    addTo(gateBag, kit.kits.walkGate, repl.walk + addWalk)
    addTo(gateBag, kit.kits.dblGate, repl.dbl + addDbl)
    materialLine(acc, kit, 'newGates', 'New gates (whole gate kit)', gateBag, `${repl.walk + repl.dbl} replaced${addWalk + addDbl ? `, ${addWalk + addDbl} added on the new line` : ''}`)
    // g. Extra sections on a longer line: like a new fence.
    if (extra > 0) {
      const b: Bag = new Map()
      addTo(b, kit.kits.section, extra)
      addTo(b, kit.kits.perFoot, Math.max(0, nw.footage - m.oldFt))
      materialLine(acc, kit, 'extra', `Extra length: ${extra} new sections`, b, `${extra} sections × the section kit${kit.kits.perFoot ? ` + ${Math.max(0, nw.footage - m.oldFt)} ft of per foot parts` : ''}`)
    }
  }
  // d. Reinstall at the new fence install rate; extra sections and added gates the same.
  laborLine(acc, 'reinstall', 'Reinstall on the new line', reused, rates.perSection, 1, 'sections', rates.sectionText, 'section (install rate)')
  laborLine(acc, 'rehangWalk', 'Rehang walk gates', reWalk, rates.perWalkGate, 1, 'walk gates', 'walk gate rate', 'walk gate')
  laborLine(acc, 'rehangDbl', 'Rehang double gates', reDbl, rates.perDblGate, 1, 'double gates', 'double gate rate', 'double gate')
  laborLine(acc, 'extraLabor', 'Install the extra sections', extra, rates.perSection, 1, 'sections', rates.sectionText, 'section (install rate)')
  laborLine(acc, 'addWalk', 'Install added walk gates', addWalk, rates.perWalkGate, 1, 'walk gates', 'walk gate rate', 'walk gate')
  laborLine(acc, 'addDbl', 'Install added double gates', addDbl, rates.perDblGate, 1, 'double gates', 'double gate rate', 'double gate')
  // h. Leftover sections (and gates) hauled away at the tear out rate.
  if (leftover > 0) line(acc, { key: 'leftover', label: `Haul away ${leftover} leftover sections`, kind: 'disposal', cents: Math.round(leftover * rates.tearOutSection * 100), math: `${leftover} sections × ${usd(rates.tearOutSection)} tear out rate (${rates.tearOutText})` })
  if (goneWalk + goneDbl > 0) line(acc, { key: 'leftoverGates', label: `Haul away ${goneWalk + goneDbl} leftover gates`, kind: 'disposal', cents: Math.round((goneWalk + goneDbl) * rates.tearOutGate * 100), math: `${goneWalk + goneDbl} gates × ${usd(rates.tearOutGate)} (${rates.tearOutGateText})` })

  const gatesWord = gatesText(oldGates.walk, oldGates.dbl)
  const parts = [
    `Carefully remove ${fmtFt(m.oldFt)} of fence${gatesWord ? ` and ${gatesWord}` : ''}, reinstall on the new line with all new posts`,
    reWalk + reDbl > 0 ? 'new gate hardware' : '',
    damaged > 0 ? 'replace damaged parts as needed' : '',
    'haul away old posts',
  ].filter(Boolean)
  let description = parts.join(', ')
  if (extra > 0) description += `, plus ${fmtFt(Math.max(0, nw.footage - m.oldFt))} of new fence for the extra length`
  if (leftover > 0) description += `, and haul away the ${leftover} leftover section${leftover === 1 ? '' : 's'}`
  description += '.'
  if (m.newPostCaps) description = description.replace('all new posts', 'all new posts and post caps')

  const crew = [
    `Before taking it down: number each section and gate in order and stack them in that order (${old.sections} sections${gatesWord ? `, ${gatesWord}` : ''}).`,
    `Pull all ${old.posts} old posts (${m.oldPostType === 'nd' ? 'no dig: pull the pipe and donuts' : 'dig set: posts come out with their concrete'}) and haul them away.`,
    `Set all new posts on the new line: ${nw.linePosts + nl.corners + nl.ends + nl.dblGates} posts, ${nw.sections} sections at the post spacing on the plan.`,
    reWalk + reDbl > 0 ? `Rehang ${reWalk + reDbl} gate${reWalk + reDbl === 1 ? '' : 's'} with new hinges and latch${repl.walk + repl.dbl ? ` (${repl.walk + repl.dbl} replaced with a new gate)` : ''}.` : '',
    damaged > 0 ? `Replace damaged parts as needed (allowance: ${damaged} section${damaged === 1 ? '' : 's'} of parts on the truck).` : '',
    extra > 0 ? `Build ${extra} new section${extra === 1 ? '' : 's'} for the extra length.` : '',
    leftover > 0 ? `Haul away ${leftover} leftover section${leftover === 1 ? '' : 's'}.` : '',
    m.newPostCaps ? 'New post caps on every post.' : 'Reuse the old post caps.',
  ].filter(Boolean)

  const mh = Number(style.sectionsPerMH) > 0 ? (old.sections * s.removalMultiplier + nw.sections) / Number(style.sectionsPerMH) : 0
  return finish(c, 'move', acc, kit, description, crew, true, nw.sections, nw.footage, mh)
}

// ── Repair ───────────────────────────────────────────────────────────────────

export const REPAIR_HINT: Record<RepairItemKey, string> = {
  resetPost: 'Pull it, new post and setting material, rehang the sections on it',
  replacePost: 'New post and setting material; dig set adds the concrete pull and disposal',
  repairSection: 'New pickets or rails only, reuse what is good',
  replaceSection: 'A whole new section',
  rehangGate: 'New hinges and latch',
  replaceGate: 'The whole gate kit',
  haulDebris: 'At the tear out rate per section',
}

/** What each "What happened?" answer starts the list with. */
export const WHAT_HAPPENED: Record<RepairInputs['what'], { label: string; items: Partial<Record<RepairItemKey, number>> }> = {
  leaning: { label: 'Leaning fence', items: { resetPost: 1 } },
  storm: { label: 'Tree or storm damage', items: { replaceSection: 1, replacePost: 1, haulDebris: 1 } },
  gate: { label: 'Broken or sagging gate', items: { rehangGate: 1 } },
  other: { label: 'Other', items: {} },
}

/**
 * What a "What happened?" answer put in the list, said out loud so it is not
 * added a second time (Oct 24, 2026 walkthrough: "Broken or sagging gate"
 * quietly added a gate rehang below the fold). Only the items still at a
 * count above 0; null when the answer added nothing that is still there.
 */
export function starterNote(what: RepairInputs['what'], items: Partial<Record<RepairItemKey, number>>): string | null {
  const start = WHAT_HAPPENED[what]
  if (!start) return null
  const kept = (Object.keys(start.items) as RepairItemKey[]).filter(k => (items[k] ?? 0) > 0)
  if (!kept.length) return null
  const list = kept.map(k => `${items[k]} × ${REPAIR_LABEL[k]}`).join(', ')
  return `"${start.label}" added ${list} to the list below. It is counted once: change the number there, do not add it again.`
}

/** The items a "What happened?" answer started the list with (marked in the list). */
export const isStarterItem = (what: RepairInputs['what'], k: RepairItemKey) => (WHAT_HAPPENED[what]?.items[k] ?? 0) > 0

/** The parts a "Repair a section" can use:the section kit (and its per foot share), with full quantities. */
export function repairPartChoices(style: QuoteStyle): Array<{ part: string; qty: number }> {
  const kit = workKit(style.woodBase ?? style)
  if (!kit) return []
  const chain = style.category === 'Chainlink' || style.category === 'Commercial'
  return [...sectionParts(kit, workWidth(style.woodBase ?? style), chain, true)].map(([part, qty]) => ({ part, qty: Math.round(qty * 1000) / 1000 }))
}

export function priceRepair(c: WorkCommon, r: RepairInputs): WorkResult {
  if (c.style.woodBase) return woodWork(c, w => priceRepair(w, r))
  const { style, settings: s } = c
  const kit = workKit(style)
  const width = workWidth(style)
  const rates = styleRates(style, c.pricing, c.overrides)
  const acc: Acc = { lines: [], warnings: [], missingRates: [], missingParts: new Set(), pull: new Map() }
  const q = (k: RepairItemKey) => Math.max(0, Math.round(r.items[k] ?? 0))
  const mult = s.itemMultipliers
  const chain = style.category === 'Chainlink' || style.category === 'Commercial'
  const gateRate = r.gateKind === 'double' ? rates.perDblGate : rates.perWalkGate
  const gateKit = r.gateKind === 'double' ? 'dblGate' : 'walkGate'
  const gateWord = r.gateKind === 'double' ? 'double gate' : 'walk gate'

  for (const k of ['resetPost', 'replacePost'] as const) {
    const n = q(k)
    if (!n) continue
    pullPosts(acc, s, n, r.postType, `${k}:`)
    if (kit) {
      const b: Bag = new Map()
      addTo(b, kit.kits.line, n, p => r.newPostCaps || !isCap(p))
      materialLine(acc, kit, `${k}:post`, `${REPAIR_LABEL[k]}: new post and setting material`, b, `${n} × the line post kit${r.newPostCaps ? '' : ' (cap reused)'}`)
    }
    laborLine(acc, `${k}:labor`, `${REPAIR_LABEL[k]}: labor`, n, rates.perSection, mult[k], 'posts', `${rates.sectionText}, per post`, 'section (install rate)')
  }
  const rs = q('repairSection')
  if (rs) {
    if (kit) {
      const chosen = r.repairParts && r.repairParts.length ? new Map(r.repairParts.filter(p => p.qty > 0).map(p => [p.part, p.qty] as [string, number])) : sectionParts(kit, width, chain, true)
      materialLine(acc, kit, 'repairSection:parts', `${REPAIR_LABEL.repairSection}: parts`, scale(chosen, rs), `${rs} × ${[...chosen].map(([p, n]) => `${Math.round(n * 1000) / 1000} ${p.replace(/^\*+/, '')}`).join(', ')}`)
    }
    laborLine(acc, 'repairSection:labor', `${REPAIR_LABEL.repairSection}: labor`, rs, rates.perSection, mult.repairSection, 'sections', rates.sectionText, 'section (install rate)')
  }
  const rp = q('replaceSection')
  if (rp) {
    if (kit) materialLine(acc, kit, 'replaceSection:parts', `${REPAIR_LABEL.replaceSection}: section kit`, scale(sectionParts(kit, width, false), rp), `${rp} × the section kit`)
    laborLine(acc, 'replaceSection:labor', `${REPAIR_LABEL.replaceSection}: labor`, rp, rates.perSection, mult.replaceSection, 'sections', rates.sectionText, 'section (install rate)')
  }
  const rh = q('rehangGate')
  if (rh) {
    if (kit) { const b: Bag = new Map(); addTo(b, kit.kits[gateKit], rh, isGateHardware); materialLine(acc, kit, 'rehangGate:parts', `${REPAIR_LABEL.rehangGate}: hinges and latch`, b, `${rh} × the ${gateWord} kit's hinges and latch`) }
    laborLine(acc, 'rehangGate:labor', `${REPAIR_LABEL.rehangGate}: labor`, rh, gateRate, mult.rehangGate, `${gateWord}s`, `${gateWord} rate`, gateWord)
  }
  const rg = q('replaceGate')
  if (rg) {
    if (kit) { const b: Bag = new Map(); addTo(b, kit.kits[gateKit], rg); materialLine(acc, kit, 'replaceGate:parts', `${REPAIR_LABEL.replaceGate}: whole gate kit`, b, `${rg} × the ${gateWord} kit`) }
    laborLine(acc, 'replaceGate:labor', `${REPAIR_LABEL.replaceGate}: labor`, rg, gateRate, mult.replaceGate, `${gateWord}s`, `${gateWord} rate`, gateWord)
  }
  const hd = q('haulDebris')
  if (hd) line(acc, { key: 'haulDebris', label: REPAIR_LABEL.haulDebris, kind: 'disposal', cents: Math.round(hd * rates.tearOutSection * 100), math: `${hd} sections × ${usd(rates.tearOutSection)} tear out rate (${rates.tearOutText})` })
  if (!kit && (q('resetPost') + q('replacePost') + rs + rp + rh + rg) > 0) acc.warnings.push(`"${style.label || style.name}" has no material kit in use, so no parts are priced. Check Inventory > Material Kits.`)
  if (r.what === 'storm' && !r.debrisCleared && !hd) acc.warnings.push('Tree or storm damage: tick "Tree and debris cleared before we start" or add Haul away debris.')

  const words: string[] = []
  const say = (n: number, one: string, many: string) => { if (n) words.push(n === 1 ? one : many.replace('#', String(n))) }
  say(q('resetPost'), 'reset a leaning post with a new post', 'reset # leaning posts with new posts')
  say(q('replacePost'), 'replace a post', 'replace # posts')
  say(rs, 'repair a section with new parts', 'repair # sections with new parts')
  say(rp, 'replace a section', 'replace # sections')
  say(rh, `rehang the ${gateWord} with new hinges and latch`, `rehang # ${gateWord}s with new hinges and latch`)
  say(rg, `replace the ${gateWord}`, `replace # ${gateWord}s`)
  say(hd, 'haul away the debris', 'haul away the debris (# sections)')
  const posts = q('resetPost') + q('replacePost')
  if (posts) words.push('haul away the old post' + (posts === 1 ? '' : 's'))
  const description = words.length ? `${words.join(', ').replace(/^./, ch => ch.toUpperCase())}.` : 'Repair as described.'
  const crew = [
    ...REPAIR_ITEMS.filter(k => q(k) > 0).map(k => `${REPAIR_LABEL[k]}: ${q(k)}${k === 'rehangGate' || k === 'replaceGate' ? ` (${gateWord})` : ''}. ${REPAIR_HINT[k]}.`),
    ...(posts ? [`Old posts come out ${r.postType === 'nd' ? 'with their pipe and donuts' : 'with their concrete'}; haul them away.`] : []),
    ...(r.what === 'storm' ? [r.debrisCleared ? 'Tree and debris are cleared by the customer before we start.' : 'Tree and debris: see the items above.'] : []),
  ]
  const sections = rs + rp
  const mh = Number(style.sectionsPerMH) > 0 ? (sections * 1.5 + posts) / Number(style.sectionsPerMH) : 0
  return finish(c, 'repair', acc, kit, description, crew, posts > 0, sections, sections * width, mh)
}

// ── Price, minimum, warnings ─────────────────────────────────────────────────

function finish(c: WorkCommon, type: 'move' | 'repair', acc: Acc, kit: KitSet | null, description: string, crew: string[], newPosts: boolean, sections: number, footage: number, manHours: number): WorkResult {
  const o = c.overrides ?? {}
  const s = c.settings
  const mhRate = Number(c.pricing.manHourRate) || 0
  if (c.extraLaborHrs) acc.lines.push({ key: 'extraHours', label: 'Extra hours', kind: 'labor', cents: Math.round(c.extraLaborHrs * mhRate * 100), math: `${c.extraLaborHrs} hr × ${usd(mhRate)}` })
  const flat = typeof o.laborCost === 'number' && Number.isFinite(o.laborCost) && o.laborCost >= 0
  if (flat) {
    for (const l of acc.lines) if (l.kind === 'labor') { l.math += ' (replaced by the flat labor typed on the quote)'; l.cents = 0 }
    acc.lines.push({ key: 'flatLabor', label: 'Labor (flat, typed on the quote)', kind: 'labor', cents: Math.round(o.laborCost! * 100), math: 'typed' })
  }
  const sum = (k: CostLine['kind']) => acc.lines.filter(l => l.kind === k).reduce((t, l) => t + l.cents, 0)
  return price(c, type, acc, { materialCents: sum('material'), laborCents: sum('labor'), disposalCents: sum('disposal') }, kit, description, crew, newPosts, sections, footage, manHours, s)
}

function price(c: WorkCommon, type: 'move' | 'repair', acc: Acc, t: { materialCents: number; laborCents: number; disposalCents: number }, _kit: KitSet | null, description: string, crew: string[], newPosts: boolean, sections: number, footage: number, manHours: number, s: MoveRepairSettings): WorkResult {
  const o = c.overrides ?? {}
  const costCents = t.materialCents + t.laborCents + t.disposalCents
  const repairFactor = s.repairProfitPct !== null ? (100 - c.overheadPct - s.repairProfitPct) / 100 : null
  const typedFactor = typeof o.costFactor === 'number' && o.costFactor > 0 ? o.costFactor : null
  const costFactor = typedFactor ?? (repairFactor !== null && repairFactor > 0 ? repairFactor : c.style.margin > 0 ? c.style.margin : 0.64)
  const marginFrom = typedFactor ? 'typed on this quote' : repairFactor !== null && repairFactor > 0 ? `Overhead ${c.overheadPct}% + Repair Profit ${s.repairProfitPct}%` : 'the style\'s Target Margin'
  const p = calculatePrice({
    sections: 0, footage: 0, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
    materialCost: (t.materialCents + t.disposalCents) / 100, extraLaborHrs: 0, hasSalesman: c.hasSalesman, priceAdjust: c.priceAdjust,
    style: { ...c.style, margin: costFactor }, pricing: c.pricing,
    // The ± dollar adjustment is applied below, after the minimum job price.
    overrides: { ...o, laborCost: t.laborCents / 100, costFactor, priceMethod: 'cost_factor', pricePerFoot: undefined, priceAdjustmentCents: undefined },
  })
  const manual = p.priceMethod === 'manual'
  // The price before the whole dollar rule, lifted to the minimum job price; then rounded down (pricingEngine.ts).
  let unroundedCents = Math.round(p.priceBeforeRounding * 100)
  const minimumCents = s.minimumJobCents
  const minimumApplied = !manual && minimumCents > 0 && unroundedCents < minimumCents
  if (minimumApplied) unroundedCents = minimumCents
  if (manual && minimumCents > 0 && unroundedCents < minimumCents) acc.warnings.push(`The price typed by hand is under the minimum job price (${usd(minimumCents / 100)}).`)
  // Commission on the price before the ± dollar adjustment and the rounding: both come out of profit only.
  const commissionCents = Math.round(unroundedCents * p.commissionPct)
  const adj = adjustedPrice(unroundedCents, o, costCents + commissionCents)
  const { priceCents, roundingCents } = adj
  const grossMarginCents = priceCents - costCents - commissionCents
  const warnings = [...acc.warnings]
  if (adj.refused) warnings.push(refusedNote(adjustmentOf(o)))
  if (acc.missingRates.length) warnings.unshift(`No rate per ${[...new Set(acc.missingRates)].join(', per ')} is set, so that cost is $0. Set it in Settings → Pricing or Settings → Moves and Repairs, or switch this quote to Hourly crew.`)
  if (acc.missingParts.size) warnings.push(`${acc.missingParts.size} part${acc.missingParts.size === 1 ? ' is' : 's are'} not in Inventory, so a built in cost was used: ${[...acc.missingParts].join('; ')}.`)
  const pullSheet: LineItem[] = []
  for (const l of acc.lines) for (const i of l.parts ?? []) {
    const was = pullSheet.find(x => x.item === i.item)
    if (was) { was.qty = Math.round((was.qty + i.qty) * 100) / 100; was.total = Math.round((was.total + i.total) * 100) / 100 }
    else pullSheet.push({ ...i })
  }
  return {
    type, lines: acc.lines, ...t, costCents, costFactor, targetMarginPct: Math.round((1 - costFactor) * 10000) / 100, marginFrom,
    basePriceCents: Math.round(p.basePrice * 100), priceCents, roundingCents, listCents: adj.listCents, adjustmentCents: adj.adjustmentCents, adjustmentRefused: adj.refused, commissionCents, grossMarginCents, gmPct: priceCents > 0 ? grossMarginCents / priceCents : 0,
    minimumApplied, minimumCents, manual, pullSheet, warnings, description, crew, needs811: newPosts, sections, footage, manHours,
  }
}

/**
 * Wood: the same work priced on the white vinyl style, then material and labor
 * × the Wood factor, each total rounded to the cent once. Disposal (pull and
 * haul away) is not a wood rate and stays as it is. The pull sheet names the
 * wood parts at $0.
 */
function woodWork(c: WorkCommon, run: (c: WorkCommon) => WorkResult): WorkResult {
  const base = c.style.woodBase!
  const f = typeof c.style.woodFactor === 'number' && c.style.woodFactor > 0 ? c.style.woodFactor : c.settings.woodFactorPct / 100
  const o = c.overrides ?? {}
  // Vinyl rates only: no extra hours, no flat labor, no typed price (those are added back below as they are).
  const v = run({ ...c, extraLaborHrs: 0, style: { ...base, margin: c.style.margin }, overrides: { ...o, finalPrice: undefined, laborCost: undefined } })
  const materialCents = Math.round(v.materialCents * f)
  const woodLaborCents = Math.round(v.laborCents * f)
  const pct = Math.round(f * 1000) / 10
  const lines: CostLine[] = [
    ...v.lines,
    { key: 'woodMaterial', label: `Wood factor ${pct}% on materials`, kind: 'material', cents: materialCents - v.materialCents, math: `${usd(v.materialCents / 100)} vinyl materials × ${pct}% = ${usd(materialCents / 100)}` },
    { key: 'woodLabor', label: `Wood factor ${pct}% on labor`, kind: 'labor', cents: woodLaborCents - v.laborCents, math: `${usd(v.laborCents / 100)} vinyl labor × ${pct}% = ${usd(woodLaborCents / 100)}` },
  ]
  let laborCents = woodLaborCents
  const mhRate = Number(c.pricing.manHourRate) || 0
  if (c.extraLaborHrs) { const x = Math.round(c.extraLaborHrs * mhRate * 100); lines.push({ key: 'extraHours', label: 'Extra hours', kind: 'labor', cents: x, math: `${c.extraLaborHrs} hr × ${usd(mhRate)}` }); laborCents += x }
  if (typeof o.laborCost === 'number' && Number.isFinite(o.laborCost) && o.laborCost >= 0) {
    for (const l of lines) if (l.kind === 'labor') { l.math += ' (replaced by the flat labor typed on the quote)'; l.cents = 0 }
    laborCents = Math.round(o.laborCost * 100)
    lines.push({ key: 'flatLabor', label: 'Labor (flat, typed on the quote)', kind: 'labor', cents: laborCents, math: 'typed' })
  }
  const missing = v.warnings.find(w => /^No rate per/.test(w))
  const acc: Acc = { lines, warnings: v.warnings.filter(w => w !== missing), missingRates: [], missingParts: new Set(), pull: new Map() }
  const r = price(c, v.type, acc, { materialCents, laborCents, disposalCents: v.disposalCents }, null, v.description, v.crew, v.needs811, v.sections, v.footage, v.manHours, c.settings)
  if (missing) r.warnings.unshift(missing)
  // The wood parts by name for the crew (wood.ts names), never priced; the wood material as one money line.
  r.pullSheet = mergeItems(v.pullSheet.map(i => ({ ...i, item: woodPartName(i.item), unitCost: 0, total: 0, costSource: 'wood' as const })))
  r.pullSheet.push({ item: `Wood material: ${(base as { label?: string }).label || base.name} material × ${pct}%`, qty: 1, unitCost: materialCents / 100, total: materialCents / 100, costSource: 'wood', moneyOnly: true })
  r.wood = { factor: f, vinylMaterialCents: v.materialCents, vinylLaborCents: v.laborCents, base: base.name }
  return r
}

function mergeItems(items: LineItem[]): LineItem[] {
  const out: LineItem[] = []
  for (const i of items) { const was = out.find(x => x.item === i.item); if (was) was.qty = Math.round((was.qty + i.qty) * 100) / 100; else out.push({ ...i }) }
  return out
}

// ── Change order pick list ───────────────────────────────────────────────────

/**
 * A change order line picked from a list (Jonathan, Oct 22 2026: "a pick list
 * from the catalog and the Repair price list for change order lines"), priced
 * for the job's style with the Repair price list's own math:
 *
 *   repair item   priceRepair with that one item × the quantity (its kits,
 *                 labor = the install rate × the item's multiplier, Settings →
 *                 Moves and Repairs)
 *   pullPost      pull an old post and haul it away: the pull labor and
 *                 disposal per post for the job's install method (Settings →
 *                 Moves and Repairs)
 *   part          an Inventory item: quantity × its Inventory cost, as a
 *                 repair prices the parts it uses (no labor)
 *
 * then priced as a repair is: cost ÷ (1 − Target Margin), Target Margin =
 * Overhead % + Repair Profit % when Repair Profit % is set, else the style's;
 * commission and the whole dollar rule as on a repair quote; a wood style's
 * material and labor × the Wood factor (woodWork). Never the minimum job price
 * (the job is already sold) and never the quote's typed price, flat labor or
 * slider: a line is priced on its own, at Settings today.
 */
export type PickRepairKey = RepairItemKey | 'pullPost'
export const PICK_REPAIR_KEYS: PickRepairKey[] = [...REPAIR_ITEMS, 'pullPost']
export const PICK_LABEL: Record<PickRepairKey, string> = { ...REPAIR_LABEL, pullPost: 'Pull an old post and haul it away' }
export type ChangeOrderPick =
  | { kind: 'repair'; key: PickRepairKey; gateKind?: 'walk' | 'double' }
  | { kind: 'part'; part: string }

export function priceChangeOrderPick(c: WorkCommon, pick: ChangeOrderPick, qty: number): WorkResult {
  const n = Math.max(1, Math.round(Number(qty) || 1))
  const cc: WorkCommon = { ...c, settings: { ...c.settings, minimumJobCents: 0 }, overrides: {}, extraLaborHrs: 0, priceAdjust: 0 }
  if (pick.kind === 'repair' && pick.key !== 'pullPost') {
    return priceRepair(cc, { what: 'other', items: { [pick.key]: n }, postType: postTypeOf(cc.style), newPostCaps: false, gateKind: pick.gateKind === 'double' ? 'double' : 'walk', debrisCleared: true })
  }
  if (cc.style.woodBase) return woodWork(cc, w => pickInner(w, pick, n))
  return pickInner(cc, pick, n)
}

function pickInner(c: WorkCommon, pick: ChangeOrderPick, n: number): WorkResult {
  const acc: Acc = { lines: [], warnings: [], missingRates: [], missingParts: new Set(), pull: new Map() }
  if (pick.kind === 'repair') {
    const type = postTypeOf(c.style)
    pullPosts(acc, c.settings, n, type, 'pullPost:')
    return finish(c, 'repair', acc, null, `${n === 1 ? 'Pull an old post' : `Pull ${n} old posts`} and haul ${n === 1 ? 'it' : 'them'} away.`, [], false, 0, 0, 0)
  }
  const unit = inventoryCost(pick.part)
  if (unit === undefined) acc.warnings.push(`"${pick.part}" is not in Inventory, so it has no cost: type the amount.`)
  const u = unit ?? 0
  const cents = Math.round(n * u * 100)
  line(acc, { key: 'part', label: 'Part', kind: 'material', cents, math: `${n} × ${usd(u)} (Inventory)`, parts: [{ item: pick.part, qty: n, unitCost: u, total: cents / 100, costSource: unit === undefined ? 'builtin' : 'inventory' }] })
  return finish(c, 'repair', acc, null, `${n} × ${pick.part.replace(/^\*+/, '')}`, [], false, 0, 0, 0)
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * "A new fence may be the better deal": damaged sections over 50% of a run, or
 * the repair price over 60% of a new fence of the same style for that run.
 */
export function newFenceBetter(args: { repairCents: number; newFenceCents: number | null; damagedByRun: Array<{ damaged: number; sections: number }> }): { over50: boolean; over60: boolean; show: boolean } {
  const over50 = args.damagedByRun.some(r => r.sections > 0 && r.damaged / r.sections > 0.5)
  const over60 = args.newFenceCents !== null && args.newFenceCents > 0 && args.repairCents > 0.6 * args.newFenceCents
  return { over50, over60, show: over50 || over60 }
}

const COLOR_WORDS = new Set(['white', 'tan', 'w', 't', 'black', 'blk', 'galv', 'g', 'gr', 'green'])
const isColorPart = (part: string) => part.split(',').some(seg => COLOR_WORDS.has(seg.replace(/\*/g, '').trim().toLowerCase()))

/** "May not match the existing fence": the style is turned off or on hold, or a color part has no Inventory price. */
export function matchRisk(style: QuoteStyle & { isActive?: boolean; quotable?: boolean; held?: string }): string | null {
  if (style.isActive === false || style.quotable === false || style.held) return 'May not match the existing fence: this style is discontinued or not available for new quotes.'
  const kit = workKit(style.woodBase ?? style)
  if (!kit) return null
  const unpriced: string[] = []
  for (const parts of Object.values(kit.kits)) for (const p of parts ?? []) {
    if (!isColorPart(p.part)) continue
    const c = inventoryCost(p.part)
    if (!(typeof c === 'number' && c > 0) && !unpriced.includes(p.part)) unpriced.push(p.part)
  }
  return unpriced.length ? `May not match the existing fence: ${unpriced.length} color part${unpriced.length === 1 ? ' has' : 's have'} no Inventory price (${unpriced.slice(0, 3).map(x => x.replace(/^\*+/, '')).join('; ')}${unpriced.length > 3 ? '; …' : ''}).` : null
}

// ── Words ────────────────────────────────────────────────────────────────────

export function gatesText(walk: number, dbl: number): string {
  const p = [walk ? `${walk} walk gate${walk > 1 ? 's' : ''}` : '', dbl ? `${dbl} double gate${dbl > 1 ? 's' : ''}` : ''].filter(Boolean)
  return p.length === 2 ? `${p[0]} and ${p[1]}` : p[0] ?? ''
}
const fmtFt = (ft: number) => `${Math.round(ft * 10) / 10} ft`

/** Whole dollars for a cents amount, for display. */
export const centsToDollars = (c: number) => Math.round(c) / 100

// ── Saved on the quote ───────────────────────────────────────────────────────

/** What a move or repair quote keeps (SavedQuote.work): its inputs and the numbers it was priced with. Internal. */
export interface SavedWork {
  version: 1
  type: 'move' | 'repair'
  move?: MoveInputs
  repair?: RepairInputs
  priced: {
    lines: Array<Omit<CostLine, 'parts'>>
    materialCents: number
    laborCents: number
    disposalCents: number
    costCents: number
    costFactor: number
    targetMarginPct: number
    priceCents: number
    /** Cents rounded off to the whole dollar (none on a quote that keeps its cents, or saved before the rule). */
    roundingCents?: number
    /** The ± dollar adjustment applied (cents, out of profit). */
    adjustmentCents?: number
    commissionCents: number
    grossMarginCents: number
    minimumApplied: boolean
    minimumCents: number
    wood?: WorkResult['wood']
  }
  /** Customer wording, and the crew's steps. */
  description: string
  crew: string[]
  needs811: boolean
  warnings: string[]
  /** "A new fence may be the better deal": the new fence price beside it (cents), and whether it was offered. */
  newFence?: { cents: number; offered: boolean } | null
  /** Sent with fewer photos than required: who said why. */
  photoOverride?: { reason: string; at: string } | null
}

export function toSavedWork(r: WorkResult, inputs: { move?: MoveInputs; repair?: RepairInputs }, extra: Pick<SavedWork, 'newFence' | 'photoOverride'> = {}): SavedWork {
  return {
    version: 1, type: r.type, ...inputs,
    priced: {
      lines: r.lines.map(({ parts, ...l }) => { void parts; return l }),
      materialCents: r.materialCents, laborCents: r.laborCents, disposalCents: r.disposalCents, costCents: r.costCents,
      costFactor: r.costFactor, targetMarginPct: r.targetMarginPct, priceCents: r.priceCents, roundingCents: r.roundingCents, ...(r.adjustmentCents ? { adjustmentCents: r.adjustmentCents } : {}), commissionCents: r.commissionCents,
      grossMarginCents: r.grossMarginCents, minimumApplied: r.minimumApplied, minimumCents: r.minimumCents, ...(r.wood ? { wood: r.wood } : {}),
    },
    description: r.description, crew: r.crew, needs811: r.needs811, warnings: r.warnings, ...extra,
  }
}

type WorkLike = Parameters<typeof workSummary>[0]

/**
 * A quote's or job's size where a list says "Sections": the count for a new
 * fence (and a move, its new line), the repair work for a repair ("Repair:
 * 2 × Replace a post · 1 × Rehang a gate with new hardware"), never "0" for a
 * repair (round 2 review, Oct 26 2026: the customer page, the Quotes list and
 * the quote window read "Sections 0").
 */
export function sectionsCell(sections: number | null | undefined, work: WorkLike): string {
  const n = Number(sections) || 0
  if (work && (work.type === 'repair' || (work.type === 'move' && n <= 0))) return workSummary(work) ?? (work.type === 'repair' ? 'Repair' : 'Fence move')
  return String(n)
}

/** The same in a sentence: "16 sections", "1 section", or the repair work. */
export function sizeText(sections: number | null | undefined, work: WorkLike): string {
  const cell = sectionsCell(sections, work)
  return /^\d+$/.test(cell) ? `${cell} section${cell === '1' ? '' : 's'}` : cell
}

/** A repair's items, one line each ("2 × Replace a post"); null for anything else. */
export function repairLines(work: WorkLike): string[] | null {
  const s = work?.type === 'repair' ? workSummary(work) : null
  return s && s.startsWith('Repair: ') ? s.slice('Repair: '.length).split(' · ') : null
}
