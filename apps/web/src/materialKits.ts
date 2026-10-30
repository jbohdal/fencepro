/**
 * Material kits per style. A style's parts are a set of kits: what one
 * section takes (chain link hook ties too), one line / corner / end post, the
 * blank post at the center of a double gate, a gate post (wood: the post each
 * side of a gate, in place of an end post; withGatePosts), one walk gate, one double gate,
 * each foot of fence (chain link fabric, rail, wire) and once per job. A job's parts are each kit
 * times how many the job has, added up per part; parts marked "rounded up"
 * (rolls of fabric, sticks of rail, bags of ties) are rounded up once per job.
 *
 * The built in kits are derived from the parts lists in materialCalculator by
 * difference: the calculator is run on jobs that differ by one kind of thing
 * at a time, and what changed is that kind's kit. Nothing is typed in by hand,
 * so a kit says exactly what the parts list said. One correction is made on
 * purpose (Jonathan, Oct 2026): every vinyl gate leaf is built from 6 ft
 * section parts (11 pickets, two 6 ft rails, U trim, no insert) plus its
 * hardware, also on 6'x8' styles; a double gate is two leaves.
 *
 * Kits Jonathan edits are saved with Inventory (server side). A style with no
 * saved kit set uses its built in one; a style whose saved sets are all
 * archived has no kit, and its quotes say so.
 */

import {
  legacyCalculateMaterialsDetailed,
  legacyCalculateMixedMaterialsDetailed,
  withPriceSource,
  sectionWidthForStyle,
  styleHasPartsList,
  setKitEngine,
  normalizeItemName,
  isVinylPostPart,
  inventoryCost,
  gateCounts,
  type GateWidths,
  type KitCounts,
  type KitLine,
  type RailWidth,
  type StyleJobLot,
} from './materialCalculator'
import { sectionsForRun, calculateLinePostsPerRun } from './sectionCount'

export const KIT_KINDS = [
  'corner', 'end', 'line', 'blank', 'gatePost', 'section', 'section8', 'perFoot', 'perJob', 'walkGate', 'dblGate',
  'walkGate5', 'walkGate6', 'dblGate10', 'dblGate12', 'anyGate', 'anyWalkGate', 'anyDblGate',
] as const
export type KitKind = typeof KIT_KINDS[number]

/** Gate kits by width: a set with no kit for the width uses this one (the 4 ft walk gate / 8 ft double gate kit). */
export const GATE_WIDTH_FALLBACK: Partial<Record<KitKind, KitKind>> = { walkGate5: 'walkGate', walkGate6: 'walkGate', dblGate10: 'dblGate', dblGate12: 'dblGate' }
const WIDTH_KINDS = Object.keys(GATE_WIDTH_FALLBACK) as KitKind[]

/** The parts a set uses for one kind of kit (a gate width with no kit of its own uses the 4 ft / 8 ft gate kit). */
export function kitParts(set: Pick<KitSet, 'kits'>, kind: KitKind): KitPart[] {
  const own = set.kits[kind]
  if (own) return own
  const from = GATE_WIDTH_FALLBACK[kind]
  return from ? set.kits[from] ?? [] : []
}

/** Every walk gate / double gate on a job, whatever its width. */
export const allWalkGates = (c: KitCounts) => c.walkGate + (c.walkGate5 ?? 0) + (c.walkGate6 ?? 0)
export const allDblGates = (c: KitCounts) => c.dblGate + (c.dblGate10 ?? 0) + (c.dblGate12 ?? 0)

/**
 * Gate posts (Oct 30 2026, wood). In this app a gate hangs on end posts: the
 * job's "End and gate posts" count includes the post on each side of every
 * gate. A kit set with a gate post kit (wood: a 6x6 post where the fence
 * takes 4x4) prices those posts from it instead of the end post kit: two per
 * walk gate and two per double gate (one each side), never more than the
 * job's end posts. A set with no gate post kit (every vinyl, chain link and
 * aluminum set today) counts exactly as before. Done here, where kit counts
 * become parts, so the pull sheet, the order list, the install packet and the
 * price all read the same posts.
 */
export function withGatePosts(set: Pick<KitSet, 'kits'>, counts: KitCounts): KitCounts {
  if (!set.kits.gatePost?.length) return counts
  const g = Math.max(0, Math.min(2 * (allWalkGates(counts) + allDblGates(counts)), counts.end))
  return { ...counts, end: counts.end - g, gatePost: g }
}

