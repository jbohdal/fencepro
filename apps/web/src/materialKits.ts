/**
 * Material kits per style. A style's parts are a set of kits: what one
 * section takes (chain link hook ties too), one line / corner / end post, the
 * blank post at the center of a double gate, one walk gate, one double gate,
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
  type KitCounts,
  type KitLine,
  type RailWidth,
  type StyleJobLot,
} from './materialCalculator'
import { sectionsForRun, calculateLinePostsPerRun } from './sectionCount'

export const KIT_KINDS = ['corner', 'end', 'line', 'blank', 'section', 'section8', 'perFoot', 'perJob', 'walkGate', 'dblGate'] as const
export type KitKind = typeof KIT_KINDS[number]

export const KIT_LABEL: Record<KitKind, string> = {
  corner: 'Corner post',
  end: 'End post',
  line: 'Line post',
  blank: 'Blank post (center of a double gate)',
  section: 'Section',
  section8: 'Section on an 8 ft rail run',
  perFoot: 'Per foot of fence',
  perJob: 'Once per job',
  walkGate: 'Walk gate (one leaf)',
  dblGate: 'Double gate (two leaves)',
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
}

// ── Deriving the built in kits ────────────────────────────────────────────────

type Probe = (j: { runs: Array<{ ft: number; rail: RailWidth }>; corners?: number; ends?: number; walkGates?: number; dblGates?: number }) => Map<string, { qty: number; cost: number }>

const MIXED: Record<string, { installMethod: 'no-dig' | 'dig-set'; colorFamily: 'white' | 'tan' }> = {
  'WV-Auto ND Privacy': { installMethod: 'no-dig', colorFamily: 'white' },
  'WV-Auto DS Privacy': { installMethod: 'dig-set', colorFamily: 'white' },
  'TV-Auto ND Privacy': { installMethod: 'no-dig', colorFamily: 'tan' },
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
  return {
    costs,
    perJob: tidy(base),
    perFoot, section, section8, line,
    corner: per({ runs: [], corners: N }, base),
    end: per({ runs: [], ends: N }, base),
    walkGate: per({ runs: [], ...posts, walkGates: N }, withPosts),
    dblWithBlank: per({ runs: [], ...posts, dblGates: N }, withPosts),
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
    }
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

/** Each kit times how many the job has, added up per part; rounded up once per job where the set says so. */
export function linesFromKitSet(set: KitSet, counts: KitCounts): KitLine[] {
  const totals = new Map<string, { qty: number; cost: number }>()
  for (const kind of KIT_KINDS) {
    const n = counts[kind]
    if (!n) continue
    for (const p of set.kits[kind] ?? []) {
      const was = totals.get(p.part)
      totals.set(p.part, { qty: (was?.qty ?? 0) + p.qty * n, cost: was?.cost || p.fallbackCost })
    }
  }
  const up = new Set(set.roundUp)
  return [...totals].map(([part, t]) => {
    const exact = Math.round(t.qty * 1e6) / 1e6
    return { part, qty: up.has(part) ? Math.ceil(exact) : exact, fallbackCost: t.cost }
  })
}

/** Which piece price pays for each kind of kit on a job lot color (per foot and per job parts never are). */
export const PIECE_OF_KIT: Record<KitKind, keyof StyleJobLot['covers'] | null> = {
  section: 'section', section8: 'section', corner: 'post', end: 'post', line: 'post', blank: 'post',
  walkGate: 'walkGate', dblGate: 'dblGate', perFoot: null, perJob: null,
}

/**
 * A job lot color's parts, kit by kit. In each kit, a part its piece price
 * covers is listed at $0 (the quantity stays, for the pull sheet, the order
 * list and the install packet); every other part prices from Inventory as
 * usual. Then one line per piece price: how many sections, posts and gates
 * times the price. Coverage is per kit, so a part is charged once: by the
 * piece whose kit it is in when that piece covers it, otherwise by Inventory.
 */
export function linesFromKitSetJobLot(set: KitSet, counts: KitCounts, lot: StyleJobLot): KitLine[] {
  const unc = new Map<string, { qty: number; cost: number }>()
  const cov = new Map<string, number>()
  const covers = Object.fromEntries(Object.entries(lot.covers).map(([k, v]) => [k, new Set((v ?? []).map(normalizeItemName))])) as Record<keyof StyleJobLot['covers'], Set<string>>
  for (const kind of KIT_KINDS) {
    const n = counts[kind]
    if (!n) continue
    const piece = PIECE_OF_KIT[kind]
    for (const p of set.kits[kind] ?? []) {
      if (piece && covers[piece]?.has(normalizeItemName(p.part))) cov.set(p.part, (cov.get(p.part) ?? 0) + p.qty * n)
      else { const was = unc.get(p.part); unc.set(p.part, { qty: (was?.qty ?? 0) + p.qty * n, cost: was?.cost || p.fallbackCost }) }
    }
  }
  const up = new Set(set.roundUp)
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
    if (qty > 0 && typeof price === 'number' && price > 0) lines.push({ part: `Job lot, ${lot.color}: ${name}`, qty, fallbackCost: price, unitCost: price, piece: true })
  }
  if (lot.width === 'auto') {
    piece('section, 6 ft wide', counts.section, lot.sections['6'])
    piece('section, 8 ft wide', counts.section8, lot.sections['8'])
  } else {
    piece(`section, ${lot.width} ft wide`, counts.section + counts.section8, lot.sections[String(lot.width)])
  }
  piece('corner post', counts.corner, lot.corner)
  piece('end post', counts.end, lot.end)
  piece('line post', counts.line, lot.line)
  piece('gate post (center of a double gate)', counts.blank, lot.blank)
  piece('walk gate', counts.walkGate, lot.walkGate)
  piece('double gate', counts.dblGate, lot.dblGate)
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
  const jobs = [
    { runs: [37, 120, 52], corners: 2, ends: 2, walkGates: gates ? 1 : 0, dblGates: gates ? 1 : 0 },
    { runs: [6, 13, 250, 8], corners: 3, ends: 1, walkGates: gates ? 2 : 0, dblGates: 0 },
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
export function countsFor(styleName: string, runs: number[], j: { corners: number; ends: number; walkGates: number; dblGates: number }, rails?: RailWidth[]): KitCounts {
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
  return { section, section8, line, corner: j.corners, end: j.ends, blank: j.dblGates, walkGate: j.walkGates, dblGate: j.dblGates, perFoot: runs.reduce((t, f) => t + (f > 0 ? f : 0), 0), perJob: 1 }
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
  if (jobLot) return { lines: linesFromKitSetJobLot(set, counts, jobLot), warnings: [] }
  // Notes about new or unconfirmed parts lists stay until a kit is saved (checked) by Jonathan.
  return { lines: linesFromKitSet(set, counts), warnings: set.builtIn ? notes() : [] }
})
