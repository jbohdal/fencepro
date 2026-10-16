/** Captions written from the pin, the plan and the facing direction. */

import { describe, test, expect } from 'vitest'
import { autoCaption, cornerName } from '../../web/src/autoCaption'
import { layoutForShape } from '../../web/src/yardLayout'

// Backyard: house at (0,0)–(90,0); left return west to (-30,0); left side up to
// (-30,120); back east to (120,120); right side down to (120,0); right return to (90,0).
function backyard() {
  const l = layoutForShape('backyard')
  const ft = [30, 120, 150, 120, 30]
  l.sides.forEach((s, i) => { s.lengthIn = ft[i] * 12 })
  l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'middle' }
  return l
}
const when = new Date(2026, 9, 15, 14, 31)

describe('corner names', () => {
  test('plain words', () => {
    expect(cornerName('Left side', 'Back')).toBe('back left corner')
    expect(cornerName('Back', 'Right side')).toBe('back right corner')
    expect(cornerName('Left return', 'Left side')).toBe('left return corner')
    expect(cornerName('Side 1', 'Side 2')).toBe('corner of the side 1 and the side 2')
  })
})

describe('auto caption', () => {
  test('side, distance along, facing, nearest feature, then category, time and who', () => {
    const c = autoCaption({ layout: backyard(), pin: { x: -29, y: 40, angle: 0 }, category: 'Site walk', takenAt: when, takenBy: 'Jonathan Bohdal' })
    expect(c).toMatch(/^Left side, about 40 ft from the left return corner, looking toward the back left corner\. Left return corner 40 ft behind\. Site walk, Oct 15, 2026, 2:31\s?PM, Jonathan Bohdal\.$/)
  })
  test('the nearest gate, to the left or right of where the camera faced', () => {
    const c = autoCaption({ layout: backyard(), pin: { x: -12, y: 5, angle: 270 }, category: 'Gate location', takenAt: when, takenBy: 'JB' })
    expect(c).toMatch(/^Left return, about 10 ft from the house/)
    expect(c).toContain('Walk gate 6 ft to the left')
  })
  test('no facing direction: no "looking toward", and "away" instead of left or right', () => {
    const c = autoCaption({ layout: backyard(), pin: { x: -12, y: 5 }, category: 'Before', takenAt: when })
    expect(c).not.toContain('looking')
    expect(c).toContain('Walk gate 6 ft away')
  })
  test('in the yard, away from any side', () => {
    expect(autoCaption({ layout: backyard(), pin: { x: 45, y: 60, angle: null } })).toMatch(/^In the yard, about \d+ ft from the /)
  })
  test('no pin: only what is known', () => {
    expect(autoCaption({ layout: backyard(), category: 'HOA', takenAt: when, takenBy: 'JB' })).toMatch(/^HOA, Oct 15, 2026, 2:31\s?PM, JB\.$/)
    expect(autoCaption({})).toBe('')
  })
})
