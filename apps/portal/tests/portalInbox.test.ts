/**
 * The staff's Customer messages bubble (lib/portalInbox.ts). Audit Oct 26
 * 2026: it said "All caught up" with no badge while a customer's message
 * waited: the message had been marked read on another screen seconds after it
 * came in, and read was all it counted.
 */

import { describe, test, expect } from 'vitest'
import { inboxFrom, WAITING_DAYS } from '../src/server/lib/portalInbox.js'

const now = new Date('2026-10-27T01:30:00Z')
const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000)
const msg = (crmCustomerId: string, minAgo: number, senderType: 'customer' | 'staff', isReadByStaff = true, body = 'x') => ({ crmCustomerId, createdAt: at(minAgo), senderType, isReadByStaff, body })

describe('the Customer messages bubble', () => {
  test('a customer\'s message read on another screen, not answered: still flagged, and counted on the badge', () => {
    const r = inboxFrom([msg('walker', 3, 'customer', true, 'one gate latch sticks'), msg('walker', 60 * 24 * 3, 'staff')], now)
    expect(r.totalUnread).toBe(0)
    expect(r.threads[0]).toMatchObject({ crmCustomerId: 'walker', lastBody: 'one gate latch sticks', lastSender: 'customer', waitingReply: true })
    expect(r.totalWaiting).toBe(1)
    expect(r.needsYou).toBe(1)
  })
  test('answered: caught up', () => {
    const r = inboxFrom([msg('walker', 3, 'customer'), msg('walker', 1, 'staff', true, 'we will send someone')], now)
    expect(r.threads[0]).toMatchObject({ lastSender: 'staff', waitingReply: false })
    expect(r.needsYou).toBe(0)
  })
  test('unread counts each message; a thread counts once on the badge', () => {
    const r = inboxFrom([msg('a', 5, 'customer', false), msg('a', 4, 'customer', false), msg('b', 2, 'staff')], now)
    expect(r.totalUnread).toBe(2)
    expect(r.needsYou).toBe(1)
    expect(r.threads.map(t => t.crmCustomerId)).toEqual(['b', 'a'])
  })
  test(`a customer's last word older than ${WAITING_DAYS} days is not waiting any more (a "thanks" left last)`, () => {
    const r = inboxFrom([msg('old', 60 * 24 * (WAITING_DAYS + 1), 'customer')], now)
    expect(r.threads[0].waitingReply).toBe(false)
    expect(r.needsYou).toBe(0)
  })
})
