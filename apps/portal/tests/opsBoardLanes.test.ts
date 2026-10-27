/**
 * The Operations board's columns and styles filter (apps/web/src/opsBoardLanes.ts).
 * Audit Oct 26 2026: jobs in Awaiting Locates and Permit Pending sat under
 * "Unscheduled 12" while the Awaiting Locates column read 0; the styles filter
 * listed old import codes (AG, WVSDS, wvnd, galvcl...).
 */

import { describe, test, expect } from 'vitest'
import { laneOf, styleChoices, UNSCHEDULED_LANE } from '../../web/src/opsBoardLanes'
import { START_OPS_STAGES } from '../../web/src/opsStageModel'
import { styleLabel } from '../../web/src/fenceCatalog'

const stages = START_OPS_STAGES

describe('which column a job is in', () => {
  test('a waiting job with no install date is in its own stage\'s column', () => {
    for (const s of ['awaiting_locates', 'permit_pending', 'need_drawing', 'materials_ordered', 'ready_to_pull']) expect(laneOf(stages, { opsStage: s, scheduledDate: null })).toBe(s)
  })
  test('on hold and finished jobs are in their column with or without a date', () => {
    for (const s of ['on_hold', 'customer_delay', 'backorder', 'completed', 'invoiced', 'paid']) expect(laneOf(stages, { opsStage: s, scheduledDate: '' })).toBe(s)
  })
  test('Unscheduled: a stage that means it has an install date, but none is set; or a stage not in the list', () => {
    for (const s of ['scheduled', 'in_progress', 'punch_list']) expect(laneOf(stages, { opsStage: s, scheduledDate: null })).toBe(UNSCHEDULED_LANE)
    expect(laneOf(stages, { opsStage: 'scheduled', scheduledDate: '2026-10-29' })).toBe('scheduled')
    expect(laneOf(stages, { opsStage: 'gone_stage', scheduledDate: '2026-10-29' })).toBe(UNSCHEDULED_LANE)
  })
  test('an added stage after Permit Pending waits like it (no date needed)', () => {
    const added = [...stages.map(s => s.order >= 2 ? { ...s, order: s.order + 1 } : s), { ...stages[1], id: 'stage_hoa_ok', name: 'HOA OK', order: 2, isFirst: false }]
    expect(laneOf(added, { opsStage: 'stage_hoa_ok', scheduledDate: null })).toBe('stage_hoa_ok')
  })
})

describe('the styles filter', () => {
  test('plain names, once each, A to Z; nothing empty', () => {
    const plain = (c: string) => ({ "WV-ND 6'x8' Privacy": 'White vinyl privacy', 'WVND': 'White vinyl privacy', 'CL': 'Chain link' } as Record<string, string>)[c] ?? c
    expect(styleChoices(["WV-ND 6'x8' Privacy", 'WVND', 'CL', '', null, undefined], plain)).toEqual(['Chain link', 'White vinyl privacy'])
  })
  test('a catalog code shows its plain name, never the code', () => {
    const names = styleChoices(["WV-ND 6'x8' Privacy", "TV-ND 6'x8' Privacy"], styleLabel)
    expect(names.some(n => /WV-ND|TV-ND/.test(n))).toBe(false)
    expect(names).toHaveLength(2)
  })
})
