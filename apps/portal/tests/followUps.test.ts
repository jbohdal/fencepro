/**
 * Follow ups: the next-date rules, the step schedules (stop on Signed and
 * Lost, start again on a stage change), who sees whose cards, the 7 am push
 * message per person, and that the app holds the same copy of the rules.
 */
import fs from 'fs'
import path from 'path'
import { describe, test, expect } from 'vitest'
import {
  addDays, applyAnswer, badgeFor, cleanConfig, defaultConfig, dueStatus, fillTemplate, keepGoing, nextDateForOutcome,
  reconcile, setNext, startState, stopsSteps, floridaDay, floridaHour,
} from '../src/server/lib/followUpRules.js'
import { morningKey, morningMessages, seesEveryone, type CardRow } from '../src/server/lib/followUps.js'
import { realDeliveryAllowed } from '../src/server/lib/outboundGate.js'
import { START_PIPELINE_STAGES, followUpStagesOf, type PipelineStageDef } from '../src/server/lib/pipelineStageModel.js'

// Settings > Pipeline Stages as it starts: which stages stop the steps, need one, take Signed and Lost.
const st = followUpStagesOf(START_PIPELINE_STAGES)

const cfg = defaultConfig(st)
const T = '2026-10-19'
const at = `${T}T15:00:00.000Z`
const ps = (since = T) => startState('Pending Signature', since, cfg, st)
const card = (stage = 'Pending Signature', lastMoved = T) => ({ stage, lastMoved })

describe('the app and the server hold the same rules', () => {
  test('apps/web/src/followUpRules.ts is the same file', () => {
    const a = fs.readFileSync(path.join(__dirname, '../src/server/lib/followUpRules.ts'), 'utf8')
    const b = fs.readFileSync(path.join(__dirname, '../../web/src/followUpRules.ts'), 'utf8')
    expect(b).toBe(a)
  })
})

describe('next date from an answer', () => {
  test('No answer tomorrow, voicemail 2 days, still deciding 3 days, not now the day picked', () => {
    expect(nextDateForOutcome('no_answer', T)).toBe('2026-10-20')
    expect(nextDateForOutcome('voicemail', T)).toBe('2026-10-21')
    expect(nextDateForOutcome('deciding', T)).toBe('2026-10-22')
    expect(nextDateForOutcome('not_now', T, '2026-12-01')).toBe('2026-12-01')
    expect(nextDateForOutcome('not_now', T, T)).toBeNull()
    expect(nextDateForOutcome('booked', T)).toBeNull()
  })
  test('a step due sooner comes first; Not now always wins', () => {
    // Entered Pending Signature today: day 2 call is before "still deciding" (3 days).
    const s = applyAnswer(ps(), card(), cfg, { outcome: 'deciding', today: T, at }, st)
    expect(s.dueOn).toBe('2026-10-21'); expect(s.dueKind).toBe('call')
    const n = applyAnswer(ps(), card(), cfg, { outcome: 'not_now', pickedOn: '2027-01-15', today: T, at }, st)
    expect(n.dueOn).toBe('2027-01-15')
    const na = applyAnswer(ps(), card(), cfg, { outcome: 'no_answer', today: T, at }, st)
    expect(na.dueOn).toBe('2026-10-20'); expect(na.touches).toBe(1); expect(na.lastOutcome).toBe('no_answer')
  })
  test('one tap change and keep', () => {
    expect(setNext(ps(), card(), cfg, '2026-11-02', T, st).dueOn).toBe('2026-11-02')
    expect(setNext(ps(), card(), cfg, null, T, st).dueOn).toBeNull()
    expect(keepGoing(ps('2026-09-01'), card(), cfg, T, st).dueOn).toBe('2026-10-21')
  })
})

