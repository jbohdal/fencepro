/**
 * The customer page after the independent review (Oct 26 2026):
 * the Balance due tile never says "Nothing owed" for a signed job without a
 * payment schedule; the Billing words start with a capital; Activity dates
 * carry the year; portal messages say who wrote them; the header goes compact
 * when scrolled; photos newest first; photo requests on their own limit; note
 * authors by name. (apps/web/src/customerPage.ts, lib/rateLimitRules.ts,
 * lib/followUps.ts noteAuthorName.)
 */
import { describe, test, expect } from 'vitest'
import {
  balanceTile, withoutScheduleWords, historyWhen, portalSenderLabel, nextCompact, COMPACT_AT, FULL_AT, newestFirst,
} from '../../web/src/customerPage'
import { isMediaTraffic } from '../src/server/lib/rateLimitRules'
import { noteAuthorName } from '../src/server/lib/followUps'

describe('Balance due tile', () => {
  test('a signed job with no payment schedule is never "Nothing owed"', () => {
    // Shawn Collins on dev: sold $7,109, Awaiting Locates, no schedule yet, nothing else owed.
    expect(balanceTile({ loaded: true, balanceCents: 0, withoutSchedule: 1 })).toEqual({ value: 'none', words: 'Not set up', sub: 'No payment schedule yet', attention: true })
    // Owes on one job, two others still have no schedule.
    const both = balanceTile({ loaded: true, balanceCents: 355450, withoutSchedule: 2 })
    expect(both).toMatchObject({ value: 'money', sub: 'Plus 2 signed jobs with no payment schedule yet', attention: true })
  })
  test('"Nothing owed" only when known; loading or no signal show no number', () => {
    expect(balanceTile({ loaded: true, balanceCents: 0, withoutSchedule: 0 })).toMatchObject({ value: 'money', sub: 'Nothing owed', attention: false })
    expect(balanceTile({ loaded: true, balanceCents: 120000, withoutSchedule: 0 })).toMatchObject({ value: 'money', sub: 'Open Billing', attention: true })
    expect(balanceTile({ loaded: null, balanceCents: 0, withoutSchedule: 0 })).toMatchObject({ value: 'none', sub: 'Loading' })
    expect(balanceTile({ loaded: false, balanceCents: 0, withoutSchedule: 0 })).toMatchObject({ value: 'none', sub: 'Needs signal' })
    // Old typed invoices still owed while the schedules load: the number shows.
    expect(balanceTile({ loaded: null, balanceCents: 5000, withoutSchedule: 0 })).toMatchObject({ value: 'money', sub: 'Open Billing' })
  })
})

describe('Billing words for a job signed before payment schedules', () => {
  test('a proper sentence with or without a fence style', () => {
    expect(withoutScheduleWords('')).toBe('Signed before payment schedules. Make its schedule from the contract (deposit and final).')
    expect(withoutScheduleWords('  ')).toMatch(/^Signed before/)
    expect(withoutScheduleWords('6 ft white vinyl privacy')).toBe('6 ft white vinyl privacy: signed before payment schedules. Make its schedule from the contract (deposit and final).')
  })
})

describe('Activity dates', () => {
  const now = new Date('2026-10-26T15:00:00Z')
  test('this year without the year, another year with it (Florida time)', () => {
    expect(historyWhen('2026-10-14T05:09:00Z', now)).toBe('Oct 14, 1:09 AM')
    expect(historyWhen('2024-03-25T16:30:00Z', now)).toBe('Mar 25, 2024, 12:30 PM')
    // 4:30 am UTC on Jan 1 is still Dec 31 in Florida: Florida's year counts.
    expect(historyWhen('2026-01-01T04:30:00Z', now)).toBe('Dec 31, 2025, 11:30 PM')
    expect(historyWhen('not a date', now)).toBe('')
  })
})

