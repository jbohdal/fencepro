/**
 * "Customer Since" shows the Florida calendar date of the stored moment.
 */
import { describe, test, expect } from 'vitest'
import { businessDate } from '../../web/src/businessDate'

describe('businessDate', () => {
  test('an afternoon entry keeps its date', () => {
    expect(businessDate('2025-06-10T18:12:28.000Z')).toBe('2025-06-10')
  })

  test('an evening entry in Florida is not pushed to the next day', () => {
    // 01:30 UTC on the 6th is 9:30 pm on the 5th in Florida (summer, UTC-4).
    expect(businessDate('2024-08-06T01:30:00.000Z')).toBe('2024-08-05')
    // Winter, UTC-5: 04:30 UTC is 11:30 pm the day before.
    expect(businessDate('2025-01-15T04:30:00.000Z')).toBe('2025-01-14')
  })

  test('a plain date is left alone', () => {
    expect(businessDate('2024-02-14')).toBe('2024-02-14')
  })

  test('accepts a Date', () => {
    expect(businessDate(new Date('2026-10-09T00:01:52.449Z'))).toBe('2026-10-08')
  })

  test('nothing or nonsense gives an empty string', () => {
    expect(businessDate('')).toBe('')
    expect(businessDate(undefined)).toBe('')
    expect(businessDate('not a date')).toBe('')
  })
})
