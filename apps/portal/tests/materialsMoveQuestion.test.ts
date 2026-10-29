/**
 * A hand move into Materials Ordered or Ready to Pull asks first when it would
 * record materials the job does not have (round 2 review, Oct 28 2026: from
 * Materials Ordered, "Advance to Ready to Pull" marked materials Received that
 * were never ordered). web/src/materialsMoveQuestion.ts.
 */
import { describe, test, expect } from 'vitest'
import { materialsMoveQuestion, bulkMaterialsMoveQuestion, drawingMoveQuestion, handMoveQuestion, bulkHandMoveQuestion } from '../../web/src/materialsMoveQuestion'
import { START_OPS_STAGES, fieldsForStage, advanceStageOf } from '../src/server/lib/opsStageModel.js'

describe('the materials question on a hand move', () => {
  test('Ready to Pull asks unless the materials are in', () => {
    const q = materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'not_ordered', customerName: 'Ann Lee' })
    expect(q).toContain("Ann Lee's materials are not ordered yet. Moving it to Ready to Pull records them as Received.")
    expect(q).toContain('Its Sales Order (Inventory > Sales Orders) is marked Ordered, not Received: mark it Received there when they come in, so the order matches.')
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'ordered' })).toContain('ordered, not received yet')
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: null })).toContain('not ordered yet')
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'received' })).toBeNull()
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'loaded' })).toBeNull()
  })
  test('Materials Ordered asks only when nothing is ordered; other stages never', () => {
    expect(materialsMoveQuestion('materials_ordered', 'Materials Ordered', { materialsStatus: 'not_ordered' })).toContain('records them as Ordered, and its Sales Order (Inventory > Sales Orders) as Ordered too. Mark it Received there when the materials come in.')
    expect(materialsMoveQuestion('materials_ordered', 'Materials Ordered', { materialsStatus: 'ordered' })).toBeNull()
    expect(materialsMoveQuestion('scheduled', 'Scheduled', { materialsStatus: 'not_ordered' })).toBeNull()
    expect(materialsMoveQuestion('stage_rts_x', 'Ready to Schedule', { materialsStatus: 'not_ordered' })).toBeNull()
  })
  test('a bulk move asks once, with how many', () => {
    expect(bulkMaterialsMoveQuestion('ready_to_pull', 'Ready to Pull', [{ materialsStatus: 'received' }, { materialsStatus: 'ordered' }, { materialsStatus: 'not_ordered' }]))
      .toContain('2 of the 3 selected jobs do not have materials received yet. Moving them to Ready to Pull records their materials as Received; their Sales Orders are marked Ordered, not Received: mark them Received in Inventory > Sales Orders when they come in, so the orders match.')
    expect(bulkMaterialsMoveQuestion('ready_to_pull', 'Ready to Pull', [{ materialsStatus: 'received' }])).toBeNull()
  })
})

/**
 * Moving a job on past Need Drawing by hand records its drawing done
 * (opsStageModel fieldsForStage). Review Oct 28 2026: Advance on a job that
 * said "Materials in; waits for its drawing" moved it to Ready to Pull with no
 * question. A move that records the drawing done now asks first when the job
 * has no drawing on file; a repair, or a job with its drawing, is not asked.
 */
describe('the drawing question on a hand move', () => {
  const stages = START_OPS_STAGES.map(s => ({ ...s }))
  const held = { opsStage: 'need_drawing', status: 'staging', materialsStatus: 'received', drawingComplete: false }
  const factsFor = (to: string, job: typeof held, o: { hasDrawing?: boolean; repair?: boolean } = {}) =>
    ({ recordsDrawing: fieldsForStage(stages, to, job, '2026-10-28')?.drawingComplete === true, hasDrawing: !!o.hasDrawing, repair: !!o.repair })

  test('Advance from Need Drawing with the materials in goes to Ready to Pull and asks about the drawing', () => {
    const next = advanceStageOf(stages, 'need_drawing', { materials: 'received' })
    expect(next?.id).toBe('ready_to_pull')
    const q = handMoveQuestion(next!.id, next!.name, { materialsStatus: 'received', customerName: 'Ann Lee' }, factsFor(next!.id, held))
    expect(q).toBe("No drawing on file for Ann Lee's job. Moving it to Ready to Pull records the drawing as done.\n\nMove it?")
  })

  test('a drag out of Need Drawing asks; with a drawing on file, a repair, or a move back it does not', () => {
    expect(drawingMoveQuestion('Scheduled', {}, factsFor('scheduled', held))).toBe('No drawing on file. Moving it to Scheduled records the drawing as done.\n\nMove it?')
    expect(handMoveQuestion('scheduled', 'Scheduled', { materialsStatus: 'received' }, factsFor('scheduled', held, { hasDrawing: true }))).toBeNull()
    expect(handMoveQuestion('scheduled', 'Scheduled', { materialsStatus: 'received' }, factsFor('scheduled', held, { repair: true }))).toBeNull()
    expect(handMoveQuestion('awaiting_locates', 'Awaiting Locates', { materialsStatus: 'received' }, factsFor('awaiting_locates', held))).toBeNull()
    // Into a side lane (On Hold) says nothing about the drawing.
    expect(handMoveQuestion('on_hold', 'On Hold', { materialsStatus: 'received' }, factsFor('on_hold', held))).toBeNull()
    // Already marked drawn: the move records nothing new.
    expect(handMoveQuestion('scheduled', 'Scheduled', { materialsStatus: 'received' }, factsFor('scheduled', { ...held, drawingComplete: true }))).toBeNull()
  })

  test('the drawing and the materials together are one question', () => {
    const job = { ...held, materialsStatus: 'not_ordered' }
    const q = handMoveQuestion('materials_ordered', 'Materials Ordered', { materialsStatus: 'not_ordered', customerName: 'Ann Lee' }, factsFor('materials_ordered', job))!
    expect(q.startsWith("No drawing on file for Ann Lee's job. Moving it to Materials Ordered records the drawing as done.\n\nAnn Lee's materials are not ordered yet.")).toBe(true)
    expect(q.endsWith('Mark the materials Ordered and move it?')).toBe(true)
  })

  test('a bulk move asks once, with how many have no drawing', () => {
    const f = factsFor('scheduled', held)
    expect(bulkHandMoveQuestion('scheduled', 'Scheduled', [{ materialsStatus: 'received', ...f }, { materialsStatus: 'received', ...f, hasDrawing: true }]))
      .toBe('1 of the 2 selected jobs has no drawing on file. Moving them to Scheduled records their drawings as done.\n\nMove them?')
    expect(bulkHandMoveQuestion('scheduled', 'Scheduled', [{ materialsStatus: 'received', ...f, hasDrawing: true }])).toBeNull()
  })
})
