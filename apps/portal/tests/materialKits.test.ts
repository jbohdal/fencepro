/**
 * Material kits against the old parts lists, item by item.
 *
 * Every style with a parts list is priced on real yards (the runs, posts and
 * gates of saved quotes) and on generated jobs, once from its kits and once
 * from the old list. Every part must match, except the gate leaf correction
 * on purpose: on 6'x8' vinyl (and auto mix with every run on 8 ft rails)
 * each gate leaf now takes 6 ft section parts, so those jobs differ by exactly
 * leaves × (6 ft section − 8 ft section) and nothing else.
 *
 * KITS_DUMP=<folder with live-quotes.json (saved quotes) and live-inventory.json>
 * uses those yards and Inventory costs; KITS_REPORT=<file.md> writes the
 * comparison table and every style's kit list with costs.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  calculateMaterialsDetailed, calculateMixedMaterialsDetailed,
  legacyCalculateMaterialsDetailed, legacyCalculateMixedMaterialsDetailed,
  setMaterialPriceSource, priceSourceFromMap, styleHasPartsList, type RailWidth,
} from '../../web/src/materialCalculator'
import {
  builtInKitSet, expectedGateCorrection, KIT_KINDS, KIT_LABEL, linesFromKitSet, countsFor, withKitSets, kitSetFor, type KitSet,
} from '../../web/src/materialKits'

const LOCKED = [
  "WV-ND 6'x6' Privacy", "WV-ND 6'x8' Privacy", "WV-ND Bell 4'x6'", "WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy",
  "TV-ND 6'x6' Privacy", "TV-ND 6'x8' Privacy", "TV-DS 6'x6' Privacy", "TV-DS 6'x8' Privacy",
  "WV-ND 8'x6' Privacy", "WV-ND 8'x8' Privacy", "WV-DS 8'x6' Privacy", "WV-DS 8'x8' Privacy",
  "TV-ND 8'x6' Privacy", "TV-ND 8'x8' Privacy", "TV-DS 8'x6' Privacy", "TV-DS 8'x8' Privacy",
  "CL - 4' Galv", "CL - 5' Galv", "CL - 6' Galv", "CL - 4' Black", "CL - 5' Black", "CL - 6' Black",
  "CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black",
  'Alum - ND - Emily - 48', 'Alum - DS - Emily - 48', 'Alum - DS - Ind Abigail',
]
const AUTO: Record<string, { installMethod: 'no-dig' | 'dig-set'; colorFamily: 'white' | 'tan' }> = {
  'WV-Auto ND Privacy': { installMethod: 'no-dig', colorFamily: 'white' },
  'WV-Auto DS Privacy': { installMethod: 'dig-set', colorFamily: 'white' },
  'TV-Auto ND Privacy': { installMethod: 'no-dig', colorFamily: 'tan' },
  'TV-Auto DS Privacy': { installMethod: 'dig-set', colorFamily: 'tan' },
}

interface Job { name: string; runs: number[]; rails: RailWidth[]; corners: number; ends: number; walkGates: number; dblGates: number; tearOutSections: number; tearOutGates: number }

// A small fixed random source, so every run checks the same jobs.
let seed = 20261017
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
const generated: Job[] = Array.from({ length: 8 }, (_, i) => {
  const runs = Array.from({ length: pick(1, 6) }, () => pick(4, 260))
  return {
    name: `generated ${i + 1}`, runs, rails: runs.map((_, k) => (i === 3 || (i % 2 && k % 2) ? '8ft' : '6ft') as RailWidth),
    corners: pick(0, 4), ends: pick(0, 3), walkGates: i === 0 ? 0 : pick(0, 2), dblGates: i < 2 ? 0 : pick(0, 1), tearOutSections: pick(0, 10), tearOutGates: pick(0, 1),
  }
})

const dump = process.env.KITS_DUMP
const real: Job[] = []
let costs: Record<string, number> | null = null
if (dump && fs.existsSync(path.join(dump, 'live-quotes.json'))) {
  const quotes = JSON.parse(fs.readFileSync(path.join(dump, 'live-quotes.json'), 'utf8')) as any[]
  const seen = new Set<string>()
  for (const q of quotes) {
    const runs = (Array.isArray(q.runs) ? q.runs : []).map(Number).filter((n: number) => n > 0)
    if (!runs.length) continue
    const key = JSON.stringify([runs, q.corners, q.ends, q.walkGates, q.dblGates])
    if (seen.has(key)) continue
    seen.add(key)
    real.push({
      name: `${q.customerName || 'saved quote'} (${runs.reduce((t: number, n: number) => t + n, 0)} ft)`, runs,
      rails: runs.map((_: number, i: number) => (q.runRails?.[i] === '8ft' ? '8ft' : '6ft') as RailWidth),
      corners: q.corners || 0, ends: q.ends || 0, walkGates: q.walkGates || 0, dblGates: q.dblGates || 0, tearOutSections: q.tearOutSections || 0, tearOutGates: q.tearOutGates || 0,
    })
  }
  const inv = path.join(dump, 'live-inventory.json')
  if (fs.existsSync(inv)) costs = Object.fromEntries((JSON.parse(fs.readFileSync(inv, 'utf8')) as any[]).map(i => [i.name, Number(i.unitCost)]))
}
// Real yards first (the ones with gates and the most runs), then generated jobs.
const REAL = real.sort((a, b) => (b.walkGates + b.dblGates) - (a.walkGates + a.dblGates) || b.runs.length - a.runs.length).slice(0, 10)
const JOBS = [...REAL, ...generated]

const byPart = (items: Array<{ item: string; qty: number; total: number }>) => {
  const m = new Map<string, { qty: number; total: number }>()
  for (const i of items) { const w = m.get(i.item); m.set(i.item, { qty: Math.round(((w?.qty ?? 0) + i.qty) * 100) / 100, total: Math.round(((w?.total ?? 0) + i.total) * 100) / 100 }) }
  return m
}

interface Row { style: string; jobs: number; realJobs: number; parts: number; same: number; gateCorrection: number; other: string[]; gateJobs: number }

function compareStyle(style: string): Row {
  const row: Row = { style, jobs: 0, realJobs: 0, parts: 0, same: 0, gateCorrection: 0, other: [], gateJobs: 0 }
  const auto = AUTO[style]
  for (const j of JOBS) {
    const jobRuns = auto ? j.runs.map((ft, i) => ({ ft, rail: j.rails[i] })) : null
    const old = auto
      ? legacyCalculateMixedMaterialsDetailed({ ...j, ...auto, runs: jobRuns! })
      : legacyCalculateMaterialsDetailed({ fenceStyle: style, ...j })
    const now = auto
      ? calculateMixedMaterialsDetailed({ ...j, ...auto, runs: jobRuns! })
      : calculateMaterialsDetailed({ fenceStyle: style, ...j })
    const a = byPart(old.items), b = byPart(now.items)
    const allEight = !!auto && j.rails.every(r => r === '8ft')
    const expect = expectedGateCorrection(style, j.walkGates, j.dblGates, allEight)
    if (expect.size) row.gateJobs++
    row.jobs++
    if (REAL.includes(j)) row.realJobs++
    for (const p of new Set([...a.keys(), ...b.keys()])) {
      row.parts++
      const qa = a.get(p)?.qty ?? 0, qb = b.get(p)?.qty ?? 0
      const want = Math.round((qa + (expect.get(p) ?? 0)) * 100) / 100
      if (qa === qb && (a.get(p)?.total ?? 0) === (b.get(p)?.total ?? 0)) row.same++
      else if (expect.has(p) && qb === Math.max(0, want)) row.gateCorrection++
      else row.other.push(`${j.name}: ${p} old ${qa}, kits ${qb}`)
    }
    // A part the correction expected that neither list has would be a miss too.
    for (const [p, d] of expect) if (!a.has(p) && !b.has(p) && d > 0) row.other.push(`${j.name}: ${p} expected +${d}, missing`)
  }
  return row
}

describe('material kits reproduce the old parts lists', () => {
  if (costs) setMaterialPriceSource(priceSourceFromMap(costs))
  const rows = [...LOCKED, ...Object.keys(AUTO)].map(compareStyle)

  test('every style has kits that were derived cleanly', () => {
    for (const s of [...LOCKED, ...Object.keys(AUTO)]) {
      const set = builtInKitSet(s)
      expect(set, s).not.toBeNull()
      expect(set!.mismatch ?? '', s).toBe('')
    }
    expect(builtInKitSet('Durafence')).toBeNull()
    expect(styleHasPartsList('Durafence')).toBe(false)
  })

  test('6 or more jobs per style, every part the same apart from the gate leaf correction', () => {
    for (const r of rows) {
      expect(r.jobs, r.style).toBeGreaterThanOrEqual(6)
      expect(r.other, r.style).toEqual([])
    }
    // The correction really happened where it should.
    for (const s of ["WV-ND 6'x8' Privacy", "WV-DS 6'x8' Privacy", "TV-ND 6'x8' Privacy", "TV-DS 6'x8' Privacy"]) {
      expect(rows.find(r => r.style === s)!.gateCorrection, s).toBeGreaterThan(0)
    }
  })

  test('vinyl gate leaf: 11 pickets, two 6 ft rails, U trim, no insert, plus hardware; a double gate is two leaves', () => {
    for (const s of ["WV-ND 6'x8' Privacy", "WV-ND 6'x6' Privacy", "WV-DS 6'x8' Privacy", "WV-Auto ND Privacy"]) {
      const set = builtInKitSet(s)!
      const walk = new Map(set.kits.walkGate!.map(p => [p.part, p.qty]))
      const dbl = new Map(set.kits.dblGate!.map(p => [p.part, p.qty]))
      expect(walk.get('*Vinyl, White, Picket, 62-1/4"'), s).toBe(11)
      expect(walk.get("*Vinyl, White, Rail, 6'"), s).toBe(2)
      expect(walk.get('*Vinyl, White, U-Trim, 59-1/4"'), s).toBe(2)
      expect(walk.has("*Vinyl, White, Rail, 8'"), s).toBe(false)
      expect([...walk.keys()].some(p => /Rail Insert/.test(p)), s).toBe(false)
      expect(walk.get('*Vinyl, Gate, Hinge'), s).toBe(1)
      expect(dbl.get('*Vinyl, White, Picket, 62-1/4"'), s).toBe(22)
      expect(dbl.get("*Vinyl, White, Rail, 6'"), s).toBe(4)
    }
    const tan = new Map(builtInKitSet("TV-ND 6'x8' Privacy")!.kits.walkGate!.map(p => [p.part, p.qty]))
    expect(tan.get('*Vinyl, Tan, Picket, 62-1/4"')).toBe(11)
    expect(tan.get("*Vinyl, Tan, Rail, 6'")).toBe(2)
  })

  // Tan dig set gates follow TAKEOFF_RULES.md (Jonathan's decision, Oct 20, 2026):
  //   Misc, Concrete (TV-DS row)        ceil(postCount + blankPosts + 2*dblGates + 2*walkGates)
  //   *Vinyl, Tan, Upright              2 per walk gate, 4 per double gate
  //   *Vinyl, Gate, P-Channel, 6'       1 per walk gate, 2 per double gate
  //   *Vinyl, Gate, Latch               1 per walk gate, 2 per double gate
  // Kits and the old list both carry this, so the item by item proof above still holds;
  // this pins the gate's own lines on TV-DS 6'x6', TV-DS 6'x8' and TV-Auto DS.
  test('tan dig set gate lines follow TAKEOFF_RULES (Oct 20, 2026)', () => {
    const parts = ['Misc, Concrete', '*Vinyl, Tan, Upright', "*Vinyl, Gate, P-Channel, 6'", '*Vinyl, Gate, Latch']
    const base = { runs: [60, 42], corners: 1, ends: 2, tearOutSections: 0, tearOutGates: 0 }
    const price = (s: string, walkGates: number, dblGates: number) => {
      const auto = AUTO[s]
      const r = withKitSets([], () => auto
        ? calculateMixedMaterialsDetailed({ ...base, ...auto, walkGates, dblGates, runs: base.runs.map(ft => ({ ft, rail: '6ft' as RailWidth })) })
        : calculateMaterialsDetailed({ fenceStyle: s, ...base, walkGates, dblGates }))
      return byPart(r.items)
    }
    for (const s of ["TV-DS 6'x6' Privacy", "TV-DS 6'x8' Privacy", 'TV-Auto DS Privacy']) {
      const none = price(s, 0, 0), walk = price(s, 1, 0), dbl = price(s, 0, 1)
      const d = (m: Map<string, { qty: number }>, p: string) => (m.get(p)?.qty ?? 0) - (none.get(p)?.qty ?? 0)
      expect(parts.map(p => d(walk, p)), s).toEqual([2, 2, 1, 1])
      // A double gate also adds its blank post's bag: 1 + 2 per double gate.
      expect(parts.map(p => d(dbl, p)), s).toEqual([3, 4, 2, 2])
    }
  })

  // White dig set concrete and the vinyl gate handle follow TAKEOFF_RULES.md (Jonathan's decision, Oct 20, 2026):
  //   Misc, Concrete (WV-DS row)   ceil(postCount + blankPosts + 2*dblGates + 2*walkGates): 2 bags per walk gate
  //                                (the 8 ft tall WV-DS list keeps its 2 bags per post and adds the 2 per walk gate)
  //   *Vinyl, Gate, Handle         gateCount*2 on the TV-DS, TV-ND, WV-DS and WV-ND privacy styles (a double gate is 2)
  // Tan walk gate H-beams stay 6 ft (Jonathan, Oct 20, 2026: no change).
  test('white dig set walk gate concrete and the vinyl gate handle follow TAKEOFF_RULES (Oct 20, 2026)', () => {
    const base = { runs: [60, 42], corners: 1, ends: 2, tearOutSections: 0, tearOutGates: 0 }
    const price = (s: string, walkGates: number, dblGates: number) => {
      const auto = AUTO[s]
      const r = withKitSets([], () => auto
        ? calculateMixedMaterialsDetailed({ ...base, ...auto, walkGates, dblGates, runs: base.runs.map(ft => ({ ft, rail: '6ft' as RailWidth })) })
        : calculateMaterialsDetailed({ fenceStyle: s, ...base, walkGates, dblGates }))
      return byPart(r.items)
    }
    const delta = (s: string, w: number, d: number, p: string) => (price(s, w, d).get(p)?.qty ?? 0) - (price(s, 0, 0).get(p)?.qty ?? 0)
    for (const s of ["WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy", "WV-DS 8'x6' Privacy", "WV-DS 8'x8' Privacy", 'WV-Auto DS Privacy']) {
      expect(delta(s, 1, 0, 'Misc, Concrete'), s).toBe(2)
    }
    for (const s of ["WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy", 'WV-Auto DS Privacy']) {
      expect(delta(s, 0, 1, 'Misc, Concrete'), s).toBe(3) // its blank post's bag + 2 per double gate, as before
    }
    // Tan dig set 8 ft tall walk gates get 2 bags of concrete too (Jonathan's decision, Oct 20, 2026:
    // "Tan dig set 8 ft tall walk gates get 2 bags of concrete too"; TAKEOFF_RULES "Misc, Concrete",
    // TV-DS row, ceil(postCount + blankPosts + 2*dblGates + 2*walkGates)). Like the white 8 ft list,
    // the posts keep their 2 bags each; double gates are unchanged.
    for (const s of ["TV-DS 8'x6' Privacy", "TV-DS 8'x8' Privacy"]) {
      expect(delta(s, 1, 0, 'Misc, Concrete'), s).toBe(2)
      expect(delta(s, 2, 0, 'Misc, Concrete'), s).toBe(4)
      expect(delta(s, 0, 1, 'Misc, Concrete'), s).toBe(0)
    }
    const handleStyles = [...LOCKED.filter(s => /^(WV|TV)-(ND|DS) /.test(s)), ...Object.keys(AUTO)]
    expect(handleStyles.length).toBe(21)
    for (const s of handleStyles) {
      expect(delta(s, 1, 0, '*Vinyl, Gate, Handle'), s).toBe(2)
      expect(delta(s, 0, 1, '*Vinyl, Gate, Handle'), s).toBe(4)
      expect(price(s, 0, 0).has('*Vinyl, Gate, Handle'), s).toBe(false)
    }
    // Tan walk gate H-beams: still two 6 ft per walk gate.
    for (const s of ["TV-DS 6'x6' Privacy", "TV-ND 6'x6' Privacy", 'TV-Auto DS Privacy']) {
      expect(delta(s, 1, 0, "*Vinyl, Gate, H-Beam, 6'"), s).toBe(2)
    }
  })

  test('chain link per foot parts are rounded up once per job', () => {
    const set = builtInKitSet("CL - 4' Galv")!
    const foot = new Map(set.kits.perFoot!.map(p => [p.part, p.qty]))
    expect(foot.get('Fabric, Galv, 48" KK (11.5)')).toBe(0.02)
    expect(foot.get('Pipe, Galv, 1-3/8" X 10\' 6" (SS40)')).toBe(0.1)
    expect(set.roundUp).toEqual(expect.arrayContaining(['Fabric, Galv, 48" KK (11.5)', 'Pipe, Galv, 1-3/8" X 10\' 6" (SS40)']))
    const lines = new Map(linesFromKitSet(set, countsFor("CL - 4' Galv", [51], { corners: 0, ends: 2, walkGates: 0, dblGates: 0 })).map(l => [l.part, l.qty]))
    expect(lines.get('Fabric, Galv, 48" KK (11.5)')).toBe(2)
    expect(lines.get('Pipe, Galv, 1-3/8" X 10\' 6" (SS40)')).toBe(6)
  })

  test('a saved kit is used instead of the built in one; archiving every set leaves the style without material', () => {
    const style = "WV-ND 6'x6' Privacy"
    const mine: KitSet = { ...JSON.parse(JSON.stringify(builtInKitSet(style))), id: 'k1', builtIn: false }
    mine.kits.section = mine.kits.section!.map(p => (p.part === '*Vinyl, White, Picket, 62-1/4"' ? { ...p, qty: 12 } : p))
    const job = { fenceStyle: style, runs: [60], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 }
    const pickets = (r: ReturnType<typeof calculateMaterialsDetailed>) => r.items.find(i => i.item === '*Vinyl, White, Picket, 62-1/4"')?.qty
    expect(pickets(calculateMaterialsDetailed(job))).toBe(110)
    expect(withKitSets([mine], () => pickets(calculateMaterialsDetailed(job)))).toBe(120)
    const archived = withKitSets([{ ...mine, archived: true }], () => calculateMaterialsDetailed(job))
    expect(archived.items).toEqual([])
    expect(archived.warnings.join(' ')).toMatch(/no material kit in use/)
    expect(kitSetFor(style, [{ ...mine, styleName: null }])).toMatchObject({ builtIn: true })
  })

  test('report', () => {
    const out = process.env.KITS_REPORT
    const t = (n: number) => `$${n.toFixed(2)}`
    const unit = (part: string, fallback: number) => (costs && part in costs ? costs[part] : fallback)
    const lines: string[] = []
    lines.push('## Kits against the old parts lists, item by item', '')
    lines.push(`Real yards: ${REAL.length} (runs, posts and gates of saved quotes), generated jobs: ${generated.length}. Each style is priced on every one.`, '')
    lines.push('| Style | Jobs (real + generated) | Parts compared | Identical | Gate leaf correction | Anything else |', '|---|---|---|---|---|---|')
    for (const r of rows) lines.push(`| ${r.style} | ${r.jobs} (${r.realJobs} + ${r.jobs - r.realJobs}) | ${r.parts} | ${r.same} | ${r.gateCorrection}${r.gateCorrection ? ` (on ${r.gateJobs} gate jobs)` : ''} | ${r.other.length ? r.other.length : 'none'} |`)
    lines.push('', '## Kits per style (unit cost from Inventory)', '')
    for (const s of [...LOCKED, ...Object.keys(AUTO)]) {
      const set = builtInKitSet(s)!
      lines.push(`### ${s}`, '')
      for (const k of KIT_KINDS) {
        const parts = set.kits[k]
        if (!parts?.length) continue
        const cost = parts.reduce((sum, p) => sum + p.qty * unit(p.part, p.fallbackCost), 0)
        lines.push(`**${KIT_LABEL[k]}**: ${t(cost)}`, '')
        for (const p of parts) lines.push(`- ${p.qty} × ${p.part} @ ${t(unit(p.part, p.fallbackCost))}${set.roundUp.includes(p.part) ? ' (job total rounded up)' : ''}`)
        lines.push('')
      }
    }
    if (out) fs.writeFileSync(out, lines.join('\n'))
    console.log(rows.map(r => `${r.style}: ${r.jobs} jobs, ${r.parts} parts, ${r.same} same, ${r.gateCorrection} gate correction, ${r.other.length} other`).join('\n'))
    expect(lines.length).toBeGreaterThan(10)
  })
})
