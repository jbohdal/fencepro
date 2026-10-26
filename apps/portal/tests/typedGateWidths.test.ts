/**
 * Gate widths survive "Advanced: type runs" (review, Oct 26 2026): a yard drawn
 * with a 12 ft double gate on Black 4 ft chain link was $2,029 (2 × 4' x 6'
 * leaves); opening the typed run list repriced it as an 8 ft gate (2 × 4' x 4',
 * $1,962) with no note. The typed list now keeps each gate's width (from the
 * drawing, or picked there), a quote saved from it keeps them on its layout
 * (layout.gateWidths), and the server prices them the same (Salesman /
 * Installer quotes, change orders, the job's rebuilt work and pull sheet).
 */
import { describe, test, expect } from 'vitest'
import { fitGateWidths, defaultGateWidths, layoutGateWidths, deriveLayout, layoutForShape } from '../../web/src/yardLayout'
import { calculateQuote } from '../../web/src/quoteCalc'
import { priceQuoteJob } from '../../web/src/quoteJob'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { deriveRunsFor } from '../../web/src/changeOrderYard'
import { requestFrom } from '../src/server/lib/quotePricing'
import { requestOfQuote, requestForShape } from '../src/server/lib/changeOrderWork'
import { applyChange, shapeOf, sameShape, fitWidths, type WorkShape } from '../src/server/lib/changeOrderMerge'
import { lockedChanges } from '../src/server/lib/quoteLock'

const leaf = (h: number, w: number) => `Chainlink, Black, Gate, 1-3/8", ${h}' x ${w}' (.065)`
const qty = (items: Array<{ item: string; qty: number }>, p: string) => items.filter(i => i.item === p).reduce((t, i) => t + i.qty, 0)

/** The reviewer's yard: a 100 ft straight line with a 12 ft double gate in the middle (44 ft each side). */
const yard = () => {
  const y = layoutForShape('straight')
  y.sides[0].lengthIn = 1200
  y.sides[0].gate = { type: 'double', widthIn: 144, position: 'middle' }
  return y
}

describe('the typed run list keeps each gate\'s width', () => {
  test('widths fit the typed counts: kept for as many gates as are typed, an added gate 4 ft / 8 ft', () => {
    expect(fitGateWidths({ walk: [5], dbl: [12] }, 1, 1)).toEqual({ walk: [5], dbl: [12] })
    expect(fitGateWidths({ walk: [5], dbl: [12] }, 2, 2)).toEqual({ walk: [5, 4], dbl: [12, 8] })
    expect(fitGateWidths({ walk: [5, 6], dbl: [12] }, 1, 0)).toEqual({ walk: [5], dbl: [] })
    expect(fitGateWidths(null, 1, 1)).toEqual({ walk: [4], dbl: [8] })
    expect(defaultGateWidths({ walk: [4], dbl: [8] })).toBe(true)
    expect(defaultGateWidths({ walk: [4], dbl: [12] })).toBe(false)
  })

  test('a saved quote\'s widths: the drawing\'s, else the typed list\'s', () => {
    expect(layoutGateWidths({ yard: yard() })).toEqual({ walk: [], dbl: [12] })
    expect(layoutGateWidths({ yard: null, gateWidths: { walk: [5], dbl: [10] } })).toEqual({ walk: [5], dbl: [10] })
    expect(layoutGateWidths({ yard: null })).toBeNull()
  })

  test('the 12 ft double gate is two 4\' x 6\' leaves drawn or typed, on the phone and on the server', () => {
    const cfg = estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { overheadPct: 30 } } as any)
    const style = cfg.fenceStyles.find(s => s.name === "CL - 4' Black")!
    const d = deriveLayout(yard(), 120)
    expect(d.gateWidthsFt).toEqual({ walk: [], dbl: [12] })
    // "Advanced: type runs": the drawing's runs, counts and widths (QuoteBuilder toAdvanced).
    const typed = fitGateWidths(d.gateWidthsFt, d.walkGates, d.dblGates)
    const base = {
      runs: d.runs.map(r => ({ ft: r.ft, rail: 'auto' as const })), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {},
    }
    const drawn = calculateQuote({ ...base, style, gateWidths: d.gateWidthsFt, pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS })
    const kept = calculateQuote({ ...base, style, gateWidths: typed, pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS })
    const lost = calculateQuote({ ...base, style, pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS })
    expect(qty(kept.materials.items, leaf(4, 6))).toBe(2)
    expect(qty(kept.materials.items, leaf(4, 4))).toBe(0)
    expect(kept.priced.price).toBe(drawn.priced.price)
    // What the reviewer saw (no widths: two 4 ft leaves, a lower price).
    expect(qty(lost.materials.items, leaf(4, 4))).toBe(2)
    expect(lost.priced.price).toBeLessThan(kept.priced.price)

    // A Salesman's or Installer's phone: the server prices the request the builder sends (with its widths).
    const { req } = requestFrom({ ...base, fenceStyle: style.name, gateWidths: typed, jobType: 'new' }, null, () => null)
    const job = priceQuoteJob(cfg, req as any, 30)
    expect(qty(job.calc.materials.items, leaf(4, 6))).toBe(2)
    expect(job.calc.priced.price).toBe(kept.priced.price)

    // Saved from the typed list (no yard; widths on the layout): repriced on the server the same.
    const saved = { fenceStyle: style.name, runs: d.runs.map(r => r.ft), corners: d.corners, ends: d.ends, walkGates: 0, dblGates: 1, layout: { yard: null, runSections: [], gateWidths: typed } }
    const again = priceQuoteJob(cfg, requestOfQuote(saved) as any, 30)
    expect(qty(again.calc.materials.items, leaf(4, 6))).toBe(2)
  })
})

