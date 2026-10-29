/**
 * The Salesman's Schedule (Jonathan, Oct 29 2026, D5; lib/salesSchedule.ts):
 * what an answer of /api/schedule keeps and leaves out for an install that is
 * not the Salesman's, and the Ready card's deposit chip when there is no
 * deposit to show. The routes themselves: salesSchedule.db.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { salesScheduleView, savesSchedule, isContactKey } from '../src/server/lib/salesSchedule'
import { scheduleWarnings } from '../src/server/lib/installDays'
import type { SalesScope } from '../src/server/lib/salesScope'

const scope: SalesScope = {
  userId: 'u1', accountId: 'a1', names: ['Christa Feagin', 'Christa'],
  directContactIds: new Set(['cMine']), contactIds: new Set(['cMine', 'cAssigned']), quoteIds: new Set(['qMine']), jobIds: new Set(['jMine']),
}
const at = new Date('2026-10-29T14:00:00Z')
const entry = (id: string, stagingJobId: string | null) => ({ id, accountId: 'a1', stagingJobId, clientName: 'Otto', area: '9 Other Rd', sections: 30, fenceType: 'WV-ND', jobPrice: 7777, tearout: false, crewId: 'c1', date: '2026-11-05', notes: 'call 352 555 0402', status: 'Scheduled', createdAt: at, updatedAt: at, deletedAt: null })
const ready = (id: string, crmContactId: string) => ({
  id, customerName: 'Otto', address: '9 Other Rd', phone: '3525550402', crmContactId, quoteId: null, fenceStyle: 'WV-ND', footage: 240, sections: 30, crewDays: 2, crewDaysFrom: 'estimate',
  stage: 'permit_pending', stageName: 'Permit', scheduledDate: '', scheduledEndDate: null, crewAssigned: '', bookedDays: [], permitStatus: 'applied', locatesDate: null, locatesExpDate: null,
  deposit: 'part', depositCents: 420450, depositPaidCents: 200000, materialsStatus: 'ordered', allowWeekend: false,
})

describe('salesScheduleView', () => {
  test('a board entry of another customer\'s install: name, address, dates, crew kept; price and notes left out; a date stays a date', () => {
    const out = salesScheduleView(scope, { success: true, data: { settings: { workDays: [1, 2, 3, 4] }, jobs: [entry('g1', 'jOther'), entry('g2', null), entry('g3', 'jMine')], version: 3 } })
    const [o, old, mine] = out.data.jobs as any[]
    expect(o).toEqual({ id: 'g1', accountId: 'a1', stagingJobId: 'jOther', clientName: 'Otto', area: '9 Other Rd', sections: 30, fenceType: 'WV-ND', tearout: false, crewId: 'c1', date: '2026-11-05', status: 'Scheduled', createdAt: at, updatedAt: at, deletedAt: null })
    expect(old).not.toHaveProperty('jobPrice')
    expect(old).not.toHaveProperty('notes')
    expect(mine).toEqual(entry('g3', 'jMine'))
    expect(out.data.version).toBe(3)
  })

  test('a Ready row: another customer\'s without deposit or phone; a customer assigned to the Salesman keeps the phone but not the money; the Salesman\'s own unchanged', () => {
    const [other, assigned, mine] = salesScheduleView(scope, [ready('jOther', 'cOther'), ready('jX', 'cAssigned'), ready('jMine', 'cMine')]) as any[]
    for (const k of ['deposit', 'depositCents', 'depositPaidCents', 'phone']) expect(other).not.toHaveProperty(k)
    expect(other).toMatchObject({ customerName: 'Otto', address: '9 Other Rd', stage: 'permit_pending', materialsStatus: 'ordered', permitStatus: 'applied' })
    expect(assigned.phone).toBe('3525550402')
    expect(assigned).not.toHaveProperty('depositCents')
    expect(mine).toEqual(ready('jMine', 'cMine'))
    // No deposit on the row: no deposit warning in the Schedule install window.
    expect(scheduleWarnings(other, '2026-11-05', '2026-11-05').map(w => w.key)).not.toContain('deposit')
  })

  test('a rain day move: no text for another customer\'s install (it is addressed to the customer\'s phone)', () => {
    const text = { jobId: 'jOther', customerName: 'Otto', phone: '3525550402', body: 'Hi', allowed: true, reason: null, callFrom: 'company' }
    const moves = salesScheduleView(scope, [{ jobId: 'jOther', customerName: 'Otto', startFrom: '2026-11-05', startTo: '2026-11-09', days: [], text, clashes: [] }, { jobId: 'jMine', customerName: 'Mina', startFrom: '2026-11-05', startTo: '2026-11-09', days: [], text, clashes: [] }]) as any[]
    expect(moves[0].text).toBeNull()
    expect(moves[0]).toMatchObject({ customerName: 'Otto', startFrom: '2026-11-05', startTo: '2026-11-09' })
    expect(moves[1].text).toEqual(text)
  })

  test('other answers pass unchanged; the input is not changed', () => {
    const settings = { success: true, data: { workDays: [1, 2, 3, 4], crews: [{ id: 'c1', name: 'Crew One' }] } }
    expect(salesScheduleView(scope, settings)).toEqual(settings)
    const e = entry('g1', 'jOther')
    salesScheduleView(scope, [e])
    expect(e.jobPrice).toBe(7777)
  })

  test('which requests save the Schedule (refused for the Salesman)', () => {
    expect(savesSchedule('GET', '/board')).toBe(false)
    expect(savesSchedule('POST', '/rain-day/preview')).toBe(false)
    for (const [m, p] of [['PUT', '/board'], ['POST', '/jobs/sync'], ['PATCH', '/jobs/x'], ['DELETE', '/jobs/x'], ['POST', '/install'], ['POST', '/rain-day'], ['POST', '/rain-log'], ['PUT', '/settings']]) expect(savesSchedule(m, p)).toBe(true)
    expect(['phone', 'customerPhone', 'email', 'customerEmail'].every(isContactKey)).toBe(true)
  })
})

describe('the Ready card\'s deposit chip', async () => {
  // A bare window for the web module's stores (nothing is stored).
  ;(globalThis as any).window ??= { location: { hostname: 'test' }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
  const { depositChip } = await import('../../web/src/ScheduleInstall')

  test('no deposit received (the Salesman, another customer\'s install): no chip, never "$0" or "No deposit recorded"', () => {
    expect(depositChip({})).toBeNull()
  })

  test('the office and the Salesman\'s own: the amounts as before; a missing or zero amount is not shown as $0 or NaN', () => {
    expect(depositChip({ deposit: 'part', depositCents: 420450, depositPaidCents: 200000 })!.label).toBe('Deposit part paid ($2,000 of $4,204.50)')
    expect(depositChip({ deposit: 'paid', depositCents: 250000, depositPaidCents: 250000 })!.label).toBe('Deposit paid ($2,500)')
    expect(depositChip({ deposit: 'unpaid', depositCents: 250000, depositPaidCents: 0 })!.label).toBe('Deposit not paid ($2,500)')
    expect(depositChip({ deposit: 'none', depositCents: 0, depositPaidCents: 0 })!.label).toBe('No deposit recorded')
    for (const d of ['paid', 'part', 'unpaid'] as const) {
      const l = depositChip({ deposit: d })!.label
      expect(l).not.toMatch(/\$0|NaN|undefined|\(\)/)
    }
  })
})