export const KIT_LABEL: Record<KitKind, string> = {
  corner: 'Corner post',
  end: 'End post',
  line: 'Line post',
  blank: 'Blank post (center of a double gate)',
  gatePost: 'Gate post (each side of a gate, used in place of an end post)',
  section: 'Section',
  section8: 'Section on an 8 ft rail run',
  perFoot: 'Per foot of fence',
  perJob: 'Once per job',
  walkGate: 'Walk gate (one leaf; 4 ft wide, or width not known)',
  dblGate: 'Double gate (two leaves; 8 ft wide, or width not known)',
  walkGate5: 'Walk gate 5 ft wide',
  walkGate6: 'Walk gate 6 ft wide',
  dblGate10: 'Double gate 10 ft wide (two 5 ft leaves)',
  dblGate12: 'Double gate 12 ft wide (two 6 ft leaves)',
  anyGate: 'Once per job with any gate',
  anyWalkGate: 'Once per job with a walk gate',
  anyDblGate: 'Once per job with a double gate',
}

export interface KitPart {
  part: string
  qty: number
  /** Cost used only if the part is missing from Inventory (from the old parts list). */
  fallbackCost: number
}

export interface KitSet {
  id: string
  name: string
  /** The style this set prices; null for a copy not in use yet. */
  styleName: string | null
  archived?: boolean
  kits: Partial<Record<KitKind, KitPart[]>>
  /** Parts whose job total is rounded up to a whole one. */
  roundUp: string[]
  /** Derived from the old parts list, not saved yet. */
  builtIn?: boolean
  /** Built in only: the derived kits did not reproduce the old parts list, so the old list is used. */
  mismatch?: string
  updatedAt?: string
  /** Saved from Inventory > Fill in (the parts Jonathan typed for a style that had none). */
  filledInAt?: string
  /** Made by Settings → Fence styles (Add color / add a choice): the choice it was made for, "material:dimension:option". */
  madeFor?: string
  /**
   * Kept derived from another style's kit (Green chain link from Black 4 ft,
   * portal lib/greenChainLink.ts): `key` is the parts it was last derived as, so an
   * edit in Material Kits (parts no longer equal to it) stops it following.
   */
  followsKit?: { from: string; key: string }
}

// ── Deriving the built in kits ────────────────────────────────────────────────

type Probe = (j: { runs: Array<{ ft: number; rail: RailWidth }>; corners?: number; ends?: number; walkGates?: number; dblGates?: number; gateWidths?: GateWidths | null }) => Map<string, { qty: number; cost: number }>

const MIXED: Record<string, { installMethod: 'no-dig' | 'dig-set'; colorFamily: 'white' | 'tan' }> = {
  'WV-Auto ND Privacy': { installMethod: 'no-dig', colorFamily: 'white' },
  'WV-Auto DS Privacy': { installMethod: 'dig-set', colorFamily: 'white' },
  'TV-Auto ND Privacy': { installMethod: 'no-dig', colorFamily: 'tan' },
  'TV-Auto DS Privacy': { installMethod: 'dig-set', colorFamily: 'tan' },
}
export const isAutoKitStyle = (name: string) => name in MIXED

function collect(items: Array<{ item: string; qty: number; unitCost: number }>) {
  const m = new Map<string, { qty: number; cost: number }>()
  for (const i of items) {
    const was = m.get(i.item)
    m.set(i.item, { qty: (was?.qty ?? 0) + i.qty, cost: was?.cost || i.unitCost })
  }
  return m
}

function probeFor(styleName: string): Probe {
  // No Inventory while deriving: every part is kept, with the parts list's own cost.
  const none = () => undefined
  const mixed = MIXED[styleName]
  if (mixed) {
    return j => withPriceSource(none, () => collect(legacyCalculateMixedMaterialsDetailed({
      ...mixed, runs: j.runs, corners: j.corners ?? 0, ends: j.ends ?? 0, walkGates: j.walkGates ?? 0, dblGates: j.dblGates ?? 0, tearOutSections: 0, tearOutGates: 0,
    }).items))
  }
  return j => withPriceSource(none, () => collect(legacyCalculateMaterialsDetailed({
    fenceStyle: styleName, runs: j.runs.map(r => r.ft), corners: j.corners ?? 0, ends: j.ends ?? 0, walkGates: j.walkGates ?? 0, dblGates: j.dblGates ?? 0, tearOutSections: 0, tearOutGates: 0,
    ...(j.gateWidths ? { gateWidths: j.gateWidths } : {}),
  }).items))
}

