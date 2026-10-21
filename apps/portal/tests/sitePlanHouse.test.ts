/**
 * Site plan: sliding the house (where the returns meet it), labels for every
 * piece of a split side, labels that never overlap, and gate swing / hinge.
 * None of it may change footage, sections, posts or price.
 */

import { describe, test, expect } from 'vitest'
import { layoutForShape, deriveLayout, sidePieces, type YardLayout } from '../../web/src/yardLayout'
import { buildPlan, houseMeetsOf, setHouseMeets, clearHouseMeets, layoutSignature, planVertices } from '../../web/src/sitePlanGeometry'
import { placeLabels, planScreen, boxesOverlap, segHitsBox, polyHitsBox, FENCE_CLEAR, LABEL_GAP, screenLeaves, type Box } from '../../web/src/sitePlanLabels'

const ft = (n: number) => n * 12

function yard(left = 120, right = 100, back = 150, lr = 30, rr = 30): YardLayout {
  const l = layoutForShape('backyard')
  ;[lr, left, back, right, rr].forEach((n, i) => { l.sides[i].lengthIn = ft(n) })
  return l
}
/** What the price is made from: runs, posts, gates. */
const priced = (l: YardLayout) => {
  const r = deriveLayout(l)
  return JSON.stringify([r.runs.map(x => x.inches), r.corners, r.ends, r.walkGates, r.dblGates, r.totalIn])
}

describe('moving the house', () => {
  test('slide the house 10 ft: both returns meet it 10 ft from the back corner, price unchanged', () => {
    const l = yard()
    const before = priced(l)
    const m = setHouseMeets(l, { left: 10, right: 10 })
    expect(m.sides[0].meetsHouse).toEqual({ at: 'distance', distanceIn: 120 })
    expect(m.sides[4].meetsHouse).toEqual({ at: 'distance', distanceIn: 120 })
    expect(houseMeetsOf(m)).toMatchObject({ left: 10, right: 10 })
    expect(priced(m)).toBe(before)
    const plan = buildPlan(m, deriveLayout(m))
    expect(plan.houseAttach.map(h => [h.which, h.distFt])).toEqual([['left', 10], ['right', 10]])
    // The returns meet the house's side walls 10 ft below its back wall.
    const top = Math.max(...plan.house!.map(p => p.y))
    expect(top - plan.vertices[0].y).toBeCloseTo(10, 9)
    expect(top - plan.vertices[5].y).toBeCloseTo(10, 9)
    expect(plan.house!.some(p => Math.abs(p.x - plan.vertices[0].x) < 1e-9)).toBe(true)
    // Lengths on the drawing stay as typed.
    expect(plan.sides.map(s => s.label)).toEqual([`30' 0"`, `120' 0"`, `150' 0"`, `100' 0"`, `30' 0"`])
  })

  test('one return alone; whole feet; 0 is the back corner (saved as unset, as before)', () => {
    const l = setHouseMeets(yard(), { right: 7.4 })
    expect(l.sides[0].meetsHouse ?? null).toBeNull()
    expect(l.sides[4].meetsHouse).toEqual({ at: 'distance', distanceIn: 84 })
    expect(setHouseMeets(l, { right: 0.3 }).sides[4].meetsHouse).toBeNull()
    expect(setHouseMeets(l, { right: -4 }).sides[4].meetsHouse).toBeNull()
  })

  test('old saved values mean the same thing', () => {
    const l = yard()
    l.sides[0].meetsHouse = { at: 'front' }
    l.sides[4].meetsHouse = { at: 'distance', distanceIn: ft(12) }
    const m = houseMeetsOf(l)
    expect(m.left).toBe(m.depth)
    expect(m.right).toBe(12)
    const v = buildPlan(l, deriveLayout(l)).vertices
    expect(v[0].y).toBeCloseTo(-m.depth, 9)
    expect(v[5].y).toBeCloseTo(-12, 9)
  })

  test('reset puts both returns back at the back corners', () => {
    const l = clearHouseMeets(setHouseMeets(yard(), { left: 10, right: 4 }))
    expect(houseMeetsOf(l)).toMatchObject({ left: 0, right: 0 })
    expect(buildPlan(l, deriveLayout(l)).vertices).toEqual(buildPlan(yard(), deriveLayout(yard())).vertices)
  })

  test('corners dragged by hand stay put; the house moves to meet the returns there', () => {
    const l = yard()
    const pts = planVertices(l).map(p => ({ x: p.x + 1, y: p.y + 2 }))
    l.plan = { points: pts, pointsFor: layoutSignature(l) }
    const m = setHouseMeets(l, { left: 6, right: 6 })
    expect(planVertices(m)).toEqual(planVertices(l))
    const plan = buildPlan(m, deriveLayout(m))
    // Each return meets a side wall of the house 6 ft in front of its back wall.
    const back = Math.max(...plan.house!.map(p => p.y))
    expect(back - plan.vertices[0].y).toBeCloseTo(6, 6)
    expect(back - plan.vertices[5].y).toBeCloseTo(6, 6)
  })

  test('not offered for shapes without returns meeting the house', () => {
    const l = layoutForShape('straight'); l.sides[0].lengthIn = ft(50)
    expect(buildPlan(l, deriveLayout(l)).houseAttach).toEqual([])
    expect(setHouseMeets(l, { left: 5 })).toEqual(l)
  })
})

