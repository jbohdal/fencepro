/**
 * The office site plan as a picture (web/src/sitePlanSvg.ts) and the permit
 * sheet PDF (lib/sitePlanSheet.ts): every side's feet, gates with width and
 * swing, numbered crew posts and "Start here", the property line, scale bar
 * and north arrow; the sheet's title block, its round scale, and the
 * property line note, read back from the PDF's own text.
 */

import { describe, test, expect } from 'vitest'
import { planFromYard, crewPosts, sectionsAt, builtFt, propertyLineWarnings, quoteSectionsOf, planFlags, openFlags, fromFeet, type SitePlanData } from '../../web/src/sitePlanData'
import { sitePlanSvg, planFrame, planExtent, gateLeaves, insideOf, feetLabel } from '../../web/src/sitePlanSvg'
import { walkToYard, type WalkList } from '../../web/src/walkList'
import { renderPermitSheet, streetOf, sheetScale } from '../src/server/lib/sitePlanSheet'
import { pdfText } from './pdfText'

const OCALA = { lat: 29.1872, lng: -82.1401 }
let k = 0
const step = (feet: number, what: any, extra: any = {}) => ({ id: `t${k++}`, feetIn: feet * 12, what, ...extra })
const walk: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(13, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(13, 'corner', { turn: 'right' }), step(120, 'gate', { gate: { widthIn: 120, type: 'double' } }), step(0, 'corner', { turn: 'right' }), step(150, 'corner', { turn: 'right' }), step(130, 'corner', { turn: 'right' }), step(30, 'end')] }] }
const yard = walkToYard(walk)
const base = planFromYard(yard, OCALA, walk)!
const lot = [{ x: -150, y: -150 }, { x: 150, y: -150 }, { x: 150, y: 150 }, { x: -150, y: 150 }].map(q => fromFeet(OCALA, q))
const plan: SitePlanData = { ...base, parcel: { id: '2854-023-000', rings: [lot], source: 'Marion County Property Appraiser', fetchedAt: '2026-11-06T00:00:00Z' }, neighbors: [[[lot[1], fromFeet(OCALA, { x: 300, y: -150 }), fromFeet(OCALA, { x: 300, y: 150 }), lot[2]]]] }
plan.sides[0].gates[0].hinge = 'left'

const m = { planExtent, planFrame, sitePlanSvg, builtFt, feetLabel, gateLeaves, propertyLineWarnings, crewPosts, quoteSectionsOf, planFlags, openFlags } as any

describe('the plan as a picture', () => {
  test('sides in feet, gates with width and kind, the property line, scale bar and north arrow, no crew numbers', () => {
    const svg = sitePlanSvg(plan, { width: 800, height: 600, neighbors: true })
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    for (const s of plan.sides) expect(svg).toContain(`>${feetLabel(builtFt(plan, s))}<`)
    expect(svg).toContain('>4 ft single gate<')
    expect(svg).toContain('>10 ft double gate<')
    // Two leaves for the double gate, one for the single: a swing arc each.
    expect((svg.match(/<path d="M [^"]* A /g) ?? []).length).toBe(3)
    expect(svg).toContain('stroke-dasharray="10 4"')
    expect(svg).toContain('>N<')
    expect(svg).toMatch(/>\d+ ft</)
    expect(svg).not.toContain('Start here')
    expect(svg).not.toContain('transform')
  })

  test('the crew\'s: every post numbered in walking order, "Start here" at the start post', () => {
    const { posts } = crewPosts(plan, (_s, f) => sectionsAt(f, 8))
    const svg = sitePlanSvg(plan, { width: 800, height: 600, crewPosts: posts, showStart: true })
    for (const p of posts) expect(svg).toContain(`>${p.n}</text>`)
    expect(svg).toContain('>Start here<')
    expect(svg).toContain('Numbered circles: posts in walking order')
  })

  test('a single gate hinged on the left (looking from inside the yard) swings from that end; into the yard by default', () => {
    const side = plan.sides[0], g = side.gates[0]
    const [leaf] = gateLeaves(plan, side, g)
    const right = gateLeaves(plan, side, { ...g, hinge: 'right' })[0]
    expect(leaf.hingeFt).not.toBe(right.hingeFt)
    expect([leaf.hingeFt, right.hingeFt].sort((a, b) => a - b).map(x => Math.round(x * 1000) / 1000)).toEqual([g.atFt, g.atFt + g.widthFt])
    // Into the yard: toward the middle of the fence.
    const n = insideOf(plan, plan.sides[1])
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 6)
  })

  test('drawn to a stated scale: a 150 ft side at 1 in = 20 ft is 7.5 in long', () => {
    const f = planFrame(plan, 700, 550, { scale: 72 / 20 })
    const s = plan.sides[2]
    const a = f.at(plan.posts.find(p => p.id === s.a)!), b = f.at(plan.posts.find(p => p.id === s.b)!)
    expect(Math.hypot(b.x - a.x, b.y - a.y) / 72).toBeCloseTo(150 / 20, 1)
  })
})