type Vec = Map<string, number>
const qtys = (m: Map<string, { qty: number }>): Vec => new Map([...m].map(([k, v]) => [k, v.qty]))
function lin(terms: Array<[number, Vec]>): Vec {
  const out: Vec = new Map()
  for (const [k, v] of terms) for (const [p, q] of v) out.set(p, (out.get(p) ?? 0) + k * q)
  return out
}
/** Counts are whole numbers or simple fractions (1 per 50 ft); the probes are large enough that rounding to 3 places is exact. */
const tidy = (v: Vec): Vec => new Map([...v].map(([p, q]) => [p, Math.round(q * 1000) / 1000] as [string, number]).filter(([, q]) => q !== 0))

const N = 20_000
const rawCache = new Map<string, ReturnType<typeof deriveRawUncached>>()
function deriveRaw(styleName: string) {
  if (!rawCache.has(styleName)) rawCache.set(styleName, deriveRawUncached(styleName))
  return rawCache.get(styleName)!
}

function deriveRawUncached(styleName: string) {
  const probe = probeFor(styleName)
  const costs = new Map<string, number>()
  const run = (j: Parameters<Probe>[0]) => { const m = probe(j); for (const [p, v] of m) if (!costs.get(p)) costs.set(p, v.cost); return qtys(m) }
  const many = (ft: number, rail: RailWidth) => Array.from({ length: N }, () => ({ ft, rail }))
  const mixed = !!MIXED[styleName]
  const w = mixed ? 6 : sectionWidthForStyle(styleName)

  const base = run({ runs: [] })
  const per = (j: Parameters<Probe>[0], from: Vec, n = N) => tidy(lin([[1 / n, run(j)], [-1 / n, from]]))
  // Gates are measured on top of plenty of posts, so a part a gate takes away (tan no dig donuts) shows.
  const posts = { corners: 3 * N }
  const withPosts = run({ runs: [], ...posts })

  const full = run({ runs: many(w, '6ft') })                  // N sections, N*w ft, no line posts
  const short = run({ runs: many(w - 1, '6ft') })             // N sections, N*(w-1) ft
  const perFoot = tidy(lin([[1 / N, full], [-1 / N, short]]))
  const section = tidy(lin([[1 / N, full], [-1 / N, base], [-w, perFoot]]))
  const longRun = run({ runs: [{ ft: (N + 1) * w, rail: '6ft' }] }) // N+1 sections, N line posts
  const line = tidy(lin([[1 / N, longRun], [-1 / N, base], [-(N + 1) * w / N, perFoot], [-(N + 1) / N, section]]))
  let section8: Vec = new Map()
  if (mixed) {
    const full8 = run({ runs: many(8, '8ft') })
    section8 = tidy(lin([[1 / N, full8], [-1 / N, base], [-8, perFoot]]))
  }
  // Gates. A gate's parts are its kit once per gate, plus (the takeoff sheet's
  // anyAddOn rows, e.g. chain link collar, forks, drop rod) parts once per job
  // when the job has any gate / any walk gate / any double gate. Measured at N
  // and 2N gates f(n) = n × kit + once: kit = (f(2N) − f(N)) / N and
  // once = 2 f(N) − f(2N); parts rounded up per job stay exact at these sizes.
  const gates = (walk: number[], dbl: number[]) =>
    lin([[1, run({ runs: [], ...posts, walkGates: walk.length, dblGates: dbl.length, gateWidths: { walk, dbl } })], [-1, withPosts]])
  const rep = (n: number, w: number) => Array.from({ length: n }, () => w)
  const measure = (walkW: number | null, dblW: number | null) => {
    const one = (n: number) => gates(walkW ? rep(n, walkW) : [], dblW ? rep(n, dblW) : [])
    const a = one(N), b = one(2 * N)
    return { kit: tidy(lin([[1 / N, b], [-1 / N, a]])), once: lin([[2, a], [-1, b]]), a, b }
  }
  const walk4 = measure(4, null), dbl8 = measure(null, 8)
  // Both kinds at once: N walk + N double = N kits of each + anyGate + anyWalkGate + anyDblGate.
  const both = gates(rep(N, 4), rep(N, 8))
  const shared = lin([[1, walk4.once], [1, dbl8.once], [-1, both], [1, walk4.b], [-1, walk4.a], [1, dbl8.b], [-1, dbl8.a]])
  const anyGate = tidy(shared)
  // A gate width's own kit, only where it differs from the 4 ft walk / 8 ft double gate kit.
  const same = (x: Vec, y: Vec) => x.size === y.size && [...x].every(([p, q]) => y.get(p) === q)
  const widthKit = (walkW: number | null, dblW: number | null, base: Vec) => {
    const k = measure(walkW, dblW).kit
    return same(k, base) ? null : k
  }
  return {
    costs,
    perJob: tidy(base),
    perFoot, section, section8, line,
    corner: per({ runs: [], corners: N }, base),
    end: per({ runs: [], ends: N }, base),
    walkGate: walk4.kit,
    dblWithBlank: dbl8.kit,
    walkGate5: widthKit(5, null, walk4.kit),
    walkGate6: widthKit(6, null, walk4.kit),
    dblWithBlank10: widthKit(null, 10, dbl8.kit),
    dblWithBlank12: widthKit(null, 12, dbl8.kit),
    anyGate,
    anyWalkGate: tidy(lin([[1, walk4.once], [-1, shared]])),
    anyDblGate: tidy(lin([[1, dbl8.once], [-1, shared]])),
  }
}

