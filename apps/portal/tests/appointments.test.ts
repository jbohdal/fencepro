/**
 * Appointments: open slot suggestions, overlap warnings, what statuses and
 * outcomes do to the pipeline card, reading a call back time said on the
 * phone, and the confirmation Jonathan sends himself.
 */
import { describe, test, expect } from 'vitest'
import {
  suggestSlots, overlapWarnings, stageAfterBooking, stageAfterOutcome, statusForOutcome, needsOutcome, nextFor, isOpen,
  floridaTime, floridaDate, floridaHM, confirmationText, onMyWayText, smsLink, buildIcs, routeUrl, directionsUrl,
  DEFAULT_APPOINTMENT_SETTINGS, withDefaults, APPOINTMENT_TYPES as WEB_TYPES, APPOINTMENT_STATUSES as WEB_STATUSES,
  APPOINTMENT_OUTCOMES as WEB_OUTCOMES, type Appointment,
} from '../../web/src/appointmentLogic'
import { parseCallbackTime, APPOINTMENT_TYPES, APPOINTMENT_STATUSES, APPOINTMENT_OUTCOMES, addressKey } from '../src/server/lib/appointments'

const S = DEFAULT_APPOINTMENT_SETTINGS
const STAGES = ['First Contact', 'Appointment', 'Estimating', 'Pending Signature', 'Signed Contract', 'Paid & Closed', 'Lost Sale', 'No Answer']
// Belleview and Ocala, about 10 miles apart; Dunnellon about 25 miles west.
const BELLEVIEW = { lat: 29.0553, lng: -82.0623 }, OCALA = { lat: 29.1872, lng: -82.1401 }, DUNNELLON = { lat: 29.0491, lng: -82.4609 }

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1', crmContactId: 'c1', quoteId: null, jobId: null, type: 'estimate', status: 'scheduled',
    startAt: floridaTime('2026-10-20', '10:00').toISOString(), endAt: floridaTime('2026-10-20', '11:00').toISOString(), allDay: false,
    address: '1 Main St, Belleview, FL', lat: BELLEVIEW.lat, lng: BELLEVIEW.lng, assignedTo: 'Jonathan Bohdal', notes: '',
    outcome: null, outcomeNotes: '', measuredFeet: null, nextStep: '', history: [], source: 'manual', version: 1,
    startedAt: null, completedAt: null, createdAt: '2026-10-01T00:00:00Z', customerName: 'Pat Lee', customerPhone: '(352) 555-0123', customerEmail: 'pat@example.com',
    ...over,
  }
}
const NOW = new Date('2026-10-14T12:00:00Z')
const hm = (iso: string) => floridaHM(iso)

describe('the server and the browser agree on the names', () => {
  test('types, statuses and outcomes', () => {
    expect([...APPOINTMENT_TYPES]).toEqual([...WEB_TYPES])
    expect([...APPOINTMENT_STATUSES]).toEqual([...WEB_STATUSES])
    expect([...APPOINTMENT_OUTCOMES]).toEqual([...WEB_OUTCOMES])
  })
})

describe('Florida time', () => {
  test('wall clock times survive daylight saving', () => {
    expect(floridaTime('2026-10-20', '10:00').toISOString()).toBe('2026-10-20T14:00:00.000Z')   // EDT
    expect(floridaTime('2026-12-01', '10:00').toISOString()).toBe('2026-12-01T15:00:00.000Z')   // EST
    expect(floridaDate('2026-10-21T02:00:00Z')).toBe('2026-10-20')                            // 10 pm the night before
  })
})