describe('step schedules', () => {
  test('Pending Signature: call day 2, text day 5, call day 10, call day 21', () => {
    expect(cfg.steps['Pending Signature']).toEqual([{ day: 2, kind: 'call' }, { day: 5, kind: 'text' }, { day: 10, kind: 'call' }, { day: 21, kind: 'call' }])
    expect(cfg.steps['Estimating']).toEqual(cfg.steps['Pending Signature'])
    expect(cfg.steps['Appointment']).toEqual(cfg.steps['Pending Signature'])
    expect(ps().dueOn).toBe('2026-10-21')
  })
  test('answers walk the steps; the text step comes up as a text', () => {
    const since = '2026-10-01'
    // Day 3: the day 2 call is done; next is the day 5 text (before still deciding's 3 days).
    const s = applyAnswer(ps(since), card('Pending Signature', since), cfg, { outcome: 'deciding', today: '2026-10-04', at }, st)
    expect(s.stepIndex).toBe(1); expect(s.dueOn).toBe('2026-10-06'); expect(s.dueKind).toBe('text')
  })
  test('after the last step: "Going cold, keep or close?"', () => {
    const since = '2026-09-01'
    const s = applyAnswer(ps(since), card('Pending Signature', since), cfg, { outcome: 'voicemail', today: '2026-09-25', at }, st)
    expect(s.stepIndex).toBe(4); expect(s.dueKind).toBe('decide'); expect(s.dueOn).toBe('2026-09-27')
  })
  test('stop on Signed and Lost', () => {
    const sg = applyAnswer(ps(), card(), cfg, { outcome: 'signed', today: T, at }, st)
    expect(sg.stoppedReason).toBe('signed'); expect(sg.dueOn).toBeNull()
    const lo = applyAnswer(ps(), card(), cfg, { outcome: 'lost', today: T, at }, st)
    expect(lo.stoppedReason).toBe('lost'); expect(lo.dueOn).toBeNull()
    expect(startState('Job Prep', T, cfg, st).stoppedReason).toBe('signed')
    expect(startState('Lost Sale', T, cfg, st).stoppedReason).toBe('lost')
    expect(stopsSteps('Estimating', st)).toBeNull()
    expect(badgeFor(sg, 'Signed Contract', T, st)).toBeNull()
  })
  test('a stage change starts the new stage\'s steps (from the day it moved)', () => {
    const s = applyAnswer(ps('2026-09-01'), card('Pending Signature', '2026-09-01'), cfg, { outcome: 'no_answer', today: '2026-10-01', at }, st)
    const moved = reconcile(s, card('Estimating', '2026-10-10'), cfg, T, st)!
    expect(moved.stage).toBe('Estimating'); expect(moved.stepIndex).toBe(0); expect(moved.dueOn).toBe('2026-10-12')
    expect(moved.touches).toBe(1)
    // A lost card brought back to Pending Signature starts again.
    const lost = applyAnswer(ps(), card(), cfg, { outcome: 'lost', today: T, at }, st)
    expect(reconcile(lost, card('Pending Signature', '2026-10-20'), cfg, '2026-10-20', st)!.stoppedReason).toBeNull()
    // Never followed up: nothing.
    expect(reconcile(null, card(), cfg, T, st)).toBeNull()
  })
  test('badges', () => {
    expect(badgeFor({ ...ps(), dueOn: '2026-10-16' }, 'Pending Signature', T, st)).toEqual({ text: 'Overdue 3d', tone: 'red' })
    expect(badgeFor({ ...ps(), dueOn: T }, 'Pending Signature', T, st)?.text).toBe('Call today')
    expect(badgeFor(null, 'Estimating', T, st)?.text).toBe('No follow up set')
    expect(badgeFor(null, 'First Contact', T, st)).toBeNull()
    expect(badgeFor({ ...ps(), dueOn: '2026-10-25' }, 'Pending Signature', T, st)).toBeNull()
    expect(dueStatus({ ...ps(), dueOn: '2026-10-25' }, T)).toEqual({ status: 'upcoming', days: 6 })
  })
  test('renamed stages and moved roles: the steps follow the roles, never the names', () => {
    const list: PipelineStageDef[] = START_PIPELINE_STAGES.map(x => ({ ...x, name: `Renamed ${x.name}`, roles: [...x.roles] }))
    const sold = list.find(x => x.id === 'Signed Contract')!; sold.name = 'Sold'
    const k = followUpStagesOf(list)
    expect(k.signed).toBe('Signed Contract'); expect(k.lost).toBe('Lost Sale')
    expect(startState('Job Prep', T, cfg, k).stoppedReason).toBe('signed')
    expect(applyAnswer(ps(), card(), cfg, { outcome: 'signed', today: T, at }, k).stage).toBe('Signed Contract')
    // No Answer does not stop the steps (Jonathan, Oct 20 2026): only the Lost stage and the Sold stages do.
    expect(stopsSteps('No Answer', k)).toBeNull()
    // Lost moved to No Answer: Lost Sale no longer stops them, No Answer does.
    const moved = followUpStagesOf(list.map(x => ({ ...x, roles: x.id === 'Lost Sale' ? [] : x.id === 'No Answer' ? ['lost' as const] : x.roles })))
    expect(stopsSteps('No Answer', moved)).toBe('lost'); expect(stopsSteps('Lost Sale', moved)).toBeNull()
    // "Needs a follow up" is a flag on the stage.
    expect(badgeFor(null, 'First Contact', T, followUpStagesOf(list.map(x => ({ ...x, needsFollowUp: x.id === 'First Contact' }))))?.text).toBe('No follow up set')
    // The standard steps start on every Selling stage after the first.
    expect(Object.keys(defaultConfig(k).steps)).toEqual(['Appointment', 'Estimating', 'Pending Signature'])
  })
  test('steps only for stages in the list', () => {
    const ids = Object.fromEntries(START_PIPELINE_STAGES.map(x => [x.id, x.name]))
    expect(Object.keys(cleanConfig({ steps: { Estimating: [{ day: 1, kind: 'call' }] } }, ids).steps)).toEqual(['Estimating'])
    expect(() => cleanConfig({ steps: { Nope: [{ day: 1, kind: 'call' }] } }, ids)).toThrow(/not one of the pipeline stages/)
  })
  test('settings are checked and sorted', () => {
    const c = cleanConfig({ steps: { Estimating: [{ day: 9, kind: 'call' }, { day: 1, kind: 'text' }] }, templates: [{ name: 'A', body: 'Hi {first name}' }] })
    expect(c.steps.Estimating.map(s => s.day)).toEqual([1, 9])
    expect(() => cleanConfig({ steps: { Estimating: [{ day: 400, kind: 'call' }] } })).toThrow()
    expect(() => cleanConfig({ steps: { Estimating: [{ day: 1, kind: 'email' }] } })).toThrow()
  })
  test('templates fill the first name', () => {
    expect(fillTemplate('Hi {first name}, {my name} with {company}.', { firstName: 'Sarah Jones', myName: 'Christa Feagin', company: 'Getter Done Fence' })).toBe('Hi Sarah, Christa with Getter Done Fence.')
  })
  test('dates in Florida', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(floridaDay(new Date('2026-10-20T02:00:00Z'))).toBe('2026-10-19')
    expect(floridaHour(new Date('2026-10-19T11:00:00Z'))).toBe(7)
  })
})

