/**
 * Walkthrough round 1 (Oct 24, 2026; ~/Downloads/walkthrough-2026-10-24/REPORT.md),
 * items 5, 14 and 15: one test per fix.
 */

import { describe, test, expect } from 'vitest'
import { redactCosts } from '../src/server/lib/costRedact'
import { certificateDay } from '../src/server/lib/portalCustomer'
import { leadLink } from '../src/server/lib/widgetDrawQuote'
import { quotedCostOf, actualCostOf, subOtherOf, type TakeoffLine } from '../src/server/lib/jobCostingMath'
import { censusSuggestions } from '../src/server/lib/addressIndex'
import { phoneCanText } from '../../web/src/textingDevice'
import { refusalOf, uploadOutcome, isInvoicePdf, isInvoicePhoto } from '../../web/src/uploadOutcome'
import { starterNote, isStarterItem, workScope } from '../../web/src/moveRepair'
import { draftToReuse, withVisit, lastVisit, visitPhotos } from '../../web/src/quoteReuse'

// ── 14. "Invalid Date" on a Salesman's iPhone ────────────────────────────────

describe('a Salesman\'s or Installer\'s answers keep their dates', () => {
  test('a Date stays a date through the cost filter (it became {}, read as "Invalid Date")', () => {
    const due = new Date('2026-10-21T01:01:10.679Z')
    const out = JSON.parse(JSON.stringify(redactCosts({ data: [{ id: 't1', title: 'File the fence permit', dueDate: due, job: { completedAt: due, laborCost: 618 } }] })))
    expect(out.data[0].dueDate).toBe('2026-10-21T01:01:10.679Z')
    expect(out.data[0].job.completedAt).toBe('2026-10-21T01:01:10.679Z')
    expect(Number.isNaN(new Date(out.data[0].dueDate).getTime())).toBe(false)
    // Costs still go.
    expect(out.data[0].job.laborCost).toBeUndefined()
  })
  test('a photo\'s date as the portal sends it', () => {
    const out = JSON.parse(JSON.stringify(redactCosts([{ id: 'p1', uploadedAt: new Date('2026-10-25T01:01:38.738Z'), caption: 'Ready to quote visit' }])))
    expect(out[0].uploadedAt).toBe('2026-10-25T01:01:38.738Z')
  })
  test('other values made by a class (a Buffer) are kept whole; plain objects are still walked', () => {
    const out = redactCosts({ file: Buffer.from('ab'), nested: Object.assign(Object.create(null), { cost: 5, name: 'x' }) }) as any
    expect(Buffer.isBuffer(out.file)).toBe(true)
    expect(out.nested.cost).toBeUndefined()
    expect(out.nested.name).toBe('x')
  })
})

// ── 14. Warranty certificate a day late for evening jobs ─────────────────────

describe('the warranty certificate\'s day is the Florida day', () => {
  test('a walkthrough finished at 9:01 pm on Oct 24 in Florida is Oct 24 (01:01 UTC on the 25th)', () => {
    expect(certificateDay(null, new Date('2026-10-25T01:01:30Z'))).toBe('2026-10-24')
    expect(certificateDay('', new Date('2026-10-25T01:01:30Z'))).toBe('2026-10-24')
  })
  test('the job\'s own completed date wins, as on the certificate PDF', () => {
    expect(certificateDay('2026-10-24', new Date('2026-10-25T03:00:00Z'))).toBe('2026-10-24')
  })
  test('no date at all', () => {
    expect(certificateDay(null, null)).toBe('')
  })
})

// ── 14. The "Website quote" notification opens the lead ──────────────────────

describe('the Website quote notification has a link to the lead', () => {
  test('its card window on the pipeline, else the customer', () => {
    expect(leadLink('card-1', 'c-1')).toBe('/pipeline?card=card-1')
    expect(leadLink(null, 'c 1')).toBe('/customers?customer=c%201')
    expect(leadLink(null, null)).toBeNull()
  })
})

// ── 14. Vendor invoice upload: say what happened ─────────────────────────────

