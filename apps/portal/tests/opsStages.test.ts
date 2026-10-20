/**
 * Operations stages, without a database (opsStageModel.ts, the same file in
 * the web app and the server):
 *   - the web and server copies are the same file;
 *   - the start list, its ids and order;
 *   - a job saved before stages were kept on the job shows where the old
 *     board put it, so no job moves;
 *   - a rename, recolor, reorder or hide changes no job's stage;
 *   - moving, advancing, a status changed elsewhere, holds;
 *   - what a list must have to be saved; automations' stage ids;
 *   - the start list made from the old Settings list.
 */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  START_OPS_STAGES, legacyStageOfJob, stageOfJob, reconcileOpsStage, phaseOf, fieldsForStage, nextStage, stagesProblem,
  normalizeStages, cleanStages, boardStages, sideStages, firstStageFor, stageIdsInRule, swapStageInRule, newStageId, stagesFromOldList,
  ADDED_STAGE_ID, type OpsStageDef, type OpsJobLike,
} from '../../web/src/opsStageModel'

const list = () => START_OPS_STAGES.map(s => ({ ...s }))
const job = (f: Partial<OpsJobLike> = {}): OpsJobLike => ({ status: 'staging', opsStage: '', materialsStatus: 'not_ordered', drawingComplete: false, locatesDate: null, ...f })

describe('one file for the app and the server', () => {
  test('web and server copies are the same', () => {
    const web = readFileSync(fileURLToPath(new URL('../../web/src/opsStageModel.ts', import.meta.url)), 'utf8')
    const server = readFileSync(fileURLToPath(new URL('../src/server/lib/opsStageModel.ts', import.meta.url)), 'utf8')
    expect(server).toBe(web)
  })
})

describe('the start list', () => {
  test('Jonathan\'s order, then the side lanes; ids are the old board keys', () => {
    expect(boardStages(list()).map(s => s.name)).toEqual(['Awaiting Locates', 'Permit Pending', 'Need Drawing', 'Materials Ordered', 'Ready to Pull', 'Scheduled', 'In Progress', 'Punch List', 'Complete', 'Invoiced', 'Paid'])
    expect(sideStages(list()).map(s => s.name)).toEqual(['On Hold', 'Customer Delay', 'Backorder'])
    for (const k of ['awaiting_locates', 'need_drawing', 'materials_ordered', 'ready_to_pull', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'on_hold', 'customer_delay', 'backorder']) {
      expect(START_OPS_STAGES.some(s => s.id === k)).toBe(true)
    }
    expect(START_OPS_STAGES.filter(s => s.isFirst).map(s => s.id)).toEqual(['awaiting_locates'])
    expect(START_OPS_STAGES.filter(s => s.isComplete).map(s => s.id)).toEqual(['completed'])
    expect(stagesProblem(list())).toBeNull()
  })

  test('a job with no stage of its own shows where the old board put it (every live combination)', () => {
    const cases: Array<[Partial<OpsJobLike>, string]> = [
      [{ status: 'staging' }, 'awaiting_locates'],
      [{ status: 'staging', locatesDate: '2026-10-01' }, 'need_drawing'],
      [{ status: 'staging', materialsStatus: 'ordered' }, 'materials_ordered'],
      [{ status: 'staging', materialsStatus: 'received' }, 'ready_to_pull'],
      [{ status: 'staging', materialsStatus: 'loaded' }, 'ready_to_pull'],
      [{ status: 'staging', drawingComplete: true }, 'awaiting_locates'],
      [{ status: 'scheduled' }, 'scheduled'], [{ status: 'in_progress' }, 'in_progress'], [{ status: 'completed' }, 'completed'],
      [{ status: 'invoiced' }, 'invoiced'], [{ status: 'paid' }, 'paid'], [{ status: 'on_hold' }, 'on_hold'],
    ]
    for (const [f, want] of cases) {
      expect(legacyStageOfJob(job(f))).toBe(want)
      expect(stageOfJob(list(), job(f))).toBe(want)
    }
  })
})

describe('renaming never moves a job', () => {
  const jobs = [
    job(), job({ status: 'paid' }), job({ status: 'completed' }), job({ status: 'invoiced' }), job({ status: 'on_hold' }),
    job({ opsStage: 'punch_list', status: 'in_progress' }), job({ opsStage: 'customer_delay', status: 'on_hold' }),
  ]
  test('rename, recolor, reorder and hide: every job keeps its stage id', () => {
    const before = jobs.map(j => stageOfJob(list(), j))
    const edited = list().map(s => ({ ...s, name: `${s.name} (renamed)`, color: '#123456' })).reverse().map((s, i) => ({ ...s, order: i }))
    edited.find(s => s.id === 'paid')!.hidden = true
    expect(jobs.map(j => stageOfJob(normalizeStages(edited), j))).toEqual(before)
  })
  test('a status change elsewhere still moves by id after a rename', () => {
    const renamed = list().map(s => (s.id === 'paid' ? { ...s, name: 'Money in' } : s))
    expect(reconcileOpsStage(renamed, job({ opsStage: 'punch_list', status: 'in_progress' }), job({ opsStage: 'punch_list', status: 'paid' }))).toBe('paid')
  })
})

