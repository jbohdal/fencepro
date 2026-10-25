/**
 * Scheduling an install: the crew days it fills, the rain day shift, the
 * warnings and the customer's text (src/server/lib/installDays.ts).
 * There are no holidays in the app (nothing in Settings keeps them), so the
 * only days off are the days of the week the crews do not work.
 */
import { describe, it, expect } from 'vitest'
import {
  crewDaysOfWeek, installDays, nextCrewDay, addCrewDays, wholeCrewDays, daysForSections, rainDayMoves, scheduleWarnings,
  installText, customerPhoneToGive, usDate, locatesWords, holidaysOf, holidayOn, crewConflicts, weekWords, shortDayWords,
} from '../src/server/lib/installDays'

// Oct 2026: Mon 26, Tue 27, Wed 28, Thu 29, Fri 30, Sat 31; Nov: Sun 1, Mon 2, Tue 3, Wed 4, Thu 5, Fri 6, Mon 9.
const MON_THU = [1, 2, 3, 4]

describe('crew working days', () => {
  it('Monday to Thursday by default', () => {
    expect(crewDaysOfWeek(undefined)).toEqual(MON_THU)
    expect(crewDaysOfWeek([])).toEqual(MON_THU)
    expect(crewDaysOfWeek([1, 2, 3, 4])).toEqual(MON_THU)
  })
  it('Friday only when Settings tick it', () => {
    expect(crewDaysOfWeek([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5])
  })
  it('never Saturday or Sunday from Settings (every day ticked, as the live settings are, is Monday to Friday)', () => {
    expect(crewDaysOfWeek([0, 1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5])
    expect(crewDaysOfWeek([0, 6])).toEqual(MON_THU)
  })
  it('a job booked "weekends too" uses every day', () => {
    expect(crewDaysOfWeek(MON_THU, true)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('the crew days a job fills', () => {
  it('Monday to Thursday: a 3 day job started Thursday skips Friday to Sunday', () => {
    expect(installDays('2026-10-29', 3, MON_THU)).toEqual(['2026-10-29', '2026-11-02', '2026-11-03'])
  })
  it('Friday on: it works Friday too', () => {
    expect(installDays('2026-10-29', 3, crewDaysOfWeek([1, 2, 3, 4, 5]))).toEqual(['2026-10-29', '2026-10-30', '2026-11-02'])
  })
  it('a start on a day off moves to the next crew day', () => {
    expect(installDays('2026-10-31', 2, MON_THU)).toEqual(['2026-11-02', '2026-11-03'])
    expect(installDays('2026-10-30', 1, MON_THU)).toEqual(['2026-11-02'])
    expect(nextCrewDay('2026-11-01', MON_THU)).toBe('2026-11-02')
  })
  it('weekends allowed: Saturday and Sunday are crew days for that job', () => {
    expect(installDays('2026-10-30', 3, crewDaysOfWeek(MON_THU, true))).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
  })
  it('one day at least, and the days counted in crew days', () => {
    expect(installDays('2026-10-26', 0, MON_THU)).toEqual(['2026-10-26'])
    expect(installDays('2026-10-26', 5, MON_THU)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-11-02'])
    expect(addCrewDays('2026-10-29', 1, MON_THU)).toBe('2026-11-02')
  })
})

describe('crew days from the quote', () => {
  it('rounds the quote\'s crew days up, a tenth of a day over still the same day', () => {
    expect(wholeCrewDays(1.04)).toBe(1)
    expect(wholeCrewDays(1.06)).toBe(2)
    expect(wholeCrewDays(2)).toBe(2)
    expect(wholeCrewDays(2.4)).toBe(3)
    expect(wholeCrewDays(0.3)).toBe(1)
    expect(wholeCrewDays(0)).toBe(0)
    expect(wholeCrewDays(NaN)).toBe(0)
  })
  it('no crew time on the quote: about 15 sections a day', () => {
    expect(daysForSections(45)).toBe(3)
    expect(daysForSections(46)).toBe(4)
    expect(daysForSections(0)).toBe(1)
  })
})

describe('rain day', () => {
  const booked = [
    { id: 'a1', jobKey: 'A', date: '2026-11-02' },
    { id: 'a2', jobKey: 'A', date: '2026-11-03' },
    { id: 'a3', jobKey: 'A', date: '2026-11-04' },
    { id: 'b1', jobKey: 'B', date: '2026-11-05' },
    { id: 'c1', jobKey: 'C', date: '2026-11-09' },
  ]
  it('everything on or after the rain day moves one crew day later; days before it stay', () => {
    const m = rainDayMoves(booked, '2026-11-03', 1, MON_THU)
    expect(m.map(x => [x.id, x.to])).toEqual([['a2', '2026-11-04'], ['a3', '2026-11-05'], ['b1', '2026-11-09'], ['c1', '2026-11-10']])
  })
  it('Thursday moves over the weekend to Monday; with Friday on, to Friday', () => {
    expect(rainDayMoves(booked, '2026-11-05', 1, MON_THU).find(x => x.id === 'b1')!.to).toBe('2026-11-09')
    expect(rainDayMoves(booked, '2026-11-05', 1, [1, 2, 3, 4, 5]).find(x => x.id === 'b1')!.to).toBe('2026-11-06')
  })
  it('two crew days', () => {
    expect(rainDayMoves(booked, '2026-11-04', 2, MON_THU).map(x => x.to)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])
  })
  it('a job booked "weekends too" (on purpose) keeps moving day by day', () => {
    const w = [{ id: 'w1', jobKey: 'W', date: '2026-10-30' }, { id: 'w2', jobKey: 'W', date: '2026-10-31' }]
    expect(rainDayMoves(w, '2026-10-30', 1, MON_THU, new Set(['W'])).map(x => x.to)).toEqual(['2026-10-31', '2026-11-01'])
  })
  it('a day left on a Friday after Friday was switched off is not a weekend job: it moves onto crew days', () => {
    const f = [{ id: 'f1', jobKey: 'F', date: '2026-10-30' }, { id: 'f2', jobKey: 'F', date: '2026-11-02' }]
    expect(rainDayMoves(f, '2026-10-30', 1, MON_THU).map(x => x.to)).toEqual(['2026-11-02', '2026-11-03'])
  })
  it('nothing on or after the day: nothing moves', () => {
    expect(rainDayMoves(booked, '2026-11-20', 1, MON_THU)).toEqual([])
  })
})

describe('warnings before booking', () => {
  const ready = { permitStatus: 'approved', locatesDate: '2026-10-20', locatesExpDate: '2026-11-19', deposit: 'paid' as const, materialsStatus: 'ordered' }
  it('nothing when everything is ready', () => {
    expect(scheduleWarnings(ready, '2026-11-02', '2026-11-04')).toEqual([])
    expect(scheduleWarnings({ ...ready, permitStatus: 'not_needed' }, '2026-11-02', '2026-11-04')).toEqual([])
  })
  it('permit not issued, 811 missing, deposit not paid, materials not ordered', () => {
    const w = scheduleWarnings({ permitStatus: 'needed', locatesDate: null, locatesExpDate: null, deposit: 'unpaid', materialsStatus: 'not_ordered' }, '2026-11-02', '2026-11-04')
    expect(w.map(x => x.key)).toEqual(['permit', 'locates', 'deposit', 'materials'])
    expect(scheduleWarnings({ ...ready, permitStatus: null }, '2026-11-02', '2026-11-02')[0].text).toMatch(/No permit/)
  })
  it('811 ticket expired before the start, or running out before the last crew day', () => {
    expect(scheduleWarnings({ ...ready, locatesExpDate: '2026-11-01' }, '2026-11-02', '2026-11-04')[0].text).toBe('The 811 ticket ran out on 11/01/2026, before the install starts.')
    expect(scheduleWarnings({ ...ready, locatesExpDate: '2026-11-03' }, '2026-11-02', '2026-11-04')[0].text).toMatch(/before the last crew day \(11\/04\/2026\)/)
    expect(locatesWords({ locatesDate: '2026-09-01', locatesExpDate: '2026-10-01' }, '2026-10-24').state).toBe('expired')
  })
})

describe('the customer\'s text', () => {
  it('is the schedule confirmation, word for word', () => {
    expect(installText('scheduled', { company: 'Getter Done Fence', firstName: 'Kristi', start: '2026-11-02', phone: '(352) 789 4314' }))
      .toBe('Getter Done Fence: Hi Kristi, your fence installation is scheduled to start on 11/02/2026. Our crew will arrive in the morning. Questions? Call (352) 789 4314. Reply STOP to opt out.')
  })
  it('a move says the new start', () => {
    expect(installText('moved', { company: 'Getter Done Fence', firstName: 'Kristi', start: '2026-11-09', phone: '(352) 789 4314' }))
      .toMatch(/^Getter Done Fence: Hi Kristi, your fence installation has moved and is now scheduled to start on 11\/09\/2026\. .* Reply STOP to opt out\.$/)
  })
  it('gives the rep\'s Direct phone, else the company phone; never the personal cell', () => {
    expect(customerPhoneToGive('3525551234', '3527894314')).toEqual({ phone: '(352) 555 1234', from: 'rep' })
    expect(customerPhoneToGive(null, '352-789-4314')).toEqual({ phone: '(352) 789 4314', from: 'company' })
    expect(customerPhoneToGive('(352) 598-9785', '3527894314')).toEqual({ phone: '(352) 789 4314', from: 'company' })
    expect(customerPhoneToGive('', '+1 352 598 9785').phone).toBe('')
  })
  it('MM/DD/YYYY', () => { expect(usDate('2026-01-05')).toBe('01/05/2026') })
  it('taken off the schedule: the customer is told the date is changing (prepared only)', () => {
    expect(installText('off', { company: 'Getter Done Fence', firstName: 'Kristi', start: '2026-12-03', phone: '(352) 789 4314' }))
      .toBe('Getter Done Fence: Hi Kristi, your fence installation date is being changed. We\'ll call you with a new date. Questions? Call (352) 789 4314. Reply STOP to opt out.')
  })
})

describe('holidays (warned and shown on the calendar; still bookable)', () => {
  it('the federal holidays plus Christmas Eve and New Year\'s Eve, worked out per year', () => {
    const h = holidaysOf(2026)
    expect(h['2026-11-26']).toBe('Thanksgiving')
    expect(h['2026-09-07']).toBe('Labor Day')
    expect(h['2026-05-25']).toBe('Memorial Day')
    expect(h['2026-01-19']).toBe('Martin Luther King Jr. Day')
    expect(h['2026-02-16']).toBe('Presidents’ Day')
    expect(h['2026-10-12']).toBe('Columbus Day')
    expect(holidayOn('2026-12-24')).toBe('Christmas Eve')
    expect(holidayOn('2026-12-25')).toBe('Christmas')
    expect(holidayOn('2026-12-31')).toBe('New Year’s Eve')
    expect(holidayOn('2027-07-04')).toBe('Independence Day')
    expect(holidayOn('2027-11-25')).toBe('Thanksgiving')
    expect(holidayOn('2026-12-23')).toBeNull()
  })
})

describe('double booking', () => {
  it('the same crew\'s other installs on the days, once per day and job; not its own days, not another crew, not a finished one', () => {
    const board = [
      { id: '1', stagingJobId: 'kristi', clientName: 'Kristi Murphy', crewId: 'c1', date: '2026-12-16' },
      { id: '2', stagingJobId: 'kristi', clientName: 'Kristi Murphy', crewId: 'c1', date: '2026-12-17' },
      { id: '3', stagingJobId: 'rick', clientName: 'Rick Rocco', crewId: 'c1', date: '2026-12-15' },
      { id: '4', stagingJobId: 'other', clientName: 'Other Crew Job', crewId: 'c2', date: '2026-12-16' },
      { id: '5', stagingJobId: 'done', clientName: 'Done Job', crewId: 'c1', date: '2026-12-16', status: 'Complete' },
    ]
    expect(crewConflicts(board, 'rick', 'c1', ['2026-12-15', '2026-12-16', '2026-12-17'])).toEqual([{ date: '2026-12-16', clientName: 'Kristi Murphy' }, { date: '2026-12-17', clientName: 'Kristi Murphy' }])
    expect(crewConflicts(board, 'rick', 'c2', ['2026-12-15'])).toEqual([])
  })
})

describe('words follow the real crew days', () => {
  it('never "Monday to Friday" when it is Monday to Thursday', () => {
    expect(weekWords(crewDaysOfWeek([1, 2, 3, 4]))).toBe('Monday to Thursday')
    expect(weekWords(crewDaysOfWeek([0, 1, 2, 3, 4, 5, 6]))).toBe('Monday to Friday')
    expect(weekWords([1, 2, 4])).toBe('Monday, Tuesday and Thursday')
    expect(shortDayWords('2026-12-03')).toBe('Thu 12/3')
  })
})

describe('the stage a job really is in (take off, when the stage before booking is not known)', () => {
  it('never claims a step that is not done', async () => {
    const { waitingStageFor } = await import('../src/server/lib/installScheduling')
    const { START_OPS_STAGES: st } = await import('../src/server/lib/opsStageModel')
    expect(waitingStageFor(st, { locatesDate: null, materialsStatus: 'received' }, 'approved')).toBe('awaiting_locates')
    expect(waitingStageFor(st, { locatesDate: '2026-11-01', materialsStatus: 'received' }, 'needed')).toBe('permit_pending')
    expect(waitingStageFor(st, { locatesDate: '2026-11-01', materialsStatus: 'not_ordered' }, null)).toBe('permit_pending')
    expect(waitingStageFor(st, { locatesDate: '2026-11-01', materialsStatus: 'not_ordered' }, 'not_needed')).toBe('need_drawing')
    expect(waitingStageFor(st, { locatesDate: '2026-11-01', materialsStatus: 'ordered' }, 'approved')).toBe('materials_ordered')
    expect(waitingStageFor(st, { locatesDate: '2026-11-01', materialsStatus: 'loaded' }, 'passed')).toBe('ready_to_pull')
  })
})
