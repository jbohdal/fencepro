/**
 * Menus open fully on screen (PopMenu's desktop placement), and the typed name
 * that unlocks Delete customer.
 */
import { describe, test, expect } from 'vitest'
import { placePopup, sameName, POPUP_MARGIN } from '../../web/src/popupPlace'

const view = { width: 1280, height: 800 }
const btn = (left: number, top: number, w = 80, h = 36) => ({ left, right: left + w, top, bottom: top + h })
const inside = (p: { left: number; top: number; maxHeight: number }, size: { width: number; height: number }, v = view) => {
  const h = Math.min(size.height, p.maxHeight)
  return p.left >= POPUP_MARGIN && p.left + Math.min(size.width, v.width - 2 * POPUP_MARGIN) <= v.width - POPUP_MARGIN
    && p.top >= POPUP_MARGIN && p.top + h <= v.height - POPUP_MARGIN
}

describe('placePopup', () => {
  test('opens below, lined up with the right edge of the button', () => {
    const p = placePopup(btn(600, 100), { width: 200, height: 120 }, view, 'end')
    expect(p).toEqual({ left: 480, top: 140, maxHeight: 800 - 8 - 140 })
  })
  test('a button near the left edge flips to line up with its left edge (the reported bug)', () => {
    const p = placePopup(btn(16, 300), { width: 208, height: 60 }, view, 'end')
    expect(p.left).toBe(16)
    expect(inside(p, { width: 208, height: 60 })).toBe(true)
  })
  test('a button near the right edge flips the other way for align start', () => {
    const p = placePopup(btn(1150, 100), { width: 240, height: 60 }, view, 'start')
    expect(p.left).toBe(1150 + 80 - 240)
  })
  test('too wide for either edge: pushed in to 8 px from the side', () => {
    const narrow = { width: 360, height: 780 }
    const p = placePopup(btn(150, 60, 48, 48), { width: 384, height: 200 }, narrow, 'end')
    expect(p.left).toBe(8)
    expect(inside(p, { width: 384, height: 200 }, narrow)).toBe(true)
  })
  test('no room below: opens above', () => {
    const p = placePopup(btn(600, 700), { width: 200, height: 150 }, view)
    expect(p.top).toBe(700 - 4 - 150)
    expect(inside(p, { width: 200, height: 150 })).toBe(true)
  })
  test('taller than both spaces: the taller space, scrolling inside', () => {
    const p = placePopup(btn(600, 300), { width: 200, height: 2000 }, view)
    expect(p.top).toBe(340)
    expect(p.maxHeight).toBe(800 - 8 - 340)
    expect(inside(p, { width: 200, height: 2000 })).toBe(true)
  })
})

describe('sameName', () => {
  test('matches ignoring capitals and spaces at the ends', () => {
    expect(sameName('  jane SMITH ', 'Jane Smith')).toBe(true)
    expect(sameName('jane  smith', 'Jane Smith')).toBe(true)
  })
  test('a different or partial name does not match', () => {
    expect(sameName('Jane Smit', 'Jane Smith')).toBe(false)
    expect(sameName('', 'Jane Smith')).toBe(false)
    expect(sameName('Jane', 'Jane Smith')).toBe(false)
  })
  test('an empty name never matches', () => {
    expect(sameName('', '')).toBe(false)
  })
})
