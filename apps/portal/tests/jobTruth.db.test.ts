/**
 * One source of truth for a job (dev database, DEV_DB=1; refuses any other),
 * on a throwaway company:
 *
 *   - the 811 locate: saved on the job page (PUT /api/saved-jobs/:id/locate)
 *     and on the crew packet (POST /p/i/<token>/locate) into the same fields;
 *     each sees the other's; a job save (PATCH) never overwrites it;
 *   - the milestones follow the records: the locate, the permit, the schedule;
 *     a hand tick on Locate Complete is refused, one on Photos is labeled;
 *   - the payment schedule makes the job "invoiced" with the deposit due, and a
 *     stale screen's "not_invoiced" save does not undo it;
 *   - the final walkthrough signed and the final payment: the job moves to
 *     Complete by itself, and its pipeline card to Job complete;
 *   - a quoted cost saved for another option is replaced by the signed one's.
 * Everything made is removed at the end.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('job truth (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: payments } = await import('../src/server/routes/payments.js')
  const { packetPublic } = await import('../src/server/routes/installPacket.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const truth = await import('../src/server/lib/jobTruth.js')
  const { snapshotQuotedCost } = await import('../src/server/lib/jobCosting.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `jt-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', owner = '', base = '', userId = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}
  const call = (method: string, p: string, body?: unknown, auth = true) => fetch(base + p, { method, headers: { ...(auth ? { Authorization: `Bearer ${owner}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any, }))

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    userId = crypto.randomUUID()
    owner = jwt.sign({ sub: userId, email: `${tag}@example.invalid`, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Getter Done Fence', phone: '3527894314' } } as any } })
    await billing.schedulesFrom(accountId)
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Manuel', lastName: tag, phone: '3526718083' } as any })
    ids.contact = c.id
    // Sold in the app at the white option, then signed at the tan one (as Manuel Cotrich's was).
    const q = await prisma.savedQuote.create({ data: {
      accountId, crmContactId: c.id, customerName: `Manuel ${tag}`, customerAddress: '1301 SE Silver Springs Pl, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", runs: [160], pullSheet: [{ item: 'Post', qty: 21, unitCost: 30 }],
      finalPrice: 6072.01, materialCost: 2000, laborCost: 1148.45, totalCOGS: 3148.45, status: 'SOLD', soldAt: new Date(),
    } as any })
    ids.quote = q.id
    await snapshotQuotedCost(accountId, q.id, 'app')
    await prisma.savedQuote.update({ where: { id: q.id }, data: { fenceStyle: "TV-ND 6'x8' Privacy", finalPrice: 7113.83, materialCost: 2540.2, laborCost: 1148.45, totalCOGS: 3688.65, acceptedAt: new Date(), chosenOption: 1 } })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/payments', payments)
    app.use('/p/i', packetPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const r = await call('POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerPhone: '3526718083', customerAddress: q.customerAddress, fenceStyle: "TV-ND 6'x8' Privacy", quotePrice: 7113.83, contractValue: 7113.83, status: 'staging', materialsStatus: 'received' })
    expect(r.status).toBe(201)
    ids.job = r.json.data.id
    const p = await prisma.installPacket.create({ data: { accountId, jobId: ids.job, token: `tok${tag}${crypto.randomBytes(8).toString('hex')}`, snapshot: { companyName: 'Getter Done Fence' } as any } })
    ids.packet = p.id; ids.token = p.token
    // A card for the job's quote in Signed Contract.
    await prisma.pipelineState.create({ data: { accountId, leads: [{ id: `card-${tag}`, firstName: 'Manuel', lastName: tag, customerId: c.id, quoteId: q.id, stage: 'Signed Contract' }] as any, stages: [] as any } })
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const jobs = [ids.job].filter(Boolean)
    const pays = await prisma.contractPayment.findMany({ where: { jobId: { in: jobs } } })
    await prisma.receipt.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.portalFile.deleteMany({ where: { crmCustomerId: ids.contact } })
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } })
    await prisma.contractPayment.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.walkthrough.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.permit.deleteMany({ where: { accountId } })
    await prisma.installPacket.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.scheduleSettings.deleteMany({ where: { accountId } })
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...pays.map(p => p.id)] } } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.receiptCounter.deleteMany({ where: { accountId } })
    await prisma.receiptNumberBlock.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the payment schedule makes the job invoiced with the deposit due, and a stale save does not undo it', async () => {
    const job = await prisma.savedJob.findUnique({ where: { id: ids.job } })
    expect(job?.paymentStatus).toBe('invoiced')
    const st = truth.billingStatusOf(await truth.billingViewFor(accountId, ids.job))
    expect(st).toMatchObject({ state: 'deposit_due' })
    expect(st.text).toMatch(/^Deposit \$3,556\.92 due \d{2}\/\d{2}\/\d{4}$/)
    // A screen that still had "not_invoiced" and no locate saves the whole job.
    const r = await call('PATCH', `/api/saved-jobs/${ids.job}`, { notes: 'gate code 1234', paymentStatus: 'not_invoiced', amountPaid: 0, locatesDate: null, locateTicket: null })
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ notes: 'gate code 1234', paymentStatus: 'invoiced' })
  })

  test('Accounts Receivable lists the deposit from the payment schedule; overdue the day after it is due', async () => {
    const r = (await call('GET', '/api/payments/receivables')).json.data.filter((x: any) => x.jobId === ids.job)
    expect(r.map((x: any) => [x.label, x.balanceCents, x.state])).toEqual([['Deposit', 355692, 'due'], ['Final', 355691, 'not_due']])
    const later = await truth.receivables(accountId, '2099-01-01')
    expect(later.find(x => x.jobId === ids.job)).toMatchObject({ state: 'overdue' })
  })

  test('an install date with no Schedule entries: listed, and its entries made once', async () => {
    const S = await import('../src/server/lib/installScheduling.js')
    await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: [{ id: 'crew1', name: 'Crew 1', color: 'bg-blue-500' }] as any } })
    await prisma.savedJob.update({ where: { id: ids.job }, data: { scheduledDate: '2099-03-02', scheduledEndDate: '2099-03-03', crewAssigned: 'crew1' } })
    const m = (await S.jobsMissingEntries(accountId)).find(x => x.jobId === ids.job)!
    expect(m).toMatchObject({ days: ['2099-03-02', '2099-03-03'], crewId: 'crew1', crewName: 'Crew 1', crewFound: true })
    expect(await S.makeMissingEntries(accountId, m)).toBe(2)
    expect(await S.makeMissingEntries(accountId, m)).toBe(0)
    expect((await S.jobsMissingEntries(accountId)).some(x => x.jobId === ids.job)).toBe(false)
    // It has a date: never "ready to schedule".
    expect((await S.readyToSchedule(accountId)).some(x => x.id === ids.job)).toBe(false)
  })

  test('the 811 locate: one record, from the crew packet and the job page', async () => {
    // The crew types it on the packet.
    const p = await call('POST', `/p/i/${ids.token}/locate`, { ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-24', expDate: '2099-11-20' }, false)
    expect(p.status).toBe(200)
    expect(p.json.data.status).toBe('clear')
    let job = (await call('GET', `/api/saved-jobs/${ids.job}`)).json.data
    expect(job).toMatchObject({ locateTicket: '294610232', locateCalledDate: '2026-10-21', locatesDate: '2026-10-24', locatesExpDate: '2099-11-20', locateUpdatedBy: 'Crew (install packet)' })
    // The packet page shows it.
    const page = await fetch(`${base}/p/i/${ids.token}`).then(r => r.text())
    expect(page).toContain('value="294610232"')
    expect(page).toContain('data-packet-locate-status="clear"')
    // The office changes the expiration on the job page; the packet shows the change.
    const j = await call('PUT', `/api/saved-jobs/${ids.job}/locate`, { ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-24', expDate: '2099-11-21' })
    expect(j.status).toBe(200)
    expect((await fetch(`${base}/p/i/${ids.token}`).then(r => r.text()))).toContain('value="2099-11-21"')
    // A job save never touches it.
    await call('PATCH', `/api/saved-jobs/${ids.job}`, { locatesDate: null, locatesExpDate: null, notes: 'x' })
    job = (await call('GET', `/api/saved-jobs/${ids.job}`)).json.data
    expect(job.locatesExpDate).toBe('2099-11-21')
    // Refused in plain words.
    const bad = await call('PUT', `/api/saved-jobs/${ids.job}/locate`, { goodDate: '2026-10-24', expDate: '2026-10-01' })
    expect(bad).toMatchObject({ status: 400, json: { error: 'The expiration date is before the good to dig date.' } })
  })

  test('the milestones follow the records; hand ticks only where allowed, labeled', async () => {
    let m = (await call('GET', `/api/saved-jobs/${ids.job}/milestones`)).json.data
    const by = (k: string) => m.milestones.find((x: any) => x.key === k)
    expect(by('locate')).toMatchObject({ done: true, by: 'data' })
    expect(by('permit')).toMatchObject({ done: false, detail: 'Permit: Not set' })
    expect(by('materials')).toMatchObject({ done: true, by: 'data' })
    const refused = await call('POST', `/api/saved-jobs/${ids.job}/milestones`, { label: 'Permit Approved', ticked: true })
    expect(refused.status).toBe(409)
    await prisma.permit.create({ data: { accountId, jobId: ids.job, status: 'approved' } })
    m = (await call('GET', `/api/saved-jobs/${ids.job}/milestones`)).json.data
    expect(by('permit')).toMatchObject({ done: true, by: 'data', detail: 'Permit: Issued' })
    const t = await call('POST', `/api/saved-jobs/${ids.job}/milestones`, { label: 'Photos Uploaded', ticked: true })
    expect(t.status).toBe(200)
    m = t.json.data
    expect(by('photos')).toMatchObject({ done: true, by: 'hand', tickedBy: `${tag}@example.invalid` /* no Team login: the email */ })
    const sum = (await call('GET', '/api/saved-jobs/milestones/summary')).json.data
    expect(sum[ids.job]).toEqual({ complete: m.complete, total: 8 })
  })

  test('signed at the walkthrough and paid in full: Complete by itself, the card to Job complete', async () => {
    await prisma.walkthrough.create({ data: { accountId, jobId: ids.job, status: 'open', homeownerSig: { name: 'Manuel', signedAt: new Date().toISOString() } as any, repSig: { name: 'Jonathan', role: 'Owner', signedAt: new Date().toISOString() } as any } })
    // The deposit alone: not yet.
    const d = await call('POST', '/api/payments', { id: `jtpay${Date.now().toString(36)}a`, jobId: ids.job, amountCents: 355692, method: 'check', checkNumber: '101' })
    expect(d.status).toBe(201)
    expect((await prisma.savedJob.findUnique({ where: { id: ids.job } }))?.status).toBe('staging')
    // The rest: the job closes out.
    const f = await call('POST', '/api/payments', { id: `jtpay${Date.now().toString(36)}b`, jobId: ids.job, amountCents: 355691, method: 'check', checkNumber: '102' })
    expect(f.status).toBe(201)
    const job = await prisma.savedJob.findUnique({ where: { id: ids.job } })
    expect(job).toMatchObject({ status: 'completed', opsStage: 'completed', paymentStatus: 'paid' })
    expect(job?.completedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const leads = (await prisma.pipelineState.findUnique({ where: { accountId } }))?.leads as any[]
    expect(leads.find(l => l.id === `card-${tag}`)?.stage).toBe('Job Complete')
    // Again: nothing more happens.
    expect(await truth.closeOutIfDone(accountId, ids.job, 'again')).toEqual({ moved: false, why: 'already done' })
  })

  test('a quoted cost saved for another option is replaced by the signed one\'s', async () => {
    const before = await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId: ids.quote } } })
    expect(before).toMatchObject({ fenceStyle: "WV-ND 6'x8' Privacy", priceCents: 607201 })
    expect(await snapshotQuotedCost(accountId, ids.quote, 'proposal')).toBe(true)
    const after = await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId: ids.quote } } })
    expect(after).toMatchObject({ fenceStyle: "TV-ND 6'x8' Privacy", priceCents: 711383, totalCents: 368865, signedVia: 'proposal' })
    // The same signing again keeps it.
    expect(await snapshotQuotedCost(accountId, ids.quote, 'proposal')).toBe(false)
  })
})
