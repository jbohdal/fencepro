/**
 * Proposal opens, the rules (no database): device, bots, time per option and
 * the longest one, staff detection, the push triggers and their keys, the
 * history line and the card badge text.
 */
import { describe, test, expect } from 'vitest'
import {
  deviceOf, isBot, mergeBeat, longestOption, openTrigger, staffDecision, durationWords, optionWords,
  viewHistoryItem, openedForCard, proposalSent, MAX_VIEW_MS, REOPEN_MS,
} from '../src/server/lib/proposalViewRules'
import { openedBadgeText, agoWords } from '../../web/src/proposalOpened'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'

describe('device and bots', () => {
  test('a coarse device from the browser name', () => {
    expect(deviceOf(IPHONE)).toBe('iPhone')
    expect(deviceOf(ANDROID)).toBe('Android')
    expect(deviceOf(MAC)).toBe('Computer')
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad')
    expect(deviceOf('')).toBe('Computer')
  })
  test('crawlers and link previews are not opens; phones are', () => {
    for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.23.20.0', 'Slackbot-LinkExpanding 1.0', 'curl/8.4.0', 'python-requests/2.31', '']) expect(isBot(ua)).toBe(true)
    for (const ua of [IPHONE, ANDROID, MAC]) expect(isBot(ua)).toBe(false)
  })
})

describe('time per option and the longest', () => {
  const startedAt = new Date('2026-10-20T15:00:00Z')
  const at = (s: number) => new Date(startedAt.getTime() + s * 1000)
  const empty = { optionMs: {}, activeMs: 0, reachedSignature: false }

  test('the option with the most time wins; under a second is not looked at; ties go to the first', () => {
    expect(longestOption({ '0': 12_000, '1': 95_000, '2': 30_000 })).toEqual({ index: 1, ms: 95_000 })
    expect(longestOption({ '0': 900 })).toBeNull()
    expect(longestOption({})).toBeNull()
    expect(longestOption({ '2': 5000, '1': 5000 })).toEqual({ index: 1, ms: 5000 })
  })

  test('heartbeats carry running totals: sent twice changes nothing, totals only grow', () => {
    const a = mergeBeat(empty, { o: { 0: 4000, 1: 9000 }, a: 13_000 }, { startedAt, now: at(15), optionCount: 3 })
    expect(a).toEqual({ optionMs: { 0: 4000, 1: 9000 }, activeMs: 13_000, reachedSignature: false })
    expect(mergeBeat(a, { o: { 0: 4000, 1: 9000 }, a: 13_000 }, { startedAt, now: at(16), optionCount: 3 })).toEqual(a)
    // An older beat arriving late does not take time away.
    expect(mergeBeat(a, { o: { 0: 1000 }, a: 2000 }, { startedAt, now: at(30), optionCount: 3 }).optionMs['0']).toBe(4000)
  })

  test('capped by the time since the open began (plus 5 s) and by two hours; bad keys ignored; the signature stays reached', () => {
    const r = mergeBeat(empty, { o: { 0: 999_999, 7: 5000, x: 5000, '-1': 5000 }, a: 999_999, sig: true }, { startedAt, now: at(60), optionCount: 3 })
    expect(r.optionMs).toEqual({ 0: 65_000 })
    expect(r.activeMs).toBe(65_000)
    expect(r.reachedSignature).toBe(true)
    expect(mergeBeat(r, { sig: false }, { startedAt, now: at(70), optionCount: 3 }).reachedSignature).toBe(true)
    const long = mergeBeat(empty, { o: { 1: 9e9 }, a: 9e9 }, { startedAt, now: at(5 * 3600), optionCount: 3 })
    expect(long.activeMs).toBe(MAX_VIEW_MS)
    expect(long.optionMs['1']).toBe(MAX_VIEW_MS)
    expect(mergeBeat(empty, { o: 'nonsense', a: -5 }, { startedAt, now: at(10), optionCount: 3 })).toEqual(empty)
  })
})

describe('staff detection', () => {
  test('any staff sign that matches makes it a staff view, the first one is named', () => {
    expect(staffDecision({})).toEqual({ staff: false, userId: null, how: null })
    expect(staffDecision({ preview: { userId: 'u1' } })).toEqual({ staff: true, userId: 'u1', how: 'preview' })
    expect(staffDecision({ session: { userId: 'u3' } }).how).toBe('session')
    expect(staffDecision({ bearer: { userId: 'u0' }, preview: { userId: 'u1' } })).toEqual({ staff: true, userId: 'u0', how: 'bearer' })
    expect(staffDecision({ preview: null, session: null }).staff).toBe(false)
  })
})

