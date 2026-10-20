/**
 * A signed quote's lock (lib/quoteLock.ts): each field allowed or refused.
 */
import { describe, test, expect } from 'vitest'
import {
  isSignedQuote, lockedChanges, keepPrices, lockMessage, sameValue, REFUSED_FIELDS, ALLOWED_FIELDS,
  LOCKED_MESSAGE, LOCKED_STATUS_MESSAGE,
} from '../src/server/lib/quoteLock'

const yard = {
  shape: 'backyard', closed: false,
  sides: [
    { id: 'l', name: 'Left return', on: true, lengthIn: 360, startFinish: 'house', endFinish: 'corner', heading: 90, gate: { type: 'walk', widthIn: 48, position: 'middle', swing: 'in' } },
    { id: 'b', name: 'Back', on: true, lengthIn: 1440, startFinish: 'corner', endFinish: 'corner', heading: 0 },
  ],
  plan: { points: [{ x: 0, y: 0 }], aerial: { lat: 29.1, lng: -82.1, halfM: 40, address: '1 Test', rotDeg: 0, planAt: null, shown: true } },
}
const saved = {
  id: 'q1', status: 'SOLD', acceptedAt: null,
  customerName: 'Pat', customerPhone: '3525550100', customerEmail: 'p@example.test', customerAddress: '1 Test Way', crmContactId: 'c1',
  leadSource: 'Google', salesRep: 'JB', notes: 'gate code 12', leadTemp: 3, date: '2026-10-01', needsResend: false,
  fenceStyle: "WV-ND 6'x8' Privacy", runs: [30, 120], runRails: null, corners: 1, ends: 1, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0, sections: 20,
  materialCost: 1500.25, laborCost: 800, tearOutCost: 0, totalCOGS: 2300.25, finalPrice: 4200, gmPct: 0.4,
  pullSheet: [{ item: 'Post', qty: 21, unitCost: 30.5, total: 640.5 }],
  pricing: { laborMode: 'subcontractor', overheadPct: 0.12 },
  work: null,
  layout: { yard, runSections: [4, 16] },
  proposal: {
    version: 1, planSvg: '<svg>a</svg>', footageFt: 150, gatesText: '1 walk gate', depositPct: 50, recommended: 0, warranty: 'Lifetime',
    customer: { name: 'Pat', address: '1 Test Way' },
    options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 4200, perFoot: 28, sections: 20, photoId: 'p1', snapshot: { materialCost: 1500.25 } }],
  },
  chosenOption: 0,
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

describe('which quotes are signed', () => {
  test('Sold, accepted on the link, or a quoted cost saved', () => {
    expect(isSignedQuote({ status: 'SOLD' })).toBe(true)
    expect(isSignedQuote({ status: 'SENT', acceptedAt: new Date() })).toBe(true)
    expect(isSignedQuote({ status: 'LOST' }, true)).toBe(true)
    expect(isSignedQuote({ status: 'SENT' })).toBe(false)
    expect(isSignedQuote({ status: 'DRAFT' })).toBe(false)
    expect(isSignedQuote(null)).toBe(false)
  })
  test('ever sold (soldAt) stays signed after Lost (Jonathan, Oct 20, 2026)', () => {
    expect(isSignedQuote({ status: 'LOST', soldAt: new Date() })).toBe(true)
    expect(isSignedQuote({ status: 'LOST', soldAt: '2026-01-02T00:00:00.000Z' })).toBe(true)
    expect(isSignedQuote({ status: 'LOST', soldAt: null })).toBe(false)
  })
})

