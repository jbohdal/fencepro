/**
 * Calendar sync: what each dated CRM record becomes, and how the calendar is
 * kept in step without duplicates.
 */
import { describe, test, expect } from 'vitest'
import { buildDesiredEvents, lastWorkday, nextWorkday, specHash, googleEventId, eventKey, type SpecInputs, type JobRow, type GridRow, type CalendarEventSpec } from '../src/server/lib/calendarSync/spec'
import { reconcile, type CalendarApi, type EventLink, type LinkStore } from '../src/server/lib/calendarSync/engine'

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: 'j1', crmContactId: 'c1', status: 'scheduled', customerName: 'Shawn Collins', customerPhone: '(352) 555-0101',
  customerAddress: '5904 SW 82nd Terrace Rd, Ocala, FL 34480', fenceStyle: 'ALUM', sections: 24, totalFeet: 144, walkGates: 1, dblGates: 1,
  contractValue: 7109.03, quotePrice: 7109.03, scheduledDate: '2026-10-13', scheduledEndDate: null, estimatedDays: 1,
  crewAssigned: 'Crew 1', notes: 'Gate code 1343', ...over,
})
const grid = (over: Partial<GridRow> = {}): GridRow => ({
  id: 'g1', stagingJobId: null, clientName: 'Matt Seabury', area: 'smrfld', sections: 47, fenceType: 'WVND', jobPrice: 9234.36,
  tearout: false, crewId: 'crew1', date: '2026-10-12', notes: '', status: 'Scheduled', ...over,
})
const inputs = (over: Partial<SpecInputs> = {}): SpecInputs => ({
  baseUrl: 'https://jonathans-mac-mini.example.ts.net', workDays: [1, 2, 3, 4], crews: [{ id: 'crew1', name: 'Crew 1' }],
  jobs: [], gridJobs: [], leads: [], contacts: [], appointments: [], ...over,
})
const appt = (over: Record<string, unknown> = {}) => ({
  id: 'a1', crmContactId: 'c5', type: 'estimate', status: 'scheduled',
  startAt: new Date('2026-10-16T14:00:00Z') as Date | null, endAt: new Date('2026-10-16T15:00:00Z') as Date | null, allDay: false,
  address: '1 Main St, Ocala, FL 34470', assignedTo: 'Jonathan Bohdal', notes: '', source: 'manual', jobId: null as string | null,
  contact: { firstName: 'Pat', lastName: 'Lee', phone: '(352) 555-0123', email: null, serviceAddress: '1 Main St, Ocala, FL 34470' },
  ...over,
} as any)
const only = (evs: CalendarEventSpec[]) => { expect(evs).toHaveLength(1); return evs[0] }

describe('working days', () => {
  test('the next working day skips Friday to Sunday for a Monday to Thursday crew', () => {
    expect(nextWorkday('2026-10-14', [1, 2, 3, 4])).toBe('2026-10-15')   // Wed -> Thu
    expect(nextWorkday('2026-10-15', [1, 2, 3, 4])).toBe('2026-10-19')   // Thu -> Mon
  })
  test('a three day job starting Wednesday ends the next Monday', () => {
    expect(lastWorkday('2026-10-14', 3, [1, 2, 3, 4])).toBe('2026-10-19')
    expect(lastWorkday('2026-10-14', 1, [1, 2, 3, 4])).toBe('2026-10-14')
  })
})

