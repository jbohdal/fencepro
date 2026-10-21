/**
 * Sales Pipeline stages: the model (pipelineStageModel.ts), no database.
 *   - the web and server copies are the same file;
 *   - the start list: today's 13 names as ids, groups, roles, chances, colors;
 *   - what a list may not be (roles missing or doubled, in the wrong group,
 *     hidden, two names alike);
 *   - renaming every stage moves nothing and every role still works (booking,
 *     signed, lost, job complete, calendar groups, follow ups, value);
 *   - the board never loses a card (hidden stage with cards, unknown word);
 *   - the one-time list from the old lists;
 *   - which card a completed job moves.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  START_PIPELINE_STAGES, START_IDS, cleanStages, normalizeStages, stagesProblem, boardColumns, stageAfterBooking, stageAfterOutcome,
  followUpStagesOf, isSoldStage, isOpenStage, isFinishedStage, chanceOf, stagesFromOldLists, newStageId, ADDED_STAGE_ID, nextStageOf,
  bookingTypeFor, cardForCompletedJob, stageIdsInSalesRule, roleStageId, stageNameOf, sortedStages, type PipelineStageDef,
} from '../src/server/lib/pipelineStageModel.js'
import { leadValue, pipelineMetrics } from '../../web/src/pipelineValue'
import { buildDesiredEvents, type SpecInputs } from '../src/server/lib/calendarSync/spec.js'

const copy = (): PipelineStageDef[] => START_PIPELINE_STAGES.map(s => ({ ...s, roles: [...s.roles] }))
const renamedAll = (): PipelineStageDef[] => copy().map(s => ({ ...s, name: `Renamed ${s.name}` }))

describe('one model, two copies', () => {
  test('apps/web/src/pipelineStageModel.ts is the same file as the server\'s', () => {
    const web = readFileSync(fileURLToPath(new URL('../../web/src/pipelineStageModel.ts', import.meta.url)), 'utf8')
    const server = readFileSync(fileURLToPath(new URL('../src/server/lib/pipelineStageModel.ts', import.meta.url)), 'utf8')
    expect(web).toBe(server)
  })
})

describe('the start list', () => {
  test('today\'s 13 names are the ids, in board order, with the plan\'s groups, roles and chances', () => {
    const s = START_PIPELINE_STAGES
    expect(s.map(x => x.id)).toEqual(Object.values(START_IDS))
    expect(s.every(x => x.name === x.id && !x.hidden)).toBe(true)
    expect(s.filter(x => x.group === 'selling').map(x => [x.id, x.chancePct])).toEqual([['First Contact', 5], ['Appointment', 15], ['Estimating', 30], ['Pending Signature', 60]])
    expect(s.filter(x => x.group === 'sold_ahead').map(x => x.id)).toEqual(['Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress'])
    expect(s.filter(x => x.group === 'sold_done').map(x => x.id)).toEqual(['Job Complete', 'Pending Payment', 'Paid & Closed'])
    expect(s.filter(x => x.group === 'dead').map(x => x.id)).toEqual(['Lost Sale', 'No Answer'])
    expect(Object.fromEntries(s.filter(x => x.roles.length).map(x => [x.id, x.roles]))).toEqual({
      'First Contact': ['first'], Appointment: ['appointment'], Estimating: ['ready_to_quote'], 'Signed Contract': ['signed'], 'Job Complete': ['complete'], 'Lost Sale': ['lost'],
    })
    expect(s.filter(x => x.finished).map(x => x.id)).toEqual(['Paid & Closed', 'Lost Sale', 'No Answer'])
    expect(s.filter(x => x.needsFollowUp).map(x => x.id)).toEqual(['Estimating', 'Pending Signature'])
    expect(s.find(x => x.id === 'Signed Contract')!.color).toBe('#22c55e')
    expect(stagesProblem(copy())).toBeNull()
  })
  test('an added Selling stage starts at 10%; a word not in the list counts as open at 10%', () => {
    const l = copy(); l.push({ ...l[0], id: 'stage_abcd1234', name: 'Site visit', roles: [], chancePct: 10, order: 9 })
    expect(chanceOf(cleanStages(l), 'stage_abcd1234')).toBe(0.1)
    expect(chanceOf(l, 'Something old')).toBe(0.1)
    expect(isOpenStage(l, 'Something old')).toBe(true)
  })
})

describe('what a list may not be', () => {
  const fix = (f: (l: PipelineStageDef[]) => void) => { const l = copy(); f(l); return stagesProblem(l) }
  test('the three required roles: exactly one each, not hidden, in the right group', () => {
    expect(fix(l => { l[0].roles = [] })).toMatch(/New cards land here/)
    expect(fix(l => { l[1].roles = ['first'] })).toMatch(/Only one stage/)
    expect(fix(l => { l.find(s => s.id === 'Signed Contract')!.roles = [] })).toMatch(/"Signed"/)
    expect(fix(l => { l.find(s => s.id === 'Lost Sale')!.hidden = true })).toMatch(/cannot be hidden/)
    expect(fix(l => { l.find(s => s.id === 'Lost Sale')!.group = 'selling' })).toMatch(/must be in Lost or dead/)
    expect(fix(l => { l.find(s => s.id === 'Job Prep')!.roles = ['signed'] ; l.find(s => s.id === 'Signed Contract')!.roles = [] })).toBeNull()
  })
  test('two stages may not share a name (any capital letters); chance is 0 to 100', () => {
    expect(fix(l => { l[1].name = 'first contact' })).toMatch(/Two stages are called/)
    expect(fix(l => { l[0].chancePct = 140 })).toMatch(/0 to 100/)
  })
  test('cleaning keeps known fields, sorts by group then order, and finished follows the group', () => {
    const raw = copy().reverse().map((s, i) => ({ ...s, order: i, extra: 'x', finished: s.group === 'selling' ? true : s.finished }))
    const c = cleanStages(raw)
    expect(c.map(s => s.group)).toEqual(sortedStages(c).map(s => s.group))
    expect(c.every(s => !('extra' in s))).toBe(true)
    expect(c.filter(s => s.group === 'selling').every(s => !s.finished)).toBe(true)
    expect(c.filter(s => s.group === 'dead').every(s => s.finished)).toBe(true)
  })
  test('a bad saved list is made safe to read (a missing role goes to a fitting stage)', () => {
    const l = copy(); l.find(s => s.id === 'Signed Contract')!.roles = []
    expect(roleStageId(normalizeStages(l), 'signed')).toBe('Signed Contract')
    expect(normalizeStages([])).toHaveLength(13)
  })
  test('a new stage id is never a name', () => {
    const id = newStageId(copy())
    expect(ADDED_STAGE_ID.test(id)).toBe(true)
    expect(ADDED_STAGE_ID.test('Signed Contract')).toBe(false)
  })
})

describe('rename every stage: nothing moves, every role still works', () => {
  const L = renamedAll()
  test('names show; ids (what cards keep) are the same', () => {
    expect(stageNameOf(L, 'Signed Contract')).toBe('Renamed Signed Contract')
    expect(L.map(s => s.id)).toEqual(START_PIPELINE_STAGES.map(s => s.id))
  })
  test('booking, Ready to quote and Not interested go by role', () => {
    expect(stageAfterBooking(L, 'First Contact', 'estimate')).toBe('Appointment')
    expect(stageAfterOutcome(L, 'Appointment', 'ready_to_quote')).toEqual({ move: 'Estimating' })
    expect(stageAfterOutcome(L, 'Appointment', 'not_interested')).toEqual({ offer: 'Lost Sale' })
    expect(bookingTypeFor(L, 'Appointment')).toBe('estimate')
    expect(bookingTypeFor(L, 'Pending Signature')).toBe('follow_up')
  })
  test('Signed, Lost, finished and the follow up stops go by role and group', () => {
    const k = followUpStagesOf(L)
    expect([k.signed, k.lost]).toEqual(['Signed Contract', 'Lost Sale'])
    expect(k.sold).toEqual(['Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress', 'Job Complete', 'Pending Payment', 'Paid & Closed'])
    expect(isSoldStage(L, 'Pending Payment')).toBe(true)
    expect(isFinishedStage(L, 'No Answer')).toBe(true)
  })
  test('Signed given to a new "Sold" stage: it is the Signed stage now', () => {
    const l = copy()
    l.find(s => s.id === 'Signed Contract')!.roles = []
    l.push({ ...l.find(s => s.id === 'Signed Contract')!, id: 'stage_sold0001', name: 'Sold', roles: ['signed'], order: -1 })
    const c = cleanStages(l)
    expect(stagesProblem(c)).toBeNull()
    expect(followUpStagesOf(c).signed).toBe('stage_sold0001')
    expect(sortedStages(c).find(s => s.group === 'sold_ahead')!.id).toBe('stage_sold0001')
  })
  test('the weighted value uses each stage\'s chance, renamed or not', () => {
    const lead = { id: 'a', customerId: 'c', stage: 'Pending Signature', createdAt: '2026-10-01' }
    const q = [{ id: 'q', customerId: 'c', status: 'SENT', date: '2026-10-01', finalPrice: 1000 }]
    expect(pipelineMetrics([lead], q, [], L, '2026-07-01').weighted).toBe(600)
    const l2 = L.map(s => (s.id === 'Pending Signature' ? { ...s, chancePct: 80 } : s))
    expect(pipelineMetrics([lead], q, [], l2, '2026-07-01').weighted).toBe(800)
    expect(leadValue({ ...lead, stage: 'Signed Contract' }, [{ ...q[0], status: 'SOLD' }], [], L)).toBe(1000)
  })
  test('the calendar: Selling dates are estimates, Sold with work ahead dates installs, by group', () => {
    const inp = (stage: string): SpecInputs => ({ baseUrl: 'https://x', workDays: [1, 2, 3, 4], crews: [], jobs: [], gridJobs: [], contacts: [], appointments: [], pipelineStages: L,
      leads: [{ id: 'l1', firstName: 'Pat', lastName: 'Lee', stage, scheduledDate: '2026-10-20' } as any] })
    expect(buildDesiredEvents(inp('Estimating'))[0].summary).toMatch(/^Estimate/)
    expect(buildDesiredEvents(inp('Job Prep'))[0].summary).toMatch(/^Install/)
    expect(buildDesiredEvents(inp('Lost Sale'))).toEqual([])
  })
})

describe('the board never loses a card', () => {
  test('a hidden stage is a column only while cards are in it; a word not in the list gets its own column', () => {
    const l = copy(); l.find(s => s.id === 'Job Prep')!.hidden = true
    expect(boardColumns(l, ['First Contact']).some(c => c.id === 'Job Prep')).toBe(false)
    expect(boardColumns(l, ['Job Prep']).some(c => c.id === 'Job Prep')).toBe(true)
    const odd = boardColumns(l, ['Old Word'])
    expect(odd[odd.length - 1]).toMatchObject({ id: 'Old Word', name: 'Old Word', unknown: true })
    expect(nextStageOf(l, 'Signed Contract')!.id).toBe('Pending Start')
  })
})

describe('the one-time list', () => {
  const thirteen = Object.values(START_IDS)
  test('today\'s lists (13 names, live as of Oct 20 2026): the start list, nothing added or hidden', () => {
    const made = stagesFromOldLists(thirteen, ['Lost Sale', 'First Contact'])
    expect(made.stages).toEqual(copy())
    expect([made.added, made.hiddenStart, made.fromCards]).toEqual([[], [], []])
  })
  test('a start stage missing from the board is hidden; an extra word is kept in its place; a card word becomes a hidden stage', () => {
    const made = stagesFromOldLists(['First Contact', 'Appointment', 'Site Visit', 'Estimating', 'Pending Signature', 'Signed Contract', 'Lost Sale', 'No Answer'], ['Weird'])
    expect(made.hiddenStart).toEqual(['Job Prep', 'Pending Start', 'Jobs In Progress', 'Job Complete', 'Pending Payment', 'Paid & Closed'])
    expect(made.added).toEqual(['Site Visit'])
    expect(made.stages.find(s => s.id === 'Site Visit')!.group).toBe('selling')
    expect(made.stages.find(s => s.id === 'Weird')).toMatchObject({ hidden: true, group: 'selling' })
    expect(made.stages.find(s => s.id === 'Signed Contract')!.hidden).toBe(false)   // a required role is never hidden
    expect(stagesProblem(made.stages)).toBeNull()
  })
})

describe('automation rules name stages by id', () => {
  test('the trigger, stage conditions and move steps', () => {
    expect(stageIdsInSalesRule({ board: 'sales', trigger: { stage: 'Signed Contract' }, conditions: [{ field: 'stage', value: 'Estimating' }], steps: [{ type: 'move_card', stage: 'Lost Sale' }] }).sort()).toEqual(['Estimating', 'Lost Sale', 'Signed Contract'])
    expect(stageIdsInSalesRule({ board: 'ops', trigger: { stage: 'scheduled' } })).toEqual([])
  })
})

describe('job complete moves only the card that belongs to the job\'s quote', () => {
  const S = copy()
  const card = (id: string, stage: string, more: Record<string, string> = {}) => ({ id, stage, customerId: 'c1', ...more })
  test('the card carrying the quote id moves, whatever else the customer has', () => {
    const r = cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, 'c1', [card('a', 'Signed Contract', { quoteId: 'q1' }), card('b', 'Job Prep')], S)
    expect(r.cardId).toBe('a')
  })
  test('older cards: only the customer\'s one card in Sold, work ahead', () => {
    expect(cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, 'c1', [card('a', 'Signed Contract'), card('b', 'Lost Sale'), card('c', 'Paid & Closed')], S).cardId).toBe('a')
    const two = cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, 'c1', [card('a', 'Signed Contract'), card('b', 'Job Prep')], S)
    expect(two.cardId).toBeNull(); expect(two.why).toMatch(/2 cards/)
    const none = cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, 'c1', [card('a', 'Pending Signature'), card('b', 'Paid & Closed')], S)
    expect(none.cardId).toBeNull(); expect(none.why).toMatch(/no card in a Sold, work ahead stage/)
  })
  test('never another customer\'s card (no name, phone or email matching), never a finished card', () => {
    expect(cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, 'c1', [{ id: 'x', stage: 'Signed Contract', customerId: 'c2' }], S).cardId).toBeNull()
    expect(cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, 'c1', [card('a', 'Paid & Closed', { quoteId: 'q1' })], S).cardId).toBeNull()
    expect(cardForCompletedJob({ id: 'j1', quoteId: 'q1' }, null, [card('a', 'Signed Contract')], S).cardId).toBeNull()
  })
})
