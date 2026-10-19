/**
 * Booking times (apps/web/src/bookingPlanner.ts), with a fake clock and fake
 * drive times: Jonathan's Oct 19 report (11:15 AM, Ashley Rozicki at 5 PM in
 * Ocala, booking Brenda Madsen in Dunnellon), a gap between two appointments,
 * an empty day from home base, typed times that clash, the time grid, other
 * days nearby, and address mismatches.
 */
import { describe, test, expect } from 'vitest'
import {
  dayInput, checkStart, bestTimes, timeGrid, warningsFor, explain, otherDays, timeline, parseTypedTime,
  clock, duration, differentStreets, estimateDriveMinutes, type DriveFn,
} from '../../web/src/bookingPlanner'
import { floridaTime, floridaHM, withDefaults, type Appointment } from '../../web/src/appointmentLogic'

// Places are fake points; the drive between them is a table.
const HOME = { lat: 1, lng: 1 }, BRENDA = { lat: 2, lng: 2 }, ASHLEY = { lat: 3, lng: 3 }, SMITH = { lat: 4, lng: 4 }
const NEAR = { lat: 5, lng: 5 }, PAT = { lat: 6, lng: 6 }, FAR = { lat: 7, lng: 7 }
const key = (p: { lat: number }) => String(p.lat)
const TABLE: Record<string, number> = {
  '1-2': 50, '2-3': 46, '1-3': 30,                // home, Brenda (Dunnellon), Ashley (Ocala)
  '4-5': 10, '5-3': 20, '4-3': 25, '1-5': 40, '1-4': 30,
  '4-2': 8, '6-2': 5, '7-2': 40, '1-6': 45, '1-7': 20, '6-7': 40,
}
const drive: DriveFn = (a, b) => {
  if (key(a) === key(b)) return 0
  const m = TABLE[`${key(a)}-${key(b)}`] ?? TABLE[`${key(b)}-${key(a)}`]
  if (m == null) throw new Error(`no fake drive ${key(a)}-${key(b)}`)
  return m
}

const PERSON = 'Jonathan Bohdal'
const S = withDefaults({ slotStart: '07:00', slotEnd: '18:00', bufferMinutes: 15, slotDays: [1, 2, 3, 4, 5, 6], team: [{ name: PERSON, isDefault: true, homeBase: '1 Home Rd, Ocklawaha, FL', homeLat: HOME.lat, homeLng: HOME.lng }] })
const MON = '2026-10-19', TUE = '2026-10-20', WED = '2026-10-21', THU = '2026-10-22'
const at = (date: string, hm: string) => floridaTime(date, hm).toISOString()

function appt(name: string, date: string, from: string, to: string, p: { lat: number; lng: number } | null, over: Partial<Appointment> = {}) {
  return {
    id: name, startAt: at(date, from), endAt: at(date, to), allDay: false, assignedTo: PERSON, status: 'scheduled' as const,
    lat: p?.lat ?? null, lng: p?.lng ?? null, customerName: name, ...over,
  }
}
const hms = (opts: Array<{ time: string }>) => opts.map(o => o.time)
const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }

describe("(a) Jonathan's report: 11:15 AM, Ashley at 5 PM in Ocala, booking Dunnellon", () => {
  const now = floridaTime(MON, '11:15')
  const d = dayInput({ date: MON, minutes: 60, target: BRENDA, person: PERSON, appointments: [appt('Ashley Rozicki', MON, '17:00', '18:00', ASHLEY)], settings: S, now, drive })
  const opts = bestTimes(d)

  test('three options, never before now plus the drive (11:15 + 50 min, rounded up to 12:15)', () => {
    expect(opts).toHaveLength(3)
    for (const o of opts) expect(minutes(o.time)).toBeGreaterThanOrEqual(minutes('12:15'))
  })
  test('each leaves the 15 minute gap and the 46 minute drive to Ashley before 5:00', () => {
    for (const o of opts) expect(o.end + 15 + 46).toBeLessThanOrEqual(minutes('17:00'))
  })
  test('15 minute steps', () => { for (const o of opts) expect(o.start % 15).toBe(0) })
  test('ranked: least dead time before Ashley first, labeled Best', () => {
    expect(hms(opts)).toEqual(['14:45', '13:45', '12:45'])
    expect(opts.map(o => o.best)).toEqual([true, false, false])
  })
  test('a narrow window still gives three choices, half an hour apart', () => {
    const d90 = dayInput({ date: MON, minutes: 90, target: BRENDA, person: PERSON, appointments: [appt('Ashley Rozicki', MON, '17:00', '18:00', ASHLEY)], settings: S, now, drive })
    expect(hms(bestTimes(d90))).toEqual(['14:15', '13:45', '12:45'])
  })
  test('each explains itself in one line', () => {
    expect(opts[0].line).toBe('Leave home 1:55 · 50 min drive · 2:45 to 3:45 · then 46 min to Ashley Rozicki (5:00) · 14 min to spare before Ashley')
    expect(explain(checkStart(d, minutes('13:00')), d)).toBe('Leave home 12:10 · 50 min drive · 1:00 to 2:00 · then 46 min to Ashley Rozicki (5:00) · 2 hr free before Ashley')
  })
  test('the 6:16 PM the old time box filled itself with is flagged three ways', () => {
    const w = warningsFor(d, '18:16')
    expect(w.some(x => /Not enough time to get here from Ashley Rozicki/.test(x))).toBe(true)
    expect(w.some(x => /after work hours/.test(x))).toBe(true)
  })
  test('the timeline shows the drive from home, this one, the drive to Ashley, and Ashley at her real time', () => {
    const t = timeline(d, '14:45')
    expect(t.map(s => [s.kind, clock(s.start), clock(s.end)])).toEqual([
      ['drive', '1:55', '2:45'], ['new', '2:45', '3:45'], ['drive', '3:45', '4:31'], ['appointment', '5:00', '6:00'],
    ])
    expect(t[3].label).toBe('5:00 Ashley Rozicki')
  })
})