/** Locked 6 ft tall, 8 ft wide vinyl privacy: gate leaves take 6 ft section parts (the sibling 6'x6' style's section). */
function sixFootSibling(styleName: string): string | null {
  return /^(WV|TV)-(ND|DS) 6'x8' Privacy$/.test(styleName) ? styleName.replace("6'x8'", "6'x6'") : null
}

let builtInCache = new Map<string, KitSet | null>()

/** The built in kit set for a style, derived from the old parts list (null when the style has no parts list). */
export function builtInKitSet(styleName: string): KitSet | null {
  if (builtInCache.has(styleName)) return builtInCache.get(styleName)!
  let set: KitSet | null = null
  if (MIXED[styleName] || styleHasPartsList(styleName)) {
    const d = deriveRaw(styleName)
    // The blank post at a double gate: the blank post itself, and what a line
    // post's per post hardware takes (caps, ties, pins, its concrete). The rest
    // of what a double gate adds is the double gate kit. A blank post comes
    // with every double gate, so the split never changes a total.
    const blank: Vec = new Map()
    const dbl: Vec = new Map(d.dblWithBlank)
    for (const [p, q] of d.dblWithBlank) {
      const take = /Post, Blank/.test(p) ? q : q > 0 && (d.line.get(p) ?? 0) > 0 ? Math.min(q, d.line.get(p)!) : 0
      if (take > 0) { blank.set(p, take); dbl.set(p, q - take); if (dbl.get(p) === 0) dbl.delete(p) }
    }
    // A double gate of another width has the same blank post.
    const noBlank = (v: Vec | null): Vec | null => v && tidy(lin([[1, v], [-1, blank]]))
    let walk = d.walkGate, dblGate = dbl
    const sib = sixFootSibling(styleName)
    if (sib) {
      const six = deriveRaw(sib).section
      walk = tidy(lin([[1, walk], [-1, d.section], [1, six]]))
      dblGate = tidy(lin([[1, dblGate], [-2, d.section], [2, six]]))
    }
    const costOf = (p: string) => d.costs.get(p) || (sib ? deriveRaw(sib).costs.get(p) : 0) || 0
    const toParts = (v: Vec): KitPart[] => [...v].map(([part, qty]) => ({ part, qty, fallbackCost: costOf(part) }))
    const kits: KitSet['kits'] = {
      corner: toParts(d.corner), end: toParts(d.end), line: toParts(d.line), blank: toParts(blank),
      section: toParts(d.section), section8: toParts(d.section8), perFoot: toParts(d.perFoot), perJob: toParts(d.perJob),
      walkGate: toParts(walk), dblGate: toParts(dblGate),
      anyGate: toParts(d.anyGate), anyWalkGate: toParts(d.anyWalkGate), anyDblGate: toParts(d.anyDblGate),
    }
    // Gate widths with parts of their own (chain link: the 4' x 5' and 4' x 6' leaves).
    const widths: Array<[KitKind, Vec | null]> = [['walkGate5', d.walkGate5], ['walkGate6', d.walkGate6], ['dblGate10', noBlank(d.dblWithBlank10)], ['dblGate12', noBlank(d.dblWithBlank12)]]
    for (const [k, v] of widths) if (v) kits[k] = toParts(v)
    for (const k of KIT_KINDS) if (!kits[k]?.length) delete kits[k]
    // Rounded up: any part a kit carries as a fraction (1 roll per 50 ft).
    const roundUp = new Set<string>()
    for (const k of KIT_KINDS) for (const p of kits[k] ?? []) if (!Number.isInteger(p.qty)) roundUp.add(p.part)
    set = { id: `builtin:${styleName}`, name: styleName, styleName, kits, roundUp: [...roundUp], builtIn: true }
    const off = selfCheck(set)
    if (off) set.mismatch = off
  }
  builtInCache.set(styleName, set)
  return set
}