describe('jobs', () => {
  test('a scheduled job becomes an Install event with the details in it', () => {
    const e = only(buildDesiredEvents(inputs({ jobs: [job()] })))
    expect(e.summary).toBe('Install: Shawn Collins (ALUM, 24 sections)')
    expect(e.location).toBe('5904 SW 82nd Terrace Rd, Ocala, FL 34480')
    expect(e.startDate).toBe('2026-10-13'); expect(e.endDate).toBe('2026-10-13')
    for (const s of ['Phone: (352) 555-0101', 'Fence style: ALUM', 'Footage: 144 ft', 'Gates: 1 walk, 1 double', 'Quote price: $7,109.03', 'Notes: Gate code 1343', 'https://jonathans-mac-mini.example.ts.net/?customer=c1']) {
      expect(e.description).toContain(s)
    }
  })
  test('a multi day job is one event across its days', () => {
    expect(only(buildDesiredEvents(inputs({ jobs: [job({ scheduledDate: '2026-10-14', estimatedDays: 3 })] })))).toMatchObject({ startDate: '2026-10-14', endDate: '2026-10-19' })
    expect(only(buildDesiredEvents(inputs({ jobs: [job({ scheduledDate: '2026-10-14', scheduledEndDate: '2026-10-15', estimatedDays: 5 })] })))).toMatchObject({ startDate: '2026-10-14', endDate: '2026-10-15' })
  })
  test('a job with no date has no event', () => {
    expect(buildDesiredEvents(inputs({ jobs: [job({ scheduledDate: '' })] }))).toEqual([])
  })
  test('the title leaves out what is not known', () => {
    expect(only(buildDesiredEvents(inputs({ jobs: [job({ fenceStyle: '', sections: 0 })] }))).summary).toBe('Install: Shawn Collins')
  })
})

describe('schedule board', () => {
  test('an entry becomes an Install event on its day', () => {
    const e = only(buildDesiredEvents(inputs({ gridJobs: [grid()] })))
    expect(e).toMatchObject({ source: 'grid', recordId: 'g1', summary: 'Install: Matt Seabury (WVND, 47 sections)', location: 'smrfld', startDate: '2026-10-12', endDate: '2026-10-12' })
    expect(e.description).toContain('Crew: Crew 1'); expect(e.description).toContain('Quote price: $9,234.36')
  })
  test('the same client on back to back working days is one event, across a weekend too', () => {
    const rows = [grid({ id: 'a', date: '2026-10-14' }), grid({ id: 'b', date: '2026-10-15' }), grid({ id: 'c', date: '2026-10-19' })]
    expect(only(buildDesiredEvents(inputs({ gridJobs: rows })))).toMatchObject({ recordId: 'a', startDate: '2026-10-14', endDate: '2026-10-19' })
  })
  test('the same client weeks apart is two events', () => {
    const evs = buildDesiredEvents(inputs({ gridJobs: [grid({ id: 'a', date: '2026-10-12' }), grid({ id: 'b', date: '2026-11-02' })] }))
    expect(evs.map(e => [e.recordId, e.startDate])).toEqual([['a', '2026-10-12'], ['b', '2026-11-02']])
  })
  test('a job that is on the board is shown once, from the board, with the job\'s address', () => {
    const e = only(buildDesiredEvents(inputs({ jobs: [job()], gridJobs: [grid({ stagingJobId: 'j1', date: '2026-10-20', clientName: 'shawn collins' })] })))
    expect(e).toMatchObject({ source: 'grid', startDate: '2026-10-20', location: '5904 SW 82nd Terrace Rd, Ocala, FL 34480', summary: 'Install: Shawn Collins (ALUM, 24 sections)' })
  })
  test('a rain day reschedule moves the same event; a rain day with no new date says so', () => {
    const before = only(buildDesiredEvents(inputs({ gridJobs: [grid()] })))
    const after = only(buildDesiredEvents(inputs({ gridJobs: [grid({ date: '2026-10-14' })] })))
    expect(eventKey(after)).toBe(eventKey(before)); expect(after.startDate).toBe('2026-10-14')
    expect(only(buildDesiredEvents(inputs({ gridJobs: [grid({ status: 'RainDay' })] }))).summary).toMatch(/^Rain day: Install: Matt Seabury/)
  })
})

