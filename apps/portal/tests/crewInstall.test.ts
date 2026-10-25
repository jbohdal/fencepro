/**
 * The installer's day (lib/crewInstall.ts, routes/installPacket.ts, web
 * installPacket.tsx, InstallerHome.tsx) and whose tasks Today lists
 * (lib/taskScope.ts). Walkthrough round 1, Oct 25, 2026.
 */

import { describe, test, expect } from 'vitest'
import { customerNotesFrom, todayState, type InstallTime } from '../src/server/lib/crewInstall'
import { myTasksWhere, seesCompanyTasks } from '../src/server/lib/taskScope'
import { onceEach } from '../src/server/routes/installPacket'
import { crewDays } from '../../web/src/crewDays'

describe("the customer's notes, for the crew", () => {
  test('the customer record\'s notes and the website\'s "Customer notes:" line; never a price; each once', () => {
    const notes = customerNotesFrom('Keep the side gate shut\nQuoted $5,000 cash\n\n', [
      'Website, drawn by customer\nEstimate shown to the customer: $7,762\nCustomer notes: Need it done before Thanksgiving, have 2 dogs.',
      'customer note: have 2 dogs',
      'Customer notes: keep the side gate shut',
      null,
    ])
    expect(notes).toEqual(['Keep the side gate shut', 'Need it done before Thanksgiving, have 2 dogs.', 'have 2 dogs'])
  })
  test('nothing on file: none', () => {
    expect(customerNotesFrom(null, [])).toEqual([])
    expect(customerNotesFrom('', ['Estimate shown: $100'])).toEqual([])
  })
})

describe('Start and Finish', () => {
  const t = (kind: 'start' | 'finish', at: string): InstallTime => ({ kind, at, by: 'Crew', day: at.slice(0, 10) })
  test('not started, working, finished, started again, by today\'s taps only', () => {
    expect(todayState([], '2026-10-26')).toBe('not-started')
    expect(todayState([t('start', '2026-10-25T12:00:00Z'), t('finish', '2026-10-25T20:00:00Z')], '2026-10-26')).toBe('not-started')
    expect(todayState([t('start', '2026-10-26T12:00:00Z')], '2026-10-26')).toBe('working')
    expect(todayState([t('start', '2026-10-26T12:00:00Z'), t('finish', '2026-10-26T20:00:00Z')], '2026-10-26')).toBe('finished')
    expect(todayState([t('start', '2026-10-26T12:00:00Z'), t('finish', '2026-10-26T15:00:00Z'), t('start', '2026-10-26T16:00:00Z')], '2026-10-26')).toBe('working')
  })
})

describe('the packet prints a note once', () => {
  test('the job\'s and the quote\'s notes were the same lines', () => {
    expect(onceEach('Gate code 1234\nTwo dogs\nGate code 1234\n gate code 1234 \nTwo dogs')).toBe('Gate code 1234\nTwo dogs')
  })
})

describe("the installer's list", () => {
  const job = (id: string, o: Record<string, unknown> = {}) => ({ id, customerName: id, status: 'scheduled', scheduledDate: '', crewAssigned: 'Crew 1', estimatedDays: 1, ...o }) as any
  test('one row per crew day from the Schedule, from today on; finished jobs left out; a job booked before the install schedule by its start day', () => {
    const entries = [
      { stagingJobId: 'a', date: '2026-10-22', crewId: 'crew1' }, { stagingJobId: 'a', date: '2026-10-26', crewId: 'crew1' }, { stagingJobId: 'a', date: '2026-10-27', crewId: 'crew1' },
      { stagingJobId: 'done', date: '2026-10-26', crewId: 'crew1' },
      { stagingJobId: 'far', date: '2026-12-30', crewId: 'crew1' },
    ]
    const rows = crewDays([job('a'), job('done', { status: 'completed' }), job('far'), job('old', { scheduledDate: '2026-10-28' })], entries, [{ id: 'crew1', name: 'Crew 1' }], '2026-10-26')
    expect(rows.map(r => [r.job.id, r.day, r.dayNo, r.days, r.crew])).toEqual([
      ['a', '2026-10-26', 2, 3, 'Crew 1'], ['a', '2026-10-27', 3, 3, 'Crew 1'], ['old', '2026-10-28', 1, 1, 'Crew 1'],
    ])
  })
})

describe("whose tasks Today lists", () => {
  test('owner and office: theirs and the company\'s unnamed ones; Salesman and Installer: theirs, or their role\'s', () => {
    expect(seesCompanyTasks('super_admin')).toBe(true)
    expect(seesCompanyTasks('office_staff')).toBe(true)
    expect(seesCompanyTasks('sales_rep')).toBe(false)
    expect(seesCompanyTasks('field_crew')).toBe(false)
    const office = JSON.stringify(myTasksWhere('office_staff', ['Pat']))
    expect(office).toContain('"assignedTo":null')
    const sales = myTasksWhere('sales_rep', ['christa@x.com', 'Christa Feagin', 'Christa']) as any
    // Unnamed tasks only with her role on them.
    expect(sales.OR).toHaveLength(4)
    expect(sales.OR[3]).toEqual({ AND: [{ OR: [{ assignedTo: null }, { assignedTo: '' }] }, { assignedRole: 'sales_rep' }] })
    expect(sales.OR.slice(0, 3).map((x: any) => x.assignedTo.equals)).toEqual(['christa@x.com', 'Christa Feagin', 'Christa'])
  })
})