describe('labels for each piece of a split side', () => {
  test("a 40 ft side with a 14 ft double gate in the middle: 13' / 14' double gate / 13'", () => {
    const l = yard()
    l.sides[4].lengthIn = ft(40)
    l.sides[4].gate = { type: 'double', widthIn: ft(14), position: 'middle' }
    const r = deriveLayout(l)
    const pieces = sidePieces(l.sides[4], r.sides[4])
    expect(pieces.map(p => p.text)).toEqual([`13'`, `14' double gate`, `13'`])
    // The same spans the runs are priced from.
    expect(r.sides[4].runs.map(x => x.inches)).toEqual([ft(13), ft(13)])
    const plan = buildPlan(l, r)
    const side = plan.sides[4]
    expect(side.pieces.map(p => p.text)).toEqual([`13'`, `14' double gate`, `13'`])
    expect(side.label).toBe(`40' 0"`)
    // The gate is drawn where it is: 13 ft from the start, 14 ft wide.
    const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    expect(len(side.a, side.gate!.a)).toBeCloseTo(13, 9)
    expect(len(side.gate!.a, side.gate!.b)).toBeCloseTo(14, 9)
  })

  test('a gate near the house and a skip: every piece labeled, at its real place', () => {
    const l = yard()
    l.sides[0].lengthIn = ft(40)
    l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'start' }
    l.sides[0].skip = { kind: 'existing', lengthIn: ft(10), position: 'distance', distanceIn: ft(24) }
    const r = deriveLayout(l)
    const pieces = sidePieces(l.sides[0], r.sides[0])
    // Near the house: one section (8 ft) of fence, then the 4 ft gate.
    expect(pieces.map(p => [p.kind, p.text, p.fromIn / 12])).toEqual([
      ['fence', `8'`, 0], ['gate', `4' walk gate`, 8], ['fence', `12'`, 12], ['skip', `10' existing fence`, 24], ['fence', `6'`, 34],
    ])
    expect(r.sides[0].runs.map(x => x.inches / 12)).toEqual([8, 12, 6])
  })

  test('a side not split has no piece labels', () => {
    const l = yard()
    expect(buildPlan(l, deriveLayout(l)).sides.every(s => s.pieces.length === 0)).toBe(true)
  })
})

// ── No overlaps ───────────────────────────────────────────────────────────────

