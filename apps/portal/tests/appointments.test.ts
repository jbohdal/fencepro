/**
 * Appointments (booking times are in bookingPlanner.test.ts): overlap warnings, what statuses and
 * outcomes do to the pipeline card, reading a call back time said on the
 * phone, and the confirmation Jonathan sends himself.
 */
import { START_PIPELINE_STAGES } from '../../web/src/pipelineStageModel'
import { describe, test, expect } from 'vitest'
import {
  overlapWarnings, stageAfterBooking, stageAfterOutcome, statusForOutcome, needsOutcome, nextFor, isOpen,
  floridaTime, floridaDate, floridaHM, smsLink, buildIcs, routeUrl, directionsUrl, visitWords,
  APPOINTMENT_TYPES as WEB_TYPES, APPOINTMENT_STATUSES as WEB_STATUSES,
  APPOINTMENT_OUTCOMES as WEB_OUTCOMES, type Appointment,
} from '../../web/src/appointmentLogic'
import { parseCallbackTime, APPOINTMENT_TYPES, APPOINTMENT_STATUSES, APPOINTMENT_OUTCOMES, addressKey } from '../src/server/lib/appointments'

// Settings > Pipeline Stages as it starts (ids are the old names); the moves go by role, not name.
const STAGES = START_PIPELINE_STAGES
const BELLEVIEW = { lat: 29.0553, lng: -82.0623 }

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
  test('by role, not name: every stage renamed and the roles moved, the moves follow the roles', () => {
    const renamed = STAGES.map(s => ({ ...s, name: `X ${s.name}`, roles: [...s.roles] }))
    // Ready to quote moved from Estimating to Pending Signature; Appointment role off its stage.
    for (const s of renamed) s.roles = s.roles.filter(r => r !== 'ready_to_quote' && r !== 'appointment')
    renamed.find(s => s.id === 'Pending Signature')!.roles.push('ready_to_quote')
    renamed.find(s => s.id === 'Estimating')!.roles.push('appointment')
    expect(stageAfterBooking('First Contact', 'estimate', renamed)).toBe('Estimating')
    expect(stageAfterBooking('Appointment', 'estimate', renamed)).toBe('Estimating')
    expect(stageAfterOutcome('Estimating', 'ready_to_quote', renamed)).toEqual({ move: 'Pending Signature' })
    const lostMoved = renamed.map(s => ({ ...s, roles: s.id === 'Lost Sale' ? [] : s.id === 'No Answer' ? ['lost' as const] : s.roles }))
    expect(stageAfterOutcome('Appointment', 'not_interested', lostMoved)).toEqual({ offer: 'No Answer' })
    // No Appointment stage at all: booking leaves the card.
    expect(stageAfterBooking('First Contact', 'estimate', STAGES.map(s => ({ ...s, roles: s.roles.filter(r => r !== 'appointment') })))).toBeNull()
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
  // The words are templates now: appointmentMessages.test.ts.
  test('the text opens the phone\'s own texting app', () => {
    expect(smsLink('(352) 555-0123', 'hi there')).toBe('sms:3525550123?body=hi%20there')
  })
  test('the calendar invite is a valid event in UTC', () => {
    const ics = buildIcs(appt(), company, 'Questions or changes: call or text Pat at (352) 844 2677.', new Date('2026-10-14T12:00:00Z'))
    expect(ics).toContain('DESCRIPTION:Questions or changes: call or text Pat at (352) 844 2677.')
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

describe('a visit on Today after it was quoted (re-check, Oct 26 2026)', () => {
  const visit = { outcome: 'ready_to_quote' as const, status: 'completed' as const, startAt: '2026-10-26T14:00:00.000Z' }
  test('Ready to quote, then the quote made since: signed, sent, a draft', () => {
    expect(visitWords(visit, [])).toBe('Ready to quote')
    expect(visitWords(visit, [{ status: 'DRAFT', date: '2026-10-26' }])).toBe('Quote started')
    expect(visitWords(visit, [{ status: 'SENT', date: '2026-10-26' }])).toBe('Quoted · Sent')
    expect(visitWords(visit, [{ status: 'SENT', date: '2026-10-26' }, { status: 'SOLD', date: '2026-10-26' }])).toBe('Quoted · Signed')
  })
  test('an older quote of the customer\'s (before the visit) does not count; other outcomes as they were', () => {
    expect(visitWords(visit, [{ status: 'SOLD', date: '2026-09-01' }])).toBe('Ready to quote')
    expect(visitWords({ ...visit, outcome: 'needs_follow_up' }, [{ status: 'SOLD', date: '2026-10-26' }])).toBe('Needs follow up')
    expect(visitWords({ outcome: null, status: 'scheduled', startAt: visit.startAt }, [])).toBe('Scheduled')
  })
})
