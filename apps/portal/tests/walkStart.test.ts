/**
 * Every new quote opens on the walk list (Jonathan, Nov 6 2026; web/src/walkList.ts newQuoteWalk): a new quote that
 * starts with a fence in it (the website's drawing, Map Quote) has it as walk steps (sides, feet, gates, corners and
 * which way they turn) that price exactly the same; a saved quote opens as it was saved.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import { setMaterialPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { estimateConfig, quoteJobFor, widgetQuoteFor, type EstimateData } from '../../web/src/estimate'
import { toYardLayout } from '../../web/src/widgetDraw'
import { deriveLayout, teePostFor } from '../../web/src/yardLayout'
import { layoutPanelFt } from '../../web/src/gateSlide'
import { isNewStart, newQuoteWalk, runsToWalk, walkToYard, stepLines, walkProblems, turnsOfPoints } from '../../web/src/walkList'

const cfg = estimateConfig(null)
const data: EstimateData = { config: null as never, inventory: [], kits: [] }
const VINYL = "WV-ND 6'x8' Privacy", CL = "CL - 5' Galv"
const styleOf = (n: string) => cfg.fenceStyles.find(s => s.name === n)!
beforeAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

// A backyard drawn on the photo, house to house, with a 4 ft walk gate on its second side (clockwise: every corner turns right).
const at = { lat: 29.185118, lng: -82.134209 }
const pt = (e: number, n: number) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'r1', pts: [pt(-30, 15), pt(-55, 15), pt(-55, 95), pt(55, 95), pt(55, 15), pt(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }

describe('a new quote with a fence in it opens on walk steps that price the same', () => {
  test('the website drawing (a draft no one has sent): same runs, posts, gates and price for each style; turns as drawn', () => {
    const yard = toYardLayout(drawing as never)
    for (const name of [VINYL, CL]) {
      const nearIn = layoutPanelFt(styleOf(name)) * 12
      const start = newQuoteWalk({ id: 'q1', status: 'DRAFT', shareToken: null, layout: { yard, widgetDrawing: { sides: [] } } }, nearIn)!
      expect(start.from).toBe('drawing')
      expect(walkProblems(start.walk)).toEqual([])
      const teeAs = teePostFor(styleOf(name))
      const a = deriveLayout(yard, nearIn, { teeAs }), b = deriveLayout(walkToYard(start.walk), nearIn, { teeAs })
      const pick = (r: typeof a) => ({ runs: r.runs.map(x => x.ft), corners: r.corners, ends: r.ends, walk: r.walkGates, dbl: r.dblGates, widths: r.gateWidthsFt, lines: r.linePosts, tees: r.tees })
      expect(pick(b)).toEqual(pick(a))
      const priceA = widgetQuoteFor(data, yard, name), priceB = widgetQuoteFor(data, walkToYard(start.walk), name)
      expect(priceB.price).toBe(priceA.price)
      expect(priceB.job.calc.perRunSections).toEqual(priceA.job.calc.perRunSections)
      expect(priceB.job.pullSheet).toEqual(priceA.job.pullSheet)
    }
    const walk = newQuoteWalk({ id: 'q1', status: 'DRAFT', layout: { yard, widgetDrawing: {} } }, 96)!.walk
    expect(stepLines(walk).map(l => l.text)).toEqual([
      'Side 1: 25 ft, Corner right', 'Side 2: 11 ft, Gate 4 ft single', 'Side 2: 65 ft, Corner right', 'Side 3: 110 ft, Corner right', 'Side 4: 80 ft, Corner right', 'Side 5: 25 ft, End post',
    ])
  })

  test('Map Quote (a line of points): one side per run, corners turning as on the map, same price as the typed runs', () => {
    // East 60 ft, north 90 ft, west 60 ft: two left turns.
    const pts = [pt(0, 0), pt(60, 0), pt(60, 90), pt(0, 90)]
    const turns = turnsOfPoints(pts)
    expect(turns).toEqual(['left', 'left'])
    const q = { runs: [60, 90, 60], corners: 2, ends: 2, walkGates: 0, dblGates: 0, layout: { mapTurns: turns } }
    const start = newQuoteWalk(q, 96)!
    expect(start.from).toBe('map')
    expect(stepLines(start.walk).map(l => l.text)).toEqual(['Side 1: 60 ft, Corner left', 'Side 2: 90 ft, Corner left', 'Side 3: 60 ft, End post'])
    for (const name of [VINYL, CL]) {
      const style = styleOf(name), nearIn = layoutPanelFt(style) * 12
      const r = deriveLayout(walkToYard(start.walk), nearIn, { teeAs: teePostFor(style) })
      expect([r.runs.map(x => x.ft), r.corners, r.ends, r.walkGates, r.dblGates, r.linePosts, r.tees]).toEqual([[60, 90, 60], 2, 2, 0, 0, 0, 0])
      const req = (runs: number[], corners: number, ends: number) => ({ fenceStyle: name, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners, ends, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {} })
      const typed = quoteJobFor(data, req(q.runs, 2, 2) as never), walked = quoteJobFor(data, req(r.runs.map(x => x.ft), r.corners, r.ends) as never)
      expect(walked.totals.price).toBe(typed.totals.price)
      expect(walked.pullSheet).toEqual(typed.pullSheet)
    }
  })

  test('a run list the walk can\'t price the same stays on the typed lengths; a blank new quote opens on a blank walk list', () => {
    expect(runsToWalk({ runs: [50, 30], corners: 0, ends: 4 })).toBeNull()
    expect(runsToWalk({ runs: [50, 30], corners: 1, ends: 2, walkGates: 1 })).toBeNull()
    expect(newQuoteWalk({ runs: [50, 30], corners: 0, ends: 4 }, 96)).toBeNull()
    const blank = newQuoteWalk({ runs: [] }, 96)!
    expect([blank.from, blank.walk.lines.length, blank.walk.lines[0].steps.length]).toEqual([null, 1, 0])
    expect(newQuoteWalk(null, 96)!.from).toBeNull()
  })
})

describe('saved quotes open as they were saved', () => {
  test('a saved drawn quote, a sent website quote, a walked quote and a sold one are not new starts', () => {
    const yard = toYardLayout(drawing as never)
    expect(newQuoteWalk({ id: 'q1', status: 'DRAFT', layout: { yard } }, 96)).toBeNull()
    expect(newQuoteWalk({ id: 'q1', status: 'SENT', shareToken: 't', layout: { yard, widgetDrawing: {} } }, 96)).toBeNull()
    expect(newQuoteWalk({ id: 'q1', status: 'DRAFT', shareToken: 't', layout: { yard, widgetDrawing: {} } }, 96)).toBeNull()
    expect(newQuoteWalk({ id: 'q1', status: 'SOLD', layout: { yard, widgetDrawing: {} } }, 96)).toBeNull()
    expect(isNewStart({ id: 'q1', status: 'DRAFT', layout: { yard, walk: { v: 1, lines: [] }, widgetDrawing: {} } })).toBe(false)
    expect(newQuoteWalk({ id: 'q1', status: 'DRAFT', runs: [40, 20], corners: 1, ends: 2 }, 96)).toBeNull()
    // A saved quote with no fence yet: a blank walk list, as before.
    expect(newQuoteWalk({ id: 'q1', status: 'DRAFT', runs: [] }, 96)!.walk.lines[0].steps).toEqual([])
  })
})