function scenarios(): Array<[string, YardLayout]> {
  const out: Array<[string, YardLayout]> = []
  let l = yard(); l.sides[4].lengthIn = ft(40); l.sides[4].gate = { type: 'double', widthIn: ft(14), position: 'middle' }
  out.push(['40 ft right return with a 14 ft double gate', l])
  l = yard(); l.sides[0].lengthIn = ft(40); l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'start' }
  l.sides[0].skip = { kind: 'existing', lengthIn: ft(10), position: 'distance', distanceIn: ft(24) }
  out.push(['gate near the house and a skip', l])
  l = yard(); l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'middle' }; l.sides[4].gate = { type: 'double', widthIn: 120, position: 'middle' }
  l.sides[2].skip = { kind: 'existing', lengthIn: ft(40), position: 'middle' }
  out.push(['gates on both returns, existing fence on the back', l])
  l = yard(); l.sides[1].gate = { type: 'walk', widthIn: 48, position: 'end', swing: 'out', hinge: 'right' }
  l.sides[3].skip = { kind: 'none', lengthIn: ft(3), position: 'distance', distanceIn: ft(2) }
  out.push(['short pieces on the sides, a gate swinging out', l])
  l = setHouseMeets(yard(), { left: 10, right: 10 }); l.sides[4].lengthIn = ft(40); l.sides[4].gate = { type: 'double', widthIn: ft(14), position: 'middle', leafSwing: { left: 'in', right: 'out' } }
  out.push(['house moved, double gate leaves set apart', l])
  l = layoutForShape('straight'); l.sides[0].lengthIn = ft(60); l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'distance', distanceIn: ft(10) }
  out.push(['straight run with a gate', l])
  return out
}

describe('labels never overlap each other, the fence, a gate swing or the house', () => {
  for (const fs of [1, 1.35]) {
    for (const [name, l] of scenarios()) {
      test(`${name} (labels x${fs})`, () => {
        // Sections on every run (8 ft panels), so each side's name line is as long as in the app.
        const r = deriveLayout(l)
        const plan = buildPlan(l, r, r.runs.map(x => Math.ceil(x.inches / 96)))
        expect(plan.sides.every(s => s.placeholder || /section/.test(s.sublabel))).toBe(true)
        const sc = planScreen(plan, { fontScale: fs })
        const labels = placeLabels(plan, sc, fs)
        // Every piece has its label.
        expect(labels.filter(x => x.kind !== 'side').length).toBe(plan.sides.reduce((t, s) => t + s.pieces.length, 0))
        const fence = plan.sides.map(s => ({ x1: sc.toX(s.a.x), y1: sc.toY(s.a.y), x2: sc.toX(s.b.x), y2: sc.toY(s.b.y) }))
        const house = plan.house?.map(p => ({ x: sc.toX(p.x), y: sc.toY(p.y) })) ?? null
        const swings: Box[] = plan.sides.flatMap(s => (s.gate ? screenLeaves(s.gate, sc).map(x => x.box) : []))
        const grow = (b: Box, g: number) => ({ x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g })
        for (const a of labels) {
          for (const b of labels) if (a !== b) expect(boxesOverlap(a.box, b.box, LABEL_GAP), `${a.lines[0].text} / ${b.lines[0].text}`).toBe(false)
          for (const f of fence) expect(segHitsBox(f, grow(a.box, FENCE_CLEAR)), `${a.lines[0].text} on the fence`).toBe(false)
          if (house) expect(polyHitsBox(house, grow(a.box, FENCE_CLEAR)), `${a.lines[0].text} on the house`).toBe(false)
          for (const s of swings) expect(boxesOverlap(a.box, s), `${a.lines[0].text} on a gate swing`).toBe(false)
          // A leader line never runs through another label.
          if (a.leader) for (const b of labels) if (b !== a) expect(segHitsBox(a.leader, b.box), `${a.lines[0].text} leader through ${b.lines[0].text}`).toBe(false)
          expect(a.box.x0 >= 0 && a.box.x1 <= sc.W && a.box.y0 >= 0 && a.box.y1 <= sc.H).toBe(true)
          expect(a.clear).toBe(true)
        }
      })
    }
  }
})

// ── Gate swing and hinge ──────────────────────────────────────────────────────