describe('suggested slots', () => {
  test('a free day: the three earliest that do not overlap, inside the hours in Settings', () => {
    const s = suggestSlots({ date: '2026-10-20', minutes: 60, person: 'Jonathan Bohdal', target: OCALA, appointments: [], settings: S, now: NOW })
    expect(s.map(x => hm(x.startAt))).toEqual(['07:00', '08:00', '09:00'])
  })
  test('no suggestions on a day Settings leaves out (Sunday by default), and Settings can change that', () => {
    expect(suggestSlots({ date: '2026-10-18', minutes: 60, person: 'Jonathan Bohdal', target: null, appointments: [], settings: S, now: NOW })).toEqual([])
    const sundays = withDefaults({ slotDays: [0], slotStart: '12:00', slotEnd: '15:00' })
    expect(suggestSlots({ date: '2026-10-18', minutes: 60, person: 'Jonathan Bohdal', target: null, appointments: [], settings: sundays, now: NOW }).map(x => hm(x.startAt))).toEqual(['12:00', '13:00', '14:00'])
  })
  test('never overlaps the person\'s appointments, and leaves time to drive', () => {
    const busy = [appt({ id: 'b', startAt: floridaTime('2026-10-20', '09:00').toISOString(), endAt: floridaTime('2026-10-20', '10:00').toISOString(), lat: DUNNELLON.lat, lng: DUNNELLON.lng })]
    const s = suggestSlots({ date: '2026-10-20', minutes: 60, person: 'Jonathan Bohdal', target: BELLEVIEW, appointments: busy, settings: S, now: NOW })
    for (const x of s) {
      const start = new Date(x.startAt).getTime(), end = new Date(x.endAt).getTime()
      const bs = new Date(busy[0].startAt!).getTime(), be = new Date(busy[0].endAt!).getTime()
      expect(start >= be + 30 * 60_000 || end <= bs - 30 * 60_000).toBe(true)   // Dunnellon to Belleview is well over half an hour
    }
  })
  test('prefers the slot next to an appointment in the same area', () => {
    const busy = [
      appt({ id: 'near', startAt: floridaTime('2026-10-20', '13:00').toISOString(), endAt: floridaTime('2026-10-20', '14:00').toISOString(), lat: BELLEVIEW.lat + 0.01, lng: BELLEVIEW.lng, customerName: 'Next Door' }),
    ]
    const s = suggestSlots({ date: '2026-10-20', minutes: 60, person: 'Jonathan Bohdal', target: BELLEVIEW, appointments: busy, settings: S, now: NOW, count: 1 })
    expect(s).toHaveLength(1)
    expect(['11:45', '14:15']).toContain(hm(s[0].startAt))
    expect(s[0].reason).toMatch(/Next Door/)
  })
  test('someone else\'s appointments and cancelled ones do not take time', () => {
    const others = [appt({ assignedTo: 'Stacy Mcgovern', startAt: floridaTime('2026-10-20', '07:00').toISOString(), endAt: floridaTime('2026-10-20', '12:00').toISOString() }),
      appt({ id: 'x', status: 'cancelled', startAt: floridaTime('2026-10-20', '07:00').toISOString(), endAt: floridaTime('2026-10-20', '12:00').toISOString() })]
    expect(hm(suggestSlots({ date: '2026-10-20', minutes: 60, person: 'Jonathan Bohdal', target: null, appointments: others, settings: S, now: NOW })[0].startAt)).toBe('07:00')
  })
  test('nothing in the past on today', () => {
    const s = suggestSlots({ date: '2026-10-20', minutes: 60, person: 'Jonathan Bohdal', target: null, appointments: [], settings: S, now: floridaTime('2026-10-20', '14:10') })
    expect(hm(s[0].startAt)).toBe('14:45')
  })
})

describe('overlap warnings', () => {
  const list = [appt({ id: 'b', customerName: 'Shawn Hart' })]
  test('double booking a person is a warning, not a block', () => {
    const w = overlapWarnings({ startAt: floridaTime('2026-10-20', '10:30').toISOString(), endAt: floridaTime('2026-10-20', '11:30').toISOString(), person: 'Jonathan Bohdal', customerId: 'c9' }, list)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/Shawn Hart/)
  })
  test('back to back, another person, or a cancelled one is fine', () => {
    expect(overlapWarnings({ startAt: floridaTime('2026-10-20', '11:00').toISOString(), endAt: floridaTime('2026-10-20', '12:00').toISOString(), person: 'Jonathan Bohdal', customerId: 'c9' }, list)).toEqual([])
    expect(overlapWarnings({ startAt: floridaTime('2026-10-20', '10:30').toISOString(), endAt: floridaTime('2026-10-20', '11:30').toISOString(), person: 'Stacy Mcgovern', customerId: 'c9' }, list)).toEqual([])
    expect(overlapWarnings({ startAt: floridaTime('2026-10-20', '10:30').toISOString(), endAt: floridaTime('2026-10-20', '11:30').toISOString(), person: 'Jonathan Bohdal', customerId: 'c9' }, [appt({ status: 'cancelled' })])).toEqual([])
  })
})

