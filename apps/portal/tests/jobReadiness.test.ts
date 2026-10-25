/**
 * The milestones from a job's records (lib/jobReadiness.ts) and its payment
 * status from its payment schedule (billingStatusOf): one source of truth,
 * so the checklist, the 811 locate, the Permit section and Payments agree.
 */

import { describe, it, expect } from 'vitest'
import { milestones, staleTicks, fromRecords, billingStatusOf, progressOf, type ReadinessFacts } from '../src/server/lib/jobReadiness.js'

const base: ReadinessFacts = {
  today: '2026-10-25', status: 'staging', previousStatus: null,
  locate: { ticket: null, calledDate: null, goodDate: null, expDate: null },
  permitStatus: 'needed', materialsStatus: 'not_ordered', vendorInvoices: 0, crewAssigned: '', scheduledDate: '',
  takeoffStarted: false, walkthrough: null, photos: 0, billing: null,
}
const tick = (label: string, i = 0) => ({ label, isComplete: true, completedBy: 'user', completedAt: '2026-10-23T15:11:02.727Z', sortOrder: i })
const ALL = ['Locate Complete', 'Permit Approved', 'Materials Confirmed', 'Crew Assigned', 'Job Started', 'Final Walkthrough', 'Photos Uploaded', 'Invoice Sent']

describe('Manuel Cotrich, as on live Oct 24', () => {
  // Four milestones ticked by hand Oct 23; the job: no 811 on the job, permit Needed, materials received, crew1 on 10/26.
  const stored = [...ALL.slice(0, 4).map(tick), ...ALL.slice(4).map((label, i) => ({ label, isComplete: false, sortOrder: 4 + i }))]
  const facts: ReadinessFacts = { ...base, materialsStatus: 'received', crewAssigned: 'crew1', scheduledDate: '2026-10-26' }
  it('the ticks on Locate Complete and Permit Approved do not count: the job says Not called and Needed', () => {
    const list = milestones(facts, stored)
    const by = Object.fromEntries(list.map(m => [m.label, m]))
    expect(by['Locate Complete']).toMatchObject({ done: false, by: 'none', detail: '811: Not called' })
    expect(by['Permit Approved']).toMatchObject({ done: false, by: 'none', detail: 'Permit: Needed' })
    expect(by['Materials Confirmed']).toMatchObject({ done: true, by: 'data', detail: 'Materials: Received' })
    expect(by['Crew Assigned']).toMatchObject({ done: true, by: 'data', detail: 'crew1, starts 10/26/2026' })
    expect(progressOf(list)).toEqual({ total: 8, complete: 2 })
  })
  it('the dry run lists the two ticks to clear', () => {
    expect(staleTicks(facts, stored).map(t => [t.label, t.records])).toEqual([['Locate Complete', '811: Not called'], ['Permit Approved', 'Permit: Needed']])
  })
  it('after the packet ticket moves onto the job (294610232, good to dig 10/24), Locate Complete follows it', () => {
    const f = { ...facts, locate: { ticket: '294610232', calledDate: null, goodDate: '2026-10-24', expDate: null } }
    expect(fromRecords('locate', f)).toEqual({ done: true, detail: '811: Clear to dig' })
    expect(staleTicks(f, stored).map(t => t.label)).toEqual(['Permit Approved'])
  })
})

