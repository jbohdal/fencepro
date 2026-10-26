/**
 * Round 3 walkthrough (Oct 26 2026), the small ones that need no database:
 * the history's "Quote sent" time, the chain link price screen's words, a
 * repair walkthrough's photos, a gate put into a side of the drawing.
 */
import { describe, test, expect } from 'vitest'
import { sentAt } from '../src/server/lib/followUps'
import { photoSlots } from '../src/server/lib/walkthroughRules'
import { isPostFence } from '../../web/src/DollarPickets'
import { gatesPutIn } from '../../web/src/changeOrderDraft'

describe('"Quote sent" in the history is never a time still to come', () => {
  const made = new Date('2026-10-26T11:40:00.000Z')
  test('the proposal\'s own time when it has one', () => {
    expect(sentAt('2026-10-26T11:50:12.000Z', '2026-10-26', made, new Date('2026-10-26T13:00:00Z'))).toBe('2026-10-26T11:50:12.000Z')
  })
  test('a day only: the time the quote was made that day, not noon (8:00 AM in Ocala)', () => {
    expect(sentAt(undefined, '2026-10-26', made, new Date('2026-10-26T11:55:00Z'))).toBe(made.toISOString())
  })
  test('an older day only: noon that day; and never after now', () => {
    expect(sentAt(undefined, '2026-10-20', made, new Date('2026-10-26T13:00:00Z'))).toBe('2026-10-20T12:00:00.000Z')
    const now = new Date('2026-10-26T11:45:00Z')
    expect(sentAt('2026-10-26T15:00:00.000Z', '2026-10-26', made, now)).toBe(now.toISOString())
  })
})

describe('the price screen for chain link speaks of posts, not pickets', () => {
  test('chain link and commercial chain link are posts; vinyl, wood, aluminum pickets', () => {
    expect(isPostFence('Chainlink')).toBe(true)
    expect(isPostFence('Commercial')).toBe(true)
    expect(isPostFence('Vinyl')).toBe(false)
    expect(isPostFence('Aluminum')).toBe(false)
    expect(isPostFence(null)).toBe(false)
  })
})

describe('a repair\'s walkthrough asks for no side it has no sides for', () => {
  test('a repair with no drawing: its repaired gates and one wide shot, no "Side 1"', () => {
    const s = photoSlots({ sideCount: 1, gateCount: 0, repairGates: 1, repair: true })
    expect(s.map(x => x.label)).toEqual(['Gate 1', 'Wide shot of the repaired fence'])
    expect(photoSlots({ sideCount: 1, repair: true }).map(x => x.kind)).toEqual(['wide'])
  })
  test('a new fence with no drawing keeps Side 1', () => {
    expect(photoSlots({ sideCount: 1, gateCount: 0 }).map(x => x.label)).toEqual(['Side 1', 'Wide shot of the whole fence'])
  })
})

describe('a gate put into a side of the drawing', () => {
  const side = (id: string, name: string, lengthIn: number, gate: any = null) => ({ id, name, on: true, lengthIn, startFinish: 'corner', endFinish: 'corner', gate } as any)
  test('the side and the feet of fence the gate takes', () => {
    const before = { shape: 'backyard', closed: false, sides: [side('a', 'Back', 600), side('b', 'Left side', 600)] } as any
    const after = { ...before, sides: [side('a', 'Back', 600, { type: 'walk', widthIn: 48, position: 'middle' }), side('b', 'Left side', 720)] }
    expect(gatesPutIn(before, after)).toEqual({ sides: ['Back'], openingFt: 4 })
    expect(gatesPutIn(before, before)).toBeNull()
    expect(gatesPutIn(null, after)).toBeNull()
  })
})
