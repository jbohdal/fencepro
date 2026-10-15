/**
 * The site plan draws exactly the posts the quote is priced with: corner
 * squares = corner posts, filled dots = end and gate posts, open dots = line
 * posts at each run's section count.
 */

import { describe, test, expect } from 'vitest'
import { layoutForShape, deriveLayout, type YardLayout } from '../../web/src/yardLayout'
import { buildPlan, autoVertices, centeredVertices, aerialFtPerPx, aerialUrl } from '../../web/src/sitePlanGeometry'

const ft = (n: number) => n * 12

function backyard(): YardLayout {
  const l = layoutForShape('backyard')
  const [lr, ls, back, rs, rr] = l.sides
  lr.lengthIn = ft(30); lr.gate = { type: 'walk', widthIn: 48, position: 'middle' }
  ls.lengthIn = ft(120)
  back.lengthIn = ft(150); back.skip = { kind: 'existing', lengthIn: ft(40), position: 'middle' }
  rs.lengthIn = ft(120)
  rr.lengthIn = ft(30); rr.gate = { type: 'double', widthIn: 120, position: 'middle' }
  return l
}
const count = (plan: ReturnType<typeof buildPlan>, kind: string) => plan.posts.filter(p => p.kind === kind).length

describe('site plan posts match the priced posts', () => {
  test('backyard with gates and an existing fence skip', () => {
    const l = backyard()
    const r = deriveLayout(l)
    // 8 ft sections: 13,13 | 120 | 55,55 | 120 | 10,10
    const secs = [2, 2, 15, 7, 7, 15, 2, 2]
    const plan = buildPlan(l, r, secs)
    expect(count(plan, 'corner')).toBe(r.corners)
    expect(count(plan, 'end') + count(plan, 'gate')).toBe(r.ends)
    expect(count(plan, 'line')).toBe(secs.reduce((t, n) => t + n - 1, 0))
    expect(plan.sides.find(s => s.name === 'Back')!.skip?.kind).toBe('existing')
    expect(plan.sides.find(s => s.name === 'Back')!.sublabel).toBe('Back · 14 sec')
    expect(plan.house).not.toBeNull()
    expect(plan.street).toBe(true)
  })

  test('sides that are off are not drawn', () => {
    const l = backyard()
    l.sides[3].on = false; l.sides[4].on = false
    const plan = buildPlan(l, deriveLayout(l))
    expect(plan.sides.map(s => s.name)).toEqual(['Left return', 'Left side', 'Back'])
  })

  test('gates swing into the yard', () => {
    const l = backyard()
    const plan = buildPlan(l, deriveLayout(l))
    // The returns run along y = 0 with the yard above them (y > 0).
    for (const s of plan.sides.filter(x => x.gate)) expect(s.gate!.swing.y).toBeGreaterThan(0)
  })

  test('a straight run is two end posts and its line posts', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(81)
    const plan = buildPlan(l, deriveLayout(l), [11])
    expect([count(plan, 'corner'), count(plan, 'end'), count(plan, 'line')]).toEqual([0, 2, 10])
    expect(plan.house).toBeNull()
    expect(plan.street).toBe(false)
  })

  test('a perimeter closes on its first corner', () => {
    const l = layoutForShape('perimeter')
    l.sides.forEach(s => { s.lengthIn = ft(100) })
    expect(autoVertices(l)).toHaveLength(4)
    expect(count(buildPlan(l, deriveLayout(l)), 'corner')).toBe(4)
  })

  test('corners dragged by hand are kept', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(50)
    l.plan = { points: [{ x: 5, y: 5 }, { x: 40, y: 30 }] }
    expect(buildPlan(l, deriveLayout(l)).vertices).toEqual([{ x: 5, y: 5 }, { x: 40, y: 30 }])
  })
})

describe('aerial photo', () => {
  test('centered drawing and photo scale', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(100)
    expect(centeredVertices(l)).toEqual([{ x: -50, y: 0 }, { x: 50, y: 0 }])
    // 80 m across 800 px = 0.1 m = 0.328 ft per pixel
    expect(aerialFtPerPx(40)).toBeCloseTo(0.328, 3)
    expect(aerialUrl(29.09, -82.17, 40)).toMatch(/^https:\/\/imagery\.nationalmap\.gov\/arcgis\/rest\/services\/USGSNAIPPlus\/ImageServer\/exportImage\?bbox=/)
  })
})
