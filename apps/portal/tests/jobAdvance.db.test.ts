/**
 * A job moves on by itself (round 2, Oct 26 2026; dev database, DEV_DB=1;
 * refuses any other), on a throwaway company:
 *
 *   - the crew's Start moves a scheduled job to In Progress (its card to Jobs
 *     In Progress);
 *   - "Finish for today" on day 1 of 2 is not the install finished; Finish on
 *     the last day, or "We finished the whole job", is;
 *   - install finished + final walkthrough signed + paid in full, in any
 *     order: Complete and on to Paid, the card to Paid & Closed;
 *   - a job marked Complete by hand that is paid in full goes on to Paid;
 *   - the crew packet shows the office's 811 locate in words, keeps it when a
 *     box is left empty, and asks before a different ticket replaces it.
 * Everything made is removed at the end.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('a job moves on by itself (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: payments } = await import('../src/server/routes/payments.js')
  const { packetPublic, packetStaff } = await import('../src/server/routes/installPacket.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const truth = await import('../src/server/lib/jobTruth.js')
  const { floridaDay } = await import('../src/server/lib/automations/context.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `ja-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', owner = '', crew = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const today = floridaDay(new Date())
  const plus = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
  const call = (method: string, p: string, body?: unknown, who: string | null = owner) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const jobOf = (id: string) => prisma.savedJob.findUnique({ where: { id } })
  const cardOf = async (id: string) => ((await prisma.pipelineState.findUnique({ where: { accountId } }))?.leads as any[]).find(l => l.id === id)

  /** A signed job with its payment schedule, booked on the given crew days, and its card in Pending Start. */
  async function soldJob(name: string, days: string[]): Promise<{ job: string; card: string; invoices: number[] }> {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: name, lastName: tag, phone: '3525550142' } as any })
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `${name} ${tag}`, customerAddress: '110 SE Watula Ave, Ocala, FL 34471', fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], pullSheet: [], finalPrice: 4000, materialCost: 1500, laborCost: 800, totalCOGS: 2300, status: 'SOLD', soldAt: new Date(), acceptedAt: new Date() } as any })
    const r = await call('POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: q.fenceStyle, quotePrice: 4000, contractValue: 4000, status: 'staging', materialsStatus: 'received' })
    expect(r.status).toBe(201)
    const job = r.json.data.id
    await prisma.savedJob.update({ where: { id: job }, data: { status: 'scheduled', opsStage: 'scheduled', scheduledDate: days[0], scheduledEndDate: days[days.length - 1], crewAssigned: 'crew1' } })
    for (const d of days) await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: job, clientName: name, crewId: 'crew1', date: d } })
    const card = `card-${name}-${tag}`
    const st = await prisma.pipelineState.findUnique({ where: { accountId } })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [...((st!.leads as any[]) ?? []), { id: card, firstName: name, lastName: tag, customerId: c.id, quoteId: q.id, jobId: job, stage: 'Pending Start' }], version: { increment: 1 } } })
    const sched = await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId: job } } })
    const inv = await prisma.contractInvoice.findMany({ where: { scheduleId: sched!.id, voidedAt: null }, orderBy: { sortOrder: 'asc' } })
    return { job, card, invoices: inv.map(i => i.amountCents) }
  }
  const pay = (jobId: string, cents: number, n: string) => call('POST', '/api/payments', { id: `japay${Date.now().toString(36)}${n}`, jobId, amountCents: cents, method: 'check', checkNumber: n })
  async function signWalkthrough(jobId: string) {
    await prisma.walkthrough.create({ data: { accountId, jobId, status: 'completed', homeownerSig: { name: 'Maria', signedAt: new Date().toISOString() } as any, repSig: { name: 'Jonathan', role: 'Owner', signedAt: new Date().toISOString() } as any, signedAt: new Date() } })
    // As lib/walkthrough.ts afterSignature does once both are in.
    return truth.closeOutIfDone(accountId, jobId, 'final walkthrough signed')
  }

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    owner = jwt.sign({ sub: crypto.randomUUID(), email: `${tag}@example.invalid`, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    crew = jwt.sign({ sub: crypto.randomUUID(), email: `${tag}-crew@example.invalid`, role: 'field_crew', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Getter Done Fence', phone: '3527894314' } } as any } })
    await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: [{ id: 'crew1', name: 'Crew 1', color: 'bg-blue-500' }] as any } })
    await prisma.pipelineState.create({ data: { accountId, leads: [] as any, stages: [] as any } })
    await billing.schedulesFrom(accountId)
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/payments', payments)
    app.use('/api/install-packets', packetStaff)
    app.use('/p/i', packetPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const jobs = (await prisma.savedJob.findMany({ where: { accountId }, select: { id: true } })).map(j => j.id)
    const pays = await prisma.contractPayment.findMany({ where: { jobId: { in: jobs } } })
    await prisma.receipt.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } })
    await prisma.contractPayment.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.walkthrough.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.installPacket.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: jobs } } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.automationRun.deleteMany({ where: { accountId } })
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.scheduleSettings.deleteMany({ where: { accountId } })
    await prisma.deletionLog.deleteMany({ where: { accountId } })
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

  test('Start → In Progress; walkthrough and payment first; Finish for today (day 1 of 2) is not done; the whole job finished → Complete, Paid, Paid & Closed', async () => {
    const { job, card, invoices } = await soldJob('Maria', [today, plus(today, 7)])
    // The crew taps Start.
    const s = await call('POST', `/api/install-packets/crew/${job}/start`, {}, crew)
    expect(s.status).toBe(200)
    expect(await jobOf(job)).toMatchObject({ status: 'in_progress', opsStage: 'in_progress' })
    expect((await cardOf(card)).stage).toBe('Jobs In Progress')
    // Signed off and paid in full before the crew is done: not yet.
    expect(await signWalkthrough(job)).toEqual({ moved: false, why: 'not paid in full' })
    for (const [i, c] of invoices.entries()) expect((await pay(job, c, `10${i}`)).status).toBe(201)
    expect((await jobOf(job))?.status).toBe('in_progress')
    // "Finish for today" on day 1 of 2: still not the install finished.
    const f1 = await call('POST', `/api/install-packets/crew/${job}/finish`, {}, crew)
    expect(f1.json.data).toMatchObject({ jobDone: false, lastDay: plus(today, 7) })
    expect((await jobOf(job))?.status).toBe('in_progress')
    // "We finished the whole job": Complete, then Paid (the balance is zero), and the card to Paid & Closed.
    const f2 = await call('POST', `/api/install-packets/crew/${job}/finish`, { jobDone: true }, crew)
    expect(f2.json.data.jobDone).toBe(true)
    expect(f2.json.data.times.at(-1)).toMatchObject({ kind: 'finish', jobDone: true })
    const j = await jobOf(job)
    expect(j).toMatchObject({ status: 'paid', opsStage: 'paid', paymentStatus: 'paid', completedDate: today })
    expect(j?.completedBy).toMatch(/Automatic/)
    expect((await cardOf(card)).stage).toBe('Paid & Closed')
  })

  test('"We finished the whole job" on day 1 of 2: day 2 comes off the Schedule (restorable) before the office closes it out', async () => {
    const { job } = await soldJob('Ana', [today, plus(today, 7)])
    await call('POST', `/api/install-packets/crew/${job}/start`, {}, crew)
    const f = await call('POST', `/api/install-packets/crew/${job}/finish`, { jobDone: true }, crew)
    expect(f.status).toBe(200)
    // Not signed off or paid yet: not closed out, but the crew is done.
    expect((await jobOf(job))?.status).toBe('in_progress')
    expect(f.json.data).toMatchObject({ jobDone: true, lastDay: today, crewDays: [today] })
    const rows = await prisma.scheduledGridJob.findMany({ where: { accountId, stagingJobId: job }, orderBy: { date: 'asc' } })
    expect(rows.map(r => [r.date, r.status, !!r.deletedAt])).toEqual([[today, 'Complete', false], [plus(today, 7), 'Scheduled', true]])
    // Logged, so it can be put back (Settings > Deleted Records).
    expect(await prisma.deletionLog.count({ where: { accountId, entityId: rows[1].id } })).toBe(1)
    // The job's install dates are the day worked.
    expect(await prisma.savedJob.findUnique({ where: { id: job }, select: { scheduledEndDate: true } })).toEqual({ scheduledEndDate: today })
  })

  test('Finish on the last crew day first, then the walkthrough, then the final payment: Paid on the payment', async () => {
    const { job, card, invoices } = await soldJob('Linda', [today])
    await call('POST', `/api/install-packets/crew/${job}/start`, {}, crew)
    const f = await call('POST', `/api/install-packets/crew/${job}/finish`, {}, crew)
    expect(f.json.data.jobDone).toBe(true) // a one day job: Finish is the job finished
    expect((await jobOf(job))?.status).toBe('in_progress')
    expect(await signWalkthrough(job)).toEqual({ moved: false, why: 'not paid in full' })
    expect((await pay(job, invoices[0], '201')).status).toBe(201)
    expect((await jobOf(job))?.status).toBe('in_progress')
    expect((await pay(job, invoices.slice(1).reduce((a, b) => a + b, 0), '202')).status).toBe(201)
    expect(await jobOf(job)).toMatchObject({ status: 'paid', opsStage: 'paid' })
    expect((await cardOf(card)).stage).toBe('Paid & Closed')
  })

  test('marked Complete by hand while paid in full: on to Paid by itself', async () => {
    const { job, invoices } = await soldJob('Robert', [plus(today, 14)])
    for (const [i, c] of invoices.entries()) await pay(job, c, `30${i}`)
    expect((await jobOf(job))?.status).toBe('scheduled')
    const r = await call('PATCH', `/api/saved-jobs/${job}`, { opsStage: 'completed' })
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ status: 'paid', opsStage: 'paid' })
  })

  test('the crew packet: the office\'s 811 locate in words, kept when a box is empty, replaced only when the crew says so', async () => {
    const { job } = await soldJob('Pat', [plus(today, 2)])
    const put = await call('PUT', `/api/saved-jobs/${job}/locate`, { ticket: '294610232', calledDate: today, goodDate: plus(today, 2), expDate: plus(today, 30) })
    expect(put.status).toBe(200)
    const p = await prisma.installPacket.create({ data: { accountId, jobId: job, token: `tok${tag}${crypto.randomBytes(8).toString('hex')}`, snapshot: { companyName: 'Getter Done Fence', notes: 'Website, drawn by customer. The customer drew the fence on the aerial photo and saw an estimate of $4,321 (Better). Confirm every measurement on site.' } as any } })
    const page = await fetch(`${base}/p/i/${p.token}`).then(r => r.text())
    expect(page).toContain('data-packet-locate-on-file')
    expect(page).toMatch(/data-packet-locate-ticket>294610232</)
    expect(page).toContain(`data-packet-locate-good>${plus(today, 2).slice(5, 7)}/${plus(today, 2).slice(8, 10)}/${plus(today, 2).slice(0, 4)}<`)
    expect(page).toContain('Change the locate')
    // The crew never reads a price sentence.
    expect(page).not.toContain('left out')
    expect(page).not.toContain('saw an estimate')
    expect(page).toContain('Confirm every measurement on site.')
    // A box left empty keeps the office's date.
    const keep = await call('POST', `/p/i/${p.token}/locate`, { ticket: '294610232', calledDate: '', goodDate: '', expDate: '' }, null)
    expect(keep.status).toBe(200)
    expect(await jobOf(job)).toMatchObject({ locateTicket: '294610232', locatesDate: plus(today, 2), locatesExpDate: plus(today, 30) })
    // A different ticket: asked first; replaced only with the crew's yes.
    const ask = await call('POST', `/p/i/${p.token}/locate`, { ticket: '555000111' }, null)
    expect(ask).toMatchObject({ status: 409, json: { code: 'REPLACE_TICKET' } })
    expect(ask.json.error).toMatch(/already has 811 ticket 294610232/)
    expect((await jobOf(job))?.locateTicket).toBe('294610232')
    const yes = await call('POST', `/p/i/${p.token}/locate`, { ticket: '555000111', replace: true }, null)
    expect(yes.status).toBe(200)
    expect(await jobOf(job)).toMatchObject({ locateTicket: '555000111', locatesDate: plus(today, 2) })
    // The installer's card reads the same record.
    const card = await call('GET', `/api/install-packets/crew/${job}`, undefined, crew)
    expect(card.json.data.locate).toMatchObject({ ticket: '555000111', status: 'called' })
  })
})
