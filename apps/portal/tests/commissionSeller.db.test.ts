/**
 * Commission stays with whoever sold it (lib/soldBy.ts; Jonathan, Nov 2 2026:
 * "COMMISSION STAYS with whoever sold it when a signed job is moved. Owner can
 * edit it by hand."). Against the dev database (DEV_DB=1; refuses any other),
 * on a throwaway company, through the same middleware order as index.ts.
 *
 *   - A signed job moved: the rep moves, the seller stays, in every grouping
 *     the server feeds (the quote list's soldBy, job costing's By salesman).
 *   - Moved twice, and moved before the record existed (the audit log).
 *   - An unsigned quote: unchanged, no record.
 *   - The hand edit: the owner only, nothing the customer reads changes, it
 *     holds through later saves and moves, and it is in the audit log.
 *   - What the Salesman and the Installer get.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('commission stays with whoever sold it (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped } = await import('../src/server/lib/salesScope.js')
  const { hideCostsFromLimitedLogins } = await import('../src/server/lib/costRedact.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { reportJobs } = await import('../src/server/lib/jobCosting.js')
  const { forgetMovedSellers } = await import('../src/server/lib/soldBy.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `csl-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = ''
  const tok: Record<string, string> = {}
  const id: Record<string, string> = {}
  let server: ReturnType<express.Express['listen']>
  const name = (first: string) => `${first} ${tag}`
  const SALLY = name('Sally'), SAM = name('Sam'), OLIVE = name('Olive')

  const newQuote = async (data: any) => (await prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', crmContactId: id.cara, customerName: `Cara ${tag}`, salesRep: SALLY, ...data } })).id
  /** A signed quote of Sally's, $10,000 less $6,000 cost less 9% commission, its job finished. */
  const signedJob = async (data: any = {}) => {
    const q = await newQuote({ status: 'SOLD', soldAt: new Date(), finalPrice: 10000, totalCOGS: 6000, gmPct: 0.31, hasSalesman: true, pricing: { commissionPct: 0.09 }, ...data })
    const j = (await prisma.savedJob.create({ data: { accountId, quoteId: q, crmContactId: id.cara, customerName: `Cara ${tag}`, salesRep: data.salesRep ?? SALLY, quotePrice: 10000, contractValue: 10000, gmPct: 0.31, hasSalesman: true, status: 'completed', completedDate: '2026-10-20' } })).id
    return { q, j }
  }

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = async (key: string, firstName: string, role: string) => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } })
      id[key] = u.id
      tok[key] = jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    await user('owner', 'Olive', 'super_admin')
    await user('admin', 'Adam', 'admin')
    await user('office', 'Opal', 'office_staff')
    await user('manager', 'Mona', 'manager')
    await user('sally', 'Sally', 'sales_rep')
    await user('sam', 'Sam', 'sales_rep')
    await user('installer', 'Ivan', 'field_crew')
    id.cara = (await prisma.crmContact.create({ data: { accountId, firstName: 'Cara', lastName: tag, ownerId: id.owner, salesRep: OLIVE } })).id
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [] } as any })

    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api', hideCostsFromLimitedLogins)
    app.use('/api/saved-jobs', salesScoped('jobs')); app.use('/api/saved-quotes', salesScoped('quotes'))
    app.use('/api/saved-jobs', jobs); app.use('/api/saved-quotes', quotes)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    const ids = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map(x => x.id)
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.paymentSchedule.deleteMany({ where: { accountId } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { entityId: { in: ids } }] } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
    forgetMovedSellers()
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const quoteOf = async (qid: string) => (await prisma.savedQuote.findUnique({ where: { id: qid } })) as any
  const jobOf = async (jid: string) => (await prisma.savedJob.findUnique({ where: { id: jid } })) as any
  const moveTo = (qid: string, to: string) => call('POST', `/api/saved-quotes/${qid}/salesman`, tok.owner, { to, confirm: true })
  const inList = async (qid: string, token = tok.owner) => (await call('GET', '/api/saved-quotes', token)).json.data.find((x: any) => x.id === qid)
  const inReport = async (jid: string) => (await reportJobs(accountId)).find(r => r.jobId === jid)!

  test('a signed job moved: the rep moves, the question names the seller, and the seller is credited everywhere', async () => {
    const { q, j } = await signedJob()
    const ask = await call('POST', `/api/saved-quotes/${q}/salesman`, tok.owner, { to: id.sam })
    expect(ask.status).toBe(409)
    expect(ask.json.confirm.question).toBe(`This job is signed. Move it from ${SALLY} to ${SAM}? Its $900.00 commission stays with ${SALLY}.`)
    expect((await moveTo(q, id.sam)).json.data.commissionWords).toBe(`Its commission stays with ${SALLY}.`)
    // Who works it now: Sam.
    expect([(await quoteOf(q)).salesRep, (await jobOf(j)).salesRep]).toEqual([SAM, SAM])
    // Who sold it: Sally, in the quote list (Sales by rep) and job costing's By salesman.
    expect((await inList(q)).soldBy).toBe(SALLY)
    expect((await inReport(j)).salesRep).toBe(SALLY)
    // No money on the History line.
    const note = await prisma.crmContactNote.findFirst({ where: { accountId, body: { contains: q.slice(-6).toUpperCase() } } })
    expect(note!.body).toContain(`its commission stays with ${SALLY}`)
    expect(note!.body).not.toMatch(/\$/)
  })

  test('moved again: the first seller stays; moved back to the seller reads as never moved', async () => {
    const { q, j } = await signedJob()
    await moveTo(q, id.sam)
    const again = await moveTo(q, id.owner)
    expect(again.json.data.commissionWords).toBe(`Its commission stays with ${SALLY}.`)
    expect((await quoteOf(q)).pricing.soldBy).toBe(SALLY)
    expect((await inReport(j)).salesRep).toBe(SALLY)
    await moveTo(q, id.sally)
    expect((await inList(q)).soldBy).toBeUndefined()
    expect((await inList(q)).salesRep).toBe(SALLY)
  })

  test('moved before the record existed: the audit log has who sold it; nothing is rewritten; the next move writes it', async () => {
    const { q, j } = await signedJob({ salesRep: SAM })
    await prisma.savedJob.update({ where: { id: j }, data: { salesRep: SAM } })
    const before = await quoteOf(q)
    await prisma.crmAuditLog.create({ data: { userId: id.owner, action: 'update', entityType: 'SavedQuote', entityId: q, oldValues: { salesRep: SALLY }, newValues: { salesRep: SAM, salesmanMoved: { from: SALLY, to: SAM, signed: true } } } })
    forgetMovedSellers()
    expect((await inList(q)).soldBy).toBe(SALLY)
    expect((await inReport(j)).salesRep).toBe(SALLY)
    expect((await quoteOf(q)).pricing).toEqual(before.pricing)
    await moveTo(q, id.owner)
    expect((await quoteOf(q)).pricing.soldBy).toBe(SALLY)
  })

  test('an unsigned quote moves as before: no question, no record, no seller', async () => {
    const q = await newQuote({ status: 'SENT', finalPrice: 10000, totalCOGS: 6000, gmPct: 0.31, hasSalesman: true, pricing: { commissionPct: 0.09 } })
    const r = await call('POST', `/api/saved-quotes/${q}/salesman`, tok.owner, { to: id.sam })
    expect(r.status).toBe(200)
    expect(r.json.data.commissionWords).toBe('Its commission goes with it.')
    const after = await quoteOf(q)
    expect(after.salesRep).toBe(SAM)
    expect(after.pricing).toEqual({ commissionPct: 0.09 })
    expect((await inList(q)).soldBy).toBeUndefined()
  })

  test('the hand edit: price, cost, status, contract and schedule stay; only the saved margin and the commission change', async () => {
    const { q, j } = await signedJob()
    const schedule = await prisma.paymentSchedule.create({ data: { accountId, jobId: j, quoteId: q, crmContactId: id.cara, signedCents: 1000000, depositPct: 50 } })
    const q0 = await quoteOf(q), j0 = await jobOf(j)
    expect((await call('GET', `/api/saved-quotes/${q}/commission`, tok.owner)).json.data).toMatchObject({ signed: true, soldBy: SALLY, commissionCents: 90000, byHand: false })
    const r = await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 120050, to: id.sam })
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ soldBy: SAM, commissionCents: 120050 })
    expect((await call('GET', `/api/saved-quotes/${q}/commission`, tok.owner)).json.data).toMatchObject({ soldBy: SAM, commissionCents: 120050, byHand: true })
    const q1 = await quoteOf(q), j1 = await jobOf(j)
    expect(q1.gmPct).toBeCloseTo((1000000 - 600000 - 120050) / 1000000, 10)
    expect(j1.gmPct).toBeCloseTo(q1.gmPct, 10)
    const drop = (o: any, ...keys: string[]) => { const c = { ...o }; for (const k of ['updatedAt', 'gmPct', 'pricing', ...keys]) delete c[k]; return JSON.parse(JSON.stringify(c)) }
    expect(drop(q1)).toEqual(drop(q0))
    expect(drop(j1)).toEqual(drop(j0))
    // The switch and the % stay: a change order is priced from them.
    expect(q1.hasSalesman).toBe(true)
    expect(q1.pricing.commissionPct).toBe(0.09)
    expect(await prisma.paymentSchedule.findUnique({ where: { id: schedule.id } })).toEqual(schedule)
    // Credited to the new name, sale and commission together.
    expect((await inReport(j)).salesRep).toBe(SAM)
    // In the audit log with old and new.
    const log = await prisma.crmAuditLog.findFirst({ where: { entityType: 'SavedQuote', entityId: q, userId: id.owner }, orderBy: { createdAt: 'desc' } }) as any
    expect(log.oldValues).toMatchObject({ soldBy: SALLY, commissionCents: 90000 })
    expect(log.newValues).toMatchObject({ soldBy: SAM, commissionCents: 120050, commissionHandEdit: true })
  })

  test('the hand edit survives a later save (an older copy too), and later moves', async () => {
    const { q, j } = await signedJob()
    await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 50000 })
    const saved = await quoteOf(q)
    // A phone read the quote before the edit: its old margin, its pricing with no record.
    const older = await call('PATCH', `/api/saved-quotes/${q}`, tok.owner, { notes: 'gate code 1234', gmPct: 0.31, hasSalesman: true, pricing: { commissionPct: 0.09 }, finalPrice: 10000 })
    expect(older.status).toBe(200)
    let now = await quoteOf(q)
    expect(now.notes).toBe('gate code 1234')
    expect(now.gmPct).toBe(saved.gmPct)
    expect(now.pricing).toEqual(saved.pricing)
    // A save from a copy that has it.
    expect((await call('PATCH', `/api/saved-quotes/${q}`, tok.office, { notes: 'second', pricing: saved.pricing, gmPct: saved.gmPct })).status).toBe(200)
    expect((await quoteOf(q)).pricing).toEqual(saved.pricing)
    // A real price change is still refused.
    expect((await call('PATCH', `/api/saved-quotes/${q}`, tok.owner, { finalPrice: 11000 })).status).toBe(409)
    await moveTo(q, id.sam)
    await moveTo(q, id.owner)
    now = await quoteOf(q)
    expect(now.gmPct).toBe(saved.gmPct)
    expect(now.pricing).toMatchObject({ commissionHandCents: 50000, soldBy: SALLY })
    expect((await jobOf(j)).gmPct).toBe(saved.gmPct)
    expect((await call('GET', `/api/saved-quotes/${q}/commission`, tok.owner)).json.data).toMatchObject({ soldBy: SALLY, commissionCents: 50000 })
  })

  test('the hand edit is refused to everyone but the owner, on the server, and nothing changes', async () => {
    const { q } = await signedJob()
    const q0 = await quoteOf(q)
    for (const who of ['admin', 'office', 'manager', 'sally', 'sam', 'installer']) {
      const w = await call('POST', `/api/saved-quotes/${q}/commission`, tok[who], { commissionCents: 1 })
      expect([who, w.status === 403 || w.status === 404]).toEqual([who, true])
      const r = await call('GET', `/api/saved-quotes/${q}/commission`, tok[who])
      expect([who, r.status === 403 || r.status === 404]).toEqual([who, true])
    }
    expect(await quoteOf(q)).toEqual(q0)
  })

  test('the hand edit: only a signed quote, whole cents, not above the price, to a real login', async () => {
    const open = await newQuote({ status: 'SENT', finalPrice: 10000, totalCOGS: 6000, gmPct: 0.31, hasSalesman: true })
    expect((await call('POST', `/api/saved-quotes/${open}/commission`, tok.owner, { commissionCents: 100 })).json.code).toBe('NOT_SIGNED')
    const { q } = await signedJob()
    for (const bad of [-1, 10.5, '100', null, 1000001]) expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: bad })).status).toBe(400)
    expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { to: 'nobody' })).json.code).toBe('NOT_ASSIGNABLE')
    expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { to: id.installer })).json.code).toBe('NOT_ASSIGNABLE')
    expect((await quoteOf(q)).gmPct).toBe(0.31)
    expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 0 })).status).toBe(200)
    expect((await call('GET', `/api/saved-quotes/${q}/commission`, tok.owner)).json.data.commissionCents).toBe(0)
  })

  test('a move and a save at once: the move stops rather than lose the save', async () => {
    const { q } = await signedJob()
    const { moveSalesman } = await import('../src/server/lib/salesmanMove.js')
    const [a, b] = await Promise.all([
      moveSalesman({ accountId, quoteId: q, toUserId: id.sam, by: { id: id.owner, name: OLIVE }, confirm: true }),
      call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 70000 }),
    ])
    const after = await quoteOf(q)
    if (a.ok && b.status === 200) expect(after.pricing).toMatchObject({ soldBy: SALLY })
    else expect(a.ok || b.status === 200).toBe(true)
    if (b.status === 200) expect(after.pricing.commissionHandCents).toBe(70000)
  })

  test('a copy of a signed quote carries no record', async () => {
    const made = await call('POST', '/api/saved-quotes', tok.owner, { customerName: `Cara ${tag}`, salesRep: SAM, fenceStyle: 'WV ND 6x8', runs: [100], pricing: { laborMode: 'hourly', soldBy: SALLY, commissionHandCents: 500 } })
    expect(made.status).toBe(201)
    expect((await quoteOf(made.json.data.id)).pricing).toEqual({ laborMode: 'hourly' })
    const open = await newQuote({ status: 'DRAFT', finalPrice: 100, totalCOGS: 50, gmPct: 0.5 })
    await call('PATCH', `/api/saved-quotes/${open}`, tok.owner, { pricing: { laborMode: 'hourly', soldBy: SALLY } })
    expect((await quoteOf(open)).pricing).toEqual({ laborMode: 'hourly' })
  })

  test('the Salesman: a moved job leaves the old one, reaches the new one with the seller\'s name and no hand edit control; the Installer gets no figure', async () => {
    const { q, j } = await signedJob()
    await moveTo(q, id.sam)
    expect(await inList(q, tok.sally)).toBeUndefined()
    expect((await call('GET', `/api/saved-quotes/${q}`, tok.sally)).status).toBe(404)
    expect((await call('GET', `/api/saved-jobs/${j}`, tok.sally)).status).toBe(404)
    expect((await inList(q, tok.sam)).soldBy).toBe(SALLY)
    expect((await call('GET', `/api/saved-quotes/${q}/commission`, tok.sam)).status).toBe(403)
    await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 50000 })
    // The Installer's copy has no money at all (lib/costRedact.ts reads the real bearer; here the role in the token).
    const crew = await inList(q, tok.installer)
    expect(JSON.stringify(crew ?? {})).not.toMatch(/commissionHandCents|50000/)
  })
  test('a signed job with no rep: credited to who wrote the quote, else to no one; never to the new Salesman', async () => {
    const { q, j } = await signedJob({ salesRep: '', ownerId: id.owner })
    await prisma.savedJob.update({ where: { id: j }, data: { salesRep: '' } })
    const ask = await call('POST', `/api/saved-quotes/${q}/salesman`, tok.owner, { to: id.sam })
    expect(ask.json.confirm.question).toBe(`This job is signed. Move it from nobody to ${SAM}? Its $900.00 commission stays with ${OLIVE}.`)
    await moveTo(q, id.sam)
    expect((await inList(q)).soldBy).toBe(OLIVE)
    expect((await inReport(j)).salesRep).toBe(OLIVE)
    const orphan = await signedJob({ salesRep: '', ownerId: null })
    await prisma.savedJob.update({ where: { id: orphan.j }, data: { salesRep: '' } })
    const ask2 = await call('POST', `/api/saved-quotes/${orphan.q}/salesman`, tok.owner, { to: id.sam })
    expect(ask2.json.confirm.question).toBe(`This job is signed. Move it from nobody to ${SAM}? Its $900.00 commission stays credited to no one (it was sold with no Salesman).`)
    expect((await moveTo(orphan.q, id.sam)).json.data.commissionWords).toBe('Its commission stays credited to no one.')
    expect((await quoteOf(orphan.q)).pricing.soldBy).toBe('')
    expect((await inList(orphan.q)).soldBy).toBe('')
    expect((await inReport(orphan.j)).salesRep).toBe('')
    // A later move keeps it credited to no one.
    await moveTo(orphan.q, id.owner)
    expect((await inList(orphan.q)).soldBy).toBe('')
  })

  test('saved with nothing changed: nothing written, not set by hand, not logged', async () => {
    const { q } = await signedJob()
    const before = await quoteOf(q)
    const r = await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 90000 })
    expect(r.json.data).toMatchObject({ unchanged: true, byHand: false, commissionCents: 90000 })
    expect(await quoteOf(q)).toEqual(before)
    expect(await prisma.crmAuditLog.count({ where: { entityId: q } })).toBe(0)
    expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 90000, to: id.sally })).json.data.unchanged).toBe(true)
  })

  test('the commission goes to the owner or a Salesman only; the reply says what the job makes before it', async () => {
    const { q } = await signedJob()
    for (const who of ['admin', 'office', 'manager', 'installer']) expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { to: id[who] })).json.code).toBe('NOT_ASSIGNABLE')
    expect((await call('GET', `/api/saved-quotes/${q}/commission`, tok.owner)).json.data.beforeCents).toBe(400000)
    // Above it: allowed for the owner (the screen warns first).
    expect((await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 500000, to: id.owner })).json.data).toMatchObject({ soldBy: OLIVE, commissionCents: 500000 })
    expect((await quoteOf(q)).gmPct).toBeCloseTo(-0.1, 10)
  })

  test('a Salesman\'s phone never gets the hand-typed figure: list, one quote, a save\'s reply, a job', async () => {
    const { q, j } = await signedJob({ salesRep: SAM })
    await prisma.savedJob.update({ where: { id: j }, data: { salesRep: SAM } })
    await call('POST', `/api/saved-quotes/${q}/commission`, tok.owner, { commissionCents: 123456, to: id.sally })
    const replies = [
      await call('GET', '/api/saved-quotes', tok.sam),
      await call('GET', `/api/saved-quotes/${q}`, tok.sam),
      await call('PATCH', `/api/saved-quotes/${q}`, tok.sam, { notes: 'sam note' }),
      await call('GET', '/api/saved-jobs', tok.sam),
      await call('GET', `/api/saved-jobs/${j}`, tok.sam),
    ]
    for (const r of replies) {
      expect(r.status).toBe(200)
      expect(JSON.stringify(r.json)).not.toMatch(/commissionHandCents|123456/)
    }
    const mine = (replies[0].json.data as any[]).find(x => x.id === q)
    expect(mine.pricing).toMatchObject({ commissionByHand: true, soldBy: SALLY })
    expect(mine.soldBy).toBe(SALLY)
    // Her save back with that copy keeps the owner's figure.
    expect((await call('PATCH', `/api/saved-quotes/${q}`, tok.sam, { notes: 'again', pricing: mine.pricing, gmPct: mine.gmPct })).status).toBe(200)
    expect((await quoteOf(q)).pricing).toMatchObject({ commissionHandCents: 123456, soldBy: SALLY })
    expect((await quoteOf(q)).pricing.commissionByHand).toBeUndefined()
    // The owner still gets the figure.
    expect(JSON.stringify((await call('GET', `/api/saved-quotes/${q}`, tok.owner)).json)).toMatch(/commissionHandCents/)
  })
})
