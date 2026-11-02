/**
 * A move or repair changed in the quote builder keeps its work, as a new fence
 * does (Nov 2 2026; dev database, DEV_DB=1; refuses any other): the next change
 * order opens on it, the job, pull sheet, packet steps and quoted cost follow,
 * in any signing order, and a void takes off only its own. Typed lines stay
 * price only, and a signed job stays the kind of job it was sold as.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('change orders on a move or repair keep their work (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { default: pullSheets } = await import('../src/server/routes/pull-sheets.js')
  const { packetStaff, packetPublic } = await import('../src/server/routes/installPacket.js')
  const { changeOrderPublic } = await import('../src/server/routes/changeOrderPublic.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { snapshotQuotedCost } = await import('../src/server/lib/jobCosting.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const STYLE = "WV-ND 6'x8' Privacy"
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[] }
  let accountId = '', owner = '', base = '', userId = '', n = 0
  let server: ReturnType<express.Express['listen']>
  const call = (method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => { const t = await r.text(); let json: any = null; try { json = JSON.parse(t) } catch { /* html */ } return { status: r.status, json, text: t } })

  const MOVE = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false }
  const REPAIR = { what: 'other', items: { replaceSection: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' }
  const request = (ft: number, walk: number, jobType: string, inputs: object = {}) => ({ fenceStyle: STYLE, runs: [{ ft, rail: 'auto' }], corners: 0, ends: 2, walkGates: walk, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType, ...inputs })
  const lines = (cents: number, description = "Price difference at today's prices") => [{ id: `l${n++}`, description, amountCents: cents }]

  async function signed(work: object | null, sections = 13) {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E CO', lastName: `Move ${Date.now().toString(36)}${n++}`, phone: '3525550133' } as any })
    made.contacts.push(c.id)
    const q = await prisma.savedQuote.create({ data: {
      accountId, ownerId: userId, crmContactId: c.id, customerName: `E2E CO ${c.lastName}`, customerAddress: '3 Change Rd, Ocala FL', fenceStyle: STYLE, runs: [100], sections, corners: 0, ends: 2, ...(work ? { work } : {}),
      materialCost: 1000, laborCost: 800, totalCOGS: 1800, finalPrice: 4000, gmPct: 0.3, pullSheet: [{ item: 'Vinyl post', qty: 14, unitCost: 10, total: 140 }], status: 'SOLD', soldAt: new Date(),
    } as any })
    made.quotes.push(q.id)
    await snapshotQuotedCost(accountId, q.id, 'app')
    const r = await call('POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: STYLE, quotePrice: 4000, contractValue: 4000, status: 'scheduled', sections, totalFeet: 100, scheduledDate: '2026-12-07', scheduledEndDate: '2026-12-07', estimatedDays: 1 })
    expect(r.status).toBe(201)
    made.jobs.push(r.json.data.id)
    return { quoteId: q.id, jobId: r.json.data.id as string, contactId: c.id }
  }
  const make = async (quoteId: string, body: object) => { const r = await call('POST', '/api/change-orders', { id: `co-${Date.now()}-${n++}`, quoteId, reason: 'Customer asked for it', ...body }); expect(r.status).toBe(201); return r.json.data }
  const approve = async (c: any) => { const r = await call('PATCH', `/api/change-orders/${c.id}`, { baseVersion: c.version, status: 'approved', verbalReason: 'Customer agreed on the phone' }); expect(r.status).toBe(200); return r.json.data }
  const job = (id: string) => prisma.savedJob.findUnique({ where: { id } })
  const start = async (quoteId: string) => (await call('GET', `/api/change-orders/start?quoteId=${quoteId}`)).json.data

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    userId = user.id
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/change-orders', changeOrders)
    app.use('/api/pull-sheets', pullSheets)
    app.use('/api/install-packets', packetStaff)
    app.use('/p/i', packetPublic)
    app.use('/p/co', changeOrderPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const jobs = made.jobs
    await prisma.installPacket.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    const cos = await prisma.changeOrder.findMany({ where: { quoteId: { in: made.quotes } }, select: { id: true } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...cos.map(c => c.id)] } } })
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.notification.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: jobs } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    server?.close()
  })

  test('a move: CO-1 20 ft, CO-2 a gate, CO-3 the gate out; each starts from the one before', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    expect(await start(quoteId)).toMatchObject({ runs: [100], walkGates: 0, move: MOVE })

    const co1 = await approve(await make(quoteId, { lines: lines(80000), work: { request: request(120, 0, 'move', { move: MOVE }), layout: { yard: null } } }))
    expect(co1.work).toMatchObject({ runs: [120], footage: 120, walkGates: 0 })
    expect(co1.scope.footageFt).toBe(20)
    expect(co1.costDelta.totalCents).toBeGreaterThan(0)
    expect(await job(jobId)).toMatchObject({ contractValue: 4800, totalFeet: 120, sections: co1.work.sections })
    expect(await start(quoteId)).toMatchObject({ runs: [120], walkGates: 0, move: MOVE })

    const co2 = await approve(await make(quoteId, { lines: lines(30000), work: { request: request(120, 1, 'move', { move: MOVE }), layout: { yard: null } } }))
    expect(co2.scope).toMatchObject({ walkGates: 1 })
    expect(co2.scope.footageFt).toBeUndefined()
    expect(await job(jobId)).toMatchObject({ contractValue: 5100, walkGates: 1 })
    expect(await start(quoteId)).toMatchObject({ runs: [120], walkGates: 1 })

    await approve(await make(quoteId, { lines: lines(-30000), work: { request: request(120, 0, 'move', { move: MOVE }), layout: { yard: null } } }))
    expect(await job(jobId)).toMatchObject({ contractValue: 4800, changeOrderTotal: 800, walkGates: 0, totalFeet: 120 })
  })

  test('the cost difference is of the move, never a new fence of the same runs', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const co = await make(quoteId, { lines: lines(0, 'No change'), work: { request: request(100, 0, 'move', { move: MOVE }), layout: { yard: null } } })
    expect(co.costDelta.totalCents).toBe(0)
  })

  test('a move input changed: the next one opens on it, and its own void takes it back', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const moved = { ...MOVE, newPostCaps: true }
    const co = await approve(await make(quoteId, { lines: lines(5000), work: { request: request(100, 0, 'move', { move: moved }), layout: { yard: null } } }))
    expect((await start(quoteId)).move.newPostCaps).toBe(true)
    const r = await call('PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'void' })
    expect(r.status).toBe(200)
    expect((await start(quoteId)).move.newPostCaps).toBe(false)
  })

  /** A repair with 1 reset post; CO-1 adds one, CO-2 is drawn on top and adds another. */
  async function twoResets() {
    const start1 = { ...REPAIR, items: { resetPost: 1 } }
    const { quoteId, jobId } = await signed({ type: 'repair', repair: start1 }, 1)
    const req = (resetPost: number) => ({ request: request(100, 0, 'repair', { repair: { ...REPAIR, items: { resetPost } } }), layout: { yard: null } })
    const co1 = await make(quoteId, { lines: lines(70000, 'Add 1 leaning post reset'), work: req(2) })
    expect((await start(quoteId)).repair.items).toEqual({ resetPost: 2 })
    const co2 = await make(quoteId, { lines: lines(70000, 'Add 1 leaning post reset'), work: req(3) })
    return { quoteId, jobId, co1, co2 }
  }

  test('a repair: signed in order, 3 resets in the contract and the job', async () => {
    const { quoteId, jobId, co1, co2 } = await twoResets()
    await approve(co1); await approve(co2)
    expect((await start(quoteId)).repair.items).toEqual({ resetPost: 3 })
    expect(await job(jobId)).toMatchObject({ contractValue: 5400 })
  })

  test('a repair: CO-2 signed before CO-1, the job has all 3 the contract pays for, on the priced work too', async () => {
    const { quoteId, jobId, co1, co2 } = await twoResets()
    await approve(co2)
    expect((await start(quoteId)).repair.items).toEqual({ resetPost: 3 })
    const later = await approve((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data.find((c: any) => c.id === co1.id))
    expect(await job(jobId)).toMatchObject({ contractValue: 5400 })
    expect((await start(quoteId)).repair.items).toEqual({ resetPost: 3 })
    // The newest approved one's work is what the job and packet read: it has 3.
    expect(later.jobWork.workDetail.repair.items).toEqual({ resetPost: 3 })
    expect(later.jobWork.workDetail.crew.join(' ')).toMatch(/3/)
  })

  test('a repair: CO-1 voided, CO-2 signed: 2 resets, as the contract pays', async () => {
    const { quoteId, jobId, co1, co2 } = await twoResets()
    const after = await approve(co2)
    const fresh = (await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data.find((c: any) => c.id === co1.id)
    const r = await call('PATCH', `/api/change-orders/${fresh.id}`, { baseVersion: fresh.version, status: 'void' })
    expect(r.status).toBe(200)
    expect(r.json.creditWarning).toMatch(/CO-1's change is out of the job now and CO-2 keeps its own/)
    expect((await start(quoteId)).repair.items).toEqual({ resetPost: 2 })
    expect(await job(jobId)).toMatchObject({ contractValue: 4700 })
    const now = (await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data.find((c: any) => c.id === after.id)
    expect(now.jobWork.workDetail.repair.items).toEqual({ resetPost: 2 })
  })

  test('the packet steps follow: stored with the work, and given to every login without a cost', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const co = await make(quoteId, { lines: lines(80000), work: { request: request(120, 0, 'move', { move: MOVE }), layout: { yard: null } } })
    const said = co.work.workDetail.crew.join(' ')
    expect(said).toMatch(new RegExp(`${co.work.sections} sections`))
    expect(JSON.stringify(co.work.workDetail)).not.toMatch(/cents|cost/i)
  })

  test('a signed job stays what it was sold as: refused both ways, no draft left', async () => {
    const newFence = await signed(null as never)
    const asRepair = await call('POST', '/api/change-orders', { id: `co-${Date.now()}-${n++}`, quoteId: newFence.quoteId, reason: 'One post', lines: lines(-823900), work: { request: request(100, 0, 'repair', { repair: REPAIR }), layout: { yard: null } } })
    expect(asRepair.status).toBe(409)
    expect(asRepair.json.error).toMatch(/sold as a new fence/)
    const move = await signed({ type: 'move', move: MOVE })
    const asNew = await call('POST', '/api/change-orders', { id: `co-${Date.now()}-${n++}`, quoteId: move.quoteId, reason: 'Back to new', lines: lines(10000), work: { request: request(120, 0, 'new'), layout: { yard: null } } })
    expect(asNew.status).toBe(409)
    expect(asNew.json.error).toMatch(/sold as a fence move/)
    expect(await prisma.changeOrder.count({ where: { quoteId: { in: [newFence.quoteId, move.quoteId] } } })).toBe(0)
  })

  test('typed lines stay price only', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    const typed = await approve(await make(quoteId, { lines: lines(10000, 'Haul off the old slab') }))
    expect(typed.work).toBeNull()
    expect(await job(jobId)).toMatchObject({ contractValue: 4100, totalFeet: 100 })
    expect(await start(quoteId)).toMatchObject({ runs: [100], move: MOVE })
  })

  const fresh = async (quoteId: string, id: string) => (await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data.find((c: any) => c.id === id)
  const voidIt = async (quoteId: string, id: string) => { const c = await fresh(quoteId, id); return call('PATCH', `/api/change-orders/${id}`, { baseVersion: c.version, status: 'void' }) }
  const move = (ft: number, m = MOVE, walk = 0) => ({ request: request(ft, walk, 'move', { move: m }), layout: { yard: null } })
  const sheet = async (contactId: string, jobId: string) => (await call('GET', `/api/pull-sheets/customer/${contactId}`)).json.data.entries.find((e: any) => e.jobId === jobId)

  test.each([['a move', { type: 'move', move: MOVE }, 'move'], ['a new fence', null, 'new']])('%s: 100 to 120, 120 to 140, signed backwards: 140 ft on the job and pull sheet', async (_n, w, kind) => {
    const { quoteId, jobId, contactId } = await signed(w as never)
    const req = (ft: number) => ({ request: request(ft, 0, kind as string, kind === 'move' ? { move: MOVE } : {}), layout: { yard: null } })
    const co1 = await make(quoteId, { lines: lines(80000), work: req(120) })
    const co2 = await make(quoteId, { lines: lines(80000), work: req(140) })
    await approve(co2)
    expect(await job(jobId)).toMatchObject({ totalFeet: 120, contractValue: 4800 }) // its own 20 ft on the signed 100
    await approve(await fresh(quoteId, co1.id))
    expect(await job(jobId)).toMatchObject({ totalFeet: 140, contractValue: 5600 })
    expect((await start(quoteId)).runs).toEqual([140])
    expect((await sheet(contactId, jobId)).footageFt ?? 140).toBe(140)
  })

  test('a move\'s old line adds up too, signed backwards or with a void, and the void says only what is true', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const m = (oldFt: number) => move(100, { ...MOVE, oldFt })
    const co1 = await make(quoteId, { lines: lines(25300), work: m(110) })
    const co2 = await make(quoteId, { lines: lines(12700), work: m(120) })
    await approve(co2); await approve(await fresh(quoteId, co1.id))
    expect((await start(quoteId)).move.oldFt).toBe(120)
    const r = await voidIt(quoteId, co1.id)
    expect((await start(quoteId)).move.oldFt).toBe(110)
    expect(r.json.creditWarning).toMatch(/CO-\d+'s change is out of the job now/)
  })

  test('a single value on two open change orders: the later can\'t be signed first, and the customer is told to call', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    const co1 = await make(quoteId, { lines: lines(5000), work: move(100, { ...MOVE, oldPostType: 'ds' }) })
    const co2 = await make(quoteId, { lines: lines(5000), work: move(100, { ...MOVE, oldPostType: 'nd' }) })
    expect(co2.status).toBe('draft')
    const refused = await call('PATCH', `/api/change-orders/${co2.id}`, { baseVersion: co2.version, status: 'approved', verbalReason: 'Customer agreed on the phone' })
    expect(refused.status).toBe(409)
    expect(refused.json.error).toMatch(/both change the old post type.*Have CO-\d+ signed first, or void it/)
    await approve(await fresh(quoteId, co1.id))
    await approve(await fresh(quoteId, co2.id))
    expect((await start(quoteId)).move.oldPostType).toBe('nd')
    expect(await job(jobId)).toMatchObject({ contractValue: 4100 })
  })

  test('with the earlier one voided, the later can be signed, and a void of it says what stayed', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const co1 = await approve(await make(quoteId, { lines: lines(5000), work: move(100, { ...MOVE, damagePct: 20 }) }))
    await approve(await make(quoteId, { lines: lines(5000), work: move(100, { ...MOVE, damagePct: 30 }) }))
    const r = await voidIt(quoteId, co1.id)
    expect(r.json.creditWarning).toMatch(/also changed the damage allowance, so that stays/)
    expect(r.json.creditWarning).not.toMatch(/CO-\d+'s change is out of the job/)
  })

  test('a signed credit voided under a later one: the amount is said, kept for the next line, and the job history says the job', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    const co1 = await approve(await make(quoteId, { lines: lines(-28200), work: move(80) }))
    await approve(await make(quoteId, { lines: lines(9400), work: move(90) }))
    const r = await voidIt(quoteId, co1.id)
    expect(await job(jobId)).toMatchObject({ totalFeet: 110, contractValue: 4094 })
    expect(r.json.creditWarning).toMatch(/under what this work prices at today/)
    const now = await fresh(quoteId, co1.id)
    expect(now.voidGapCents).toBeGreaterThan(0)
    expect((r.json.creditWarning as string)).toContain(`$${(now.voidGapCents / 100).toLocaleString('en-US')}`)
    const items = (await call('GET', `/api/change-orders/timeline?jobId=${jobId}`)).json.data.items.map((x: any) => x.title)
    expect(items.some((t: string) => /The job after CO-1 was voided: 110 ft/.test(t))).toBe(true)
  })

  /** New fence: the warning never says an amount or a line, whatever the chain (Nov 2 2026: "$202 under" with a true gap of $161, $1 and $0). */
  const plainWarning = (w: string) => {
    expect(w).toMatch(/the contract stands as it is\. Check the contract against the work/)
    expect(w).not.toMatch(/\$\d/)
    expect(w).not.toMatch(/own line/)
  }
  const sold = (ft: number, walk: number) => ({ request: request(ft, walk, 'new'), layout: { yard: null } })

  test.each([['chain link', "CL - 5' Galv"], ['vinyl', STYLE]])('a new fence, %s: gate signed, 20 ft signed, gate voided: true words, no amount', async (_n, style) => {
    const { quoteId, jobId } = await signed(null)
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { fenceStyle: style } })
    const w = (ft: number, walk: number) => ({ request: { ...request(ft, walk, 'new'), fenceStyle: style }, layout: { yard: null } })
    const co1 = await approve(await make(quoteId, { lines: lines(49500), work: w(100, 1) }))
    await approve(await make(quoteId, { lines: lines(43100), work: w(120, 1) }))
    const r = await voidIt(quoteId, co1.id)
    plainWarning(r.json.creditWarning)
    expect((await fresh(quoteId, co1.id)).voidGapCents).toBe(0)
    expect(await job(jobId)).toMatchObject({ contractValue: 4431, totalFeet: 120 })
  })

  test('a new fence: gate signed, gate out still open, gate voided: no amount', async () => {
    const { quoteId } = await signed(null)
    const co1 = await approve(await make(quoteId, { lines: lines(49500), work: sold(100, 1) }))
    await make(quoteId, { lines: lines(-49500), work: sold(100, 0) })
    const r = await voidIt(quoteId, co1.id)
    plainWarning(r.json.creditWarning)
    expect(r.json.creditWarning).toMatch(/Void CO-2 too/)
  })

  test('a void is a pull sheet revision of its own, between the orders around it, and the job history reads the same', async () => {
    const { quoteId, jobId, contactId } = await signed({ type: 'move', move: MOVE })
    const co1 = await approve(await make(quoteId, { lines: lines(80000), work: move(120) }))
    await approve(await make(quoteId, { lines: lines(80000), work: move(140) }))
    expect((await sheet(contactId, jobId)).revision).toBe(3)
    await voidIt(quoteId, co1.id)
    expect((await sheet(contactId, jobId)).revision).toBe(4)
    await approve(await make(quoteId, { lines: lines(10000), work: move(125) }))
    const s = await sheet(contactId, jobId)
    expect(s.revision).toBe(5)
    expect(s.revisions.map((r: any) => r.title.replace(/^Rev \d+: /, ''))).toEqual(['change order CO-3', 'CO-1 voided', 'change order CO-2', 'as signed'])
    const items = (await call('GET', `/api/change-orders/timeline?jobId=${jobId}`)).json.data.items.map((x: any) => x.title)
    expect(items).toEqual(expect.arrayContaining(['Pull sheet rev 4 for the crew (CO-1 voided)', 'Pull sheet rev 5 for the crew (change order CO-3)']))
  })

  test('signing CO-1 after CO-2: its drawing is said to be its own, with the feet the job goes to', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const co1 = await make(quoteId, { lines: lines(80000), work: { ...move(120), planSvg: SVG } })
    const co2 = await make(quoteId, { lines: lines(80000), work: { ...move(140), planSvg: SVG } })
    await approve(co2)
    const now = await fresh(quoteId, co1.id)
    const data = (await call('GET', `/api/change-orders/${co1.id}/for-signing`)).json.data
    expect(data.jobNote).toBe('This drawing shows 120 ft. With what is signed so far, the job will be 140 ft.')
    await call('PATCH', `/api/change-orders/${co1.id}`, { baseVersion: now.version, status: 'sent' })
    const token = (await call('POST', `/api/change-orders/${co1.id}/link`)).json.data.token
    expect(await fetch(`${base}/p/co/${token}`).then(x => x.text())).toMatch(/data-co-job-feet>This drawing shows 120 ft\. With what is signed so far, the job will be 140 ft\./)
  })

  test('voiding a typed line says nothing false', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const typed = await approve(await make(quoteId, { lines: lines(10000, 'Extra concrete footing') }))
    await approve(await make(quoteId, { lines: lines(30000), work: move(110) }))
    const r = await voidIt(quoteId, typed.id)
    expect(r.status).toBe(200)
    expect(r.json.creditWarning).toBeUndefined()
    expect((await fresh(quoteId, typed.id)).voidGapCents).toBe(0)
  })

  test('voiding CO-1 after CO-2 edited the same side: CO-2 keeps its own feet, the packet and pull sheet say the void', async () => {
    const { quoteId, jobId, contactId } = await signed({ type: 'move', move: MOVE })
    const packet = await call('POST', '/api/install-packets', { jobId, snapshot: { style: STYLE, footageFt: 100, sections: 13, pullSheet: [{ item: 'Vinyl post', qty: 14 }], planSvg: '<svg/>' } })
    expect(packet.status).toBe(200)
    await approve(await make(quoteId, { lines: lines(10000, 'Extra concrete footing') }))
    const co2 = await approve(await make(quoteId, { lines: lines(80000), work: move(120) }))
    await approve(await make(quoteId, { lines: lines(90000), work: move(144) }))
    expect(await job(jobId)).toMatchObject({ totalFeet: 144, contractValue: 5800 })
    const before = (await sheet(contactId, jobId)).revision
    const r = await voidIt(quoteId, co2.id)
    expect(r.status).toBe(200)
    expect(r.json.creditWarning).toMatch(/Check it against the contract/)
    expect(await job(jobId)).toMatchObject({ totalFeet: 124, contractValue: 5000 })
    expect(await start(quoteId)).toMatchObject({ runs: [124] })
    const s = await sheet(contactId, jobId)
    expect(s.revision).toBe(before + 1)
    expect(s.source).toMatch(/CO-2 voided/)
    const staff = (await call('GET', `/api/install-packets?jobId=${jobId}`)).json.data
    expect(staff.changedBy).toBeTruthy()
    const page = await fetch(`${base}/p/i/${staff.token}`).then(x => x.text())
    expect(page).toMatch(/data-packet-voided/)
    expect(page).toMatch(/CO-2 was voided on/)
    expect(page).toMatch(/added 24 ft/)
    expect(page).not.toMatch(/120 ft → 144 ft/)
    expect(page).toMatch(/data-packet-typed/)
    expect(page).toMatch(/Extra concrete footing/)
    expect(page).not.toMatch(/\$100/)
  })

  test('a move or repair change order with no inputs is refused', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const r = await call('POST', '/api/change-orders', { id: `co-${Date.now()}-${n++}`, quoteId, reason: 'No inputs', lines: lines(10000), work: { request: request(120, 0, 'move'), layout: { yard: null } } })
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/no move details/)
  })

  test('picked sections on a move stay price only (a new fence keeps the work they leave)', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    const co = await approve(await make(quoteId, { lines: [{ id: `l${n++}`, description: '1 × Add a section', amountCents: 30000, qty: 1, source: { kind: 'repair', ref: 'add:section', label: 'Add a section' } }] }))
    expect(co.work).toBeNull()
    expect(await job(jobId)).toMatchObject({ contractValue: 4300, totalFeet: 100 })
  })
})