describe('status changes and the pipeline', () => {
  test('booking an estimate moves an earlier card to Appointment, never backwards', () => {
    expect(stageAfterBooking('First Contact', 'estimate', STAGES)).toBe('Appointment')
    expect(stageAfterBooking('Appointment', 'estimate', STAGES)).toBeNull()
    expect(stageAfterBooking('Estimating', 'estimate', STAGES)).toBeNull()
    expect(stageAfterBooking('First Contact', 'follow_up', STAGES)).toBeNull()
    expect(stageAfterBooking(null, 'estimate', STAGES)).toBeNull()
  })
  test('Ready to quote moves to Estimating; Not interested offers Lost Sale; others leave the card', () => {
    expect(stageAfterOutcome('Appointment', 'ready_to_quote', STAGES)).toEqual({ move: 'Estimating' })
    expect(stageAfterOutcome('Pending Signature', 'ready_to_quote', STAGES)).toEqual({})
    expect(stageAfterOutcome('Appointment', 'not_interested', STAGES)).toEqual({ offer: 'Lost Sale' })
    expect(stageAfterOutcome('Appointment', 'needs_follow_up', STAGES)).toEqual({})
  })
  test('an outcome closes the appointment: No show as No show, the rest as Completed', () => {
    expect(statusForOutcome('no_show')).toBe('no_show')
    expect(statusForOutcome('ready_to_quote')).toBe('completed')
    expect(isOpen({ status: 'rescheduled' })).toBe(true)
    expect(isOpen({ status: 'completed' })).toBe(false)
  })
  test('needs an outcome: over and still open; imported history never does', () => {
    const later = new Date('2026-10-21T12:00:00Z')
    expect(needsOutcome(appt(), later)).toBe(true)
    expect(needsOutcome(appt(), NOW)).toBe(false)
    expect(needsOutcome(appt({ status: 'completed' }), later)).toBe(false)
    expect(needsOutcome(appt({ source: 'import' }), later)).toBe(false)
    expect(needsOutcome(appt({ startAt: null, endAt: null }), later)).toBe(false)
  })
  test('the next appointment is the soonest still to come', () => {
    const list = [appt({ id: 'late', startAt: floridaTime('2026-10-25', '09:00').toISOString(), endAt: null }), appt({ id: 'soon' }), appt({ id: 'gone', status: 'cancelled', startAt: floridaTime('2026-10-15', '09:00').toISOString() })]
    expect(nextFor('c1', list, NOW)?.id).toBe('soon')
    expect(nextFor('c2', list, NOW)).toBeNull()
  })
})

describe('call back times said on the phone', () => {
  const at = new Date('2026-10-14T15:00:00Z')   // Wednesday 11 am in Florida
  test('clear times are read', () => {
    expect(parseCallbackTime('tomorrow at 3 pm', at)?.toISOString()).toBe('2026-10-15T19:00:00.000Z')
    expect(parseCallbackTime('Friday 10am', at)?.toISOString()).toBe('2026-10-16T14:00:00.000Z')
    expect(parseCallbackTime('2026-10-20 14:30', at)?.toISOString()).toBe('2026-10-20T18:30:00.000Z')
    expect(parseCallbackTime('today at 4:15 p.m.', at)?.toISOString()).toBe('2026-10-14T20:15:00.000Z')
  })
  test('anything unclear waits for a date', () => {
    expect(parseCallbackTime('sometime next week', at)).toBeNull()
    expect(parseCallbackTime('afternoon', at)).toBeNull()
    expect(parseCallbackTime('', at)).toBeNull()
    expect(parseCallbackTime('2026-01-01 10:00', at)).toBeNull()   // already past
  })
  test('addresses match however they are typed', () => {
    expect(addressKey('123 Main St., Ocala,  FL')).toBe(addressKey('123 main st ocala fl'))
  })
})

describe('what Jonathan sends himself', () => {
  const company = { name: 'Getter Done Fence', phone: '(352) 789-4314' }
  test('the confirmation has the day, time, address and phone', () => {
    const t = confirmationText(appt(), company)
    expect(t).toBe('Hi Pat, this is Jonathan with Getter Done Fence. You\'re all set for your fence estimate on Tuesday, October 20 at 10:00 AM at 1 Main St, Belleview, FL. If anything changes, call or text (352) 789-4314.')
    expect(smsLink('(352) 555-0123', 'hi there')).toBe('sms:3525550123?body=hi%20there')
  })
  test('the on my way text', () => {
    expect(onMyWayText('Pat Lee', 17.4, company)).toBe('Hi Pat, this is Jonathan with Getter Done Fence, I\'m on my way and should be there in about 17 minutes.')
  })
  test('the calendar invite is a valid event in UTC', () => {
    const ics = buildIcs(appt(), company, new Date('2026-10-14T12:00:00Z'))
    expect(ics).toContain('DTSTART:20261020T140000Z')
    expect(ics).toContain('DTEND:20261020T150000Z')
    expect(ics).toContain('LOCATION:1 Main St\\, Belleview\\, FL')
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR')
  })
  test('directions and the day\'s route open Google Maps without a key', () => {
    expect(directionsUrl(appt())).toBe('https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Belleview%2C%20FL')
    expect(routeUrl([appt(), appt({ address: '2 Oak Ave, Ocala, FL' })])).toBe('https://www.google.com/maps/dir//1%20Main%20St%2C%20Belleview%2C%20FL/2%20Oak%20Ave%2C%20Ocala%2C%20FL')
  })
})
