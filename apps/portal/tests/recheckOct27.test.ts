/**
 * Recheck Oct 27 2026, without a database:
 *   1. automation tasks close by themselves: what a task asks for, and when its job says it is done;
 *   2. a repair says repair: the office's and crew's word, a rule's task title, Advance past Need
 *      Drawing, the contract's title, warranty start and Scope and Exclusions;
 *   4. the failure after waiting for the job says how long it really waited.
 */

import { describe, test, expect } from 'vitest'
import { needsOfTask, closeReason, type TaskJobFacts } from '../src/server/lib/taskAutoClose.js'
import { installWord, repairWording } from '../src/server/lib/workWords.js'
import { advanceStageOf, START_OPS_STAGES } from '../src/server/lib/opsStageModel.js'
import { warrantyLines, contractTitle } from '../src/server/lib/contractPdf.js'
import { termsForRepair, STOCK_SCOPE_OPENING } from '../src/server/lib/contractTerms.js'
import { jobWaitGaveUp } from '../src/server/lib/automations/queue.js'

const facts = (f: Partial<TaskJobFacts> = {}): TaskJobFacts => ({ status: 'staging', scheduledDate: '', materialsStatus: 'not_ordered', permitStatus: 'needed', salesOrdersOrdered: 0, vendorInvoices: 0, ...f })

describe('automation tasks that close by themselves', () => {
  test('what the Signed Contract tasks ask for, from their titles (not the customer\'s name)', () => {
    expect(needsOfTask('File the fence permit for Pat Smith', 'Pat Smith')).toEqual(['permit'])
    expect(needsOfTask('Schedule the install for Pat Smith', 'Pat Smith')).toEqual(['schedule'])
    expect(needsOfTask('Schedule the repair for Pat Smith', 'Pat Smith')).toEqual(['schedule'])
    expect(needsOfTask('Order materials for Pat Smith', 'Pat Smith')).toEqual(['materials'])
    expect(needsOfTask('Follow up with Pat Smith (2 days, no answer)', 'Pat Smith')).toEqual([])
    // A customer named "Permit" is not a permit task.
    expect(needsOfTask('Call Joe Permit', 'Joe Permit')).toEqual([])
  })

  test('the permit task closes when the permit is Approved or Not needed, never while Needed or Applied', () => {
    expect(closeReason(['permit'], facts({ permitStatus: 'needed' }))).toBeNull()
    expect(closeReason(['permit'], facts({ permitStatus: 'applied' }))).toBeNull()
    expect(closeReason(['permit'], facts({ permitStatus: null }))).toBeNull()
    expect(closeReason(['permit'], facts({ permitStatus: 'approved' }))).toBe('the permit is Approved')
    expect(closeReason(['permit'], facts({ permitStatus: 'not_needed' }))).toBe('the permit is marked Not needed')
  })

  test('the schedule task closes once the job has a start date', () => {
    expect(closeReason(['schedule'], facts())).toBeNull()
    expect(closeReason(['schedule'], facts({ scheduledDate: '2026-10-29' }))).toBe('the job is scheduled to start 10/29/2026')
  })

  test('the materials task closes when materials are marked ordered, its Sales Order is Ordered, or a vendor invoice is in', () => {
    expect(closeReason(['materials'], facts())).toBeNull()
    expect(closeReason(['materials'], facts({ materialsStatus: 'ordered' }))).toBe('materials are marked Ordered on the job')
    expect(closeReason(['materials'], facts({ salesOrdersOrdered: 1 }))).toBe('its Sales Order is marked Ordered')
    expect(closeReason(['materials'], facts({ vendorInvoices: 2 }))).toBe('a vendor invoice for the job is in')
  })

  test('every one of them closes when the job is Complete, Invoiced or Paid (an on hold job keeps the status it had)', () => {
    for (const n of [['permit'], ['schedule'], ['materials']] as const) {
      expect(closeReason([...n], facts({ status: 'completed' }))).toBe('the job is Complete')
      expect(closeReason([...n], facts({ status: 'paid' }))).toBe('the job is Paid')
    }
    expect(closeReason(['permit'], facts({ status: 'in_progress' }))).toBeNull()
    // A task that asks for nothing it can check is never closed, even on a Paid job.
    expect(closeReason([], facts({ status: 'paid' }))).toBeNull()
  })

  test('a title that asks for two things closes only when both are done', () => {
    expect(needsOfTask('Order materials and file the permit for Pat', 'Pat')).toEqual(['permit', 'materials'])
    expect(closeReason(['permit', 'materials'], facts({ permitStatus: 'approved' }))).toBeNull()
    expect(closeReason(['permit', 'materials'], facts({ permitStatus: 'approved', materialsStatus: 'ordered' }))).toBe('the permit is Approved and materials are marked Ordered on the job')
  })
})

