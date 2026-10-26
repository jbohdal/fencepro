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
    await prisma.changeOrder.deleteMany({ where: { accountId } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: jobs } } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.automationRun.deleteMany({ where: { accountId } })
    await prisma.automationRule.deleteMany({ where: { accountId } })
    await prisma.deletionLog.deleteMany({ where: { accountId } })
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
    // Issued: Advance passes over Permit Pending (permitOk).
    expect(sum[ids.job]).toEqual({ complete: m.complete, total: 8, permitOk: true })
    await prisma.permit.update({ where: { jobId: ids.job }, data: { status: 'applied' } })
    expect((await call('GET', '/api/saved-jobs/milestones/summary')).json.data[ids.job].permitOk).toBe(false)
    await prisma.permit.update({ where: { jobId: ids.job }, data: { status: 'not_needed' } })
    expect((await call('GET', '/api/saved-jobs/milestones/summary')).json.data[ids.job].permitOk).toBe(true)
    await prisma.permit.update({ where: { jobId: ids.job }, data: { status: 'approved' } })
  })

  test('signed at the walkthrough and paid in full: Complete by itself, the card to Job complete', async () => {
    await prisma.walkthrough.create({ data: { accountId, jobId: ids.job, status: 'open', homeownerSig: { name: 'Manuel', signedAt: new Date().toISOString() } as any, repSig: { name: 'Jonathan', role: 'Owner', signedAt: new Date().toISOString() } as any } })
    // The deposit alone: not yet.
    const d = await call('POST', '/api/payments', { id: `jtpay${Date.now().toString(36)}a`, jobId: ids.job, amountCents: 355692, method: 'check', checkNumber: '101' })
    expect(d.status).toBe(201)
    expect((await prisma.savedJob.findUnique({ where: { id: ids.job } }))?.status).toBe('staging')
    // Paid in full and signed off, but never installed (its crew days are in 2099): not Complete; the owner is asked.
    const f = await call('POST', '/api/payments', { id: `jtpay${Date.now().toString(36)}b`, jobId: ids.job, amountCents: 355691, method: 'check', checkNumber: '102' })
    expect(f.status).toBe(201)
    expect((await prisma.savedJob.findUnique({ where: { id: ids.job } }))?.status).toBe('staging')
    expect((await call('GET', `/api/saved-jobs/${ids.job}/milestones`)).json.data.closeOut).toBe('mark_installed')
    // The install happened (the crew tapped "We finished the whole job"): it closes out.
    const { recordInstallTime } = await import('../src/server/lib/crewInstall.js')
    await recordInstallTime(ids.job, 'finish', 'Crew test', new Date(), true)
    expect(await truth.closeOutIfDone(accountId, ids.job, 'finish tapped')).toMatchObject({ moved: true })
    const job = await prisma.savedJob.findUnique({ where: { id: ids.job } })
    // Paid in full: on to Paid (round 2, Oct 26 2026).
    expect(job).toMatchObject({ status: 'paid', opsStage: 'paid', paymentStatus: 'paid' })
    expect(job?.completedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const leads = (await prisma.pipelineState.findUnique({ where: { accountId } }))?.leads as any[]
    // Paid in full and done: the last Sold, work done stage (Paid & Closed on the start list).
    expect(leads.find(l => l.id === `card-${tag}`)?.stage).toBe('Paid & Closed')
    // Again: nothing more happens.
    expect(await truth.closeOutIfDone(accountId, ids.job, 'again')).toEqual({ moved: false, why: 'already done' })
  })

  test('the sales card follows the job: Job Prep while staging, Pending Start once scheduled', async () => {
    const { stages } = await (await import('../src/server/lib/pipelineStages.js')).loadPipelineStages(accountId)
    expect(truth.cardStageForJob(stages, { status: 'staging' }, false)).toBe('Job Prep')
    expect(truth.cardStageForJob(stages, { status: 'scheduled' }, false)).toBe('Pending Start')
    expect(truth.cardStageForJob(stages, { status: 'in_progress' }, false)).toBe('Jobs In Progress')
    expect(truth.cardStageForJob(stages, { status: 'completed' }, false)).toBe('Job Complete')
    expect(truth.cardStageForJob(stages, { status: 'paid' }, true)).toBe('Paid & Closed')
  })

  test('a card follows only the same sale: an old paid job never closes a new open quote card', async () => {
    // Tiffany Clark: 2026 card ($3,032.79 quote sent 7/28) and her paid 2023 job ($9,264.24).
    expect(truth.sameJobCard({ customerId: 'c1', createdAt: '2026-07-15', quotePrice: 3032.79, jobValue: 0 }, { crmContactId: 'c1', createdAt: new Date('2023-01-26T19:30:00Z'), contractValue: 9264.24, status: 'paid' })).toBe(false)
    // Central Florida Landscapes: a $24,811 quote card (8/13/2026) and a $150 job from 2025.
    expect(truth.sameJobCard({ customerId: 'c2', createdAt: '2026-08-13', quotePrice: 24811, jobValue: 0 }, { crmContactId: 'c2', createdAt: new Date('2025-08-11T19:44:20Z'), contractValue: 150, status: 'paid' })).toBe(false)
    // The same customer, within 60 days, but the price is far off: not the same sale.
    expect(truth.sameJobCard({ customerId: 'c2', createdAt: '2026-08-13', quotePrice: 24811 }, { crmContactId: 'c2', createdAt: new Date('2026-09-01T12:00:00Z'), contractValue: 150, status: 'staging' })).toBe(false)
    // Within 60 days and within 10%: the same sale.
    expect(truth.sameJobCard({ customerId: 'c1', createdAt: '2026-10-01', quotePrice: 3032.79 }, { crmContactId: 'c1', createdAt: new Date('2026-10-20T12:00:00Z'), contractValue: 3100, status: 'staging' })).toBe(true)
    // A card with no price: only a job still under way, made within 60 days.
    expect(truth.sameJobCard({ customerId: 'c1', createdAt: '2026-10-01' }, { crmContactId: 'c1', createdAt: new Date('2026-10-20T12:00:00Z'), contractValue: 3100, status: 'staging' })).toBe(true)
    expect(truth.sameJobCard({ customerId: 'c1', createdAt: '2026-10-01' }, { crmContactId: 'c1', createdAt: new Date('2026-10-20T12:00:00Z'), contractValue: 3100, status: 'paid' })).toBe(false)
    // In the database: an old paid job and the customer's new open quote card (no quote on it): nothing moves.
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Tiffany', lastName: tag } as any })
    const old = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `Tiffany ${tag}`, status: 'paid', paymentStatus: 'paid', contractValue: 9264.24, createdAt: new Date('2023-01-26T19:30:00Z') } as any })
    const st = await prisma.pipelineState.findUnique({ where: { accountId } })
    const leads = [...((st!.leads as any[]) ?? []), { id: `tiff-${tag}`, firstName: 'Tiffany', lastName: tag, customerId: c.id, stage: 'Appointment', quotePrice: 3032.79, createdAt: '2026-07-15' }]
    await prisma.pipelineState.update({ where: { accountId }, data: { leads, version: { increment: 1 } } })
    expect((await truth.cardsBehind(accountId)).some(x => x.cardId === `tiff-${tag}`)).toBe(false)
    await truth.cardFollowsJob(accountId, old.id)
    const after = ((await prisma.pipelineState.findUnique({ where: { accountId } }))!.leads as any[]).find(l => l.id === `tiff-${tag}`)
    expect(after.stage).toBe('Appointment')
  })

  test('Mark as Sold: the server moves the sale\'s card to Signed Contract, stamped with the quote', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Sol', lastName: tag } as any })
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `Sol ${tag}`, fenceStyle: "WV-ND 6'x8' Privacy", runs: [80], pullSheet: [], finalPrice: 2945, status: 'SENT' } as any })
    const st = await prisma.pipelineState.findUnique({ where: { accountId } })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [...((st!.leads as any[]) ?? []), { id: `sol-${tag}`, firstName: 'Sol', lastName: tag, customerId: c.id, stage: 'First Contact', createdAt: new Date().toISOString().slice(0, 10) }], version: { increment: 1 } } })
    expect(await truth.moveCardForSoldQuote(accountId, q.id)).toEqual({ cardId: `sol-${tag}`, why: 'moved' })
    const card = ((await prisma.pipelineState.findUnique({ where: { accountId } }))!.leads as any[]).find(l => l.id === `sol-${tag}`)
    expect(card).toMatchObject({ stage: 'Signed Contract', quoteId: q.id })
    // Its follow up is stopped (signed), never "None set".
    const fu = await prisma.cardFollowUp.findFirst({ where: { accountId, cardId: `sol-${tag}` } })
    expect(fu?.stoppedReason ?? null).toBe('signed')
  })

  test('a finished job: its crew days done, any still ahead off the Schedule', async () => {
    const S = await import('../src/server/lib/installScheduling.js')
    const j = await prisma.savedJob.create({ data: { accountId, customerName: `Fin ${tag}`, status: 'completed', completedDate: '2026-10-27', scheduledDate: '2026-10-27', scheduledEndDate: '2026-10-28' } as any })
    for (const d of ['2026-10-27', '2026-10-28']) await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: j.id, clientName: 'Fin', crewId: 'crew1', date: d } })
    expect(await S.finishScheduleRows(accountId, j.id, { accountId, userId: null }, '2026-10-27')).toEqual({ completed: 1, removed: 1 })
    const rows = await prisma.scheduledGridJob.findMany({ where: { accountId, stagingJobId: j.id }, orderBy: { date: 'asc' } })
    expect(rows.map(r => [r.date, r.status, !!r.deletedAt])).toEqual([['2026-10-27', 'Complete', false], ['2026-10-28', 'Scheduled', true]])
    // Its install dates are the days worked.
    expect(await prisma.savedJob.findUnique({ where: { id: j.id }, select: { scheduledDate: true, scheduledEndDate: true } })).toEqual({ scheduledDate: '2026-10-27', scheduledEndDate: '2026-10-27' })
  })

  test('a card moved on: its queued Signed Contract runs stay while it is in Job Prep, are cancelled once Paid & Closed', async () => {
    const Q = await import('../src/server/lib/automations/queue.js')
    expect(await Q.stageStillApplies(accountId, 'sales', 'Signed Contract', 'Job Prep')).toBe(true)
    expect(await Q.stageStillApplies(accountId, 'sales', 'Signed Contract', 'Paid & Closed')).toBe(false)
    expect(await Q.stageStillApplies(accountId, 'sales', 'Pending Signature', 'Signed Contract')).toBe(false)
    const rule = await prisma.automationRule.create({ data: { accountId, name: `Signed ${tag}`, board: 'sales', enabled: true, trigger: { type: 'card_entered', stage: 'Signed Contract', settleMinutes: 2 } as any, steps: [{ type: 'notify', title: `${tag} order materials`, body: '' }] as any } })
    const st = await prisma.pipelineState.findUnique({ where: { accountId } })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [...((st!.leads as any[]) ?? []), { id: `auto-${tag}`, firstName: 'Auto', lastName: tag, stage: 'Signed Contract', createdAt: '2026-10-25' }], version: { increment: 1 } } })
    const run = await prisma.automationRun.create({ data: { accountId, ruleId: rule.id, eventId: `ev-${tag}`, entityKind: 'card', entityId: `auto-${tag}`, status: 'queued', nextRunAt: new Date(Date.now() + 120_000) } })
    expect(await truth.moveCardTo(accountId, `auto-${tag}`, 'Job Prep')).toBe(true)
    expect((await prisma.automationRun.findUnique({ where: { id: run.id } }))?.status).toBe('queued')
    expect(await truth.moveCardTo(accountId, `auto-${tag}`, 'Paid & Closed')).toBe(true)
    const after = await prisma.automationRun.findUnique({ where: { id: run.id } })
    expect(after?.status).toBe('skipped')
    expect(JSON.stringify(after?.log)).toMatch(/Cancelled: it moved on from Signed Contract/)
    // And at run time a run for a stage it left is skipped, never run.
    const run2 = await prisma.automationRun.create({ data: { accountId, ruleId: rule.id, eventId: `ev2-${tag}`, entityKind: 'card', entityId: `auto-${tag}`, status: 'queued', nextRunAt: new Date(Date.now() - 1000) } })
    expect(await Q.executeRun(run2.id)).toBe('skipped')
    expect(await prisma.notification.count({ where: { title: { contains: `${tag} order materials` } } })).toBe(0)
  })

  test('the crew packet carries the approved change order, whoever builds it', async () => {
    const { withSignedWork } = await import('../src/server/routes/installPacket.js')
    const original = { footageFt: 150, sections: 17, pullSheet: [{ item: 'Tension bar', qty: 12 }], gates: ['1 double gate'], runs: [{ label: 'Run 1', length: '150 ft', sections: 17, spacing: '' }] }
    // No change order: as sent.
    expect(await withSignedWork(accountId, ids.quote, original)).toEqual(original)
    await prisma.changeOrder.create({ data: { accountId, quoteId: ids.quote, number: 1, status: 'approved', approvedAt: new Date(), totalCents: 74900,
      work: { fenceStyle: "TV-ND 6'x8' Privacy", footage: 170, sections: 19, runs: [150, 20], walkGates: 1, dblGates: 1, layout: { runSections: [17, 2] }, pullSheet: [{ item: 'Tension bar', qty: 16 }, { item: 'Price line', qty: 1, moneyOnly: true }] } as any } })
    const made = await withSignedWork(accountId, ids.quote, original)
    expect(made).toMatchObject({ footageFt: 170, sections: 19, gates: ['1 walk gate', '1 double gate'], pullSheet: [{ item: 'Tension bar', qty: 16 }], changeOrder: 1 })
    // The office's snapshot already has the change: left as sent.
    const office = { ...original, footageFt: 170, sections: 19, pullSheet: [{ item: 'Tension bar', qty: 16 }] }
    expect(await withSignedWork(accountId, ids.quote, office)).toEqual(office)
    // Never a price: only items and quantities.
    expect(JSON.stringify(made)).not.toMatch(/cost|price|cents/i)
    await prisma.changeOrder.deleteMany({ where: { accountId } })
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
