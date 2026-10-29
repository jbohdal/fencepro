/**
 * Final walkthrough rules: which checklist a job gets, which photos are
 * required, what is missing before it can be finished, the warranty on the
 * certificate, and that the certificate is a real PDF.
 */
import { describe, test, expect } from 'vitest'
import { categoryForStyle, workChecklist, walkHeading, checklistName, photoSlots, mergeSlots, missingToFinish, templatesFrom, itemsFromTemplate, STARTER_ITEMS, locationText, type Signature } from '../src/server/lib/walkthroughRules'
import { warrantyFrom, DEFAULT_WARRANTY, certificatePdf } from '../src/server/lib/walkthroughCertificate'
import { pngDataUrl } from './fixtures/png'

const signed = (name: string): Signature => ({ name, role: 'Homeowner', signedAt: '2026-10-18T15:00:00.000Z', lat: null, lng: null, accuracyM: null, image: pngDataUrl(), via: 'device' })

describe('category from the fence style', () => {
  test('WV- and TV- are vinyl, "CL -" chain link, "Alum" aluminum, anything else vinyl', () => {
    expect(categoryForStyle("WV-ND 6'x6' Privacy")).toBe('vinyl')
    expect(categoryForStyle("TV-DS 6'x8' Privacy")).toBe('vinyl')
    expect(categoryForStyle("CL - 4' Galv")).toBe('chain_link')
    expect(categoryForStyle("CL - Com 6'+1' Black")).toBe('chain_link')
    expect(categoryForStyle('Alum - ND - Emily - 48')).toBe('aluminum')
    expect(categoryForStyle('Wood 6ft')).toBe('vinyl')
    expect(categoryForStyle('')).toBe('vinyl')
  })
})

describe('templates', () => {
  test('starter list for each category; a saved category is used as saved, in its order', () => {
    const t = templatesFrom(undefined)
    expect(t.vinyl.map(i => i.label)).toEqual(STARTER_ITEMS.map(i => i.label))
    expect(t.chain_link).toHaveLength(10)
    const saved = templatesFrom({ aluminum: [{ id: 'b', label: 'Second' }, { id: 'a', label: 'First' }, { id: 'x', label: '  ' }] })
    expect(saved.aluminum.map(i => i.id)).toEqual(['b', 'a'])
    expect(saved.vinyl).toHaveLength(10)
  })
})

describe('required photos', () => {
  test('from the yard layout: each side that is on, each gate, one wide shot', () => {
    const s = photoSlots({ layout: { sides: [
      { id: 'a', name: 'Left', on: true, gate: null },
      { id: 'b', name: 'Back', on: true, gate: { type: 'double' } },
      { id: 'c', name: 'Right', on: false, gate: { type: 'walk' } },
      { id: 'd', name: 'Front', on: true, gate: { type: 'walk' } },
    ] } })
    expect(s.map(x => x.label)).toEqual(['Side: Left', 'Side: Back', 'Side: Front', 'Double gate on Back', 'Walk gate on Front', 'Wide shot of the whole fence'])
  })
  test('unknown layout: the counts the crew sets', () => {
    expect(photoSlots({ sideCount: 3, gateCount: 2 }).map(x => x.key)).toEqual(['side:1', 'side:2', 'side:3', 'gate:1', 'gate:2', 'wide'])
    expect(photoSlots({}).map(x => x.key)).toEqual(['side:1', 'wide'])
  })
  test('changing the counts keeps photos already taken', () => {
    const before = photoSlots({ sideCount: 2, gateCount: 0 }).map(s => s.key === 'side:1' ? { ...s, clientId: 'photo-aaaa1' } : s)
    const after = mergeSlots(photoSlots({ sideCount: 3, gateCount: 1 }), before)
    expect(after.find(s => s.key === 'side:1')?.clientId).toBe('photo-aaaa1')
    expect(after).toHaveLength(5)
  })
})

describe('what is missing before it can be finished', () => {
  const items = itemsFromTemplate(STARTER_ITEMS.slice(0, 2))
  const photos = photoSlots({ sideCount: 1 })
  test('everything missing', () => {
    const m = missingToFinish({ items, photos, homeownerSig: null, repSig: null }, [], () => false)
    expect(m).toEqual(['2 checklist items not marked', 'Photo needed: Side 1', 'Photo needed: Wide shot of the whole fence', "Our representative's signature", "Homeowner's signature"])
  })
  test('a photo taken but not uploaded, an open punch item, a fix photo uploading', () => {
    const p = photos.map(s => ({ ...s, clientId: `c-${s.key}-xxxx` }))
    const marked = items.map(i => ({ ...i, result: 'pass' as const }))
    const m = missingToFinish({ items: marked, photos: p, homeownerSig: signed('A'), repSig: signed('B') },
      [{ id: '1', label: 'Hardware tight', status: 'open', fixPhotoClientId: null }, { id: '2', label: 'Posts plumb', status: 'fixed', fixPhotoClientId: 'fix-photo-1' }],
      id => id === 'c-side:1-xxxx')
    expect(m).toEqual(['Photo still uploading: Wide shot of the whole fence', '1 punch list item to fix and re-photograph', 'Photo still uploading: fixed Posts plumb'])
  })
  test('ready: nothing missing', () => {
    const p = photos.map(s => ({ ...s, clientId: `c-${s.key}-xxxx` }))
    expect(missingToFinish({ items: items.map(i => ({ ...i, result: 'fix' as const })), photos: p, homeownerSig: signed('A'), repSig: signed('B') }, [{ id: '1', label: 'x', status: 'fixed', fixPhotoClientId: 'f-xxxxxxxx' }], () => true)).toEqual([])
  })
  test('location: shown when shared, "location not shared" otherwise', () => {
    expect(locationText({ lat: null, lng: null, accuracyM: null })).toBe('location not shared')
    expect(locationText({ lat: 29.18731, lng: -82.14009, accuracyM: 12.4 })).toBe('29.18731, -82.14009 (within 12 m)')
  })
})