describe('moving jobs', () => {
  const today = '2026-10-20'
  test('a move on purpose sets the status the stage stands for', () => {
    expect(fieldsForStage(list(), 'scheduled', job(), today)).toEqual({ opsStage: 'scheduled', status: 'scheduled' })
    expect(fieldsForStage(list(), 'materials_ordered', job(), today)).toMatchObject({ status: 'staging', materialsStatus: 'ordered' })
    expect(fieldsForStage(list(), 'completed', job({ status: 'in_progress' }), today)).toMatchObject({ status: 'completed', completedDate: today })
    expect(fieldsForStage(list(), 'invoiced', job({ status: 'completed', completedDate: '2026-10-01' }), today)).toEqual({ opsStage: 'invoiced', status: 'invoiced' })
    expect(fieldsForStage(list(), 'backorder', job({ status: 'scheduled' }), today)).toMatchObject({ status: 'on_hold', previousStatus: 'scheduled' })
    expect(fieldsForStage(list(), 'nope', job(), today)).toBeNull()
  })
  test('an added stage stands for the status of the board stage before it', () => {
    const l = list()
    l.splice(7, 0, { id: 'stage_abcd1234', name: 'Inspection', color: '#000000', order: 0, hidden: false, isFirst: false, isComplete: false, lane: 'main' })
    l.forEach((s, i) => { s.order = i })
    expect(phaseOf(l, 'stage_abcd1234')).toBe('in_progress')
    expect(phaseOf(l, 'punch_list')).toBe('in_progress')
    expect(phaseOf(l, 'on_hold')).toBe('on_hold')
    const first: OpsStageDef = { id: 'stage_first000', name: 'Deposit', color: '#000000', order: -1, hidden: false, isFirst: false, isComplete: false, lane: 'main' }
    expect(phaseOf(normalizeStages([first, ...list()]), 'stage_first000')).toBe('staging')
  })
  test('Advance goes to the next shown board stage, skipping hidden ones', () => {
    const l = list()
    expect(nextStage(l, 'awaiting_locates')?.id).toBe('permit_pending')
    l.find(s => s.id === 'permit_pending')!.hidden = true
    expect(nextStage(l, 'awaiting_locates')?.id).toBe('need_drawing')
    expect(nextStage(l, 'permit_pending')?.id).toBe('need_drawing')
    expect(nextStage(l, 'paid')).toBeNull()
    expect(nextStage(l, 'on_hold')).toBeNull()
  })
  test('a save keeps the stage, moves on purpose, or follows a status change', () => {
    const l = list()
    const pp = job({ opsStage: 'permit_pending' })
    expect(reconcileOpsStage(l, pp, { ...pp })).toBe('permit_pending')                                  // notes edited
    expect(reconcileOpsStage(l, pp, { ...pp, opsStage: 'scheduled', status: 'scheduled' })).toBe('scheduled')   // dragged
    expect(reconcileOpsStage(l, pp, { ...pp, materialsStatus: 'ordered' })).toBe('materials_ordered')    // as the old board did
    expect(reconcileOpsStage(l, pp, { ...pp, status: 'on_hold' })).toBe('on_hold')                      // Hold
    const cd = job({ opsStage: 'customer_delay', status: 'on_hold', previousStatus: 'scheduled' })
    expect(reconcileOpsStage(l, cd, { ...cd, notes: 'x' } as any)).toBe('customer_delay')
    expect(reconcileOpsStage(l, cd, { ...cd, status: 'scheduled' })).toBe('scheduled')                   // Resume
    const pl = job({ opsStage: 'punch_list', status: 'in_progress' })
    expect(reconcileOpsStage(l, pl, { ...pl, materialsStatus: 'loaded' })).toBe('punch_list')
    // An old app that never sends a stage: the status still moves it.
    expect(reconcileOpsStage(l, job(), { ...job(), opsStage: undefined, status: 'scheduled' })).toBe('scheduled')
    // A new job lands in the first stage.
    const l2 = l.map(s => ({ ...s, isFirst: s.id === 'permit_pending' }))
    expect(reconcileOpsStage(l2, null, job())).toBe('permit_pending')
    expect(reconcileOpsStage(l2, null, job({ status: 'paid' }))).toBe('paid')
  })
  test('a deleted stage: jobs that would go there go to the first stage of that status', () => {
    const l = list().filter(s => s.id !== 'materials_ordered')
    expect(reconcileOpsStage(l, job(), { ...job(), materialsStatus: 'ordered' })).toBe('awaiting_locates')
    expect(firstStageFor(l, 'on_hold')).toBe('on_hold')
    expect(stageOfJob(l.filter(s => s.id !== 'awaiting_locates'), job())).toBe('permit_pending')
  })
})

