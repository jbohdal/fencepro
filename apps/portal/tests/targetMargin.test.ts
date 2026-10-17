/**
 * Target Margin: Overhead % + each style's Target Profit %, price = cost ÷
 * (100% − Target Margin). Converting from the old per style number must not
 * move any price: every saved quote prices exactly the same before and after.
 *
 * With LIVE_DUMP=<folder holding live-config.json and live-quotes.json> (a
 * read only copy of live), every live quote is checked too.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { withTargetMargins, parsePercent } from '../../web/src/targetMargin'
import type { AppConfig, FenceStyle } from '../../web/src/configStore'
import { calculatePrice } from '../../web/src/pricingEngine'
import { splitDollars, picketCounts } from '../../web/src/DollarPickets'

const style = (name: string, margin: number, extra: Partial<FenceStyle> = {}): FenceStyle =>
  ({ id: name, name, category: 'Vinyl', margin, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, ...extra })
const cfgWith = (styles: FenceStyle[], overheadPct?: number) =>
  ({ fenceStyles: styles, pricing: { overheadPct } } as unknown as AppConfig)

describe('Target Margin', () => {
  test('converting at 30% overhead: 0.56 → 14% profit, 0.60 → 10%, 0.58 → 12%, and the same divisor exactly', () => {
    const out = withTargetMargins(cfgWith([style('WV-ND', 0.56), style('WV-DS', 0.60), style('CL', 0.58, { category: 'Chainlink' })]))
    expect(out.pricing.overheadPct).toBe(30)
    expect(out.fenceStyles.map(s => s.targetProfitPct)).toEqual([14, 10, 12])
    // Bit for bit the same number as before, so no price moves by even a cent.
    expect(out.fenceStyles.map(s => s.margin)).toEqual([0.56, 0.60, 0.58])
  })

  test('Target Margin = Overhead % + Target Profit %; changing overhead moves every style', () => {
    const out = withTargetMargins(cfgWith([style('a', 0.56, { targetProfitPct: 14 }), style('b', 0.6, { targetProfitPct: 10 })], 32))
    expect(out.fenceStyles.map(s => s.margin)).toEqual([(100 - 32 - 14) / 100, (100 - 32 - 10) / 100])
  })

  test('percents are typed as people say them', () => {
    expect([parsePercent('44'), parsePercent('44%'), parsePercent(' 44.5 % '), parsePercent('abc'), parsePercent('')]).toEqual([44, 44, 44.5, null, null])
  })

  test('where every dollar goes: 20 pickets, profit is what is left, commission its own slice', () => {
    const parts = splitDollars({ price: 10000, materials: 3500, labor: 2100, commission: 500, overheadPct: 30 })
    expect(parts.map(p => [p.part, Math.round(p.dollars)])).toEqual([['materials', 3500], ['labor', 2100], ['overhead', 3000], ['commission', 500], ['profit', 900]])
    const counts = picketCounts(parts)
    expect(counts.reduce((t, c) => t + c.count, 0)).toBe(20)
    expect(Object.fromEntries(counts.map(c => [c.part, c.count]))).toEqual({ materials: 7, labor: 4, overhead: 6, commission: 1, profit: 2 })
  })
})

const dump = process.env.LIVE_DUMP
describe.skipIf(!dump)('live: every saved quote prices the same before and after', () => {
  test('all quotes', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(dump!, 'live-config.json'), 'utf8')) as AppConfig
    const quotes = JSON.parse(fs.readFileSync(path.join(dump!, 'live-quotes.json'), 'utf8')) as any[]
    const before = new Map(cfg.fenceStyles.map(s => [s.name, s]))
    const after = new Map(withTargetMargins(cfg).fenceStyles.map(s => [s.name, s]))
    const rows: string[] = []
    for (const s of withTargetMargins(cfg).fenceStyles) rows.push(`${s.name} | ${before.get(s.name)!.margin} | ${s.targetProfitPct}% | ${Math.round((100 - s.margin * 100) * 100) / 100}%`)
    console.log(`Style | old number | Target Profit | Target Margin (overhead 30%)\n${rows.join('\n')}`)
    let checked = 0, same = 0
    const moved: string[] = []
    for (const q of quotes) {
      const old = before.get(q.fenceStyle), now = after.get(q.fenceStyle)
      if (!old || !now) continue
      const footage = (Array.isArray(q.runs) ? q.runs : []).reduce((t: number, n: number) => t + Number(n || 0), 0)
      const input = {
        sections: q.sections, footage, walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates,
        materialCost: q.materialCost, extraLaborHrs: q.adjLaborHrs ?? 0, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust ?? 0,
        pricing: cfg.pricing as any, overrides: q.pricing ?? undefined,
      }
      const a = calculatePrice({ ...input, style: old as any }).price
      const b = calculatePrice({ ...input, style: now as any }).price
      checked++
      if (a === b) same++; else moved.push(`${q.id} ${q.fenceStyle}: ${a} → ${b}`)
    }
    console.log(`checked ${checked} quotes; identical ${same}; moved ${moved.length}`)
    expect(moved).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })
})
