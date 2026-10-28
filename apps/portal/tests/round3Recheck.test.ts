/**
 * Round 3 recheck (Oct 26 2026): what an independent re-check found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { jobRowTarget } from '../../web/src/customerPage'
import { canOpenOperations } from '../../web/src/permissions'
import { shapeOf, sideChanges, sideChangeWords, ownChangeWords, ownLineWords, applyChange, type DeriveRuns } from '../src/server/lib/changeOrderMerge'
import { shownLines, alsoInDrawing, alsoInDrawingWords } from '../src/server/lib/changeOrders'
import { arrivalContact } from '../src/server/lib/followUps'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'

describe('a Jobs tab row opens what the login can see (item 1)', () => {
  test('the Salesman cannot open Operations; the office, the owner and the installer can', () => {
    expect(canOpenOperations('sales_rep')).toBe(false)
    for (const r of ['super_admin', 'admin', 'manager', 'office_staff', 'field_crew']) expect(canOpenOperations(r)).toBe(true)
    expect(canOpenOperations(null)).toBe(false)
  })
  test('the office: the job window in Operations', () => {
    expect(jobRowTarget({ jobId: 'j 1', canOpenOperations: true }))
      .toEqual({ kind: 'operations', path: '/operations?job=j%201' })
  })
  test('the Salesman: the job page, read only (audit #49), never Operations', () => {
    expect(jobRowTarget({ jobId: 'j 1', canOpenOperations: false }))
      .toEqual({ kind: 'job', path: '/job?id=j%201' })
  })
})

// The yard of the recheck: Left side 40 ft, Back 60 ft, Right side 42 ft (142 ft). CO-1 (Christa): Left side 40 -> 50 ft.
// CO-2 (Jonathan, drawn on top of CO-1): a 4 ft walk gate in the Back. CO-2 signed first: 142 -> 138; then CO-1: 148.
const side = (id: string, name: string, ft: number, gate: any = null) => ({ id, name, on: true, lengthIn: ft * 12, startFinish: 'corner', endFinish: 'corner', gate, skip: null })
const yard = (left: number, gate = false) => ({ shape: 'backyard', closed: false, sides: [side('l', 'Left side', left), side('b', 'Back', 60, gate ? { type: 'walk', widthIn: 48, position: 'middle' } : null), side('r', 'Right side', 42)] })
// Runs as the builder makes them: a side with a gate is two pieces.
const derive: DeriveRuns = y => {
  const runs: number[] = []; let walk = 0
  for (const s of y.sides) { const ft = s.lengthIn / 12; if (s.gate) { walk++; runs.push((ft - 4) / 2, (ft - 4) / 2) } else runs.push(ft) }
  return { runs, corners: 2, ends: 2, walkGates: walk, dblGates: 0 }
}
const shape = (y: any) => ({ ...shapeOf({ yard: y }), ...(() => { const d = derive(y, '')!; return { runs: d.runs, corners: d.corners, ends: d.ends, walkGates: d.walkGates } })() })

describe("a change order's words say its own change, true in any order (item 2)", () => {
  const signed = shape(yard(40)), co1 = shape(yard(50)), co2Base = co1, co2 = shape(yard(50, true))
  test('side by side: "Left side 40 ft → 50 ft"; a gate put in changes no side length', () => {
    expect(sideChangeWords(sideChanges(signed, co1))).toBe('Left side 40 ft → 50 ft')
    expect(sideChanges(co2Base, co2)).toEqual([])
    expect(ownChangeWords({ ...co1, base: signed })).toBe('Left side 40 ft → 50 ft')
  })
  test('sides added and taken out', () => {
    const more = { ...yard(40), sides: [...yard(40).sides, side('f', 'Front', 20)] }
    expect(sideChangeWords(sideChanges(signed, shape(more)))).toBe('Front 20 ft added')
    const less = { ...yard(40), sides: yard(40).sides.filter(s => s.id !== 'r') }
    expect(sideChangeWords(sideChanges(signed, shape(less)))).toBe('Right side taken out (42 ft)')
  })
  test('the words stay true whichever is signed first: CO-1 on the job after CO-2 is still Left side 40 → 50', () => {
    const afterCo2 = applyChange(signed, { number: 2, base: co2Base, work: co2 }, derive).shape
    const afterBoth = applyChange(afterCo2, { number: 1, base: signed, work: co1 }, derive).shape
    expect(afterCo2.runs.reduce((a, b) => a + b, 0)).toBe(138)
    expect(afterBoth.runs.reduce((a, b) => a + b, 0)).toBe(148)
    // What CO-1 did to the job as it stood when it was signed: the same side words.
    expect(sideChangeWords(sideChanges(afterCo2, afterBoth))).toBe('Left side 40 ft → 50 ft')
  })
  test('old words with the whole fence ("146 ft to 156 ft") become the change order\'s own sides; other lines stay', () => {
    expect(ownLineWords('Add 10 ft of fence, 2 panels more (146 ft to 156 ft)', 'Left side 40 ft → 50 ft')).toBe('Add 10 ft of fence, 2 panels more (Left side 40 ft → 50 ft)')
    expect(ownLineWords('Add 8 ft of fence, 2 panels more (130 ft to 138 ft of fence, gates not counted)', 'Back 50 ft → 62 ft')).toBe('Add 8 ft of fence, 2 panels more (Back 50 ft → 62 ft; the fence feet leave out the gates)')
    expect(ownLineWords('Add 6 ft of fence (130 ft to 136 ft): still 15 panels in all, no price change', 'Back 50 ft → 53 ft, Left side 40 ft → 43 ft')).toBe('Add 6 ft of fence (Back 50 ft → 53 ft, Left side 40 ft → 43 ft): same panels, no price change')
    expect(ownLineWords('Add 1 walk gate in the Back side (4 ft of fence becomes the gate)', 'Left side 40 ft → 50 ft')).toBe('Add 1 walk gate in the Back side (4 ft of fence becomes the gate)')
    expect(ownLineWords('Add 10 ft of fence (146 ft to 156 ft)', null)).toBe('Add 10 ft of fence (146 ft to 156 ft)')
  })
  const work = { ...co1, base: signed }
  const lines = [{ id: 'a', description: 'Add 10 ft of fence, 2 panels more (146 ft to 156 ft)', amountCents: 50000 }]
  test('shown and signed: the own words until signed; once signed, what was signed', () => {
    expect(shownLines({ lines, work }).map(l => l.description)).toEqual(['Add 10 ft of fence, 2 panels more (Left side 40 ft → 50 ft)'])
    expect(shownLines({ lines, work, signedAt: new Date() }).map(l => l.description)).toEqual([lines[0].description])
    expect(shownLines({ lines, work: null }).map(l => l.description)).toEqual([lines[0].description])
  })
  test("CO-2's drawing also shows CO-1's side: said, with CO-1 not signed yet (then signed)", () => {
    const t0 = new Date('2026-10-26T13:00:00Z'), t1 = new Date('2026-10-26T13:10:00Z')
    const c1 = { id: '1', number: 1, status: 'sent', work, createdAt: t0, approvedAt: null, voidedAt: null }
    const c2 = { id: '2', number: 2, status: 'sent', work: { ...co2, base: co2Base }, createdAt: t1, approvedAt: null, voidedAt: null }
    expect(alsoInDrawing(c2, [c1, c2])).toEqual([{ number: 1, status: 'sent', signed: false, change: 'Left side 40 ft → 50 ft' }])
    expect(alsoInDrawingWords(alsoInDrawing(c2, [c1, c2]))).toEqual(["The drawing also shows CO-1's change (Left side 40 ft → 50 ft): not part of this change order (CO-1, not signed yet)."])
    expect(alsoInDrawing(c1, [c1, c2])).toEqual([])                      // made before CO-2: its drawing has nothing of CO-2's
    const signed1 = { ...c1, status: 'approved', approvedAt: new Date('2026-10-26T14:00:00Z') }
    expect(alsoInDrawingWords(alsoInDrawing(c2, [signed1, c2]))[0]).toMatch(/\(CO-1, signed separately\)\.$/)
    const before = { ...c1, status: 'approved', approvedAt: new Date('2026-10-26T12:30:00Z') }
    expect(alsoInDrawing(c2, [before, c2])).toEqual([])                  // signed before CO-2 was drawn: part of the job already
  })
})

describe('the change order made in the quote builder says its sides (item 2)', () => {
  const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
  beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
  afterAll(() => setMaterialPriceSource(null))
  const style: QuoteStyle = { name: "WV-ND 6'x8' Privacy", category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 8 }
  const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
  const input = (runs: number[]): QuoteCalcInput => ({ style, runs: runs.map(ft => ({ ft })), corners: 2, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS })
  test('"Add 10 ft of fence, 2 panels more (Left side 40 ft → 50 ft)", never the whole fence before and after', () => {
    const was = input([40, 60, 46]), now = input([50, 60, 46])
    const signed = { id: 'q', fenceStyle: style.name, runs: [40, 60, 46], runRails: ['auto', 'auto', 'auto'], corners: 2, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0, sections: calculateQuote(was).sections, finalPrice: calculateQuote(was).priced.price } as any
    const d = changeOrderDraft({ signed, current: now, signedOverrides: was.overrides, styles: [style], priceNow: calculateQuote(now).priced.price, sectionsNow: calculateQuote(now).sections, simple: false, sides: 'Left side 40 ft → 50 ft' })
    expect(d.lines[0].description).toBe('Add 10 ft of fence, 2 panels more (Left side 40 ft → 50 ft)')
    expect(d.lines[0].description).not.toMatch(/146 ft|156 ft/)
  })
})

describe('a walk-in counts as a contact (item 5)', () => {
  const at = new Date('2026-10-26T14:00:00Z')
  test('Walk-in: a visit at the counter; Phone call: the call; others nothing', () => {
    expect(arrivalContact('Walk-in', at, [])).toMatchObject({ kind: 'visit', title: 'Visit: walked in (new lead)', at: at.toISOString() })
    expect(arrivalContact('Phone call', at, [])).toMatchObject({ kind: 'call' })
    expect(arrivalContact('Google', at, [])).toBeNull()
    expect(arrivalContact('Walk-in', at, [new Date(at.getTime() + 5 * 60_000)])).toBeNull()
  })
})