describe('change orders from a typed run list keep the gate widths', () => {
  const STYLE = 'chain/4/black/res/ds'
  const derive = (y: any, s: string) => deriveRunsFor([{ name: STYLE, category: 'Chainlink', panelWidth: 10 }], y, s)
  const typedShape = (runs: number[], dbl: number[], walk: number[] = []): WorkShape => shapeOf({
    fenceStyle: STYLE, runs, corners: 0, ends: 4, walkGates: walk.length, dblGates: dbl.length, layout: { yard: null, gateWidths: { walk, dbl } },
  })

  test('the shape keeps them; the request for it sends them; a width change is a change', () => {
    const s = typedShape([44, 44], [12])
    expect(s.gateWidths).toEqual({ walk: [], dbl: [12] })
    expect(requestForShape(s, { gateWidths: { walk: [], dbl: [8] } }).gateWidths).toEqual({ walk: [], dbl: [12] })
    expect(sameShape(s, typedShape([44, 44], [10]))).toBe(false)
    // Plain 4 ft / 8 ft gates keep nothing (as before).
    expect(typedShape([44, 44], [8]).gateWidths).toBeUndefined()
    expect(fitWidths({ walk: [4], dbl: [8] }, 1, 1)).toBeNull()
  })

  test('a typed change on a drawn job keeps the drawn widths; an added gate is 4 ft', () => {
    const drawn = (() => { const d = derive(yard(), STYLE)!; return { fenceStyle: STYLE, runs: d.runs, corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates, tearOutSections: 0, tearOutGates: 0, yard: yard() } as WorkShape })()
    // Typed from the drawing: runs 44 / 50, a walk gate added; the 12 ft double gate kept.
    const mine = typedShape([44, 50], [12], [4])
    const out = applyChange(drawn, { number: 1, base: drawn, work: mine }, derive)
    expect(out.shape.yard).toBeNull()
    expect(out.shape.gateWidths).toEqual({ walk: [4], dbl: [12] })
    expect(requestForShape(out.shape, {}).gateWidths).toEqual({ walk: [4], dbl: [12] })
  })

  test('two typed change orders: the one that changes the width decides it', () => {
    const start = typedShape([44, 44], [12])
    const co1 = typedShape([44, 54], [12])          // longer run, same gate
    const co2 = typedShape([44, 44], [10])          // the gate made 10 ft
    const after1 = applyChange(start, { number: 1, base: start, work: co1 }, derive).shape
    const after2 = applyChange(after1, { number: 2, base: start, work: co2 }, derive).shape
    expect(after2.runs).toEqual([44, 54])
    expect(after2.gateWidths).toEqual({ walk: [], dbl: [10] })
  })
})

describe('a signed typed quote: a gate width change is a change', () => {
  test('lockedChanges counts layout.gateWidths on a typed list', () => {
    const saved = { status: 'SOLD', layout: { yard: null, runSections: [5, 5], gateWidths: { walk: [], dbl: [12] } } }
    expect(lockedChanges(saved, { layout: { yard: null, runSections: [5, 5], gateWidths: { walk: [], dbl: [12] } } })).toEqual([])
    expect(lockedChanges(saved, { layout: { yard: null, runSections: [5, 5], gateWidths: { walk: [], dbl: [10] } } })).toEqual(['layout'])
    // A typed quote saved before this (no widths) opened and saved unchanged: no change.
    expect(lockedChanges({ status: 'SOLD', layout: { yard: null, runSections: [5] } }, { layout: { yard: null, runSections: [5] } })).toEqual([])
  })
})
