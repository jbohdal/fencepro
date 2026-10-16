/** Install packet links: open until turned off, or 30 days after the job is complete. */

import { describe, test, expect } from 'vitest'
import { packetClosed } from '../src/server/routes/installPacket.js'

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
  test('turned off, or the job is gone', () => {
    expect(packetClosed({ disabledAt: new Date() }, { completedDate: null }, now)).toBe('off')
    expect(packetClosed({ disabledAt: null }, null, now)).toBe('gone')
    expect(packetClosed({ disabledAt: null }, { completedDate: null, archivedAt: new Date() }, now)).toBe('gone')
  })
})