/** For tests: forget the derived kits. */
export function clearBuiltInKits() { builtInCache = new Map(); rawCache.clear() }

// ── Job parts from kits ───────────────────────────────────────────────────────

/** Styles whose section is bought whole as "Misc, 6' Section" (TAKEOFF_RULES; lib/costReview.ts flags them). */
export const BELL_STYLES = ["WV-ND Bell 4'x6'"] as const
export const BELL_SECTION_PART = "Misc, 6' Section"
/** The takeoff sheet's cost for "Misc, 6' Section" (TAKEOFF_RULES "workbook cost $154.34"): a placeholder, not a supplier's price. */
export const BELL_SECTION_PLACEHOLDER = 154.34

/** The cost "Misc, 6' Section" counts at now: the Catalog's, else the kit's. */
const bellSectionCost = (p: KitPart) => inventoryCost(p.part) ?? p.fallbackCost

/** True when the real supplier cost of the Bell's section is entered: above $0 and not the sheet's $154.34 placeholder. */
export function bellSectionCostEntered(cost: number): boolean {
  return cost > 0 && Math.round(cost * 100) !== Math.round(BELL_SECTION_PLACEHOLDER * 100)
}

/**
 * The Bell's section and gate leaves are priced like a 6'x6' white vinyl
 * privacy section (pickets, 6 ft rails, U trim, truss) until the real supplier
 * cost is entered (Jonathan, Oct 21 2026, docs/DECISIONS.md). The section is
 * "Misc, 6' Section" in the Bell's kits (Inventory > Material Kits), its cost
 * in the Catalog (lib/costReview.ts); the Catalog still has the takeoff
 * sheet's $154.34, the placeholder the ruling set aside. Before (audit Oct 26
 * 2026) a kit with both counted both, about double the price. Now one or the
 * other, never both, per kit:
 *
 *   real cost entered (above $0, not $154.34)  the section counts; the
 *                                              privacy stand in parts do not.
 *   not yet                                    the privacy stand in parts
 *                                              count; the section line does not.
 *
 * Returns the kit's parts to count.
 */
export function withoutBellStandIns(set: Pick<KitSet, 'styleName'>, parts: KitPart[]): KitPart[] {
  if (!set.styleName || !(BELL_STYLES as readonly string[]).includes(set.styleName)) return parts
  const section = parts.find(p => p.part === BELL_SECTION_PART)
  if (!section) return parts
  if (!bellSectionCostEntered(bellSectionCost(section))) return parts.filter(p => p !== section)
  // The stand in: what the built in Bell section kit is (the 6'x6' privacy section's parts).
  const standIn = new Set((builtInKitSet(set.styleName)?.kits.section ?? []).map(p => p.part).filter(p => p !== BELL_SECTION_PART))
  return parts.filter(p => !standIn.has(p.part))
}

/**
 * The note after a style's name in Inventory > Material Kits: " (no parts
 * list)" when it has no kit set, " (archived)" when every set it has is
 * archived (the four Oct 19 "Wood Privacy" styles, review Oct 30 2026), else
 * nothing.
 */