describe('each milestone from its record', () => {
  it('permit issued, passed or not needed', () => {
    for (const s of ['approved', 'inspection_scheduled', 'passed', 'not_needed']) expect(fromRecords('permit', { ...base, permitStatus: s }).done).toBe(true)
    expect(fromRecords('permit', { ...base, permitStatus: 'applied' })).toEqual({ done: false, detail: 'Permit: Applied' })
    expect(fromRecords('permit', { ...base, permitStatus: null })).toEqual({ done: false, detail: 'Permit: Not set' })
  })
  it('materials from the status or a vendor invoice for the job', () => {
    expect(fromRecords('materials', { ...base, materialsStatus: 'ordered' })).toEqual({ done: false, detail: 'Materials: Ordered, not received' })
    expect(fromRecords('materials', { ...base, materialsStatus: 'ordered', vendorInvoices: 1 }).done).toBe(true)
  })
  it('started, walkthrough, photos', () => {
    expect(fromRecords('started', { ...base, status: 'in_progress' }).done).toBe(true)
    expect(fromRecords('started', { ...base, takeoffStarted: true }).detail).toBe('The takeoff is started')
    expect(fromRecords('started', { ...base, status: 'on_hold', previousStatus: 'in_progress' }).done).toBe(true)
    expect(fromRecords('walkthrough', { ...base, walkthrough: { signed: false, signedAt: null, homeowner: null, open: true } })).toEqual({ done: false, detail: 'Started, not signed yet' })
    expect(fromRecords('walkthrough', { ...base, walkthrough: { signed: true, signedAt: '2026-10-24', homeowner: 'Maria Lopez', open: false } }).detail).toBe('Signed by Maria Lopez on 10/24/2026')
    expect(fromRecords('photos', { ...base, photos: 3 })).toEqual({ done: true, detail: '3 photos or videos' })
  })
  it('an expired 811 ticket on a job under way still counts', () => {
    const locate = { ticket: '1', calledDate: null, goodDate: '2026-09-01', expDate: '2026-10-01' }
    expect(fromRecords('locate', { ...base, locate }).done).toBe(false)
    expect(fromRecords('locate', { ...base, locate, status: 'completed' }).done).toBe(true)
  })
  it('Invoice Sent: the Final due once the job is complete, or paid in full', () => {
    expect(fromRecords('invoice', base)).toEqual({ done: false, detail: 'No payment schedule' })
    expect(fromRecords('invoice', { ...base, billing: { finalCents: 355691, finalDue: false, balanceCents: 711383, paidInFull: false } })).toEqual({ done: false, detail: 'Final $3,556.91 is due when the job is complete' })
    expect(fromRecords('invoice', { ...base, billing: { finalCents: 355691, finalDue: true, balanceCents: 355691, paidInFull: false } }).done).toBe(true)
  })
})

describe('ticks by hand', () => {
  it('count only where allowed, labeled', () => {
    const list = milestones(base, [tick('Photos Uploaded'), tick('Crew Assigned', 1), tick('Gate code collected', 2)])
    expect(list.map(m => [m.label, m.done, m.by])).toEqual([['Photos Uploaded', true, 'hand'], ['Crew Assigned', false, 'none'], ['Gate code collected', true, 'hand']])
    expect(list[0]).toMatchObject({ tickedBy: 'user', detail: 'No photos yet' })
  })
  it('a list never saved shows the defaults, worked out from the records', () => {
    const list = milestones({ ...base, permitStatus: 'not_needed' }, null)
    expect(list.map(m => m.label)).toEqual(ALL)
    expect(list.find(m => m.key === 'permit')).toMatchObject({ done: true, by: 'data', detail: 'Permit: Not needed' })
  })
})

describe('payment status from the payment schedule', () => {
  const schedule = (paid: number, completedDate: string | null = null) => ({
    contractCents: 711383, paidCents: paid, completedDate,
    invoices: [
      { kind: 'deposit', label: 'Deposit', amountCents: 355692, balanceCents: Math.max(0, 355692 - paid), dueOn: 'signing', dueDate: '2026-10-20' },
      { kind: 'final', label: 'Final', amountCents: 355691, balanceCents: 355691 - Math.max(0, paid - 355692), dueOn: 'completion', dueDate: completedDate },
    ],
  })
  it('the deposit due, not "Not invoiced yet" (Manuel Cotrich)', () => {
    expect(billingStatusOf(schedule(0))).toMatchObject({ state: 'deposit_due', text: 'Deposit $3,556.92 due 10/20/2026' })
  })
  it('deposit paid: the Final due on completion, then due once complete, then paid in full', () => {
    expect(billingStatusOf(schedule(355692))).toMatchObject({ state: 'not_due', text: 'Paid $3,556.92; Final $3,556.91 due on completion' })
    expect(billingStatusOf(schedule(355692, '2026-10-28'))).toMatchObject({ state: 'due', finalDue: true, text: 'Final $3,556.91 due 10/28/2026 (paid $3,556.92 so far)' })
    expect(billingStatusOf(schedule(711383, '2026-10-28'))).toMatchObject({ state: 'paid', paidInFull: true, text: 'Paid in full' })
  })
  it('no schedule', () => {
    expect(billingStatusOf(null)).toMatchObject({ state: 'none', text: 'No payment schedule yet' })
  })
})
