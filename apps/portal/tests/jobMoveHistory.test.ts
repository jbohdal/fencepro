/**
 * The job's history shows who moved it between stages and changed its
 * materials, or that it moved by itself and why (audit #47, Oct 28 2026;
 * lib/jobMoveHistory.ts): from the audit rows every job save writes.
 */
import { describe, test, expect } from 'vitest'
import { moveHistoryItems, type JobAuditRow, type AutoMoveNote } from '../src/server/lib/jobMoveHistory'
import { START_OPS_STAGES } from '../src/server/lib/opsStageModel'

const t = (min: number) => new Date(Date.UTC(2026, 9, 28, 13, min))
const row = (min: number, r: Partial<JobAuditRow>): JobAuditRow => ({ createdAt: t(min), userEmail: 'jane@example.invalid', userName: 'Jane Smith', action: 'update', oldValues: null, newValues: null, ...r })
const names = (e: string) => (e === 'jane@example.invalid' ? 'Jane Smith' : null)

describe('job move history', () => {
  test('made, moved by hand, moved by itself with its note, materials; newest first', () => {
    const rows: JobAuditRow[] = [
      row(0, { action: 'create', newValues: { opsStage: 'awaiting_locates', materialsStatus: 'not_ordered', quotePrice: 4200 } }),
      // A save that changes neither (the notes): no line.
      row(1, { oldValues: { opsStage: 'awaiting_locates', materialsStatus: 'not_ordered', notes: '' }, newValues: { opsStage: 'awaiting_locates', materialsStatus: 'not_ordered', notes: 'gate code 12' } }),
      row(2, { userEmail: 'system', userName: null, oldValues: { opsStage: 'awaiting_locates' }, newValues: { opsStage: 'permit_pending', from: 'awaiting_locates', why: '811 locate is clear to dig', by: '811 locate saved, jane@example.invalid' } }),
      row(3, { oldValues: { opsStage: 'permit_pending', materialsStatus: 'not_ordered' }, newValues: { opsStage: 'materials_ordered', materialsStatus: 'ordered' } }),
      row(4, { userEmail: 'system', userName: null, oldValues: { materialsStatus: 'ordered', opsStage: 'materials_ordered' }, newValues: { materialsStatus: 'received', opsStage: 'ready_to_pull', by: 'Sales Order, bob@example.invalid' } }),
    ]
    const notes: AutoMoveNote[] = [
      { createdAt: new Date(t(4).getTime() - 40), to: 'ready_to_pull', body: 'Moved to Ready to Pull by itself: materials received (Sales Order marked Received).' },
      { createdAt: new Date(t(2).getTime() - 40), to: 'permit_pending', body: 'Moved to Permit Pending by itself: 811 locate is clear to dig.' },
    ]
    const used = new Set<number>()
    const items = moveHistoryItems(START_OPS_STAGES, rows, notes, names, used)
    expect(items.map(i => [i.kind, i.title, i.detail, i.by])).toEqual([
      ['stage', 'Moved from Materials Ordered to Ready to Pull automatically:', 'materials received (Sales Order marked Received). (Sales Order, bob@example.invalid)', ''],
      ['materials', 'Materials: Ordered → Received automatically', '(Sales Order, bob@example.invalid)', ''],
      ['stage', 'Moved from Permit Pending to Materials Ordered', '', 'Jane Smith'],
      ['materials', 'Materials: Not ordered yet → Ordered', '', 'Jane Smith'],
      ['stage', 'Moved from Awaiting Locates to Permit Pending automatically:', '811 locate is clear to dig. (811 locate saved, Jane Smith)', ''],
      ['stage', 'Job made in Awaiting Locates', '', 'Jane Smith'],
    ])
    expect([...used].sort()).toEqual([0, 1])
    // Never a price, whatever the row held.
    expect(JSON.stringify(items)).not.toMatch(/4200|\$/)
  })

  test('a row with no old stage (Schedule) is read against the stage before it; a stage gone from Settings shows its id', () => {
    const items = moveHistoryItems(START_OPS_STAGES, [
      row(0, { oldValues: { opsStage: 'ready_to_pull' }, newValues: { opsStage: 'retired_stage' } }),
      row(1, { newValues: { scheduledDate: '2026-11-02', opsStage: 'scheduled' } }),
    ])
    expect(items.map(i => i.title)).toEqual(['Moved from retired_stage to Scheduled', 'Moved from Ready to Pull to retired_stage'])
  })

  test('a move by itself with no note keeps its own reason (the crew tapped Start)', () => {
    const items = moveHistoryItems(START_OPS_STAGES, [row(0, { userEmail: 'system', userName: null, oldValues: { status: 'scheduled', opsStage: 'scheduled' }, newValues: { status: 'in_progress', opsStage: 'in_progress', why: 'The crew tapped Start' } })])
    expect(items).toEqual([{ at: t(0).toISOString(), kind: 'stage', title: 'Moved from Scheduled to In Progress automatically:', detail: 'The crew tapped Start.', by: '' }])
  })
})
