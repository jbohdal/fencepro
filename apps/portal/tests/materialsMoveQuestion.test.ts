/**
 * A hand move into Materials Ordered or Ready to Pull asks first when it would
 * record materials the job does not have (round 2 review, Oct 28 2026: from
 * Materials Ordered, "Advance to Ready to Pull" marked materials Received that
 * were never ordered). web/src/materialsMoveQuestion.ts.
 */
import { describe, test, expect } from 'vitest'
import { materialsMoveQuestion, bulkMaterialsMoveQuestion } from '../../web/src/materialsMoveQuestion'

describe('the materials question on a hand move', () => {
  test('Ready to Pull asks unless the materials are in', () => {
    const q = materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'not_ordered', customerName: 'Ann Lee' })
    expect(q).toContain("Ann Lee's materials are not ordered yet. Moving it to Ready to Pull records them as Received, and its Sales Order (Inventory > Sales Orders) as Received too.")
    expect(q).toContain('Marking its Sales Order Received records it')
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'ordered' })).toContain('ordered, not received yet')
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: null })).toContain('not ordered yet')
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'received' })).toBeNull()
    expect(materialsMoveQuestion('ready_to_pull', 'Ready to Pull', { materialsStatus: 'loaded' })).toBeNull()
  })
  test('Materials Ordered asks only when nothing is ordered; other stages never', () => {
    expect(materialsMoveQuestion('materials_ordered', 'Materials Ordered', { materialsStatus: 'not_ordered' })).toContain('records them as Ordered, and its Sales Order (Inventory > Sales Orders) as Ordered too.')
    expect(materialsMoveQuestion('materials_ordered', 'Materials Ordered', { materialsStatus: 'ordered' })).toBeNull()
    expect(materialsMoveQuestion('scheduled', 'Scheduled', { materialsStatus: 'not_ordered' })).toBeNull()
    expect(materialsMoveQuestion('stage_rts_x', 'Ready to Schedule', { materialsStatus: 'not_ordered' })).toBeNull()
  })
  test('a bulk move asks once, with how many', () => {
    expect(bulkMaterialsMoveQuestion('ready_to_pull', 'Ready to Pull', [{ materialsStatus: 'received' }, { materialsStatus: 'ordered' }, { materialsStatus: 'not_ordered' }]))
      .toContain('2 of the 3 selected jobs do not have materials received yet. Moving them to Ready to Pull records their materials as Received, and their Sales Orders too.')
    expect(bulkMaterialsMoveQuestion('ready_to_pull', 'Ready to Pull', [{ materialsStatus: 'received' }])).toBeNull()
  })
})