describe('certificate', () => {
  test('warranty: Contract Templates first, then the walkthrough field, then the default when never saved', () => {
    expect(warrantyFrom({ contractSections: [{ key: 'warranty', visible: true, body: '<p>Two years <b>workmanship</b>.</p>' }] })).toBe('Two years workmanship.')
    expect(warrantyFrom({ contractSections: [{ key: 'warranty', visible: false, body: 'Hidden' }], config: { walkthroughWarranty: 'Our own words' } })).toBe('Our own words')
    expect(warrantyFrom({ contractSections: [], config: {} })).toBe(DEFAULT_WARRANTY)
  })
  test('a real PDF with the checklist, photos and signatures', async () => {
    const pdf = await certificatePdf({
      company: { name: 'Getter Done Fence', phone: '(352) 789-4314', email: '' }, customerName: 'Test Homeowner', address: '1 Main St, Ocala, FL',
      fenceStyle: "WV-ND 6'x6' Privacy", category: 'vinyl', completedAt: new Date('2026-10-18T18:00:00Z'),
      items: itemsFromTemplate(STARTER_ITEMS).map(i => ({ ...i, result: 'pass' as const })),
      punch: [{ label: 'Hardware tight', note: 'Loose hinge', fixNote: 'Tightened', fixedAt: new Date(), fixedBy: 'Crew' }],
      photos: [{ label: 'Side 1', file: null }], homeowner: signed('Test Homeowner'), rep: { ...signed('Jonathan'), role: 'Project coordinator' }, warranty: DEFAULT_WARRANTY,
    })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(3000)
  })
})

describe('a repair\'s and a move\'s checklist and heading (re-check, Oct 26 2026)', () => {
  const style = templatesFrom(undefined).vinyl
  test('a repair: each repair item done, the gate when one was rehung, debris when on the quote, the area cleaned; none of the new fence items', () => {
    const work = { type: 'repair', repair: { items: { replacePost: 2, rehangGate: 1, haulDebris: 1, resetPost: 0 } } }
    const list = workChecklist(work, style)
    expect(list.map(i => i.label)).toEqual([
      'Replace a post: 2 done',
      'Rehang a gate with new hardware: 1 done',
      'The gate opens, closes and latches',
      'Debris hauled away',
      'Work area cleaned up',
    ])
    for (const gone of ['Concrete / donuts finished', 'Utility flags and stakes removed', 'Property pins undisturbed']) expect(list.map(i => i.label)).not.toContain(gone)
    expect(new Set(list.map(i => i.id)).size).toBe(list.length)
    // Concrete footers on the quote (#31, Oct 29 2026): one line, with how many.
    const footers = workChecklist({ type: 'repair', repair: { items: { replacePost: 2, footerDisposal: 2 } } }, style).map(i => i.label)
    expect(footers).toEqual(['Replace a post: 2 done', 'Concrete footers hauled away: 2', 'Work area cleaned up'])
  })
  test('a repair with no gate and no haul away: no gate or debris line; a double gate says so', () => {
    expect(workChecklist({ type: 'repair', repair: { items: { resetPost: 1 } } }, style).map(i => i.id)).toEqual(['repair_resetPost', 'cleanup'])
    expect(workChecklist({ type: 'repair', repair: { items: { replaceGate: 1 }, gateKind: 'double' } }, style).map(i => i.label))
      .toEqual(['Replace a gate (double gate): 1 done', 'The double gate opens, closes and latches', 'Work area cleaned up'])
    expect(workChecklist({ type: 'repair', repair: { items: {} } }, style).map(i => i.id)).toEqual(['repair_done', 'cleanup'])
  })
  test('a move: the style\'s list and the old line; a new fence: the style\'s list as it is', () => {
    const move = workChecklist({ type: 'move', crew: [] }, style)
    expect(move.slice(0, style.length)).toEqual(style)
    expect(move[move.length - 1].id).toBe('old_line')
    expect(workChecklist(null, style)).toEqual(style)
  })
  test('headed with the work for a repair or move, else nothing (the style is used)', () => {
    expect(walkHeading({ type: 'repair', repair: { items: { replacePost: 2 } } })).toBe('Repair: 2 × Replace a post')
    expect(walkHeading(null)).toBeNull()
    expect(checklistName({ type: 'repair' }, 'vinyl')).toBe('Repair checklist')
    expect(checklistName({ type: 'move' }, 'vinyl')).toBe('Fence move checklist')
    expect(checklistName(null, 'chain_link')).toBe('Chain link checklist')
  })
})