describe('gate swing and hinge (drawing and crew notes only)', () => {
  const withGate = (gate: NonNullable<YardLayout['sides'][number]['gate']>, i = 0) => {
    const l = yard(); l.sides[i].gate = gate
    const plan = buildPlan(l, deriveLayout(l))
    return { l, g: plan.sides[i].gate!, plan }
  }
  test('default: swings into the yard, hinged on the end nearest the house', () => {
    const { g, plan } = withGate({ type: 'walk', widthIn: 48, position: 'middle' })
    expect(g.leaves).toHaveLength(1)
    expect(g.leaves[0].swing).toBe('in')
    expect(g.leaves[0].dir.y).toBeGreaterThan(0)
    // The left return starts at the house: the hinge is the gate post nearer it.
    const houseX = plan.vertices[0].x
    expect(Math.abs(g.leaves[0].hinge.x - houseX)).toBeLessThan(Math.abs(g.leaves[0].latch.x - houseX))
    expect(g.hingeDefaulted).toBe(true)
    expect(g.swingText).toBe(`swings in, hinges ${g.hinge}`)
    // The hinge post is marked.
    expect(plan.posts.filter(p => p.hinge)).toHaveLength(1)
  })

  test('flipping swing and hinge moves the drawing, never the price', () => {
    const base = withGate({ type: 'walk', widthIn: 48, position: 'middle' })
    const flipped = withGate({ type: 'walk', widthIn: 48, position: 'middle', swing: 'out', hinge: base.g.hinge === 'left' ? 'right' : 'left' })
    expect(flipped.g.leaves[0].dir.y).toBeLessThan(0)
    expect(flipped.g.leaves[0].hinge).toEqual(base.g.leaves[0].latch)
    expect(flipped.g.swingText).toBe(`swings out, hinges ${base.g.hinge === 'left' ? 'right' : 'left'}`)
    expect(priced(flipped.l)).toBe(priced(base.l))
    expect(flipped.plan.posts.filter(p => p.kind !== 'line').length).toBe(base.plan.posts.filter(p => p.kind !== 'line').length)
  })

  test('left and right are as seen from inside the yard', () => {
    // The back runs left to right across the top; from inside facing it, left is the left of the page.
    const { g } = withGate({ type: 'walk', widthIn: 48, position: 'middle', hinge: 'left' }, 2)
    expect(g.leaves[0].hinge.x).toBeLessThan(g.leaves[0].latch.x)
  })

  test('a gate on a side not touching the house hinges at the side start by default', () => {
    const { g, l } = withGate({ type: 'walk', widthIn: 48, position: 'middle' }, 2)
    const r = deriveLayout(l).sides[2]
    const plan = buildPlan(l, deriveLayout(l))
    const start = plan.sides[2].a
    expect(Math.hypot(g.leaves[0].hinge.x - start.x, g.leaves[0].hinge.y - start.y)).toBeCloseTo(r.gateAtIn! / 12, 9)
  })

  test('double gate: both leaves the same way, or each set on its own', () => {
    let { g, plan } = withGate({ type: 'double', widthIn: 120, position: 'middle', swing: 'out' }, 4)
    expect(g.leaves.map(x => x.swing)).toEqual(['out', 'out'])
    expect(g.swingText).toBe('both leaves swing out')
    expect(plan.posts.filter(p => p.hinge)).toHaveLength(2)
    ;({ g } = withGate({ type: 'double', widthIn: 120, position: 'middle', leafSwing: { left: 'in', right: 'out' } }, 4))
    expect(g.swingText).toBe('left leaf swings in, right leaf swings out')
    expect(g.leaves.find(x => x.side === 'left')!.swing).toBe('in')
    expect(g.leaves.find(x => x.side === 'right')!.swing).toBe('out')
  })

  test('each leaf is drawn to scale: a 4 ft walk gate swings 4 ft', () => {
    const { g, plan } = withGate({ type: 'walk', widthIn: 48, position: 'middle' })
    const sc = planScreen(plan)
    const [leaf] = screenLeaves(g, sc)
    expect(leaf.r * sc.ftPerPx).toBeCloseTo(4, 6)
  })
})
