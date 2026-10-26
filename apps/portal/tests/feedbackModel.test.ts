/**
 * "Send feedback": the record a page address is on, the status words, and the
 * daily review's words (lib/feedbackModel.ts, lib/feedbackReport.ts).
 */

import { describe, test, expect } from 'vitest'
import { recordFromAddress, recordText, deviceText, FEEDBACK_STATUS_LABEL, isFeedbackStatus } from '../src/server/lib/feedbackModel.js'
import { parseReportArgs, startOfDayNewYork, sinceMoment, entryText, entryJson, shotLink } from '../src/server/lib/feedbackReport.js'

describe('the record a screen is on', () => {
  test('the open window comes first, then the screen', () => {
    expect(recordFromAddress('/operations?job=j1&co=c1')).toEqual({ type: 'change_order', id: 'c1' })
    expect(recordFromAddress('/quotes?qv=q1')).toEqual({ type: 'quote', id: 'q1' })
    expect(recordFromAddress('/customers/abc?qv=q2&tab=quotes')).toEqual({ type: 'quote', id: 'q2' })
    expect(recordFromAddress('/?quote=q3&for=x')).toEqual({ type: 'quote', id: 'q3' })
    expect(recordFromAddress('/operations?job=j2')).toEqual({ type: 'job', id: 'j2' })
    expect(recordFromAddress('/pipeline?card=lead-1')).toEqual({ type: 'card', id: 'lead-1' })
    expect(recordFromAddress('/service?ticket=t1')).toEqual({ type: 'service_ticket', id: 't1' })
    expect(recordFromAddress('/customers/9f1c2d3e-aaaa-bbbb-cccc-123456789012?tab=photos')).toEqual({ type: 'customer', id: '9f1c2d3e-aaaa-bbbb-cccc-123456789012' })
  })
  test('no record: a list, a new customer form, odd ids', () => {
    expect(recordFromAddress('/customers')).toBeNull()
    expect(recordFromAddress('/customers/new')).toBeNull()
    expect(recordFromAddress('/pipeline')).toBeNull()
    expect(recordFromAddress('')).toBeNull()
    expect(recordFromAddress('/operations?job=<script>')).toBeNull()
  })
  test('words', () => {
    expect(recordText('quote', 'Dana Smith')).toBe('Quote: Dana Smith')
    expect(recordText('card', '')).toBe('Pipeline card')
    expect(recordText('', 'x')).toBe('')
    expect(FEEDBACK_STATUS_LABEL).toEqual({ new: 'New', seen: 'Looked at', done: 'Fixed', needs_jonathan: 'Needs Jonathan' })
    expect(isFeedbackStatus('needs_jonathan')).toBe(true)
    expect(isFeedbackStatus('nope')).toBe(false)
    expect(deviceText('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1')).toBe('iPhone, Safari')
  })
})

describe('the daily feedback review (scripts/feedback-report.ts)', () => {
  test('reads its options, and says plainly what is wrong', () => {
    const a = parseReportArgs(['--status', 'new', '--since', '2026-10-26', '--limit', '20', '--json', '--copy-shots', '/tmp/x'])
    expect(a.status).toBe('new')
    expect(a.limit).toBe(20)
    expect(a.json).toBe(true)
    expect(a.copyShots).toBe('/tmp/x')
    // Midnight in Ocala on Oct 26 2026 (summer time): 04:00 UTC.
    expect(a.since?.toISOString()).toBe('2026-10-26T04:00:00.000Z')
    expect(() => parseReportArgs(['--status', 'closed'])).toThrow(/needs_jonathan/)
    expect(() => parseReportArgs(['--since', 'yesterday'])).toThrow(/--since/)
    expect(() => parseReportArgs(['--days', '0'])).toThrow(/--days/)
    expect(parseReportArgs([]).limit).toBe(50)
  })
  test('a plain date is midnight in Ocala, winter and summer', () => {
    expect(startOfDayNewYork('2026-12-01').toISOString()).toBe('2026-12-01T05:00:00.000Z')
    expect(startOfDayNewYork('2026-07-01').toISOString()).toBe('2026-07-01T04:00:00.000Z')
  })
  test('--since and --days: the later one wins', () => {
    const now = new Date('2026-10-26T23:00:00Z')
    expect(sinceMoment({ limit: 50, json: false, days: 1, since: new Date('2026-10-01T00:00:00Z') }, now)?.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(sinceMoment({ limit: 50, json: false, days: 30, since: new Date('2026-10-26T04:00:00Z') }, now)?.toISOString()).toBe('2026-10-26T04:00:00.000Z')
    expect(sinceMoment({ limit: 50, json: false }, now)).toBeUndefined()
  })
  const row = {
    id: 'fb-1', createdAt: new Date('2026-10-26T22:15:00Z'), status: 'needs_jonathan', userName: 'Christa F', userId: 'u1', role: 'sales_rep',
    path: '/pipeline?card=lead-1', screen: '390x844 @3x', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/604.1', appFile: '/assets/index-abc.js',
    text: 'The card total is wrong', screenshotPath: '/Users/x/ezbiz/apps/portal/uploads/feedback/a/fb-1.jpg', errors: [{ at: '2026-10-26T22:14:00Z', message: 'Boom' }],
    statusAt: new Date('2026-10-26T23:00:00Z'), statusBy: 'Jonathan Bohdal', screenTitle: 'Sales Pipeline', recordType: 'card', recordId: 'lead-1', recordName: 'Dana Smith', appVersion: 'abc1234 built 2026-10-26 18:00 UTC',
  }
  test('one feedback in words: note, screen, record, who, device, app version, a link to the screenshot', () => {
    const t = entryText(row, { file: row.screenshotPath, exists: true })
    expect(t).toContain('[NEEDS JONATHAN]  Christa F (Salesman)')
    expect(t).toContain('note:       The card total is wrong')
    expect(t).toContain('screen:     Sales Pipeline')
    expect(t).toContain('record:     Pipeline card: Dana Smith (card lead-1)')
    expect(t).toContain('device:     iPhone, Safari, 390x844 @3x')
    expect(t).toContain('app:        abc1234 built 2026-10-26 18:00 UTC')
    expect(t).toContain('screenshot: file:///Users/x/ezbiz/apps/portal/uploads/feedback/a/fb-1.jpg')
    expect(t).toContain('marked Needs Jonathan by Jonathan Bohdal')
    expect(t).toContain('app error:  2026-10-26T22:14:00Z Boom')
  })
  test('an older row without the new fields still prints; a missing file says so', () => {
    const old = { ...row, status: 'new', statusBy: null, statusAt: null, screenTitle: undefined, recordType: undefined, recordId: undefined, recordName: undefined, appVersion: undefined }
    const t = entryText(old, { file: old.screenshotPath, exists: false })
    expect(t).toContain('[NEW]')
    expect(t).toContain('screen:     -')
    expect(t).toContain('record:     -')
    expect(t).toContain('app:        /assets/index-abc.js')
    expect(t).toContain('(file missing)')
    expect(shotLink(null, false)).toBe('(none)')
    expect(shotLink('/a b/c.jpg', true)).toBe('file:///a%20b/c.jpg')
  })
  test('JSON: the row, its words and the screenshot link', () => {
    const j = JSON.parse(entryJson(row, { file: '/tmp/shots/fb-1.jpg', exists: true }))
    expect(j).toMatchObject({ id: 'fb-1', statusWords: 'Needs Jonathan', roleWords: 'Salesman', record: 'Pipeline card: Dana Smith', device: 'iPhone, Safari', screenshotUrl: 'file:///tmp/shots/fb-1.jpg', screenshotExists: true })
  })
})
