/**
 * The floating Feedback button over a window never sits on a control (web/src/feedbackSpot.ts).
 * Found on an iPhone (Simulator, Oct 26 2026): at a fixed bottom left corner it covered the card
 * window's "Customer page" button and the quote builder's camera button.
 */
import { describe, test, expect } from 'vitest'
import { spotsFor, pickSpot, probePoints, edgeTab, BUTTON, TAB, TAPPABLE, LABELS, CUSTOMER_HOLDS, type Spot } from '../../web/src/feedbackSpot'

const overlaps = (a: Spot, b: { left: number; top: number; width: number; height: number }) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
/** isFree for a screen whose controls are these rectangles (as elementsFromPoint would find them). */
const freeOf = (controls: Array<{ left: number; top: number; width: number; height: number }>) => (s: Spot) =>
  !probePoints(s).some(([x, y]) => controls.some(c => x >= c.left && x <= c.left + c.width && y >= c.top && y <= c.top + c.height))

describe('the floating Feedback button finds a free spot', () => {
  test('iPhone 13 (390 x 844) with the tab bar: tries low on the screen first, both sides, all on screen', () => {
    const spots = spotsFor(390, 844, 76)
    expect(spots[0]).toEqual({ left: 12, top: 844 - 76 - BUTTON.height - 12, width: BUTTON.width, height: BUTTON.height })
    expect(spots[1].left).toBe(390 - BUTTON.width - 12)
    for (const s of spots) { expect(s.left).toBeGreaterThanOrEqual(0); expect(s.left + s.width).toBeLessThanOrEqual(390); expect(s.top + s.height).toBeLessThanOrEqual(844 - 76) }
  })

  test('the card window\'s "Customer page" button at 87,555 (the Simulator finding) is never covered', () => {
    const customerPage = { left: 16, top: 530, width: 160, height: 48 }
    const camera = { left: 16, top: 700, width: 170, height: 44 }
    const spots = spotsFor(390, 844, 76)
    // A phone: the edge tab, which reaches no control's middle (they sit inside the 16 px gutter).
    const s = pickSpot(spots, freeOf([customerPage, camera]), 844, 390)!
    expect(s.tab).toBe(true)
    expect(s.left + s.width / 2).toBeLessThan(customerPage.left)
    // A computer: a full button, on a spot with nothing under it.
    const wide = pickSpot(spotsFor(1280, 800, 0), freeOf([{ left: 0, top: 700, width: 1280, height: 100 }]), 800, 1280)!
    expect(wide.tab).toBeFalsy()
    expect(overlaps(wide, { left: 0, top: 700, width: 1280, height: 100 })).toBe(false)
  })

  test('a screen full of controls: a narrow tab on the left edge, its middle inside the 16 px gutter, where it is free', () => {
    // Full width rows everywhere, with the side gutter kept clear (16 px).
    const rows = Array.from({ length: 21 }, (_, i) => ({ left: 16, top: i * 42, width: 1248, height: 40 }))
    const s = pickSpot(spotsFor(1280, 844, 0), freeOf(rows), 844, 1280)!
    expect(s.tab).toBe(true)
    expect(s.left + s.width / 2).toBeLessThan(16)
    expect(s.width).toBe(TAB.width)
    // A control flush to the left edge half way down: the tab moves to another height.
    const flush = { left: 0, top: 380, width: 390, height: 90 }
    const t = pickSpot([], freeOf([flush]), 844)!
    expect(overlaps(t, flush)).toBe(false)
    expect(t).not.toEqual(edgeTab(844))
  })

  test('the quote builder on an iPhone 13 (Oct 27 recheck): the tab sits wholly inside the 16 px gutter, never on the "No gate" button or the "Customer name" label', () => {
    // The Voice switch card and the "Customer name" heading start at x = 16 (the gutter); "No gate" also starts at 16.
    const voice = { left: 16, top: 162, width: 358, height: 110 }
    const label = { left: 16, top: 248, width: 87, height: 14 }
    const noGate = { left: 16, top: 400, width: 120, height: 44 }
    const s = pickSpot(spotsFor(390, 844, 0), freeOf([voice, label, noGate]), 844, 390)!
    expect(s.tab).toBe(true)
    expect(s.left + s.width).toBeLessThanOrEqual(16)
    for (const c of [voice, label, noGate]) expect(overlaps(s, c)).toBe(false)
  })

  test('a 14 px label is found anywhere under the tab (probes every 8 px down), and labels count as covered', () => {
    const tab = edgeTab(844)
    const ys = probePoints(tab).map(([, y]) => y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(8)
    expect(LABELS.split(',').map(x => x.trim())).toEqual(expect.arrayContaining(['label', 'h3']))
  })

  test('a control flush to the left edge all the way down: the right edge; covered everywhere: not shown at all', () => {
    const leftWall = { left: 0, top: 0, width: 20, height: 844 }
    const r = pickSpot(spotsFor(390, 844, 0), freeOf([leftWall]), 844, 390)!
    expect(r.side).toBe('right')
    expect(r.left).toBe(390 - TAB.width)
    expect(pickSpot(spotsFor(390, 844, 0), freeOf([{ left: 0, top: 0, width: 390, height: 844 }]), 844, 390)).toBeNull()
    expect(pickSpot(spotsFor(1280, 800, 0), freeOf([{ left: 0, top: 0, width: 1280, height: 800 }]), 800, 1280)).toBeNull()
  })

  test('a signature box counts as a control; a screen the customer holds hides the button', () => {
    // e2e/round4-co: the in-person change order's signature box sat under it and the signature never landed.
    expect(TAPPABLE.split(',').map(x => x.trim())).toContain('canvas')
    expect(CUSTOMER_HOLDS).toBe('[data-customer-holds]')
  })
})
