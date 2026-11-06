/** Install packet links: open until turned off, or 30 days after the job is complete (longer while covered warranty work is open). */

import { describe, test, expect } from 'vitest'
import { packetClosed, propertyLineBlock } from '../src/server/routes/installPacket.js'

const day = 86_400_000
describe('install packet links', () => {
  const now = new Date('2026-11-20T12:00:00').getTime()
  test('open while the job is not complete', () => {
    expect(packetClosed({ disabledAt: null }, { completedDate: null }, now)).toBeNull()
  })
  test('still open 29 days after completion, closed after 30', () => {
    expect(packetClosed({ disabledAt: null }, { completedDate: '2026-10-22' }, now)).toBeNull()
    expect(packetClosed({ disabledAt: null }, { completedDate: '2026-10-20' }, now)).toBe('expired')
    expect(packetClosed({ disabledAt: null }, { completedDate: new Date(now - 31 * day).toISOString() }, now)).toBe('expired')
  })
  test('covered warranty work still to do keeps a finished job\'s packet open (not one turned off)', () => {
    expect(packetClosed({ disabledAt: null }, { completedDate: '2024-03-10' }, now, 1)).toBeNull()
    expect(packetClosed({ disabledAt: null }, { completedDate: '2024-03-10' }, now, 0)).toBe('expired')
    expect(packetClosed({ disabledAt: new Date() }, { completedDate: '2024-03-10' }, now, 1)).toBe('off')
  })
  test('turned off, or the job is gone', () => {
    expect(packetClosed({ disabledAt: new Date() }, { completedDate: null }, now)).toBe('off')
    expect(packetClosed({ disabledAt: null }, null, now)).toBe('gone')
    expect(packetClosed({ disabledAt: null }, { completedDate: null, archivedAt: new Date() }, now)).toBe('gone')
  })
})

describe('property line warnings on the crew\'s sheet', () => {
  test('five sides past the line are one short sentence; sides inside the setback say how close', () => {
    const past = ['Side 1', 'Side 2', 'Side 3', 'Side 4', 'Side 5'].map(s => `${s} crosses the property line. Check it against a survey.`)
    expect(propertyLineBlock(past)).toBe('Side 1, Side 2, Side 3, Side 4 and Side 5 are on or past it.')
    expect(propertyLineBlock(['Back crosses the property line. Check it against a survey.', 'Left is 1.5 ft from the property line, closer than the 3 ft setback.']))
      .toBe('Back is on or past it. Left (1.5 ft) is closer than the 3 ft setback.')
    expect(propertyLineBlock([])).toBe('')
  })
})
