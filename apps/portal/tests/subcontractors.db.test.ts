/**
 * Subcontractors, Phase A, end to end on the dev database (DEV_DB=1 and
 * ezbiz_dev only; Jonathan, Nov 6 2026). Every row it makes is taken off at
 * the end, the sub's crew row on the Schedule too.
 *   - a sub with no insurance on file: assigning is refused with the reasons;
 *     the owner can override (recorded), the office cannot;
 *   - papers on file: assigned in one call; the install is booked as the
 *     sub's crew row; pay from Settings' rates, then from their own rate;
 *   - "Call in 811" task, due 3 business days before; the ticket closes it;
 *   - the link: no price, no margin; red "Do not dig" before the ticket;
 *   - check out, sign off, check in: flags for what does not add up;
 *   - the owner's one tap: Complete with the final furnishing date;
 *   - the Salesman and the Installer get none of it.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('subcontractors (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: subRoutes } = await import('../src/server/routes/subcontractors.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { subLinkPublic } = await import('../src/server/routes/subLinkPublic.js')
  const { subSignPublic } = await import('../src/server/routes/subSignPublic.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { linkToken, businessDaysBefore, subCrewId } = await import('../src/server/lib/subcontractors.js')
  const { plusDays } = await import('../src/server/lib/installDays.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const ND = "WV-ND 6'x8' Privacy"
  const tag = `sub-${Date.now().toString(36)}`
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[], subs: [] as string[] }
  let accountId = '', owner = '', office = '', sales = '', crew = '', base = ''
  let keptSettings: any = undefined
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => { const t = await r.text(); let json: any = null; try { json = JSON.parse(t) } catch { /* html */ } return { status: r.status, json, text: t } })

  // The next Monday at least a week out: a crew day, with business days before it for 811.
  const nextMonday = () => { let d = plusDays(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), 8); while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = plusDays(d, 1); return d }

  async function soldJob() {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E Sub', lastName: tag, phone: '3525550144' } as any })
    made.contacts.push(c.id)
    const q = await prisma.savedQuote.create({ data: {
      accountId, crmContactId: c.id, customerName: `E2E Sub ${tag}`, customerAddress: '7 Sub Rd, Ocala FL', fenceStyle: ND, runs: [100, 20], sections: 16, corners: 1, ends: 2, walkGates: 1, dblGates: 1,
      materialCost: 3000, laborCost: 1500, totalCOGS: 4500, finalPrice: 9876.54, gmPct: 0.25,
      pullSheet: [{ item: 'Vinyl panel 6x8', qty: 16, unitCost: 100, total: 1600 }, { item: 'Vinyl post 5x5', qty: 18, unitCost: 30, total: 540 }], status: 'SOLD', soldAt: new Date(),
    } as any })
    made.quotes.push(q.id)
    const r = await call(owner, 'POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: ND, quotePrice: 9876.54, contractValue: 9876.54, status: 'staging', sections: 16, estimatedDays: 1 })
    expect(r.status).toBe(201)
    made.jobs.push(r.json.data.id)
    return { jobId: r.json.data.id as string, quoteId: q.id }
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    const tok = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = tok('super_admin'); office = tok('office_staff'); sales = tok('sales_rep'); crew = tok('field_crew')
    keptSettings = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'subs:settings' } } }))?.value ?? null
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/subcontractors', subRoutes)
    app.use('/api/saved-jobs', savedJobs)
    app.use('/p/sub-sign', subSignPublic)
    app.use('/p/sub', subLinkPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    const jobs = made.jobs
    await prisma.task.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.scheduledGridJob.deleteMany({ where: { stagingJobId: { in: jobs } } })
    await prisma.subJob.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.subDocument.deleteMany({ where: { subId: { in: made.subs } } })
    await prisma.subSignRequest.deleteMany({ where: { subId: { in: made.subs } } })
    await prisma.subcontractor.deleteMany({ where: { id: { in: made.subs } } })
    const s = await prisma.scheduleSettings.findUnique({ where: { accountId } })
    if (s) await prisma.scheduleSettings.update({ where: { accountId }, data: { crews: (s.crews as any[]).filter(c => !made.subs.some(id => c.id === subCrewId(id))) } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: jobs } } }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { id: { in: jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId, key: { startsWith: 'sub-doc-warned:' } } }).catch(() => {})
    // The agreement settings as they were before this test.
    if (keptSettings === null) await prisma.accountKeyValue.deleteMany({ where: { accountId, key: 'subs:settings' } }).catch(() => {})
    else if (keptSettings) await prisma.accountKeyValue.update({ where: { accountId_key: { accountId, key: 'subs:settings' } }, data: { value: keptSettings } }).catch(() => {})
  })

  test('the whole job: refused without insurance, assigned, 811, the link, check out, sign off, check in, confirm', async () => {
    // The Salesman and the Installer: no subs at all.
    expect((await call(sales, 'GET', '/api/subcontractors')).status).toBe(403)
    expect((await call(crew, 'GET', '/api/subcontractors')).status).toBe(403)

    const add = await call(office, 'POST', '/api/subcontractors', { businessName: `E2E Fence Sub ${tag}`, contactName: 'Sam Sub', phone: '3525550145', email: `sub-${tag}@example.invalid`, trades: ['vinyl', 'gates'], crewSize: 3 })
    expect(add.status).toBe(201)
    const subId = add.json.data.id as string
    made.subs.push(subId)
    // "Do not use" needs a reason.
    expect((await call(office, 'PUT', `/api/subcontractors/${subId}`, { ...add.json.data, status: 'do_not_use', statusReason: '' })).status).toBe(400)

    const { jobId } = await soldJob()
    const start = nextMonday()
    // No papers: refused, with the reasons; the office cannot override.
    const refused = await call(office, 'POST', '/api/subcontractors/assign', { jobId, subId, start })
    expect(refused.status).toBe(409)
    expect(refused.json.code).toBe('SUB_PAPERS')
    expect(refused.json.problems).toEqual(['No general liability certificate on file', "No workers' comp policy or Florida exemption on file"])
    expect((await call(office, 'POST', '/api/subcontractors/assign', { jobId, subId, start, override: true })).status).toBe(403)

    // Papers on file (liability and the Florida exemption), uploaded as PDFs with their expiry.
    const pdf = new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' })
    for (const [kind, exp] of [['liability', plusDays(start, 200)], ['wc_exemption', plusDays(start, 20)]]) {
      const fd = new FormData(); fd.append('kind', kind); fd.append('expiresOn', exp); fd.append('file', pdf, `${kind}.pdf`)
      const up = await fetch(`${base}/api/subcontractors/${subId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${office}` }, body: fd })
      expect(up.status).toBe(201)
    }
    // The office cannot file a W9.
    const w9 = new FormData(); w9.append('kind', 'w9'); w9.append('file', pdf, 'w9.pdf')
    expect((await fetch(`${base}/api/subcontractors/${subId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${office}` }, body: w9 })).status).toBe(403)

    // Preview, then assign: booked as the sub's own crew row, pay from Settings' rates.
    const pre = (await call(office, 'GET', `/api/subcontractors/assign/preview?jobId=${jobId}&subId=${subId}&start=${start}`)).json.data
    expect(pre.insuranceProblems).toEqual([])
    expect(pre.days).toEqual([start])
    const assigned = await call(office, 'POST', '/api/subcontractors/assign', { jobId, subId, start })
    expect(assigned.status).toBe(200)
    expect(assigned.json.data.days).toEqual([start])
    const grid = await prisma.scheduledGridJob.findMany({ where: { stagingJobId: jobId, deletedAt: null } })
    expect(grid.map(g => [g.date, g.crewId])).toEqual([[start, subCrewId(subId)]])
    const crews = (await prisma.scheduleSettings.findUnique({ where: { accountId } }))!.crews as any[]
    expect(crews.find(c => c.id === subCrewId(subId))?.name).toBe(`E2E Fence Sub ${tag}`)
    const job = await prisma.savedJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.crewAssigned).toBe(`E2E Fence Sub ${tag}`)

    // Their own vinyl rate ($4.50 a foot) and walk gate ($60): pay follows (cents, per line).
    const detail = (await call(office, 'GET', `/api/subcontractors/${subId}`)).json.data
    const cat = detail.rates.categories.find((c: string) => /vinyl/i.test(c)) ?? 'Vinyl'
    expect((await call(office, 'PUT', `/api/subcontractors/${subId}`, { ...detail.sub, rates: { perUnit: { [cat]: 450 }, walkGate: 6000 } })).status).toBe(200)
    const reset = await call(office, 'PUT', `/api/subcontractors/job/${jobId}`, { payReset: true })
    const lines = reset.json.data.payLines as any[]
    const fence = lines.find(l => l.key === 'fence'), walk = lines.find(l => l.key === 'walk')
    if (fence.unit === 'ft') expect([fence.qty, fence.rateCents, fence.cents]).toEqual([120, 450, 54000])
    expect([walk.qty, walk.rateCents, walk.cents]).toEqual([1, 6000, 6000])
    expect(reset.json.data.payCents).toBe(lines.reduce((t, l) => t + l.cents, 0))
    // Pay typed by hand stays until Reset.
    expect((await call(office, 'PUT', `/api/subcontractors/job/${jobId}`, { payCents: 70000 })).json.data).toMatchObject({ payCents: 70000, payEdited: true })

    // "Call in 811": due 3 business days before; the ticket closes it.
    const task = await prisma.task.findFirstOrThrow({ where: { jobId, title: { startsWith: 'Call in 811: ' } } })
    expect(task.status).toBe('pending')
    expect(task.dueDate!.toISOString().slice(0, 10)).toBe(businessDaysBefore(start, 3))
    expect(task.assignedTo).toBeNull()

    // The link: the sub's pay, red "Do not dig" before the ticket; never the customer's price.
    const sj = await prisma.subJob.findUniqueOrThrow({ where: { jobId } })
    const token = linkToken(sj.id, sj.linkNonce)
    const pagePre = await call('', 'GET', `/p/sub/${token}`)
    expect(pagePre.status).toBe(200)
    expect(pagePre.text).toContain('Do not dig, 811 ticket not in yet')
    expect(pagePre.text).toContain('$700.00')
    expect(pagePre.text).not.toContain('9,876')
    expect(pagePre.text).not.toContain('3525550144')
    expect((await call('', 'GET', `/p/sub/${token.slice(0, -2)}xx`)).status).toBe(404)

    const loc = await call(owner, 'PUT', `/api/saved-jobs/${jobId}/locate`, { ticket: '311026-123', calledDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), goodDate: plusDays(start, -2), expDate: plusDays(start, 25) })
    expect(loc.status, JSON.stringify(loc.json)).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('completed')
    const pagePost = await call('', 'GET', `/p/sub/${token}`)
    expect(pagePost.text).toContain('Ticket 311026-123')
    expect(pagePost.text).not.toContain('Do not dig, 811 ticket not in yet')

    // A photo id stands for the trailer and after photos (the link's own upload is the packet's, used for real in the browser).
    const photo = '00000000-0000-4000-8000-000000000001'
    // Check out: every line ticked, one short.
    expect((await call('', 'POST', `/p/sub/${token}/checkout`, { lines: [{ item: 'Vinyl panel 6x8', ticked: true, taken: 16 }, { item: 'Vinyl post 5x5', ticked: false, taken: 18 }], photos: [photo] })).status).toBe(400)
    expect((await call('', 'POST', `/p/sub/${token}/checkout`, { lines: [{ item: 'Vinyl panel 6x8', ticked: true, taken: 16 }, { item: 'Vinyl post 5x5', ticked: true, taken: 17 }], photos: [photo] })).status).toBe(200)
    expect((await prisma.savedJob.findUniqueOrThrow({ where: { id: jobId } })).materialsStatus).toBe('loaded')
    // Sign off: missing things are said; then sent, with 110 ft (the job is 120) and 2 gates.
    const missing = await call('', 'POST', `/p/sub/${token}/report`, { startedOn: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), submit: true })
    expect(missing.status).toBe(400)
    expect(missing.json.error).toContain('the day you finished')
    // Before check in: one post short of the pull sheet.
    expect(((await prisma.subJob.findUniqueOrThrow({ where: { jobId } })).flags as any[]).map(f => f.key)).toContain('short:Vinyl post 5x5')
    // A day still to come is refused (it starts the lien and warranty clocks); the work done today is signed off.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    expect((await call('', 'POST', `/p/sub/${token}/report`, { startedOn: start, finishedOn: start, footage: 110, gates: 2, after: [photo], signName: 'Sam Sub', signedOn: start, submit: true })).status).toBe(400)
    expect((await call('', 'POST', `/p/sub/${token}/report`, { startedOn: today, finishedOn: today, footage: 110, gates: 2, after: [photo], signName: 'Sam Sub', signedOn: today, submit: true })).status).toBe(200)
    // Check in: 1 panel back.
    expect((await call('', 'POST', `/p/sub/${token}/checkin`, { lines: [{ item: 'Vinyl panel 6x8', back: 1 }, { item: 'Vinyl post 5x5', back: 0 }], photos: [photo] })).status).toBe(200)
    const after = await prisma.subJob.findUniqueOrThrow({ where: { jobId } })
    const flags = (after.flags as any[]).map(f => f.key)
    expect(flags).toContain('footage')
    // After check in: used (out − back) against the pull sheet: 17 posts used of 18; 15 panels used of 16.
    expect(flags).toContain('material:Vinyl post 5x5')
    expect(flags).toContain('material:Vinyl panel 6x8')
    expect((after.flags as any[]).find(f => f.key === 'material:Vinyl post 5x5').text).toBe('Vinyl post 5x5: 17 out − 0 back = 17 used; the pull sheet is 18 (1 fewer).')
    expect(flags).not.toContain('gates')

    // The dashboard: waiting on the owner's confirm.
    const dash = (await call(office, 'GET', '/api/subcontractors/dashboard')).json.data
    expect(dash.waitingOnYou.map((x: any) => x.jobId)).toContain(jobId)

    // One tap: Complete, final furnishing date the sub's finish day (editable).
    const conf = await call(owner, 'POST', `/api/subcontractors/job/${jobId}/confirm`, { finalFurnishingDate: null })
    expect(conf.status).toBe(200)
    const done = await prisma.savedJob.findUniqueOrThrow({ where: { id: jobId } })
    expect([done.finalFurnishingDate, done.completedDate]).toEqual([today, today])
    expect(done.opsStage).toBe('completed')
  })

  test('the agreement: locked until the owner marks it reviewed; signed on the link and filed on the sub', async () => {
    const add = await call(office, 'POST', '/api/subcontractors', { businessName: `E2E Sign Sub ${tag}`, contactName: 'Sue Sign', email: `sign-${tag}@example.invalid` })
    const subId = add.json.data.id as string
    made.subs.push(subId)
    const start = (await call(office, 'GET', '/api/subcontractors/settings')).json.data
    expect(start.agreement.text).toContain('[NUMBER] months')
    // The office cannot change the words (settings.change), the owner can; new words take the review off.
    expect((await call(office, 'PUT', '/api/subcontractors/settings', { agreement: { text: start.agreement.text, callbackMonths: 12 } })).status).toBe(403)
    const saved = (await call(owner, 'PUT', '/api/subcontractors/settings', { agreement: { text: start.agreement.text, callbackMonths: 12 } })).json.data
    expect(saved.agreement.reviewedAt).toBeNull()
    const locked = await call(office, 'POST', `/api/subcontractors/${subId}/agreement`)
    expect(locked.status).toBe(409)
    expect(locked.json.error).toContain('Attorney review required')
    // Only the owner marks it reviewed.
    expect((await call(office, 'POST', '/api/subcontractors/settings/reviewed', { reviewed: true })).status).toBe(403)
    expect((await call(owner, 'POST', '/api/subcontractors/settings/reviewed', { reviewed: true })).json.data.agreement.reviewedAt).toBeTruthy()
    const sent = await call(office, 'POST', `/api/subcontractors/${subId}/agreement`)
    expect(sent.status).toBe(200)
    const token = String(sent.json.data.link).split('/p/sub-sign/')[1]
    const pageNow = await call('', 'GET', `/p/sub-sign/${token}`)
    expect(pageNow.text).toContain('12 months')
    expect(pageNow.text).toContain(`E2E Sign Sub ${tag}`)
    const SIG = 'data:image/png;base64,' + Buffer.alloc(400, 1).toString('base64')
    expect((await call('', 'POST', `/p/sub-sign/${token}/sign`, { name: 'Sue Sign', signature: SIG })).status).toBe(200)
    const papers = (await call(office, 'GET', `/api/subcontractors/${subId}`)).json.data
    expect(papers.documents.map((d: any) => [d.kind, d.version, d.mime])).toEqual([['agreement', `v${saved.agreement.version}`, 'application/pdf']])
    expect(papers.papers.missing).not.toContain('Subcontractor Agreement (signed)')
    // Changing the words again takes the review off (the next send is locked).
    await call(owner, 'PUT', '/api/subcontractors/settings', { agreement: { text: start.agreement.text + '\n\n9. Added.', callbackMonths: 12 } })
    expect((await call(office, 'POST', `/api/subcontractors/${subId}/agreement`)).status).toBe(409)
  })

  test('booked on another crew: the sub comes off the job; Inactive: their crew row leaves the Schedule', async () => {
    const { scheduleInstall } = await import('../src/server/lib/installScheduling.js')
    const add = await call(owner, 'POST', '/api/subcontractors', { businessName: `E2E Move Sub ${tag}`, email: `move-${tag}@example.invalid` })
    const subId = add.json.data.id as string
    made.subs.push(subId)
    const { jobId } = await soldJob()
    const start = nextMonday()
    expect((await call(owner, 'POST', '/api/subcontractors/assign', { jobId, subId, start, override: true })).status).toBe(200)
    const crews = (await prisma.scheduleSettings.findUniqueOrThrow({ where: { accountId } })).crews as any[]
    const other = crews.find(c => !String(c.id).startsWith('sub-'))
    await scheduleInstall(accountId, { userId: null, name: 'Test' } as any, { jobId, start, crew: other.id })
    expect(await prisma.subJob.findUnique({ where: { jobId } })).toBeNull()
    // Nothing booked on their row now: Inactive takes it off the Schedule.
    const s = (await call(owner, 'GET', `/api/subcontractors/${subId}`)).json.data.sub
    expect((await call(owner, 'PUT', `/api/subcontractors/${subId}`, { ...s, status: 'inactive' })).status).toBe(200)
    const after = (await prisma.scheduleSettings.findUniqueOrThrow({ where: { accountId } })).crews as any[]
    expect(after.some(c => c.id === subCrewId(subId))).toBe(false)
  })
})