describe('(b) two appointments with a gap', () => {
  const now = floridaTime(MON, '08:00')
  const list = [appt('Smith', TUE, '09:00', '10:00', SMITH), appt('Ashley Rozicki', TUE, '14:00', '15:00', ASHLEY)]
  const d = dayInput({ date: TUE, minutes: 60, target: NEAR, person: PERSON, appointments: list, settings: S, now, drive })
  test('fills the gap (it was dead time anyway) before the end of the day', () => {
    const opts = bestTimes(d)
    expect(hms(opts)).toEqual(['10:30', '11:30', '15:45'])
    expect(opts[0].line).toBe('After Smith (ends 10:00) · 10 min drive · 10:30 to 11:30 · then 20 min to Ashley Rozicki (2:00) · 1 hr 55 min free before Ashley')
  })
  test('the gap: nothing before 10:25 (Smith ends 10:00, 15 min gap, 10 min drive), nothing ending after 13:25', () => {
    expect(checkStart(d, minutes('10:15')).ok).toBe(false)
    expect(checkStart(d, minutes('10:30')).ok).toBe(true)
    expect(checkStart(d, minutes('12:15')).ok).toBe(true)
    expect(checkStart(d, minutes('12:30')).ok).toBe(false)
  })
})

describe('(c) a day with nothing booked, from home base', () => {
  const d = dayInput({ date: TUE, minutes: 60, target: NEAR, person: PERSON, appointments: [], settings: S, now: floridaTime(MON, '16:00'), drive })
  test('first time is after leaving home at 7:00 (40 min drive): 8:00, labeled with the leave time', () => {
    const opts = bestTimes(d)
    expect(hms(opts)).toEqual(['08:00', '09:00', '10:00'])
    expect(opts[0].line).toBe('Leave home 7:20 · 40 min drive · 8:00 to 9:00')
    expect(checkStart(d, minutes('07:30')).problems.join()).toMatch(/leave home at 6:50, before work hours/)
  })
  test('no home base: from the start of work hours', () => {
    const noHome = withDefaults({ ...S, team: [{ name: PERSON, isDefault: true }] })
    const d2 = dayInput({ date: TUE, minutes: 60, target: NEAR, person: PERSON, appointments: [], settings: noHome, now: floridaTime(MON, '16:00'), drive })
    expect(bestTimes(d2)[0].time).toBe('07:00')
    expect(bestTimes(d2)[0].line).toBe('No home base set · 7:00 to 8:00')
  })
  test('within work hours: never ends after 6:00', () => {
    for (const c of timeGrid(d).filter(x => x.ok)) expect(c.start + 60).toBeLessThanOrEqual(minutes('18:00'))
    expect(checkStart(d, minutes('17:15')).problems.join()).toMatch(/after work hours/)
  })
})