describe('push triggers', () => {
  const now = new Date('2026-10-20T15:00:00Z')
  test('the first customer open', () => {
    expect(openTrigger('q1', null, now)).toEqual({ trigger: 'first', key: 'proposal-opened:q1:first' })
  })
  test('a reopen after 2 days or more, keyed to the open before it (so it is sent once)', () => {
    const prev = { id: 'v1', at: new Date(now.getTime() - REOPEN_MS) }
    expect(openTrigger('q1', prev, now)).toEqual({ trigger: 'reopen', key: 'proposal-opened:q1:reopen:v1' })
    expect(openTrigger('q1', prev, new Date(now.getTime() + 60_000))?.key).toBe('proposal-opened:q1:reopen:v1')
  })
  test('a reopen within 2 days: none', () => {
    expect(openTrigger('q1', { id: 'v1', at: new Date(now.getTime() - REOPEN_MS + 60_000) }, now)).toBeNull()
    expect(openTrigger('q1', { id: 'v1', at: new Date(now.getTime() - 3600_000) }, now)).toBeNull()
  })
  test('an open counted before opens were recorded one by one stands in for the last open', () => {
    const old = new Date('2026-10-01T12:00:00Z')
    expect(openTrigger('q1', { id: null, at: old }, now)).toEqual({ trigger: 'reopen', key: `proposal-opened:q1:reopen:legacy-${old.getTime()}` })
  })
})

describe('history and badge', () => {
  const options = [
    { label: "White Vinyl 6'", tier: { label: 'Good' }, finalPrice: 7400 },
    { label: "White Vinyl 6' no dig", tier: { label: 'Better' }, finalPrice: 8200 },
    { label: "Tan Vinyl 6'", finalPrice: 9100.4 },
  ]
  const v = { startedAt: new Date('2026-10-20T15:00:00Z'), activeMs: 4 * 60_000 + 10_000, optionMs: { 0: 20_000, 1: 150_000, 2: 30_000 }, reachedSignature: true, signed: false, staff: false, device: 'iPhone' }
  test('a customer open says device, time, option looked at longest and the signature', () => {
    expect(viewHistoryItem(v, options).title).toBe('Proposal opened on iPhone, 4 min, looked longest at Better ($8,200), reached the signature')
    expect(viewHistoryItem({ ...v, signed: true }, options).title).toBe('Proposal opened on iPhone, 4 min, looked longest at Better ($8,200), signed')
    expect(viewHistoryItem({ ...v, reachedSignature: false, optionMs: {}, activeMs: 25_000 }, options).title).toBe('Proposal opened on iPhone, 25 sec')
    // One option: nothing to compare.
    expect(viewHistoryItem(v, options.slice(1, 2)).title).toBe('Proposal opened on iPhone, 4 min, reached the signature')
  })
  test('a staff open is a Staff view', () => {
    const h = viewHistoryItem({ ...v, staff: true, device: 'Computer' }, options, 'Jonathan Bohdal')
    expect(h.title).toBe('Staff view')
    expect(h.kind).toBe('proposal_staff')
    expect(h.detail).toContain('Jonathan Bohdal')
  })
  test('words', () => {
    expect(durationWords(59_000)).toBe('59 sec')
    expect(durationWords(65 * 60_000)).toBe('1 h 5 min')
    expect(optionWords(options[2])).toBe("Tan Vinyl 6' ($9,100)")
  })
  test('badge text: count and how long ago, or not opened yet', () => {
    const now = Date.parse('2026-10-20T15:00:00Z')
    expect(openedBadgeText({ count: 3, lastAt: '2026-10-20T13:00:00Z' }, now)).toBe('Opened 3× · last 2h ago')
    expect(openedBadgeText({ count: 1, lastAt: '2026-10-20T14:59:30Z' }, now)).toBe('Opened 1× · just now')
    expect(openedBadgeText({ count: 0, lastAt: null }, now)).toBe('Not opened yet')
    expect(openedBadgeText(null, now)).toBeNull()
    expect(agoWords('2026-10-20T14:45:00Z', now)).toBe('15m ago')
    expect(agoWords('2026-10-17T15:00:00Z', now)).toBe('3d ago')
  })
  test('a card shows opens only when its customer was sent a proposal', () => {
    const card = { customerId: 'c1' }
    expect(openedForCard(card, [{ crmContactId: 'c1', status: 'DRAFT', shareToken: null }])).toBeNull()
    expect(openedForCard(card, [{ crmContactId: 'c1', status: 'SENT', shareToken: 't' }])).toEqual({ count: 0, lastAt: null })
    expect(openedForCard(card, [
      { crmContactId: 'c1', status: 'SENT', shareToken: 't', viewCount: 2, lastViewedAt: '2026-10-19T10:00:00Z' },
      { crmContactId: 'c1', status: 'SOLD', shareToken: 'u', viewCount: 1, lastViewedAt: '2026-10-20T10:00:00Z', acceptedAt: '2026-10-20T10:05:00Z' },
      { crmContactId: 'c2', status: 'SENT', shareToken: 'v', viewCount: 9, lastViewedAt: '2026-10-20T11:00:00Z' },
    ])).toEqual({ count: 3, lastAt: '2026-10-20T10:00:00.000Z' })
    expect(openedForCard({ customerId: null }, [{ crmContactId: null, status: 'SENT', shareToken: 't' }])).toBeNull()
    // Sold in person, never sent: no badge.
    expect(proposalSent({ crmContactId: 'c1', status: 'SOLD', shareToken: null })).toBe(false)
    expect(proposalSent({ crmContactId: 'c1', status: 'SENT', shareToken: 't', archivedAt: '2026-10-01' })).toBe(false)
  })
})
