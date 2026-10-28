/**
 * Round 2b (Oct 26 2026), the job window and the job flow (dev database,
 * DEV_DB=1; refuses any other), on a throwaway company:
 *
 *   - a job window that missed a close out (the final payment closed the job
 *     on the server) can never move the Paid job back: a stage move from an
 *     old copy is refused (409 STALE_JOB), nothing is saved; a note saved from
 *     that old copy keeps the job Paid;
 *   - a Paid or Complete job goes back only with Reopen, by the owner or the
 *     office (409 REOPEN_NEEDED otherwise; a hold too);
 *   - the installer's card knows where the close out stands (closed, the
 *     walkthrough signed, paid in full) and the crew days in order;
 *   - the packet's 811 table is sent back after a save (no reload);
 * Everything made is removed at the end.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the job window and the job flow, round 2b (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: payments } = await import('../src/server/routes/payments.js')
  const { packetPublic, packetStaff } = await import('../src/server/routes/installPacket.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const truth = await import('../src/server/lib/jobTruth.js')
  const { floridaDay } = await import('../src/server/lib/automations/context.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `js-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', owner = '', office = '', sales = '', crew = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const today = floridaDay(new Date())
  const plus = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
  const call = (method: string, p: string, body?: unknown, who: string | null = owner) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const jobOf = (id: string) => prisma.savedJob.findUnique({ where: { id } })

  /** A signed job with its payment schedule, booked on the given crew days (none: not booked, staging). */
  async function soldJob(name: string, days: string[]): Promise<{ job: string; invoices: number[] }> {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: name, lastName: tag, phone: '3525550142' } as any })
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `${name} ${tag}`, customerAddress: '110 SE Watula Ave, Ocala, FL 34471', fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], pullSheet: [], finalPrice: 4000, materialCost: 1500, laborCost: 800, totalCOGS: 2300, status: 'SOLD', soldAt: new Date(), acceptedAt: new Date() } as any })
    const r = await call('POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: q.fenceStyle, quotePrice: 4000, contractValue: 4000, status: 'staging', materialsStatus: 'not_ordered' })
    expect(r.status).toBe(201)
    const job = r.json.data.id
    if (days.length) {
      await prisma.savedJob.update({ where: { id: job }, data: { status: 'scheduled', opsStage: 'scheduled', scheduledDate: days[0], scheduledEndDate: days[days.length - 1], crewAssigned: 'crew1' } })
      for (const d of days) await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: job, clientName: name, crewId: 'crew1', date: d } })
    }
    const sched = await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId: job } } })
    const inv = await prisma.contractInvoice.findMany({ where: { scheduleId: sched!.id, voidedAt: null }, orderBy: { sortOrder: 'asc' } })
    return { job, invoices: inv.map(i => i.amountCents) }
  }
  const pay = (jobId: string, cents: number, n: string) => call('POST', '/api/payments', { id: `jspay${Date.now().toString(36)}${n}`, jobId, amountCents: cents, method: 'check', checkNumber: n })
  async function signWalkthrough(jobId: string) {
    await prisma.walkthrough.create({ data: { accountId, jobId, status: 'completed', homeownerSig: { name: 'Maria', signedAt: new Date().toISOString() } as any, repSig: { name: 'Jonathan', role: 'Owner', signedAt: new Date().toISOString() } as any, signedAt: new Date() } })
    return truth.closeOutIfDone(accountId, jobId, 'final walkthrough signed')
  }
  /** The job as the office's screen read it (the API's answer). */
  const read = async (id: string) => (await call('GET', `/api/saved-jobs/${id}`)).json.data
  /** What jobStore sends: the job after the edit, with the copy it was made on as `base`. */
  const save = (id: string, before: any, change: Record<string, unknown>, who = owner, more: Record<string, unknown> = {}) =>
    call('PATCH', `/api/saved-jobs/${id}`, { ...before, ...change, base: before, ...more }, who)

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    const sign = (role: string, who: string) => jwt.sign({ sub: crypto.randomUUID(), email: `${tag}-${who}@example.invalid`, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = sign('super_admin', 'owner'); office = sign('office_staff', 'office'); sales = sign('sales_rep', 'sales'); crew = sign('field_crew', 'crew')
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
    await prisma.permit.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.installPacket.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: jobs } } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.automationRun.deleteMany({ where: { accountId } })
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.scheduleSettings.deleteMany({ where: { accountId } })
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

  test('the final payment closes the job while the window is open: its old "Advance to Punch List" is refused, the job stays Paid; a note from that window keeps it Paid', async () => {
    const { job, invoices } = await soldJob('Brooks', [today])
    await call('POST', `/api/install-packets/crew/${job}/start`, {}, crew)
    await call('POST', `/api/install-packets/crew/${job}/finish`, {}, crew)
    await signWalkthrough(job)
    // The office's window, opened now: In Progress.
    const window = await read(job)
    expect(window).toMatchObject({ status: 'in_progress', opsStage: 'in_progress' })
    // The final payment from that window: the server closes the job out.
    for (const [i, c] of invoices.entries()) expect((await pay(job, c, `40${i}`)).status).toBe(201)
    const paid = await jobOf(job)
    expect(paid).toMatchObject({ status: 'paid', opsStage: 'paid', completedDate: today })
    // The window's "Advance to Punch List" (from its old copy).
    const adv = await save(job, window, { opsStage: 'punch_list', status: 'in_progress' }, office)
    expect(adv.status).toBe(409)
    expect(adv.json.code).toBe('STALE_JOB')
    expect(adv.json.error).toMatch(/is in Paid now/)
    expect(adv.json.data).toMatchObject({ status: 'paid', opsStage: 'paid' })
    expect(await jobOf(job)).toMatchObject({ status: 'paid', opsStage: 'paid', completedDate: today })
    // A note typed in that old window: saved, the job stays Paid and keeps its completed date.
    const note = await save(job, window, { notes: 'Gate code 4411' }, office)
    expect(note.status).toBe(200)
    expect(await jobOf(job)).toMatchObject({ status: 'paid', opsStage: 'paid', completedDate: today, notes: 'Gate code 4411' })
    // An older screen without a base, sending the whole old copy: the closed job is not moved back either.
    const old = await call('PATCH', `/api/saved-jobs/${job}`, { ...window, opsStage: 'punch_list' }, office)
    expect(old.status).toBe(409)
    expect(old.json.code).toBe('REOPEN_NEEDED')
    expect((await jobOf(job))?.status).toBe('paid')
  })

  test('a Paid job goes back only with Reopen, by the owner or the office; Hold is refused; forward moves are fine', async () => {
    const { job, invoices } = await soldJob('Carter', [today])
    await call('POST', `/api/install-packets/crew/${job}/finish`, {}, crew)
    await signWalkthrough(job)
    for (const [i, c] of invoices.entries()) await pay(job, c, `50${i}`)
    let now = await read(job)
    expect(now.status).toBe('paid')
    // Back to Punch List without Reopen: refused, as said.
    const no = await save(job, now, { opsStage: 'punch_list' }, office)
    expect(no).toMatchObject({ status: 409, json: { code: 'REOPEN_NEEDED' } })
    expect(no.json.error).toMatch(/only the owner or the office can, with Reopen/)
    // A hold on a closed job: refused.
    const hold = await save(job, now, { status: 'on_hold', holdReason: 'Rain Day' }, office)
    expect(hold).toMatchObject({ status: 409, json: { code: 'REOPEN_NEEDED' } })
    // Paid → Complete is back too.
    expect((await save(job, now, { opsStage: 'completed' }, office)).json.code).toBe('REOPEN_NEEDED')
    // The Salesman cannot reopen, even saying Reopen: the Salesman's job page is read only (audit #49, lib/salesmanJobs.ts).
    expect((await save(job, now, { opsStage: 'punch_list' }, sales, { reopen: true }))).toMatchObject({ status: 403, json: { code: 'NOT_ALLOWED' } })
    expect((await jobOf(job))?.status).toBe('paid')
    // The office says Reopen: back in progress, no completed date.
    const yes = await save(job, now, { opsStage: 'punch_list' }, office, { reopen: true })
    expect(yes.status).toBe(200)
    expect(yes.json.data).toMatchObject({ status: 'in_progress', opsStage: 'punch_list', completedDate: null })
    // Forward again (Complete): not a reopen; paid in full, so on to Paid by itself.
    now = await read(job)
    const c = await save(job, now, { opsStage: 'completed' }, office)
    expect(c.status).toBe(200)
    expect(c.json.data).toMatchObject({ status: 'paid' })
  })

  test('two edits from the same window in a row are not stale (the second is made on the first one\'s result)', async () => {
    const { job } = await soldJob('Diaz', [])
    const first = await read(job)
    const a = await save(job, first, { opsStage: 'permit_pending' }, office)
    expect(a.status).toBe(200)
    // The screen's copy after its own edit (not yet confirmed: the same stage it asked for).
    const b = await save(job, { ...first, opsStage: 'permit_pending' }, { opsStage: 'need_drawing' }, office)
    expect(b.status).toBe(200)
    expect((await jobOf(job))?.opsStage).toBe('need_drawing')
  })

  test('the installer\'s card: crew days in order and the close out as it stands (never an amount)', async () => {
    const day2 = plus(today, 7)
    const { job, invoices } = await soldJob('Evans', [today, day2])
    let r = await call('GET', `/api/install-packets/crew/${job}`, undefined, crew)
    expect(r.json.data).toMatchObject({ crewDays: [today, day2], lastDay: day2, closeOut: { closed: false, walkthroughSigned: false, paidInFull: false } })
    await call('POST', `/api/install-packets/crew/${job}/finish`, { jobDone: true }, crew)
    r = await call('GET', `/api/install-packets/crew/${job}`, undefined, crew)
    expect(r.json.data).toMatchObject({ jobDone: true, closeOut: { closed: false, walkthroughSigned: false, paidInFull: false } })
    await signWalkthrough(job)
    r = await call('GET', `/api/install-packets/crew/${job}`, undefined, crew)
    expect(r.json.data.closeOut).toEqual({ closed: false, walkthroughSigned: true, paidInFull: false })
    for (const [i, c] of invoices.entries()) await pay(job, c, `60${i}`)
    r = await call('GET', `/api/install-packets/crew/${job}`, undefined, crew)
    expect(r.json.data.closeOut).toEqual({ closed: true, walkthroughSigned: true, paidInFull: true })
    expect(JSON.stringify(r.json.data)).not.toMatch(/\$|amount|cents/i)
  })

  test('the packet\'s 811 table is sent back after "Replace it?" Yes, with the new ticket, dates and who saved it', async () => {
    const { job } = await soldJob('Fox', [plus(today, 3)])
    await call('PUT', `/api/saved-jobs/${job}/locate`, { ticket: '111222333', calledDate: today, goodDate: plus(today, 2), expDate: plus(today, 30) }, office)
    const p = await prisma.installPacket.create({ data: { accountId, jobId: job, token: `tok${tag}${crypto.randomBytes(8).toString('hex')}`, snapshot: { companyName: 'Getter Done Fence' } as any } })
    const page = await fetch(`${base}/p/i/${p.token}`).then(r => r.text())
    expect(page).toContain('<div id="locOnFile">')
    const yes = await call('POST', `/p/i/${p.token}/locate`, { ticket: '999888777', goodDate: plus(today, 3), replace: true }, null)
    expect(yes.status).toBe(200)
    const onFile = String(yes.json.data.onFile)
    expect(onFile).toMatch(/data-packet-locate-ticket>999888777</)
    expect(onFile).toContain(`data-packet-locate-good>${plus(today, 3).slice(5, 7)}/${plus(today, 3).slice(8, 10)}/${plus(today, 3).slice(0, 4)}<`)
    expect(onFile).toContain('Saved by Crew (install packet)')
    expect(onFile).not.toContain('111222333')
  })
})