describe('(d) a typed time that clashes, and the time grid', () => {
  const now = floridaTime(MON, '11:15')
  const d = dayInput({ date: MON, minutes: 60, target: BRENDA, person: PERSON, appointments: [appt('Ashley Rozicki', MON, '17:00', '18:00', ASHLEY)], settings: S, now, drive })
  test('typed times get a plain warning', () => {
    expect(warningsFor(d, '17:30')[0]).toBe('Clashes with Ashley Rozicki (5:00 to 6:00)')
    expect(warningsFor(d, '16:00')[0]).toMatch(/^Not enough time to drive to Ashley Rozicki \(46 min drive \+ 15 min gap; they're at 5:00\)/)
    expect(warningsFor(d, '10:00')).toContain('Already past')
    expect(warningsFor(d, '11:45').join()).toMatch(/Can't get there by then: it's 11:15 and the drive is 50 min/)
    expect(warningsFor(d, '14:45')).toEqual([])
  })
  test('the grid: every 15 minutes inside work hours, greyed with the reason', () => {
    const g = timeGrid(d)
    expect(g[0].time).toBe('07:00'); expect(g[g.length - 1].time).toBe('17:45'); expect(g).toHaveLength(44)
    const cell = (t: string) => g.find(c => c.time === t)!
    expect(cell('10:00')).toMatchObject({ ok: false, short: 'past' })
    expect(cell('12:00')).toMatchObject({ ok: false, short: 'too soon' })
    expect(cell('14:45')).toMatchObject({ ok: true })
    expect(cell('15:00')).toMatchObject({ ok: false, short: 'to Ashley' })
    expect(cell('17:00')).toMatchObject({ ok: false, short: 'Ashley 5:00' })
    expect(cell('17:00').reason).toMatch(/Clashes with Ashley Rozicki/)
  })
  test('a day already gone offers nothing', () => {
    const past = dayInput({ date: '2026-10-16', minutes: 60, target: BRENDA, person: PERSON, appointments: [], settings: S, now, drive })
    expect(bestTimes(past)).toEqual([])
  })
})

describe('other days this week, near this address', () => {
  const now = floridaTime(MON, '11:15')
  const jobs = [{ id: 'j1', customerName: 'Smith', lat: SMITH.lat, lng: SMITH.lng, scheduledDate: TUE, scheduledEndDate: TUE, status: 'scheduled' }]
  const list = [appt('Pat Lee', THU, '10:00', '11:00', PAT), appt('Far Away', WED, '10:00', '11:00', FAR)]
  const o = otherDays({ date: MON, minutes: 60, target: BRENDA, person: PERSON, appointments: list, jobs, settings: S, now, drive })
  test('a scheduled job 8 min away on Tuesday, and an appointment 5 min away on Thursday, nearest first', () => {
    expect(o.map(x => x.line)).toEqual(['Thu 11:30 · 5 min from Pat Lee', 'Tue 8:00 · 8 min from Smith job'])
  })
  test('the Thursday time sits next to Pat Lee (11:00 end + 15 gap + 5 drive, next quarter hour)', () => {
    expect(floridaHM(o[0].startAt)).toBe('11:30')
  })
  test('nothing when nowhere near, or no address on the map', () => {
    expect(otherDays({ date: MON, minutes: 60, target: BRENDA, person: PERSON, appointments: [list[1]], jobs: [], settings: S, now, drive })).toEqual([])
    expect(otherDays({ date: MON, minutes: 60, target: null, person: PERSON, appointments: list, jobs, settings: S, now, drive })).toEqual([])
  })
})

describe('words and parsing', () => {
  test('typed times', () => {
    expect(parseTypedTime('2')).toBe('14:00')
    expect(parseTypedTime('9')).toBe('09:00')
    expect(parseTypedTime('2:30')).toBe('14:30')
    expect(parseTypedTime('230p')).toBe('14:30')
    expect(parseTypedTime('10:15 am')).toBe('10:15')
    expect(parseTypedTime('12')).toBe('12:00')
    expect(parseTypedTime('16:10')).toBe('16:10')
    expect(parseTypedTime('6:16 PM')).toBe('18:16')
    expect(parseTypedTime('soon')).toBeNull()
    expect(parseTypedTime('13pm')).toBeNull()
  })
  test('clock and durations', () => {
    expect(clock(minutes('12:10'))).toBe('12:10'); expect(clock(minutes('17:00'))).toBe('5:00')
    expect(duration(119)).toBe('2 hr'); expect(duration(75)).toBe('1 hr 15 min'); expect(duration(14)).toBe('14 min')
  })
  test('the free drive estimate: straight line x 1.25 at 30 mph (home in Ocklawaha to Dunnellon, about an hour)', () => {
    const m = estimateDriveMinutes({ lat: 29.04, lng: -81.93 }, { lat: 29.06345, lng: -82.351852 }, 30)
    expect(m).toBeGreaterThan(55); expect(m).toBeLessThan(75)
  })
})

describe('addresses on different streets', () => {
  test("Brenda Madsen's two addresses", () => {
    expect(differentStreets('10976 SW 139th Court Rd, Dunnellon, FL 34432', '10976 SW 136th Ct Dunnellon, FL 34432')).toBe(true)
  })
  test('the same street written two ways, or another house number, is not flagged', () => {
    expect(differentStreets('17008 SE 60th St, Ocklawaha, FL 32179', '17008 Southeast 60th Street, Ocklawaha')).toBe(false)
    expect(differentStreets('17008 SE 60th St', '17010 SE 61st St')).toBe(false)
    expect(differentStreets('10976 SW 139th Ct', '10976 SW 139th Ct Rd')).toBe(true)
  })
})