describe('who sees whose follow ups', () => {
  test('owner, admin, manager and office see everyone; salesman and installer only their own', () => {
    for (const r of ['super_admin', 'admin', 'manager', 'office_staff']) expect(seesEveryone(r)).toBe(true)
    for (const r of ['sales_rep', 'field_crew', null, 'customer']) expect(seesEveryone(r as any)).toBe(false)
  })
})

describe('the 7 am push', () => {
  const row = (ownerId: string, status: string, name: string, stage = 'Pending Signature'): CardRow => ({
    cardId: name, customerId: null, name, firstName: name, stage, phone: '', address: '', valueCents: 0, ownerId, ownerName: '', dueOn: T,
    dueKind: 'call', status, days: 0, stepIndex: 0, stepCount: 4, lastOutcome: null, lastContactAt: null, daysSinceContact: null, touches: 0, badge: null, state: null,
    opened: null, stopped: stopsSteps(stage, st), mustHave: st.mustHave.includes(stage),
  })
  const people = [{ id: 'a', name: 'Christa F', email: 'a@x', role: 'sales_rep' }, { id: 'b', name: 'Jonathan B', email: 'b@x', role: 'super_admin' }, { id: 'c', name: 'C', email: 'c@x', role: 'sales_rep' }]
  test('each person gets only their own calls for the day (and overdue)', () => {
    const m = morningMessages([row('a', 'today', 'Ann'), row('a', 'overdue', 'Bob'), row('b', 'today', 'Cal'), row('a', 'upcoming', 'Dee'), row('c', 'today', 'Eve', 'Lost Sale')], people)
    expect(m.map(x => x.userId)).toEqual(['a', 'b'])
    expect(m[0].title).toBe('2 follow ups today'); expect(m[0].body).toContain('1 overdue'); expect(m[0].body).not.toContain('Dee')
  })
  test('one key per person per day', () => {
    expect(morningKey('a', T)).toBe('followup-morning:a:2026-10-19')
    expect(morningKey('a', T)).not.toBe(morningKey('a', '2026-10-20'))
    expect(morningKey('a', T)).not.toBe(morningKey('b', T))
  })
  test('the dev copy never delivers to phones', () => {
    const live = { home: '/Users/x', codeDir: '/Users/x/ezbiz/apps/portal/dist/server/lib' }
    expect(realDeliveryAllowed({ ...live, env: { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u@localhost:5432/ezbiz_dev' } as any })).toBe(false)
    expect(realDeliveryAllowed({ ...live, env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u@localhost:5432/ezbiz_dev?x=1' } as any })).toBe(false)
    expect(realDeliveryAllowed({ ...live, env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u@localhost:5432/ezbiz' } as any })).toBe(true)
  })
})