export function kitStyleNote(sets: Array<Pick<KitSet, 'archived'>>): string {
  if (!sets.length) return ' (no parts list)'
  return sets.every(s => s.archived) ? ' (archived)' : ''
}

/** Each kit times how many the job has, added up per part; rounded up once per job where the set says so. */
export function linesFromKitSet(set: KitSet, counts0: KitCounts): KitLine[] {
  const counts = withGatePosts(set, counts0)
  const totals = new Map<string, { qty: number; cost: number }>()
  for (const kind of KIT_KINDS) {
    const n = counts[kind]
    if (!n) continue
    for (const p of withoutBellStandIns(set, kitParts(set, kind))) {
      const was = totals.get(p.part)
      totals.set(p.part, { qty: (was?.qty ?? 0) + p.qty * n, cost: was?.cost || p.fallbackCost })
    }
  }
  // Pieces added to a sold job (counts.exact): nothing rounded up, the share these pieces use.
  const up = new Set(counts.exact ? [] : set.roundUp)
  return [...totals].map(([part, t]) => {
    const exact = Math.round(t.qty * 1e6) / 1e6
    return { part, qty: up.has(part) ? Math.ceil(exact) : exact, fallbackCost: t.cost }
  })
}

/** Which piece price pays for each kind of kit on a job lot color (per foot and per job parts never are). */
export const PIECE_OF_KIT: Record<KitKind, keyof StyleJobLot['covers'] | null> = {
  section: 'section', section8: 'section', corner: 'post', end: 'post', line: 'post', blank: 'post', gatePost: 'post',
  walkGate: 'walkGate', dblGate: 'dblGate', perFoot: null, perJob: null,
  walkGate5: 'walkGate', walkGate6: 'walkGate', dblGate10: 'dblGate', dblGate12: 'dblGate',
  anyGate: null, anyWalkGate: null, anyDblGate: null,
}

/**
 * A job lot color's parts, kit by kit. In each kit, a part its piece price
 * covers is listed at $0 (the quantity stays, for the pull sheet, the order
 * list and the install packet); every other part prices from Inventory as
 * usual. Then one line per piece price: how many sections, posts and gates
 * times the price. Coverage is per kit, so a part is charged once: by the
 * piece whose kit it is in when that piece covers it, otherwise by Inventory.
 */