describe('the permit sheet', () => {
  const input = (size: 'letter' | 'tabloid') => ({
    size, plan, revision: 4, drawnBy: 'Olive Office', date: '11/06/2026',
    company: { name: 'Getter Done Fence', address: '123 Main St, Ocala, FL 34471', phone: '3528442677' },
    customerName: 'Pat Example', address: '1234 SE 3rd Ave, Ocala, FL 34471', county: 'Marion', parcelId: plan.parcel!.id,
    fenceText: 'White Vinyl Privacy, 6 ft tall', aerial: null,
  })

  test('letter: the title block, the fence and its total feet, every side and gate, the scale and the note', async () => {
    const { pdf, note } = await renderPermitSheet(m, input('letter'))
    expect(note).toBe('')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const text = pdfText(pdf)
    for (const w of ['Getter Done Fence', 'Fence site plan', 'Pat Example', '1234 SE 3rd Ave, Ocala, FL 34471', 'SE 3rd Ave', '2854-023-000', '11/06/2026', 'Olive Office', 'White Vinyl Privacy, 6 ft tall', 'Approximate property lines from county records, not a survey.', 'Property lines: Marion County Property Appraiser.', '(352) 844 2677'])
      expect(text, w).toContain(w)
    const total = plan.sides.reduce((t, s) => t + builtFt(plan, s), 0)
    expect(text).toContain(`${Math.round(total * 10) / 10} linear ft`)
    expect(text).toMatch(/1 in = \d+ ft \(printed at full size\)/)
    for (const s of plan.sides) expect(text).toContain(feetLabel(builtFt(plan, s)))
    expect(text).toContain('4 ft single gate')
    expect(text).toContain('10 ft double gate')
    expect(text).not.toContain('$')
    // Landscape letter: 792 x 612.
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 792 612\]/)
  })

  test('11 x 17 at a larger scale; with the aerial photo asked for but not reachable, made without it and said so', async () => {
    const { pdf, note } = await renderPermitSheet(m, { ...input('tabloid'), aerial: async () => { throw new Error('no connection') } })
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 1224 792\]/)
    expect(note).toMatch(/aerial photo could not be loaded/)
    expect(pdfText(pdf)).toContain('the sheet was made without it')
  })

  test('the street from the address; the round scale that fits', () => {
    expect(streetOf('1234 SE 3rd Ave, Ocala, FL 34471')).toBe('SE 3rd Ave')
    expect(streetOf('10501 SW 54th Ct')).toBe('SW 54th Ct')
    expect(sheetScale({ x: 150, y: 120 }, { w: 7, h: 6 })).toBe(30)
    expect(sheetScale({ x: 60, y: 40 }, { w: 7, h: 6 })).toBe(10)
  })
})
