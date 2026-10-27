/**
 * The floating Feedback button over a window never sits on a control (web/src/feedbackSpot.ts).
 * Found on an iPhone (Simulator, Oct 26 2026): at a fixed bottom left corner it covered the card
 * window's "Customer page" button and the quote builder's camera button.
 */
import { describe, test, expect } from 'vitest'
import { spotsFor, pickSpot, probePoints, edgeTab, BUTTON, TAB, type Spot } from '../../web/src/feedbackSpot'

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
    const s = pickSpot(spots, freeOf([customerPage, camera]), 844)
    expect(overlaps(s, customerPage)).toBe(false)
    expect(overlaps(s, camera)).toBe(false)
    expect(s.tab).toBeFalsy()
  })

  test('a screen full of controls: a thin tab on the left edge, inside the 16 px gutter, where it is free', () => {
    // Full width rows everywhere, with the side gutter kept clear (16 px).
    const rows = Array.from({ length: 20 }, (_, i) => ({ left: 16, top: i * 42, width: 358, height: 40 }))
    const s = pickSpot(spotsFor(390, 844, 76), freeOf(rows), 844)
    expect(s.tab).toBe(true)
    expect(s.left + s.width).toBeLessThanOrEqual(16)
    expect(s.width).toBe(TAB.width)
    // A control flush to the left edge half way down: the tab moves to another height.
    const flush = { left: 0, top: 380, width: 390, height: 90 }
    const t = pickSpot([], freeOf([flush]), 844)
    expect(overlaps(t, flush)).toBe(false)
    expect(t).not.toEqual(edgeTab(844))
  })
})
