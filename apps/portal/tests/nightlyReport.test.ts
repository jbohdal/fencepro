/**
 * The nightly check's report (lib/nightlyReport.ts): new failures against the
 * previous night, the morning summary first, the feedback, the night agent,
 * PASS / FAIL lines read from a test's output, 30 nights kept.
 */

import { describe, test, expect } from 'vitest'
import { compareNights, morningSummary, renderReport, parseCheckLines, nightsToRemove, previousNight, feedbackLine, type StepResult, type NightInput } from '../src/server/lib/nightlyReport.js'

const st = (job: string, step: string, status: StepResult['status'], extra: Partial<StepResult> = {}): StepResult =>
  ({ suite: 'walkthrough', job, step, role: 'office_staff', device: 'computer (Chromium)', status, ms: 4200, detail: '', screenshot: null, ...extra })

const night = (steps: StepResult[], over: Partial<NightInput> = {}): NightInput => ({
  date: '2026-10-27', startedAt: '2026-10-27T23:15:00Z', finishedAt: '2026-10-27T23:52:00Z', commit: 'abc1234 fix(x): y', dryRun: false,
  refresh: { done: true, words: 'a fresh copy of live, scrubbed' }, safety: ['Database: ezbiz_dev'],
  suites: [{ name: 'walkthrough', label: 'The 3 job walkthrough', ran: true, words: '' }, { name: 'iphone', label: 'iPhone', ran: false, words: 'dry run' }],
  steps, feedback: { source: 'live (read only)', fresh: [], olderNew: 0, error: null }, outboxHeld: 3, agent: null, problems: [], ...over,
})

describe('tonight against the previous night', () => {
  test('a step that passed last night and fails tonight is a NEW failure; failing both nights is still failing; skipped is neither', () => {
    const prev = { date: '2026-10-26', steps: [st('A', 'deposit', 'pass'), st('A', 'final', 'fail'), st('B', 'co', 'fail'), st('C', 'paid', 'skip')] }
    const now = [st('A', 'deposit', 'fail'), st('A', 'final', 'fail'), st('B', 'co', 'pass'), st('C', 'paid', 'fail'), st('C', 'new step', 'fail'), st('A', 'after', 'skip')]
    const c = compareNights(prev, now)
    expect(c.newFailures.map(s => s.step)).toEqual(['deposit', 'new step'])
    expect(c.stillFailing.map(s => s.step)).toEqual(['final', 'paid'])
    expect(c.fixed.map(s => s.step)).toEqual(['co'])
    expect(c.previousDate).toBe('2026-10-26')
  })
  test('the first night: every failure is new', () => {
    const c = compareNights(null, [st('A', 'x', 'fail'), st('A', 'y', 'pass')])
    expect(c.newFailures.map(s => s.step)).toEqual(['x'])
    expect(c.previousDate).toBeNull()
  })
})

describe('the report', () => {
  test('all passed: the first line says so, then the feedback line', () => {
    const n = night([st('A', 'deposit', 'pass'), st('B', 'co', 'pass')])
    const lines = morningSummary(n, compareNights(null, n.steps))
    expect(lines[0]).toBe('**All 2 steps passed.**')
    expect(lines[1]).toBe('No new feedback.')
  })
  test('new failures come first, with who, what and the screenshot; the agent\'s summary is in the first lines', () => {
    const steps = [st('A', 'Office takes the deposit', 'fail', { detail: 'the receipt says waiting', screenshot: '/x/screens/a b.png' }), st('A', 'Office schedules', 'skip'), st('B', 'co', 'pass')]
    const n = night(steps, {
      agent: { ran: true, why: 'It looked at 1 new failure', command: 'claude -p ...', exitCode: 0, summary: '- Fixed on branch nightly-fix/2026-10-27: the deposit receipt never said Saved. Deploy: merge ...' },
      feedback: { source: 'live (read only)', fresh: [feedbackLine({ id: 'f1', createdAt: '2026-10-27T20:00:00Z', userName: 'Christa F', roleWords: 'Salesman', text: 'Card total wrong', statusWords: 'New', screenTitle: 'Sales Pipeline', record: 'Pipeline card: Dana', path: '/pipeline?card=1', device: 'iPhone, Safari', screen: '390x844 @3x' }, '/n/feedback/f1.jpg')], olderNew: 2, error: null },
    })
    const c = compareNights({ date: '2026-10-26', steps: [st('A', 'Office takes the deposit', 'pass')] }, steps)
    const md = renderReport(n, c)
    const top = md.split('\n').slice(0, 6).join('\n')
    expect(top).toContain('**1 NEW FAILURE** (1 passed, 1 failed, 1 skipped after a failure; compared with 2026-10-26).')
    expect(top).toContain('Fixed on branch nightly-fix/2026-10-27')
    expect(top).toContain('1 new feedback since the last check (and 2 older still marked New)')
    expect(md).toContain('## New failures (worked on 2026-10-26, broken tonight)')
    expect(md).toContain('- **Job A: Office takes the deposit** (office_staff, computer (Chromium)): the receipt says waiting [screenshot](file:///x/screens/a%20b.png)')
    expect(md.indexOf('## New failures')).toBeLessThan(md.indexOf('## The 3 job walkthrough'))
    expect(md).toContain('- **Card total wrong**')
    expect(md).toContain('Screen: Sales Pipeline · Pipeline card: Dana · page /pipeline?card=1')
    expect(md).toContain('[screenshot](file:///n/feedback/f1.jpg)')
    expect(md).toContain('Not run: dry run')
    expect(md).toContain('Messages held by the outbound gate tonight (dev outbox, nothing sent): 3')
  })
  test('the agent did not run with new failures: it says so, needs Jonathan', () => {
    const steps = [st('A', 'x', 'fail')]
    const n = night(steps, { agent: { ran: false, why: 'the claude command was not found', command: '', exitCode: null, summary: '' } })
    expect(morningSummary(n, compareNights(null, steps))).toContain('The night agent did not run: the claude command was not found. Needs Jonathan.')
  })
  test('a check that could not run says so first', () => {
    const n = night([], { problems: ['the dev copy still has 2 phone push sign ups: the tests were not run'] })
    const lines = morningSummary(n, compareNights(null, []))
    expect(lines[0]).toMatch(/^\*\*The check could not run in full:\*\* the dev copy still has 2 phone push sign ups/)
    expect(lines[1]).toBe('**No steps ran tonight.**')
  })
})

describe('reading a test\'s PASS / FAIL lines', () => {
  test('area, name and detail', () => {
    const log = 'starting\nPASS  fit: Today fits at 393 px\nFAIL  payments: the receipt link opens  -- 404 on /r/abc\n(waiting)\nPASS  Add to Home Screen: manifest\n'
    const s = parseCheckLines(log, 'iphone')
    expect(s.map(x => [x.job, x.step, x.status, x.detail])).toEqual([
      ['fit', 'fit: Today fits at 393 px', 'pass', ''],
      ['payments', 'payments: the receipt link opens', 'fail', '404 on /r/abc'],
      ['iphone', 'Add to Home Screen: manifest', 'pass', ''],
    ])
  })
})

describe('the nights kept', () => {
  test('30 newest kept; the previous night is the newest before tonight', () => {
    const names = Array.from({ length: 33 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`).filter(d => d <= '2026-10-31').concat(['2026-11-01', '2026-11-02', 'notes.txt'])
    expect(nightsToRemove(names, 30)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(previousNight(names, '2026-11-02')).toBe('2026-11-01')
    expect(previousNight(['2026-11-02'], '2026-11-02')).toBeNull()
  })
})