describe('saving a list', () => {
  test('what is refused, in words', () => {
    expect(stagesProblem([])).toMatch(/at least one/)
    expect(stagesProblem(list().map(s => ({ ...s, isFirst: false })))).toMatch(/first stage/)
    expect(stagesProblem(list().map(s => ({ ...s, isComplete: s.id === 'on_hold' })))).toMatch(/Complete stage must be on the board/)
    expect(stagesProblem(list().map(s => (s.id === 'paid' ? { ...s, name: 'scheduled' } : s)))).toMatch(/Two stages are called/)
    expect(stagesProblem(list().map(s => (s.id === 'completed' ? { ...s, hidden: true } : s)))).toMatch(/cannot be hidden/)
    expect(stagesProblem(list().map(s => (s.id === 'paid' ? { ...s, name: '  ' } : s)))).toMatch(/needs a name/)
  })
  test('cleanStages keeps marks as sent; normalizeStages repairs them', () => {
    const two = list().map(s => ({ ...s, isFirst: s.id === 'awaiting_locates' || s.id === 'paid' }))
    expect(stagesProblem(cleanStages(two))).toMatch(/first stage/)
    expect(normalizeStages(two).filter(s => s.isFirst).map(s => s.id)).toEqual(['awaiting_locates'])
    expect(normalizeStages(null).length).toBe(14)
  })
  test('added ids', () => {
    const id = newStageId(list())
    expect(id).toMatch(ADDED_STAGE_ID)
    expect(ADDED_STAGE_ID.test('need_drawing')).toBe(false)
  })
})

describe('automations keep the stage id', () => {
  const rule = {
    board: 'ops',
    trigger: { type: 'card_entered', stage: 'punch_list' },
    conditions: [{ field: 'stage', op: 'is', value: 'scheduled' }, { field: 'city', op: 'is', value: 'Ocala' }],
    steps: [{ type: 'move_card', stage: 'completed' }, { type: 'notify', title: 'x' }],
  }
  test('which ids a rule uses; sales rules use none', () => {
    expect(stageIdsInRule(rule).sort()).toEqual(['completed', 'punch_list', 'scheduled'])
    expect(stageIdsInRule({ ...rule, board: 'sales' })).toEqual([])
  })
  test('a deleted stage is swapped for the one picked', () => {
    const r = swapStageInRule(rule, 'punch_list', 'in_progress')
    expect(r.trigger.stage).toBe('in_progress')
    expect(stageIdsInRule(r).sort()).toEqual(['completed', 'in_progress', 'scheduled'])
    expect(r.conditions[1]).toEqual(rule.conditions[1])
  })
})

describe('the start list from the old Settings list', () => {
  const live = [
    { id: '9vriucdp', name: 'Awaiting Locates', color: '#3b82f6', isActive: true, sortOrder: 0 },
    { id: 'wjyh8yvs', name: 'Permit Pending', color: '#f59e0b', isActive: true, sortOrder: 1, isCompletionStage: true },
    { id: 'kjzhb2gv', name: 'Materials Ordered', color: '#f97316', isActive: true, sortOrder: 2 },
    { id: '3944xrf3', name: 'Scheduled', color: '#10b981', isActive: true, sortOrder: 3 },
    { id: '9jhfbbbs', name: 'In Progress', color: '#06b6d4', isActive: true, sortOrder: 4 },
    { id: 'xpxxdtun', name: 'Punch List', color: '#8b5cf6', isActive: true, sortOrder: 5 },
    { id: 'derxpdp0', name: 'Complete', color: '#16a34a', isActive: true, sortOrder: 6, isCompletionStage: true },
    { id: 'j56cfg8s', name: 'On Hold', color: '#6b7280', isActive: true, sortOrder: 7 },
  ]
  test('live\'s saved list (defaults only) gives the start list as it is', () => {
    const r = stagesFromOldList(live)
    expect(r.stages).toEqual(list())
    expect(r.kept).toEqual([])
    expect(r.colors).toEqual([])
  })
  test('a color chosen by hand is kept; a stage the start list lacks stays, under its old name', () => {
    const r = stagesFromOldList([...live.map(s => (s.name === 'Scheduled' ? { ...s, color: '#ABCDEF' } : s)), { id: 'zz9', name: 'HOA Approval', color: '#112233', isActive: false, sortOrder: 9 }])
    expect(r.stages.find(s => s.id === 'scheduled')!.color).toBe('#abcdef')
    expect(r.colors).toEqual(['Scheduled'])
    const hoa = r.stages.find(s => s.name === 'HOA Approval')!
    expect(hoa).toMatchObject({ id: 'stage_old_zz9', hidden: true, lane: 'main', color: '#112233' })
    expect(hoa.id).toMatch(ADDED_STAGE_ID)
    expect(r.kept).toEqual(['HOA Approval'])
    expect(stagesProblem(r.stages)).toBeNull()
  })
  test('nothing saved: the start list', () => {
    expect(stagesFromOldList(null).stages).toEqual(list())
  })
})