describe('refused: every price-bearing field', () => {
  const changes: Record<string, unknown> = {
    fenceStyle: "TV-ND 6'x8' Privacy", runs: [30, 140], runRails: ['8ft', '8ft'], corners: 2, ends: 2, walkGates: 2, dblGates: 1,
    tearOutSections: 3, tearOutGates: 1, adjLaborHrs: 2, hasSalesman: true, priceAdjust: 100, sections: 21,
    materialCost: 1600, laborCost: 900, tearOutCost: 50, totalCOGS: 2550, finalPrice: 4400, gmPct: 0.35,
    pullSheet: [{ item: 'Post', qty: 22, unitCost: 30.5, total: 671 }],
    pricing: { laborMode: 'hourly', overheadPct: 0.12 },
    work: { type: 'repair', items: { replaceSection: 1 } },
    chosenOption: 1,
  }
  for (const f of REFUSED_FIELDS) {
    if (!(f in changes)) continue
    test(f, () => { expect(lockedChanges(saved, { ...clone(saved), [f]: changes[f] })).toEqual([f]) })
  }
  test('a pull sheet line\'s unit cost', () => {
    expect(lockedChanges(saved, { pullSheet: [{ item: 'Post', qty: 21, unitCost: 31, total: 651 }] })).toEqual(['pullSheet'])
  })
  test('layout: a side\'s length, a gate, a skip, turning a side off, closing the yard', () => {
    const edit = (fn: (y: any) => void) => { const l = clone(saved.layout); fn(l.yard); return lockedChanges(saved, { layout: l }) }
    expect(edit(y => { y.sides[1].lengthIn = 1500 })).toEqual(['layout'])
    expect(edit(y => { y.sides[1].gate = { type: 'double', widthIn: 120, position: 'middle' } })).toEqual(['layout'])
    expect(edit(y => { y.sides[0].gate.widthIn = 60 })).toEqual(['layout'])
    // A gate slid along its side (the builder's drag, gateSlide.ts): same footage, still a price bearing change.
    expect(edit(y => { y.sides[0].gate = { ...y.sides[0].gate, position: 'distance', distanceIn: 12 } })).toEqual(['layout'])
    expect(edit(y => { y.sides[0].gate = { ...y.sides[0].gate, position: 'distance', distanceIn: (y.sides[0].gate.distanceIn ?? 0) + 6 } })).toEqual(['layout'])
    expect(edit(y => { y.sides[1].skip = { kind: 'existing', lengthIn: 96, position: 'middle' } })).toEqual(['layout'])
    expect(edit(y => { y.sides[0].on = false })).toEqual(['layout'])
    expect(edit(y => { y.closed = true })).toEqual(['layout'])
    expect(edit(y => { y.sides[1].endFinish = 'house' })).toEqual(['layout'])
    expect(lockedChanges(saved, { layout: { ...clone(saved.layout), runSections: [4, 17] } })).toEqual(['layout'])
  })
  test('proposal: an option\'s price, an option added, deposit, footage, tiers', () => {
    const edit = (fn: (p: any) => void) => { const p = clone(saved.proposal); fn(p); return lockedChanges(saved, { proposal: p }) }
    expect(edit(p => { p.options[0].finalPrice = 4300 })).toEqual(['proposal'])
    expect(edit(p => { p.options.push({ ...p.options[0], fenceStyle: 'TV', finalPrice: 4500 }) })).toEqual(['proposal'])
    expect(edit(p => { p.depositPct = 30 })).toEqual(['proposal'])
    expect(edit(p => { p.footageFt = 160 })).toEqual(['proposal'])
    expect(edit(p => { p.tierSet = { category: 'Vinyl', tiers: [] } })).toEqual(['proposal'])
    expect(edit(p => { p.options[0].snapshot.materialCost = 1 })).toEqual(['proposal'])
  })
  test('back to Draft or Sent', () => {
    expect(lockedChanges(saved, { status: 'DRAFT' })).toEqual(['status'])
    expect(lockedChanges(saved, { status: 'SENT' })).toEqual(['status'])
    expect(lockMessage(['status'])).toBe(LOCKED_STATUS_MESSAGE)
    expect(lockMessage(['finalPrice', 'status'])).toBe(LOCKED_MESSAGE)
    expect(LOCKED_MESSAGE).toBe('This quote is signed. Make a change order instead.')
  })
  test('several at once: each named', () => {
    expect(lockedChanges(saved, { ...clone(saved), runs: [40, 120], sections: 21, finalPrice: 4500 })).toEqual(['runs', 'sections', 'finalPrice'])
  })
})