describe('estimates', () => {
  const lead = { id: 'l1', customerId: 'c9', firstName: 'Donna', lastName: 'Antill', phone: '(352) 555-0199', address: '82 Bay Rd, Ocklawaha, FL 32179', stage: 'Appointment', scheduledDate: '2026-10-16', notes: 'Wants white vinyl' }
  test('a pipeline card with a date before the sale is an Estimate', () => {
    const e = only(buildDesiredEvents(inputs({ leads: [lead] })))
    expect(e).toMatchObject({ source: 'lead', summary: 'Estimate: Donna Antill', location: '82 Bay Rd, Ocklawaha, FL 32179', startDate: '2026-10-16' })
    expect(e.description).toContain('Notes: Wants white vinyl'); expect(e.description).toContain('/?customer=c9')
  })
  test('a lost card has no event', () => {
    expect(buildDesiredEvents(inputs({ leads: [{ ...lead, stage: 'Lost Sale' }] }))).toEqual([])
  })
  test('a date on a sold card is an Install only when no job carries a date', () => {
    const sold = { ...lead, stage: 'Signed Contract', fenceType: 'WVND', sections: 30 }
    expect(only(buildDesiredEvents(inputs({ leads: [sold] }))).summary).toBe('Install: Donna Antill (WVND, 30 sections)')
    const evs = buildDesiredEvents(inputs({ leads: [sold], jobs: [job({ crmContactId: 'c9' })] }))
    expect(evs.map(e => e.source)).toEqual(['job'])
  })
  const contact = { id: 'c9', firstName: 'Donna', lastName: 'Antill', phone: '(352) 555-0199', email: null, serviceAddress: '82 Bay Rd, Ocklawaha, FL 32179', firstApptDate: '2026-10-16', notes: null }
  test('a customer\'s first appointment date is an Estimate', () => {
    expect(only(buildDesiredEvents(inputs({ contacts: [contact] })))).toMatchObject({ source: 'contact', summary: 'Estimate: Donna Antill', startDate: '2026-10-16' })
  })
  test('the same estimate on the card and on the customer is shown once', () => {
    expect(buildDesiredEvents(inputs({ contacts: [contact], leads: [lead] })).map(e => e.source)).toEqual(['lead'])
    expect(buildDesiredEvents(inputs({ contacts: [{ ...contact, firstApptDate: '2026-10-20' }], leads: [lead] }))).toHaveLength(2)
  })
  test('an appointment is a timed event with a 30 minute reminder', () => {
    const e = only(buildDesiredEvents(inputs({ appointments: [appt()], defaultPerson: 'Jonathan Bohdal' })))
    expect(e).toMatchObject({ source: 'appointment', summary: 'Estimate: Pat Lee', location: '1 Main St, Ocala, FL 34470',
      startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z', reminderMinutes: 30 })
    expect(e.description).toContain('Phone: (352) 555-0123')
    expect(e.description).toContain('/?customer=c5')
  })
  test('someone other than the usual person is named in the title', () => {
    expect(only(buildDesiredEvents(inputs({ appointments: [appt({ assignedTo: 'Stacy Mcgovern', type: 'follow_up' })], defaultPerson: 'Jonathan Bohdal' }))).summary)
      .toBe('Follow up: Pat Lee (Stacy Mcgovern)')
  })
  test('cancelled, no show, imported, undated and job-linked installs are not on the calendar', () => {
    for (const over of [{ status: 'cancelled' }, { status: 'no_show' }, { source: 'import' }, { startAt: null, endAt: null }, { type: 'install', jobId: 'j1', allDay: true }]) {
      expect(buildDesiredEvents(inputs({ appointments: [appt(over)] }))).toEqual([])
    }
  })
  test('a completed appointment stays, marked done; a moved one changes its hash', () => {
    const done = only(buildDesiredEvents(inputs({ appointments: [appt({ status: 'completed' })] })))
    expect(done.summary).toBe('✓ Estimate: Pat Lee')
    const moved = only(buildDesiredEvents(inputs({ appointments: [appt({ startAt: new Date('2026-10-17T14:00:00Z'), endAt: new Date('2026-10-17T15:00:00Z') })] })))
    expect(specHash(moved)).not.toBe(specHash(only(buildDesiredEvents(inputs({ appointments: [appt()] })))))
  })
  test('an all day install with no job is an all day event across its days', () => {
    const e = only(buildDesiredEvents(inputs({ appointments: [appt({ type: 'install', allDay: true, startAt: new Date('2026-10-19T04:00:00Z'), endAt: new Date('2026-10-21T04:00:00Z') })] })))
    expect(e).toMatchObject({ summary: 'Install: Pat Lee', startDate: '2026-10-19', endDate: '2026-10-20' })
    expect(e.reminderMinutes).toBeUndefined()
  })
})

// ── a stand in for Google: accepts an id once, refuses a second insert with 409 ──
function fakeGoogle() {
  const events = new Map<string, CalendarEventSpec>()
  const calls: string[] = []
  let failNext = 0
  const boom = (code: number) => Object.assign(new Error(`google says ${code}`), { code })
  const api: CalendarApi = {
    async insert(_c, id, spec) { calls.push('insert'); if (failNext > 0) { failNext--; throw boom(503) } if (events.has(id)) throw boom(409); events.set(id, spec) },
    async update(_c, id, spec) { calls.push('update'); if (failNext > 0) { failNext--; throw boom(503) } if (!events.has(id)) throw boom(404); events.set(id, spec) },
    async remove(_c, id) { calls.push('remove'); if (failNext > 0) { failNext--; throw boom(503) } if (!events.delete(id)) throw boom(404) },
  }
  return { api, events, calls, failNextCalls: (n: number) => { failNext = n } }
}
function memoryLinks() {
  const links = new Map<string, EventLink>()
  const store: LinkStore = {
    async save(l) { links.set(`${l.source}:${l.recordId}`, { ...l }) },
    async remove(s, r) { links.delete(`${s}:${r}`) },
  }
  return { store, links, list: () => [...links.values()] }
}
const TODAY = '2026-10-09'
function world() {
  const g = fakeGoogle(), l = memoryLinks()
  const run = (inp: Partial<SpecInputs>, today = TODAY) => reconcile({ accountId: 'acct', calendarId: 'cal', today, desired: buildDesiredEvents(inputs(inp)), links: l.list(), api: g.api, store: l.store })
  return { ...g, ...l, run }
}

describe('keeping the calendar in step', () => {
  test('create, then move, then delete a job: one event that appears, moves and disappears', async () => {
    const w = world()
    expect(await w.run({ jobs: [job()] })).toMatchObject({ created: 1, updated: 0, deleted: 0, failed: 0 })
    expect([...w.events.values()].map(e => e.startDate)).toEqual(['2026-10-13'])
    expect(await w.run({ jobs: [job({ scheduledDate: '2026-10-20' })] })).toMatchObject({ created: 0, updated: 1 })
    expect(w.events.size).toBe(1); expect([...w.events.values()][0].startDate).toBe('2026-10-20')
    expect(await w.run({ jobs: [job({ scheduledDate: '' })] })).toMatchObject({ deleted: 1 })
    expect(w.events.size).toBe(0); expect(w.links.size).toBe(0)
  })

  test('saving again with nothing changed sends nothing', async () => {
    const w = world()
    await w.run({ jobs: [job()] }); w.calls.length = 0
    expect(await w.run({ jobs: [job()] })).toMatchObject({ created: 0, updated: 0, unchanged: 1 })
    expect(w.calls).toEqual([])
  })

  test('a lost link cannot make a second event', async () => {
    const w = world()
    await w.run({ jobs: [job()] })
    w.links.clear()                                             // as if the mapping row was lost
    expect(await w.run({ jobs: [job()] })).toMatchObject({ created: 0, updated: 1, failed: 0 })
    expect(w.events.size).toBe(1)
  })

  test('the event id is the same every time for the same record, and differs between records', () => {
    expect(googleEventId('acct', { source: 'job', recordId: 'j1' })).toBe(googleEventId('acct', { source: 'job', recordId: 'j1' }))
    expect(googleEventId('acct', { source: 'job', recordId: 'j1' })).not.toBe(googleEventId('acct', { source: 'lead', recordId: 'j1' }))
    expect(googleEventId('acct', { source: 'job', recordId: 'j1' })).toMatch(/^[a-v0-9]{5,}$/)
  })

  test('history is not back filled, but an event already on the calendar still follows its record into the past', async () => {
    const w = world()
    expect(await w.run({ jobs: [job({ scheduledDate: '2026-09-22' })] })).toMatchObject({ created: 0 })
    await w.run({ jobs: [job()] })
    expect(await w.run({ jobs: [job({ scheduledDate: '2026-10-01' })] })).toMatchObject({ updated: 1, deleted: 0 })
    expect([...w.events.values()][0].startDate).toBe('2026-10-01')
  })

  test('a Google outage is recorded and the next run finishes the job', async () => {
    const w = world()
    w.failNextCalls(1)
    const first = await w.run({ jobs: [job()] })
    expect(first).toMatchObject({ created: 0, failed: 1 }); expect(first.errors[0].error).toContain('503')
    expect(w.list()[0]).toMatchObject({ status: 'error', attempts: 1 }); expect(w.events.size).toBe(0)
    expect(await w.run({ jobs: [job()] })).toMatchObject({ created: 1, failed: 0 })
    expect(w.list()[0]).toMatchObject({ status: 'synced', attempts: 0, lastError: null }); expect(w.events.size).toBe(1)
  })

  test('one failing event does not stop the others', async () => {
    const w = world()
    w.failNextCalls(1)
    const r = await w.run({ jobs: [job(), job({ id: 'j2', customerName: 'Ken Murphy' })] })
    expect(r).toMatchObject({ created: 1, failed: 1 })
  })

  test('an event deleted by hand in Google is put back on the next change', async () => {
    const w = world()
    await w.run({ jobs: [job()] })
    w.events.clear()
    expect(await w.run({ jobs: [job({ notes: 'call first' })] })).toMatchObject({ updated: 1, failed: 0 })
    expect(w.events.size).toBe(1)
  })

  test('a failed delete is tried again', async () => {
    const w = world()
    await w.run({ jobs: [job()] })
    w.failNextCalls(1)
    expect(await w.run({ jobs: [] })).toMatchObject({ deleted: 0, failed: 1 })
    expect(await w.run({ jobs: [] })).toMatchObject({ deleted: 1 }); expect(w.events.size).toBe(0)
  })

  test('an estimate and a board entry move and disappear the same way', async () => {
    const w = world()
    const lead = { id: 'l1', firstName: 'Donna', lastName: 'Antill', stage: 'Appointment', scheduledDate: '2026-10-16' }
    await w.run({ leads: [lead], gridJobs: [grid()] })
    expect([...w.events.values()].map(e => e.summary).sort()).toEqual(['Estimate: Donna Antill', 'Install: Matt Seabury (WVND, 47 sections)'])
    await w.run({ leads: [{ ...lead, scheduledDate: '2026-10-21' }], gridJobs: [grid({ date: '2026-10-14' })] })
    expect([...w.events.values()].map(e => e.startDate).sort()).toEqual(['2026-10-14', '2026-10-21'])
    await w.run({ leads: [{ ...lead, stage: 'Lost Sale' }], gridJobs: [] })
    expect(w.events.size).toBe(0)
  })

  test('the hash changes when anything shown changes, and only then', () => {
    const a = only(buildDesiredEvents(inputs({ jobs: [job()] })))
    expect(specHash(a)).toBe(specHash(only(buildDesiredEvents(inputs({ jobs: [job()] })))))
    expect(specHash(a)).not.toBe(specHash(only(buildDesiredEvents(inputs({ jobs: [job({ customerPhone: '(352) 555-0000' })] })))))
  })
})

describe('which calendar', () => {
  // The import is deferred: the module reads the database client at load.
  // null = no GOOGLE_CALENDAR_NAME in the settings file (undefined would read this machine's own setting).
  test('only the live install uses the real calendar name; every other copy gets (TEST)', async () => {
    const { calendarName } = await import('../src/server/lib/calendarSync/index')
    const HOME = '/Users/someone'
    expect(calendarName(`${HOME}/ezbiz/apps/portal`, HOME, null)).toBe('Getter Done Fence')
    expect(calendarName(`${HOME}/Downloads/project/apps/portal`, HOME, null)).toBe('Getter Done Fence (TEST)')
    expect(calendarName(`${HOME}/Downloads/project/apps/portal`, HOME, 'Getter Done Fence')).toBe('Getter Done Fence (TEST)')
    expect(calendarName(`${HOME}/Downloads/project/apps/portal`, HOME, 'Getter Done Fence (TEST)')).toBe('Getter Done Fence (TEST)')
    expect(calendarName(`${HOME}/ezbiz-copy/apps/portal`, HOME, null)).toBe('Getter Done Fence (TEST)')
  })
})
