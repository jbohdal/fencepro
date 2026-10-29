/**
 * The Salesman's Schedule (Jonathan, Oct 29 2026, D5: "Hide deposit amounts,
 * prices and other customers' phone numbers from Christa's Schedule. She only
 * needs names, addresses and dates."; lib/salesSchedule.ts).
 *
 * Against the dev database (DEV_DB=1; refuses any other), on a throwaway
 * company, through the real routes, signed in as the Salesman, the office, the
 * owner and the Installer:
 *   - the Salesman's reads of the Schedule (the board, its entries, Ready to
 *     schedule, one job's install facts, a rain day worked out) carry no money,
 *     notes, phone or email of an install that is not hers, and still carry
 *     every name, address and date; her own installs are unchanged;
 *   - the owner and office read everything as before; the Installer no price;
 *   - every save of the Schedule from the Salesman is refused, and a Salesman
 *     and the office saving at the same time (the Schedule, and the business
 *     record with other customers' invoices and payments in it) leave every
 *     hidden field byte for byte.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman\'s Schedule: no money or other customers\' phones (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: schedule } = await import('../src/server/routes/schedule.js')
  const { default: business } = await import('../src/server/routes/business-state.js')
  const { hideCostsFromLimitedLogins } = await import('../src/server/lib/costRedact.js')
  const { refuseScopedCrew } = await import('../src/server/lib/crewScope.js')
  const { forgetHandedOut } = await import('../src/server/lib/salesServed.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `ssd-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', office = '', sales = '', crew = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}

  const OTHER_PHONE = '3525550402', OTHER_EMAIL = `otto-${tag}@example.invalid`
  const MINE_PHONE = '3525550401'
  const OLD_PHONE = '352 555 0499'
  /** Amounts that belong to other customers' installs: none may reach the Salesman. */
  const OTHER_MONEY = ['8409', '840900', '420450', '200000', '7777', '3150']

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const mkUser = (first: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${role}@example.invalid`, firstName: first, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const [o, of, s, c] = [await mkUser('Olive', 'super_admin'), await mkUser('Opal', 'office_staff'), await mkUser('Sally', 'sales_rep'), await mkUser('Carl', 'field_crew')]
    const tok = (u: any) => jwt.sign({ sub: u.id, email: u.email, role: u.role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = tok(o); office = tok(of); sales = tok(s); crew = tok(c)

    await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: [{ id: 'c1', name: 'Crew One', color: 'bg-blue-500' }] } })
    ids.cMine = (await prisma.crmContact.create({ data: { accountId, firstName: 'Mina', lastName: tag, ownerId: s.id, phone: MINE_PHONE } as any })).id
    ids.cOther = (await prisma.crmContact.create({ data: { accountId, firstName: 'Otto', lastName: tag, ownerId: o.id, salesRep: `Olive ${tag}`, phone: OTHER_PHONE, email: OTHER_EMAIL } as any })).id
    const job = (k: string, contact: string, rep: string, name: string, phone: string, addr: string, f: Record<string, unknown>) =>
      prisma.savedJob.create({ data: { accountId, crmContactId: contact, salesRep: rep, customerName: name, customerPhone: phone, customerEmail: contact === ids.cOther ? OTHER_EMAIL : '', customerAddress: addr, fenceStyle: "WV-ND 6'x8' Privacy", sections: 30, totalFeet: 240, ...f } as any }).then(j => { ids[k] = j.id })
    // Waiting (Ready to schedule) and booked, of each.
    await job('jOther', ids.cOther, `Olive ${tag}`, `Otto ${tag}`, OTHER_PHONE, '9 Other Rd, Ocala, FL', { status: 'staging', opsStage: 'permit_pending', materialsStatus: 'ordered', contractValue: 8409, quotePrice: 8409 })
    await job('jMine', ids.cMine, `Sally ${tag}`, `Mina ${tag}`, MINE_PHONE, '1 Mine St, Ocala, FL', { status: 'staging', opsStage: 'permit_pending', materialsStatus: 'ordered', contractValue: 5000, quotePrice: 5000 })
    await job('jOtherB', ids.cOther, `Olive ${tag}`, `Otto ${tag}`, OTHER_PHONE, '9 Other Rd, Ocala, FL', { status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-11-05', scheduledEndDate: '2026-11-09', crewAssigned: 'Crew One', contractValue: 7777, quotePrice: 7777 })
    await job('jMineB', ids.cMine, `Sally ${tag}`, `Mina ${tag}`, MINE_PHONE, '1 Mine St, Ocala, FL', { status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-11-05', scheduledEndDate: '2026-11-05', crewAssigned: 'Crew One', contractValue: 5100, quotePrice: 5100 })

    // Deposits: Otto's 4,204.50 invoice with 2,000 paid; Mina's 2,500 paid in full.
    for (const [k, jobId, contact, cents, paid] of [['psOther', ids.jOther, ids.cOther, 420450, 200000], ['psMine', ids.jMine, ids.cMine, 250000, 250000]] as const) {
      const ps = await prisma.paymentSchedule.create({ data: { accountId, jobId, crmContactId: contact, signedCents: cents * 2 } })
      ids[k] = ps.id
      await prisma.contractInvoice.create({ data: { accountId, scheduleId: ps.id, jobId, crmContactId: contact, key: 'deposit', kind: 'deposit', label: 'Deposit', originalCents: cents, amountCents: cents, contractCents: cents * 2 } })
      await prisma.contractPayment.create({ data: { id: `${tag}-${k}-pay`, accountId, jobId, crmContactId: contact, amountCents: paid, method: 'check', paidOn: '2026-10-20' } })
    }

    // The board: two days of Otto's install, one of Mina's, and an old entry with only a name.
    const entry = (stagingJobId: string | null, clientName: string, area: string, date: string, jobPrice: number, notes: string) =>
      prisma.scheduledGridJob.create({ data: { accountId, stagingJobId, clientName, area, sections: 30, fenceType: 'WV-ND', jobPrice, crewId: 'c1', date, notes, status: 'Scheduled' } })
    ids.gOther1 = (await entry(ids.jOtherB, `Otto ${tag}`, '9 Other Rd, Ocala, FL', '2026-11-05', 7777, `Gate code 4411, call Otto at ${OTHER_PHONE}, $3150 due on completion`)).id
    ids.gOther2 = (await entry(ids.jOtherB, `Otto ${tag}`, '9 Other Rd, Ocala, FL', '2026-11-09', 7777, '')).id
    ids.gMine = (await entry(ids.jMineB, `Mina ${tag}`, '1 Mine St, Ocala, FL', '2026-11-05', 5100, 'Dog in the yard')).id
    ids.gOld = (await entry(null, 'Old Manual Job', '77 Old Rd', '2026-11-05', 3150, `Call ${OLD_PHONE}`)).id

    // The business record: other customers' invoices and payments next to the Salesman's own Sales Order.
    await prisma.businessState.create({ data: { accountId,
      invoices: [{ id: `${tag}-inv-other`, customerId: ids.cOther, customerName: `Otto ${tag}`, totalCents: 840900, status: 'sent', lineItems: [] }],
      payments: [{ id: `${tag}-pay-other`, customerId: ids.cOther, invoiceId: `${tag}-inv-other`, amountCents: 200000, paymentMethod: 'check' }],
      pendingOrders: [{ id: `${tag}-so-mine`, customerId: ids.cMine, jobId: ids.jMine, customerName: `Mina ${tag}`, status: 'pending', items: [], notes: '' }],
      config: { company: { name: tag, phone: '3528442677' } },
    } as any })

    const app = express(); app.use(express.json({ limit: '10mb' }))
    // As index.ts mounts them: the Salesman's and Installer's answers without costs (the Installer without prices), the Installer kept off Ready.
    app.use('/api', hideCostsFromLimitedLogins)
    app.use('/api/schedule/ready', refuseScopedCrew)
    app.use('/api/schedule', schedule); app.use('/api/business-state', business)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    forgetHandedOut()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.automationEvent.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.deletionLog.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.scheduleRainDay.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.scheduleSettings.deleteMany({ where: { accountId } })
    await prisma.contractPayment.deleteMany({ where: { accountId } })
    await prisma.contractInvoice.deleteMany({ where: { accountId } })
    await prisma.paymentSchedule.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  /** Nothing of another customer's install that the Salesman may not have: money, phone, email, notes. */
  const expectNothingHidden = (body: unknown) => {
    // Ids are left out first: a random id can hold "7777" by chance.
    const t = JSON.stringify(body).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').split(tag).join('<tag>')
    expect(t).not.toContain(OTHER_PHONE)
    expect(t).not.toContain(OTHER_EMAIL)
    expect(t).not.toContain(OLD_PHONE)
    expect(t).not.toContain('Gate code 4411')
    for (const m of OTHER_MONEY) expect(t).not.toContain(m)
  }
  /** Every hidden field as stored: the board's prices and notes, the jobs' phones and money, deposits and payments. */
  const hiddenNow = async () => JSON.stringify({
    grid: await prisma.scheduledGridJob.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, stagingJobId: true, jobPrice: true, notes: true, deletedAt: true } }),
    jobs: await prisma.savedJob.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, customerPhone: true, customerEmail: true, contractValue: true, quotePrice: true } }),
    contacts: await prisma.crmContact.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, phone: true, email: true } }),
    invoices: await prisma.contractInvoice.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, amountCents: true, originalCents: true, contractCents: true } }),
    payments: await prisma.contractPayment.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, amountCents: true } }),
  })

  test('Ready to schedule: every waiting job with its name, address and stage; another customer\'s carries no deposit or phone; the Salesman\'s own is unchanged', async () => {
    const s = await call('GET', '/api/schedule/ready', sales)
    expect(s.status).toBe(200)
    expectNothingHidden(s.json)
    const byId = new Map(s.json.data.map((r: any) => [r.id, r]))
    expect([...byId.keys()].sort()).toEqual([ids.jOther, ids.jMine].sort())
    const other: any = byId.get(ids.jOther)
    expect(other).toMatchObject({ customerName: `Otto ${tag}`, address: '9 Other Rd, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", footage: 240, materialsStatus: 'ordered', stage: 'permit_pending' })
    for (const k of ['deposit', 'depositCents', 'depositPaidCents', 'phone']) expect(other).not.toHaveProperty(k)
    // The owner reads everything, and the Salesman's own job exactly as the owner does.
    const o = await call('GET', '/api/schedule/ready', owner)
    const oById = new Map(o.json.data.map((r: any) => [r.id, r]))
    expect(oById.get(ids.jOther)).toMatchObject({ deposit: 'part', depositCents: 420450, depositPaidCents: 200000, phone: OTHER_PHONE })
    expect(byId.get(ids.jMine)).toEqual(oById.get(ids.jMine))
    expect(byId.get(ids.jMine)).toMatchObject({ deposit: 'paid', depositCents: 250000, phone: MINE_PHONE })
    // The office too.
    expect((await call('GET', '/api/schedule/ready', office)).json.data.find((r: any) => r.id === ids.jOther)).toMatchObject({ depositCents: 420450, phone: OTHER_PHONE })
  })

  test('one job\'s install facts (the Schedule install window): the same', async () => {
    const s = await call('GET', `/api/schedule/ready/${ids.jOther}`, sales)
    expect(s.status).toBe(200)
    expectNothingHidden(s.json)
    expect(s.json.data).toMatchObject({ id: ids.jOther, customerName: `Otto ${tag}`, address: '9 Other Rd, Ocala, FL' })
    const booked = await call('GET', `/api/schedule/ready/${ids.jOtherB}`, sales)
    expectNothingHidden(booked.json)
    expect(booked.json.data).toMatchObject({ scheduledDate: '2026-11-05', scheduledEndDate: '2026-11-09', bookedDays: ['2026-11-05', '2026-11-09'] })
    const mine = await call('GET', `/api/schedule/ready/${ids.jMine}`, sales)
    expect(mine.json.data).toMatchObject({ depositCents: 250000, phone: MINE_PHONE })
  })

  test('the board and its entries: names, addresses and dates of every install; no price or notes on another customer\'s; the Salesman\'s own unchanged', async () => {
    for (const path of ['/api/schedule/board', '/api/schedule/jobs']) {
      const s = await call('GET', path, sales)
      expect(s.status).toBe(200)
      expectNothingHidden(s.json)
      const list: any[] = path.endsWith('board') ? s.json.data.jobs : s.json.data
      const g = (id: string) => list.find(x => x.id === id)
      for (const id of [ids.gOther1, ids.gOther2, ids.gOld]) {
        expect(g(id)).toBeTruthy()
        expect(g(id)).not.toHaveProperty('jobPrice')
        expect(g(id)).not.toHaveProperty('notes')
      }
      expect(g(ids.gOther1)).toMatchObject({ clientName: `Otto ${tag}`, area: '9 Other Rd, Ocala, FL', date: '2026-11-05', crewId: 'c1', status: 'Scheduled', stagingJobId: ids.jOtherB })
      expect(g(ids.gOld)).toMatchObject({ clientName: 'Old Manual Job', area: '77 Old Rd', date: '2026-11-05' })
      expect(g(ids.gMine)).toMatchObject({ jobPrice: 5100, notes: 'Dog in the yard' })
      // Dates come through as dates (not walked into {}).
      expect(typeof g(ids.gOther1).createdAt).toBe('string')
      const o = await call('GET', path, owner)
      const og = (path.endsWith('board') ? o.json.data.jobs : o.json.data).find((x: any) => x.id === ids.gOther1)
      expect(og).toMatchObject({ jobPrice: 7777, notes: expect.stringContaining('Gate code 4411') })
    }
  })

  test('a rain day worked out: every install that moves, with no text (addressed to the customer\'s phone) for another customer\'s', async () => {
    const s = await call('POST', '/api/schedule/rain-day/preview', sales, { date: '2026-11-05' })
    expect(s.status).toBe(200)
    expectNothingHidden(s.json)
    const other = s.json.data.find((m: any) => m.jobId === ids.jOtherB)
    expect(other).toMatchObject({ customerName: `Otto ${tag}`, startFrom: '2026-11-05', text: null })
    const mine = s.json.data.find((m: any) => m.jobId === ids.jMineB)
    expect(mine.text).toMatchObject({ phone: MINE_PHONE })
    const o = await call('POST', '/api/schedule/rain-day/preview', owner, { date: '2026-11-05' })
    expect(o.json.data.find((m: any) => m.jobId === ids.jOtherB).text).toMatchObject({ phone: OTHER_PHONE })
  })

  test('the Installer still gets no price on the board, and no Ready list', async () => {
    const b = await call('GET', '/api/schedule/board', crew)
    expect(b.status).toBe(200)
    for (const j of b.json.data.jobs) expect(j).not.toHaveProperty('jobPrice')
    expect(JSON.stringify(b.json)).not.toContain('$3150')
    expect((await call('GET', '/api/schedule/ready', crew)).status).toBe(403)
  })

  test('every save of the Schedule from the Salesman is refused before anything is read; nothing changes', async () => {
    const before = await hiddenNow()
    const v = (await prisma.scheduleSettings.findUnique({ where: { accountId } }))!.version
    const board = (await call('GET', '/api/schedule/board', sales)).json.data
    const tries = [
      call('PUT', '/api/schedule/board', sales, { settings: board.settings, jobs: board.jobs, baseVersion: board.version }),
      call('POST', '/api/schedule/jobs/sync', sales, { jobs: board.jobs }),
      call('PATCH', `/api/schedule/jobs/${ids.gOther1}`, sales, { notes: '' }),
      call('POST', '/api/schedule/jobs', sales, { clientName: 'x', date: '2026-11-10' }),
      call('DELETE', `/api/schedule/jobs/${ids.gOther2}`, sales),
      call('POST', '/api/schedule/install', sales, { jobId: ids.jMine, start: '2026-11-10' }),
      call('POST', `/api/schedule/install/${ids.jOtherB}/off`, sales, {}),
      call('POST', '/api/schedule/rain-day', sales, { date: '2026-11-05' }),
      call('POST', '/api/schedule/rain-log', sales, { jobId: ids.jOtherB, originalDate: '2026-11-05' }),
      call('PUT', '/api/schedule/settings', sales, { workDays: [1, 2, 3, 4], crews: [], baseVersion: board.version }),
    ]
    for (const r of await Promise.all(tries)) {
      expect(r.status).toBe(403)
      expectNothingHidden(r.json)
    }
    expect(await hiddenNow()).toBe(before)
    expect((await prisma.scheduleSettings.findUnique({ where: { accountId } }))!.version).toBe(v)
    expect(await prisma.scheduleRainDay.count({ where: { accountId } })).toBe(0)
  })

  test('the Salesman and the office save at the same time (the Schedule and the business record, other customers\' invoices and payments in it): the office\'s changes land, every hidden field byte for byte', async () => {
    forgetHandedOut()
    const before = JSON.parse(await hiddenNow())
    const bsBefore = (await prisma.businessState.findUnique({ where: { accountId } }))!
    let officeNote = ''
    for (let round = 1; round <= 6; round++) {
      // Both read, then both save at once: the Salesman her board copy (a moved day) and her own Sales Order; the office its board (Mina's day moved) and Otto's payment.
      const sb = (await call('GET', '/api/schedule/board', sales)).json.data
      const ob = (await call('GET', '/api/schedule/board', office)).json.data
      const sbs = (await call('GET', '/api/business-state', sales)).json.data
      const obs = (await call('GET', '/api/business-state', office)).json.data
      expectNothingHidden(sb); expect(sbs.invoices).toEqual([]); expect(sbs.payments).toEqual([])
      const sJobs = sb.jobs.map((j: any) => (j.id === ids.gOther1 ? { ...j, date: '2026-11-12' } : j))
      const oJobs = ob.jobs.map((j: any) => (j.id === ids.gMine ? { ...j, date: round % 2 ? '2026-11-10' : '2026-11-05' } : j))
      officeNote = `office round ${round}`
      const [sBoard, oBoard, sBiz, oBiz] = await Promise.all([
        call('PUT', '/api/schedule/board', sales, { settings: sb.settings, jobs: sJobs, baseVersion: sb.version }),
        call('PUT', '/api/schedule/board', office, { settings: ob.settings, jobs: oJobs, baseVersion: ob.version }),
        call('PATCH', '/api/business-state', sales, { pendingOrders: sbs.pendingOrders.map((p: any) => ({ ...p, notes: `sales round ${round}` })), invoices: sbs.invoices, payments: sbs.payments, baseVersion: sbs.version }),
        call('PATCH', '/api/business-state', office, { payments: obs.payments.map((p: any) => ({ ...p, paymentMethod: round % 2 ? 'card' : 'check' })), baseVersion: obs.version }),
      ])
      expect(sBoard.status).toBe(403)
      expectNothingHidden(sBoard.json)
      expect(oBoard.status).toBe(200)
      // The two business record saves raced: one lands, the other may be told to merge (409), as the app does; then saves again.
      for (const [who, r, retry] of [['sales', sBiz, async (d: any) => call('PATCH', '/api/business-state', sales, { pendingOrders: d.pendingOrders.map((p: any) => ({ ...p, notes: `sales round ${round}` })), invoices: d.invoices, payments: d.payments, baseVersion: d.version })],
        ['office', oBiz, async (d: any) => call('PATCH', '/api/business-state', office, { payments: d.payments.map((p: any) => ({ ...p, paymentMethod: round % 2 ? 'card' : 'check' })), baseVersion: d.version })]] as const) {
        if (r.status === 409) {
          if (who === 'sales') expectNothingHidden(r.json)
          const again = await retry({ ...r.json.data, version: r.json.version })
          expect(again.status).toBe(200)
        } else expect(r.status).toBe(200)
      }
      const now = JSON.parse(await hiddenNow())
      // The board: only the office's day moved; every price and note as stored; nothing removed or added.
      expect(now.grid).toEqual(before.grid)
      expect(now.jobs).toEqual(before.jobs)
      expect(now.contacts).toEqual(before.contacts)
      expect(now.invoices).toEqual(before.invoices)
      expect(now.payments).toEqual(before.payments)
      const g = await prisma.scheduledGridJob.findMany({ where: { accountId }, select: { id: true, date: true } })
      expect(g.find(x => x.id === ids.gMine)!.date).toBe(round % 2 ? '2026-11-10' : '2026-11-05')
      expect(g.find(x => x.id === ids.gOther1)!.date).toBe('2026-11-05')
      const bs: any = (await prisma.businessState.findUnique({ where: { accountId } }))!
      expect(bs.invoices).toEqual(bsBefore.invoices)
      expect(bs.payments).toEqual((bsBefore.payments as any[]).map(p => ({ ...p, paymentMethod: round % 2 ? 'card' : 'check' })))
      expect(bs.pendingOrders[0].notes).toBe(`sales round ${round}`)
    }
    expect(officeNote).toBe('office round 6')
  })
})