describe('portal messages: who wrote it', () => {
  const o = { me: 'Jonathan Bohdal', customerName: 'Shawn Collins', company: 'Getter Done Fence' }
  test('"You", the staff member by name, the customer by name', () => {
    expect(portalSenderLabel({ senderType: 'staff', senderUser: 'Jonathan Bohdal' }, o)).toBe('You')
    expect(portalSenderLabel({ senderType: 'staff', senderUser: 'Christa Feagin' }, o)).toBe('Christa Feagin')
    expect(portalSenderLabel({ senderType: 'customer', senderUser: null }, o)).toBe('Shawn Collins')
    expect(portalSenderLabel({ senderType: 'customer' }, { ...o, customerName: ' ' })).toBe('Customer')
  })
  test('old replies saved as "user" or "staff" (or a login email) show the company, never "user"', () => {
    for (const who of ['user', 'staff', 'User', 'jb@example.com', '', null]) {
      expect(portalSenderLabel({ senderType: 'staff', senderUser: who }, o)).toBe('Getter Done Fence')
    }
  })
})

describe('compact header', () => {
  test('compact past one point, full again only near the top (no flicker in between)', () => {
    expect(nextCompact(false, 0)).toBe(false)
    expect(nextCompact(false, COMPACT_AT)).toBe(false)
    expect(nextCompact(false, COMPACT_AT + 1)).toBe(true)
    expect(nextCompact(true, 40)).toBe(true)
    expect(nextCompact(false, 40)).toBe(false)
    expect(nextCompact(true, FULL_AT)).toBe(false)
    // More apart than the header shrinks by, so getting shorter can never flip it back.
    expect(COMPACT_AT - FULL_AT).toBeGreaterThan(80)
  })
})

describe('photos newest first', () => {
  test('newest at the top; the same time keeps the order given; a date that is not text does not break it', () => {
    const list = [{ k: 'a', takenAt: '2026-10-01T10:00:00Z' }, { k: 'b', takenAt: '2026-10-20T10:00:00Z' }, { k: 'c', takenAt: {} as unknown }, { k: 'd', takenAt: '2026-10-20T10:00:00Z' }]
    expect(newestFirst(list).map(x => x.k)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('request limit: photos on their own', () => {
  test('signed photo, thumbnail and video links and upload chunks', () => {
    expect(isMediaTraffic('GET', '/api/media/f/abc123/thumb?e=1&s=xyz')).toBe(true)
    expect(isMediaTraffic('GET', '/api/media/f/abc123/full?e=1&s=xyz')).toBe(true)
    expect(isMediaTraffic('HEAD', '/api/media/f/abc123/preview')).toBe(true)
    expect(isMediaTraffic('PUT', '/api/media/uploads/9f1c?offset=0')).toBe(true)
  })
  test('everything else stays on the general limit; sign in keeps its own strict one', () => {
    expect(isMediaTraffic('POST', '/api/media/uploads')).toBe(false)
    expect(isMediaTraffic('POST', '/api/media/uploads/9f1c/finish')).toBe(false)
    expect(isMediaTraffic('GET', '/api/media?customerId=x')).toBe(false)
    expect(isMediaTraffic('DELETE', '/api/media/f/abc/thumb')).toBe(false)
    expect(isMediaTraffic('POST', '/api/crm-auth/login')).toBe(false)
    expect(isMediaTraffic('GET', '/api/crm-contacts')).toBe(false)
    expect(isMediaTraffic('GET', '/api/media/f/abc/thumb/../../crm-contacts')).toBe(false)
  })
})

describe('Activity: who wrote a note', () => {
  const users = [
    { id: 'u1', email: 'owner@example.com', firstName: 'Jonathan', lastName: 'Bohdal' },
    { id: 'u2', email: 'office@example.com', firstName: 'Christa', lastName: 'Feagin' },
  ]
  test('by the login it was written with (its id, else the email it saved)', () => {
    expect(noteAuthorName({ createdBy: 'owner@example.com' }, users)).toBe('Jonathan Bohdal')
    expect(noteAuthorName({ createdBy: 'Owner@Example.com' }, users)).toBe('Jonathan Bohdal')
    expect(noteAuthorName({ createdBy: 'whatever', createdById: 'u2' }, users)).toBe('Christa Feagin')
  })
  test('else the name it saved (an import, "Office"); "Staff" only for an unknown email or nothing', () => {
    expect(noteAuthorName({ createdBy: 'MyBudgetQuote import' }, users)).toBe('MyBudgetQuote import')
    expect(noteAuthorName({ createdBy: 'gone@example.com' }, users)).toBe('Staff')
    expect(noteAuthorName({ createdBy: '' }, users)).toBe('Staff')
  })
})