export function linesFromKitSetJobLot(set: KitSet, counts0: KitCounts, lot: StyleJobLot): KitLine[] {
  const counts = withGatePosts(set, counts0)
  const unc = new Map<string, { qty: number; cost: number }>()
  const cov = new Map<string, number>()
  const covers = Object.fromEntries(Object.entries(lot.covers).map(([k, v]) => [k, new Set((v ?? []).map(normalizeItemName))])) as Record<keyof StyleJobLot['covers'], Set<string>>
  // 8 ft tall vinyl: the section price covers every part of a section kit
  // (coversAll); the post price covers the vinyl post only, and the cap,
  // donuts, pipe or concrete price from Inventory (Jonathan, Oct 29, 2026).
  const all = new Set(lot.coversAll ?? [])
  for (const kind of KIT_KINDS) {
    const n = counts[kind]
    if (!n) continue
    const piece = PIECE_OF_KIT[kind]
    for (const p of kitParts(set, kind)) {
      if (piece && (all.has(piece) || (lot.tall && piece === 'post' && isVinylPostPart(p.part)) || covers[piece]?.has(normalizeItemName(p.part)))) cov.set(p.part, (cov.get(p.part) ?? 0) + p.qty * n)
      else { const was = unc.get(p.part); unc.set(p.part, { qty: (was?.qty ?? 0) + p.qty * n, cost: was?.cost || p.fallbackCost }) }
    }
  }
  const up = new Set(counts.exact ? [] : set.roundUp)
  const exact = (q: number) => Math.round(q * 1e6) / 1e6
  const lines: KitLine[] = []
  for (const part of new Set([...unc.keys(), ...cov.keys()])) {
    const u = exact(unc.get(part)?.qty ?? 0), c = exact(cov.get(part) ?? 0)
    // Rounded up once on the whole quantity; the part charged from Inventory keeps its own rounding.
    const total = up.has(part) ? Math.ceil(exact(u + c)) : exact(u + c)
    const uq = up.has(part) ? Math.min(total, Math.ceil(u)) : u
    if (uq > 0) lines.push({ part, qty: uq, fallbackCost: unc.get(part)!.cost })
    if (total - uq > 0) lines.push({ part, qty: exact(total - uq), fallbackCost: 0, unitCost: 0 })
  }
  const piece = (name: string, qty: number, price: number | undefined) => {
    if (qty > 0 && typeof price === 'number' && price > 0) lines.push({ part: `${lot.label ?? `Job lot, ${lot.color}`}: ${name}`, qty, fallbackCost: price, unitCost: price, piece: true })
  }
  // A section sold as a kit is its own catalog item, priced from Inventory (Vinyl Colors form).
  const section = (w: string, qty: number) => {
    const item = lot.sectionNames?.[w]
    if (!item) { piece(`section, ${w} ft wide`, qty, lot.sections[w]); return }
    const price = inventoryCost(item) ?? lot.sections[w]
    if (qty > 0 && typeof price === 'number' && price > 0) lines.push({ part: item, qty, fallbackCost: price, unitCost: price, piece: true })
  }
  // Gate leaves built from a section kit: one per walk gate, two per double gate.
  const walks = allWalkGates(counts), dbls = allDblGates(counts)
  const leaves = lot.leafWidth ? walks + dbls * 2 : 0
  if (lot.width === 'auto') {
    section('6', counts.section + (lot.leafWidth === '6' ? leaves : 0))
    section('8', counts.section8 + (lot.leafWidth === '8' ? leaves : 0))
    if (leaves && lot.leafWidth !== '6' && lot.leafWidth !== '8') section(lot.leafWidth!, leaves)
  } else {
    const w = String(lot.width)
    section(w, counts.section + counts.section8 + (lot.leafWidth === w ? leaves : 0))
    if (leaves && lot.leafWidth !== w) section(lot.leafWidth!, leaves)
  }
  piece('corner post', counts.corner, lot.corner)
  // A gate post stands where an end post would (withGatePosts): charged at the end post price.
  piece('end post', counts.end + (counts.gatePost ?? 0), lot.end)
  piece('line post', counts.line, lot.line)
  piece('gate post (center of a double gate)', counts.blank, lot.blank)
  piece('walk gate', walks, lot.walkGate)
  piece('double gate', dbls, lot.dblGate)
  return lines
}

/**
 * The gate correction: what kits are meant to differ from the old list by on a
 * gate job (kits minus old list). 6'x8' vinyl: each leaf swaps 8 ft section
 * parts for 6 ft ones. Auto mix with every run on 8 ft rails: the old list
 * built the leaves from 8 ft parts; kits use 6 ft.
 */
export function expectedGateCorrection(styleName: string, walkGates: number, dblGates: number, allEightFootRuns = false): Map<string, number> {
  const sib = sixFootSibling(styleName)
  const out = new Map<string, number>()
  const leaves = walkGates + dblGates * 2
  if (!leaves) return out
  const swap = (six: Vec, eight: Vec) => {
    for (const [p, q] of six) out.set(p, (out.get(p) ?? 0) + q * leaves)
    for (const [p, q] of eight) out.set(p, (out.get(p) ?? 0) - q * leaves)
  }
  if (sib) swap(deriveRaw(sib).section, deriveRaw(styleName).section)
  if (MIXED[styleName] && allEightFootRuns) swap(deriveRaw(styleName).section, deriveRaw(styleName).section8)
  return new Map([...out].filter(([, q]) => Math.abs(q) > 1e-9))
}

/** Kits against the old list on a few jobs (gates only where no correction applies). Returns what differed, or ''. */
function selfCheck(set: KitSet): string {
  const style = set.styleName!
  const mixed = MIXED[style]
  const gates = !sixFootSibling(style) && !mixed
  // Gates of every width the sheet has rows for, and typed counts with no width.
  const jobs = [
    { runs: [37, 120, 52], corners: 2, ends: 2, walkGates: gates ? 1 : 0, dblGates: gates ? 1 : 0 },
    { runs: [6, 13, 250, 8], corners: 3, ends: 1, walkGates: gates ? 2 : 0, dblGates: 0 },
    { runs: [44, 61], corners: 1, ends: 2, walkGates: gates ? 2 : 0, dblGates: gates ? 2 : 0, gateWidths: gates ? { walk: [5, 6], dbl: [10, 12] } : null },
    { runs: [90], corners: 0, ends: 2, walkGates: gates ? 1 : 0, dblGates: gates ? 2 : 0, gateWidths: gates ? { walk: [4], dbl: [8, 10] } : null },
  ]
  for (const j of jobs) {
    const legacy = probeFor(style)({ ...j, runs: j.runs.map(ft => ({ ft, rail: '6ft' as RailWidth })) })
    const counts = countsFor(style, j.runs, j)
    const kits = new Map(linesFromKitSet(set, counts).filter(l => l.qty > 0).map(l => [l.part, Math.round(l.qty * 100) / 100]))
    for (const p of new Set([...legacy.keys(), ...kits.keys()])) {
      const a = Math.round((legacy.get(p)?.qty ?? 0) * 100) / 100, b = kits.get(p) ?? 0
      if (a !== b) return `${p}: old list ${a}, kits ${b}`
    }
  }
  return ''
}