describe('an upload the server turns down says why, and the others still go', () => {
  test('a 4xx that will not change is a refusal, in the server\'s words', () => {
    expect(refusalOf(400, { error: 'Not a photo or video this app takes' })).toBe('Not a photo or video this app takes')
    expect(refusalOf(403, {})).toBe('This login is not allowed to upload it.')
    expect(refusalOf(413, null)).toBe('The file is too big.')
  })
  test('lost signal, a server error, signed out, "not all bytes yet" and "slow down" are tried again', () => {
    for (const s of [0, 401, 408, 409, 429, 500, 502, 200]) expect(refusalOf(s, { error: 'x' })).toBeNull()
  })
  test('the outcome in plain words: uploaded, refused with the reason, or waiting', () => {
    expect(uploadOutcome(['a'], [], () => null, true)).toEqual({ kind: 'uploaded' })
    expect(uploadOutcome(['a', 'b'], [{ clientId: 'b' }], id => (id === 'b' ? 'The file is too big.' : null), true)).toEqual({ kind: 'refused', why: 'The file is too big.' })
    expect(uploadOutcome(['a'], [{ clientId: 'a' }], () => null, false).kind).toBe('waiting')
    expect((uploadOutcome(['a'], [{ clientId: 'a' }], () => null, false) as any).why).toMatch(/No signal/)
    expect((uploadOutcome(['a'], [{ clientId: 'a' }], () => null, true) as any).why).toMatch(/could not be reached/)
  })
  test('a picture picked as a PDF (or a PDF as a photo) is caught before upload', () => {
    expect(isInvoicePdf({ type: 'application/pdf', name: 'a.pdf' })).toBe(true)
    expect(isInvoicePdf({ type: '', name: 'A.PDF' })).toBe(true)
    expect(isInvoicePdf({ type: 'image/jpeg', name: 'yard1.jpg' })).toBe(false)
    expect(isInvoicePhoto({ type: 'image/jpeg', name: 'yard1.jpg' })).toBe(true)
    expect(isInvoicePhoto({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe(true)
    expect(isInvoicePhoto({ type: 'image/gif', name: 'x.gif' })).toBe(false)
    expect(isInvoicePhoto({ type: 'application/pdf', name: 'a.pdf' })).toBe(false)
  })
})

// ── 14. "Text the receipt" on a computer ─────────────────────────────────────

describe('only a phone that texts records the text as sent', () => {
  test('iPhone and Android phones: yes; a Mac, Windows, an iPad, an Android tablet: ask first', () => {
    expect(phoneCanText('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(phoneCanText('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe(true)
    expect(phoneCanText('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe(false)
    expect(phoneCanText('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe(false)
    expect(phoneCanText('Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1')).toBe(false)
    expect(phoneCanText('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe(false)
  })
})

// ── 14. Repairs: the gate rehang is said out loud; the job page lists the items ──

describe('"Broken or sagging gate" says what it added', () => {
  test('the note names the rehang it put in the list, once', () => {
    expect(starterNote('gate', { rehangGate: 1 })).toBe('"Broken or sagging gate" added 1 × Rehang a gate with new hardware to the list below. It is counted once: change the number there, do not add it again.')
    expect(isStarterItem('gate', 'rehangGate')).toBe(true)
    expect(isStarterItem('gate', 'replacePost')).toBe(false)
  })
  test('nothing to say when the item was taken back out, or for Other', () => {
    expect(starterNote('gate', { rehangGate: 0, replacePost: 2 })).toBeNull()
    expect(starterNote('other', { replacePost: 2 })).toBeNull()
  })
  test('storm damage lists each item it added', () => {
    expect(starterNote('storm', { replaceSection: 1, replacePost: 1, haulDebris: 1 })).toMatch(/1 × Replace a whole section, 1 × Replace a post, 1 × Haul away debris/)
  })
})

describe('a repair job\'s Scope of Work is its items, not "0 ft, 0 sections"', () => {
  test('the crew lines from the quote', () => {
    const crew = ['Replace a post: 2. New post and setting material; dig set adds the concrete pull and disposal.', 'Rehang a gate with new hardware: 1 (walk gate). New hinges and latch.']
    expect(workScope({ type: 'repair', crew, description: 'Replace 2 posts.' })).toEqual({ title: 'Repair', items: crew })
    expect(workScope({ type: 'move', crew: [], description: 'Move the fence.' })).toEqual({ title: 'Fence move', items: ['Move the fence.'] })
    expect(workScope(null)).toBeNull()
    expect(workScope({ type: 'new' as any, crew: [], description: '' })).toBeNull()
  })
})

// ── 5. Website lead to quote: the draft is reused, the visit carried in ──────

const websiteDraft = { id: 'web', customerId: 'c1', status: 'DRAFT' as const, date: '2026-10-24', notes: 'Website, drawn by customer.', customerAddress: '110 SE Watula Ave, Ocala, FL 34471', layout: { widgetDrawing: { v: 1 } } }
describe('Ready to quote opens the customer\'s draft', () => {
  test('the website quote first, even when a newer draft exists', () => {
    const later = { id: 'later', customerId: 'c1', status: 'DRAFT' as const, date: '2026-10-25', notes: '', customerAddress: '' }
    expect(draftToReuse([later, websiteDraft], 'c1')?.id).toBe('web')
  })
  test('else the newest draft for a new fence; never a sent, signed or repair quote, or another customer\'s', () => {
    const old = { id: 'old', customerId: 'c1', status: 'DRAFT' as const, date: '2026-10-01', notes: '', customerAddress: '' }
    const newer = { ...old, id: 'newer', date: '2026-10-20' }
    const sent = { ...old, id: 'sent', status: 'SENT' as const, date: '2026-10-24' }
    const repair = { ...old, id: 'repair', date: '2026-10-24', work: { type: 'repair' } }
    const accepted = { ...old, id: 'acc', date: '2026-10-24', acceptedAt: '2026-10-24T12:00:00Z' }
    const other = { ...websiteDraft, id: 'other', customerId: 'c2' }
    expect(draftToReuse([old, newer, sent, repair, accepted, other], 'c1')?.id).toBe('newer')
    expect(draftToReuse([sent, repair, other], 'c1')).toBeNull()
    expect(draftToReuse([websiteDraft], '')).toBeNull()
  })
  test('the visit\'s footage and notes are added once; the drawing is untouched', () => {
    const v = { notes: 'Measured on site: about 186 ft. Back yard, 2 walk gates.', address: '110 SE Watula Ave' }
    const once = withVisit(websiteDraft, v)
    expect(once.notes).toBe('Website, drawn by customer.\nSite visit: Measured on site: about 186 ft. Back yard, 2 walk gates.')
    expect(withVisit(once, v).notes).toBe(once.notes)
    expect(once.layout).toBe(websiteDraft.layout)
    expect(once.customerAddress).toBe(websiteDraft.customerAddress)
    expect(withVisit(websiteDraft, {})).toBe(websiteDraft)
    expect(withVisit({ ...websiteDraft, customerAddress: '' }, v).customerAddress).toBe('110 SE Watula Ave')
  })
  test('the last closed visit, and its photos (captioned "… visit", else the staff photos that day)', () => {
    const appts = [
      { id: 'a1', crmContactId: 'c1', status: 'scheduled', outcome: null, startAt: '2026-11-02T12:00:00Z', completedAt: null, measuredFeet: null, outcomeNotes: '' },
      { id: 'a2', crmContactId: 'c1', status: 'completed', outcome: 'ready_to_quote', startAt: '2026-10-24T13:00:00Z', completedAt: '2026-10-25T01:01:00Z', measuredFeet: 186, outcomeNotes: 'Dogs' },
      { id: 'a3', crmContactId: 'c2', status: 'completed', outcome: 'ready_to_quote', startAt: '2026-10-25T13:00:00Z', completedAt: '2026-10-25T14:00:00Z', measuredFeet: 90, outcomeNotes: '' },
    ]
    expect(lastVisit(appts, 'c1')?.id).toBe('a2')
    expect(lastVisit(appts, 'nobody')).toBeNull()
    const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))
    const photos = [
      { id: 'p1', source: 'crm_staff', caption: 'Ready to quote visit', uploadedAt: '2026-10-25T01:01:38Z' },
      { id: 'p2', source: 'portal_customer', caption: 'my yard', uploadedAt: '2026-10-25T01:00:00Z' },
      { id: 'p3', source: 'crm_staff', caption: '', uploadedAt: '2026-10-24T18:00:00Z' },
    ]
    expect(visitPhotos(photos, '2026-10-24', day).map(p => p.id)).toEqual(['p1'])
    expect(visitPhotos(photos.filter(p => p.id !== 'p1'), '2026-10-24', day).map(p => p.id)).toEqual(['p3'])
    expect(visitPhotos(photos.filter(p => p.id !== 'p1'), null, day)).toEqual([])
  })
})

// ── 15. Gate labor in job costing ────────────────────────────────────────────

describe('the sub\'s gate pay is in the actual labor (2 gate job came out $20 under the quote)', () => {
  // WT Maria Lopez, as signed: 26 sections at $23.00 and 2 walk gates at $10.00 = $618 sub labor.
  const quote = {
    id: 'q-maria', fenceStyle: "WV-ND 6'x8' Privacy", salesRep: '', sections: 26, runs: [21, 19.5, 19.5, 63, 19, 19, 21], walkGates: 2,
    materialCost: 3729.03, laborCost: 618, tearOutCost: 0, totalCOGS: 4347.03, finalPrice: 7762,
    pullSheet: [], pricing: { laborMode: 'subcontractor', subUnit: 'section', subRate: 23 }, work: null,
  }
  const pricing = { laborMode: 'subcontractor', subUnit: 'section', manHourRate: 25, subWalkGate: 10 }
  const quoted = quotedCostOf(quote, { inventory: [], pricing, signedVia: 'proposal', signedAt: new Date('2026-10-25T01:18:00Z') })
  const none = (_l: TakeoffLine) => ({ cents: 0, source: 'none' as const })
  test('the quote keeps the gates\' sub pay apart', () => {
    expect(quoted.labor.subRateCostCents).toBe(2300)
    expect(quoted.labor.subOtherCents).toBe(2000)
    expect(subOtherOf(quoted)).toBe(2000)
  })
  test('actual = 26 sections × $23.00 + $20.00 gates = the quoted $618', () => {
    const a = actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 26, crew: [] }, installDate: '2026-10-29' }, { quoted, unitCostOf: none, hourlyCostCents: 2500, subRateCostCents: 2300, otherLaborCostCents: 0, frozen: false })
    expect(a.laborCents).toBe(61800)
    expect(a.laborMath).toBe('26 sections paid × $23.00 + $20.00 gates and other sub work as quoted (sub rate saved at signing)')
  })
  test('a cost saved before this (no subOtherCents) stays as it was', () => {
    const { subOtherCents: _drop, ...older } = quoted.labor
    expect(subOtherOf({ ...quoted, labor: older })).toBe(0)
  })
  test('never more than the quote\'s labor beyond the sections (a quote priced before a gate rate was set)', () => {
    const q = quotedCostOf({ ...quote, laborCost: 598 }, { inventory: [], pricing, signedVia: 'proposal', signedAt: new Date() })
    expect(q.labor.subOtherCents).toBe(0)
    // Settings' rate changed after the quote was priced: the difference is not taken for gates.
    const noGates = quotedCostOf({ ...quote, walkGates: 0, laborCost: 624 }, { inventory: [], pricing, signedVia: 'proposal', signedAt: new Date() })
    expect(noGates.labor.subOtherCents).toBe(0)
  })
  test('"Sub paid $" still replaces it all; crew and flat labor have no gate pay added', () => {
    const paid = actualCostOf({ lines: [], labor: { mode: 'sub', subUnit: 'section', subUnits: 26, subPaidCents: 60000, crew: [] }, installDate: '2026-10-29' }, { quoted, unitCostOf: none, hourlyCostCents: 2500, subRateCostCents: 2300, otherLaborCostCents: 0, frozen: false })
    expect(paid.laborCents).toBe(60000)
    expect(subOtherOf({ ...quoted, labor: { ...quoted.labor, mode: 'crew' } })).toBe(0)
    expect(subOtherOf(null)).toBe(0)
  })
})

// ── 15. The address lookup offered a far away city first ─────────────────────

describe('a Census match far from Ocala is not offered', () => {
  // What the Census answered for "2715 SE 3rd St, FL" on Oct 25, 2026.
  const matches = [
    { matchedAddress: '2715 SE 3RD ST, HOMESTEAD, FL, 33033', coordinates: { x: -80.448634998203, y: 25.46715493907 } },
    { matchedAddress: '2715 SE 3RD ST, POMPANO BEACH, FL, 33062', coordinates: { x: -80.096498416614, y: 26.228729427134 } },
    { matchedAddress: '2715 SE 3RD ST, OKEECHOBEE, FL, 34974', coordinates: { x: -80.82, y: 27.24 } },
  ]
  test('none in the work area: nothing (the box says to type the full address)', () => {
    expect(censusSuggestions(matches)).toEqual([])
  })
  test('in the work area: offered, nearest to Ocala first', () => {
    const near = [...matches, { matchedAddress: '2715 SE 3RD AVE, OCALA, FL, 34480', coordinates: { x: -82.134293021733, y: 29.158519178062 } }, { matchedAddress: '2715 SE 3RD AVE, BELLEVIEW, FL, 34420', coordinates: { x: -82.06, y: 29.05 } }]
    const out = censusSuggestions(near)
    expect(out.map(s => s.city)).toEqual(['Ocala', 'Belleview'])
    expect(out[0]).toMatchObject({ line1: '2715 SE 3rd Ave', state: 'FL', zip: '34480', source: 'census', formatted: '2715 SE 3rd Ave, Ocala, FL 34480' })
  })
  test('not Florida, or no point: dropped', () => {
    expect(censusSuggestions([{ matchedAddress: '1 MAIN ST, OCALA, GA, 30000', coordinates: { x: -82.14, y: 29.19 } }, { matchedAddress: '1 MAIN ST, OCALA, FL, 34471' }])).toEqual([])
    expect(censusSuggestions(null)).toEqual([])
  })
})