describe('allowed', () => {
  const changes: Record<string, unknown> = {
    crmContactId: 'c2', customerName: 'Pat Smith', customerPhone: '3525550101', customerEmail: 'x@example.test', customerAddress: '2 Test Way',
    leadSource: 'Referral', salesRep: 'Mike', notes: 'new gate code 99', leadTemp: 5, date: '2026-10-20', needsResend: true, status: 'LOST',
  }
  for (const f of ALLOWED_FIELDS) {
    test(f, () => { expect(lockedChanges(saved, { ...clone(saved), [f]: changes[f] })).toEqual([]) })
  }
  test('the whole quote sent back unchanged (as the app holds it)', () => {
    const app = clone(saved) as any
    app.pullSheet = app.pullSheet.map((l: any) => ({ ...l, unitCost: l.unitCost ?? 0, total: l.total ?? 0 }))
    expect(lockedChanges(saved, app)).toEqual([])
  })
  test('a field left out is not a change', () => {
    expect(lockedChanges(saved, { notes: 'x' })).toEqual([])
  })
  test('the site plan drawing: names, headings, swing, house, dragged corners, the aerial photo turned and moved', () => {
    const l = clone(saved.layout) as any
    l.yard.sides[0].name = 'Left side'
    l.yard.sides[1].heading = 10
    l.yard.sides[0].gate.swing = 'out'
    l.yard.sides[0].meetsHouse = { at: 'distance', distanceIn: 60 }
    l.yard.plan.points = [{ x: 3, y: 4 }]
    l.yard.plan.aerial.rotDeg = 35
    l.yard.plan.aerial.planAt = { x: 5, y: -2 }
    l.yard.shape = 'custom'
    expect(lockedChanges(saved, { layout: l })).toEqual([])
  })
  test('the proposal\'s words and plan picture, an option\'s photo and label', () => {
    const p = clone(saved.proposal) as any
    p.planSvg = '<svg>turned</svg>'
    p.warranty = 'Lifetime, transferable'
    p.customer = { name: 'Pat Smith', address: '2 Test Way' }
    p.createdAt = '2026-10-20'
    p.options[0].photoId = 'p2'
    p.options[0].label = 'White vinyl privacy'
    expect(lockedChanges(saved, { proposal: p })).toEqual([])
  })
  test('a move or repair\'s photo choice', () => {
    const w = { ...saved, work: { type: 'move', priced: { costCents: 100 }, photoOverride: null } }
    expect(lockedChanges(w, { work: { type: 'move', priced: { costCents: 100 }, photoOverride: { photoId: 'x' } } })).toEqual([])
  })
  test('null, missing and {} are the same; numbers within half a cent', () => {
    expect(sameValue(null, undefined)).toBe(true)
    expect(sameValue({}, null)).toBe(true)
    expect(sameValue({ a: 1, b: null }, { a: 1 })).toBe(true)
    expect(sameValue(4200, 4200.004)).toBe(true)
    expect(sameValue(4200, 4200.01)).toBe(false)
    expect(lockedChanges({ ...saved, pricing: null }, { pricing: {} })).toEqual([])
  })
})

describe('keepPrices: the saved quote with only the allowed changes', () => {
  test('price fields stay as saved; customer, notes and the drawing come through', () => {
    const edited = clone(saved) as any
    edited.runs = [30, 140]; edited.finalPrice = 4400; edited.sections = 21; edited.pullSheet = []
    edited.notes = 'changed'; edited.customerPhone = '3525550199'
    edited.layout.yard.plan.aerial.rotDeg = 20
    edited.proposal = { ...edited.proposal, planSvg: '<svg>b</svg>', options: [{ ...edited.proposal.options[0], finalPrice: 4400 }] }
    const out = keepPrices(saved, edited) as any
    expect(out.finalPrice).toBe(4200)
    expect(out.runs).toEqual([30, 120])
    expect(out.pullSheet).toEqual(saved.pullSheet)
    expect(out.notes).toBe('changed')
    expect(out.customerPhone).toBe('3525550199')
    expect(out.layout.yard.plan.aerial.rotDeg).toBe(20)
    expect(out.proposal.options[0].finalPrice).toBe(4200)
    expect(out.proposal.planSvg).toBe('<svg>b</svg>')
    expect(lockedChanges(saved, out)).toEqual([])
  })
  test('a changed yard keeps the saved drawing and plan picture', () => {
    const edited = clone(saved) as any
    edited.layout.yard.sides[1].lengthIn = 1600
    edited.proposal.planSvg = '<svg>longer</svg>'
    const out = keepPrices(saved, edited) as any
    expect(out.layout).toEqual(saved.layout)
    expect(out.proposal.planSvg).toBe('<svg>a</svg>')
  })
  test('a signed quote never goes back to Draft or Sent; a sent one may', () => {
    expect((keepPrices(saved, { status: 'DRAFT' }) as any).status).toBe('SOLD')
    expect((keepPrices({ ...saved, status: 'SENT' }, { status: 'DRAFT' }) as any).status).toBe('DRAFT')
  })
})