describe('a repair says repair', () => {
  test('the office\'s and crew\'s word for the work', () => {
    expect(installWord({ type: 'repair' })).toBe('Repair')
    expect(installWord({ type: 'move' })).toBe('Install')
    expect(installWord(null)).toBe('Install')
  })

  test('a rule\'s own words on a repair job', () => {
    expect(repairWording('Schedule the install for {name}')).toBe('Schedule the repair for {name}')
    expect(repairWording('Install day reminder')).toBe('Repair day reminder')
    expect(repairWording('Order materials for {name}')).toBe('Order materials for {name}')
    expect(repairWording('Call the installer')).toBe('Call the installer')
  })

  test('Advance passes over Need Drawing on a repair, and only on a repair', () => {
    const list = START_OPS_STAGES
    expect(advanceStageOf(list, 'awaiting_locates', { permitOk: true })!.id).toBe('need_drawing')
    expect(advanceStageOf(list, 'awaiting_locates', { permitOk: true, repair: true })!.id).toBe('materials_ordered')
    expect(advanceStageOf(list, 'permit_pending', { repair: true })!.id).toBe('materials_ordered')
    // Permit not issued: a repair still goes to Permit Pending first.
    expect(advanceStageOf(list, 'awaiting_locates', { repair: true })!.id).toBe('permit_pending')
    expect(advanceStageOf(list, 'materials_ordered', { repair: true })!.id).toBe('ready_to_pull')
  })

  test('the contract: title and warranty start', () => {
    expect(contractTitle('repair')).toBe('Fence Repair Contract')
    expect(contractTitle(null)).toBe('Fence Contract')
    expect(warrantyLines(null, null, 'repair').start).toBe('Warranty starts on the repair date (set when the repair is done).')
    expect(warrantyLines(null, 'October 29, 2026', 'repair').start).toBe('Warranty starts on the repair date: October 29, 2026')
    expect(warrantyLines(null, null).start).toBe('Warranty starts on the install date (set when the fence is installed).')
  })

  test('Scope and Exclusions: the stock opening says repair; words typed in its place are kept', () => {
    const stock = { key: 'scope_exclusions', title: 'Scope and Exclusions', text: `${STOCK_SCOPE_OPENING} Unless otherwise noted, the following are excluded: landscaping.` }
    const other = { key: 'payment_terms', title: 'Payment Terms', text: 'Installation is per plan, paid on completion.' }
    const typed = { key: 'scope_exclusions', title: 'Scope', text: 'We do what is listed.' }
    expect(termsForRepair([stock, other])).toEqual([{ ...stock, text: 'Repair work is per the items listed above. Unless otherwise noted, the following are excluded: landscaping.' }, other])
    expect(termsForRepair([typed])).toEqual([typed])
  })
})

describe('the failure after waiting for the job', () => {
  test('says how long it really waited', () => {
    expect(jobWaitGaveUp(3 * 86_400_000 + 5 * 60_000)).toBe('No job was made for it in 3 days of waiting.')
    expect(jobWaitGaveUp(23 * 60_000)).toBe('No job was made for it in 23 minutes of waiting.')
    expect(jobWaitGaveUp(2 * 3600_000)).toBe('No job was made for it in 2 hours of waiting.')
  })
})