/** How many of each kit a job has (the same counting the parts lists do). */
export function countsFor(styleName: string, runs: number[], j: { corners: number; ends: number; walkGates: number; dblGates: number; gateWidths?: GateWidths | null }, rails?: RailWidth[]): KitCounts {
  const mixed = !!MIXED[styleName]
  let section = 0, section8 = 0
  const perRun: number[] = []
  runs.forEach((ft, i) => {
    if (!(ft > 0)) return
    const eight = mixed && rails?.[i] === '8ft'
    const sec = sectionsForRun(ft, mixed ? (eight ? 8 : 6) : sectionWidthForStyle(styleName))
    perRun.push(sec)
    if (eight) section8 += sec; else section += sec
  })
  const line = calculateLinePostsPerRun(perRun).reduce((t, n) => t + n, 0)
  return { section, section8, line, corner: j.corners, end: j.ends, blank: j.dblGates, ...gateCounts(j.walkGates, j.dblGates, j.gateWidths), perFoot: runs.reduce((t, f) => t + (f > 0 ? f : 0), 0), perJob: 1 }
}

// ── Which set a style uses ────────────────────────────────────────────────────

let saved: () => KitSet[] = () => []
/** Where saved kit sets come from (inventoryStore registers the server copy). */
export function setSavedKitSets(fn: () => KitSet[]) { saved = fn }

/** The set a style quotes with: its saved active set, nothing if every saved set is archived, else the built in one. */
export function kitSetFor(styleName: string, sets: KitSet[] = saved()): KitSet | 'archived' | null {
  const mine = sets.filter(s => s.styleName === styleName)
  const active = mine.find(s => !s.archived)
  if (active) return active
  if (mine.length) return 'archived'
  return builtInKitSet(styleName)
}

/** Every style's set as shown on the Material Kits screen: saved ones, plus built in ones for styles with none saved. */
export function allKitSets(styleNames: string[], sets: KitSet[] = saved()): KitSet[] {
  const out = [...sets]
  for (const name of styleNames) {
    if (sets.some(s => s.styleName === name)) continue
    const b = builtInKitSet(name)
    if (b) out.push(b)
  }
  return out
}

let override: KitSet[] | null = null
/** Price with these sets instead of the saved ones (the "which open quotes would change" preview). */
export function withKitSets<T>(sets: KitSet[], run: () => T): T {
  const was = override
  override = sets
  try { return run() } finally { override = was }
}

setKitEngine((styleKey, counts, notes, jobLot) => {
  const set = kitSetFor(styleKey, override ?? saved())
  if (set === null) return null
  if (set === 'archived') return { lines: [], warnings: [`"${styleKey}" has no material kit in use (its kits are archived in Inventory > Material Kits), so no fence material is included.`] }
  if (set.mismatch) return null
  // A gate width the takeoff sheet has no row for, on a style whose gates go by width (chain link).
  const gateNote = counts.gateNotes?.length && WIDTH_KINDS.some(k => set.kits[k]?.length)
    ? [`No takeoff sheet row for ${counts.gateNotes.join('; ')}. Check the gate parts.`] : []
  if (jobLot) return { lines: linesFromKitSetJobLot(set, counts, jobLot), warnings: gateNote }
  // Notes about new or unconfirmed parts lists stay until a kit is saved (checked) by Jonathan.
  return { lines: linesFromKitSet(set, counts), warnings: [...(set.builtIn ? notes() : []), ...gateNote] }
})
