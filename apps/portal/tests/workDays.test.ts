import { describe, test, expect } from 'vitest'
import { onWorkDay, addWorkDays } from '../../web/src/workDays'

// 2026-10-19 is a Monday.
describe('crew working days (Monday to Thursday by default)', () => {
  test('a working day stays; Friday to Sunday move to Monday', () => {
    expect(onWorkDay('2026-10-21')).toBe('2026-10-21') // Wednesday
    expect(onWorkDay('2026-10-23')).toBe('2026-10-26') // Friday → Monday
    expect(onWorkDay('2026-10-24')).toBe('2026-10-26') // Saturday → Monday
    expect(onWorkDay('2026-10-25')).toBe('2026-10-26') // Sunday → Monday
  })

  test('adding working days skips Friday to Sunday', () => {
    expect(addWorkDays('2026-10-19', 0)).toBe('2026-10-19')
    expect(addWorkDays('2026-10-19', 3)).toBe('2026-10-22') // Mon + 3 = Thu
    expect(addWorkDays('2026-10-21', 2)).toBe('2026-10-26') // Wed + 2 = next Mon
    expect(addWorkDays('2026-10-22', 1)).toBe('2026-10-26') // Thu + 1 = next Mon
    expect(addWorkDays('2026-10-24', 1)).toBe('2026-10-27') // Sat → Mon, + 1 = Tue
  })

  test('a group of jobs never lands on a day off', () => {
    const lengths = [2, 1, 3, 1]
    let offset = 0
    const starts = lengths.map(n => { const d = addWorkDays('2026-10-20', offset); offset += n; return d })
    expect(starts).toEqual(['2026-10-20', '2026-10-22', '2026-10-26', '2026-10-29'])
    for (const d of starts) expect([1, 2, 3, 4]).toContain(new Date(d + 'T12:00:00Z').getUTCDay())
  })

  test('other working days from Settings are used; an empty list falls back to Monday to Thursday', () => {
    expect(addWorkDays('2026-10-22', 1, [1, 2, 3, 4, 5])).toBe('2026-10-23') // Thu + 1 = Fri when Friday is on
    expect(onWorkDay('2026-10-23', [])).toBe('2026-10-26')
  })
})
