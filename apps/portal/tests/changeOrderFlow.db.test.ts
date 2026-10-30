/**
 * Once a change order is approved, everything follows (Jonathan, Oct 22 2026;
 * dev database, DEV_DB=1; refuses any other). On a signed test job:
 *
 * - From the yard drawing, +12 ft and a walk gate: the server prices the new
 *   work (pull sheet, costs, sections); the customer signs on the office's
 *   phone (in person): contract rev 2, change order CO-1; the job's contract
 *   value, sections, feet, gates and crew days; a warning when the scheduled
 *   install no longer fits; the payment schedule's Final; pull sheet rev 2 with
 *   what changed, rev 1 kept; the crew's install packet shows the change; the
 *   quoted cost includes it; the signed PDF is stored; the customer history and
 *   the job timeline say "Change order CO-1 approved: +$450 (added 12 ft and a
 *   walk gate), by ...".
 * - Approved verbally (owner or office, a reason required): it counts (rev 3),
 *   the customer's copy says "not signed by you yet" until they sign on their
 *   link; the signed PDF only then. Switching no dig to dig set changes the
 *   contract's warranty, with the new words on the change order.
 * - After the deposit and Final are paid: an increase is its own invoice
 *   "Change order CO-n" (the paid Final unchanged); a credit is a credit on the
 *   balance (no paid invoice cut).
 * - Reports and pipeline value read the job's contract (web code: App.tsx,
 *   pipelineValue.ts) from changeOrderTotal, checked here on the job.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { pdfText } from './pdfText'
import { OFFER_ADD_PICKS } from '../../web/src/changeOrderPicks'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('change orders: everything follows (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { default: payments } = await import('../src/server/routes/payments.js')
  const { default: pullSheets } = await import('../src/server/routes/pull-sheets.js')
  const { default: jobCosting } = await import('../src/server/routes/job-costing.js')
  const { default: warranties } = await import('../src/server/routes/warranties.js')
  const { default: followUps } = await import('../src/server/routes/follow-ups.js')
  const { packetStaff, packetPublic } = await import('../src/server/routes/installPacket.js')
  const { changeOrderPublic } = await import('../src/server/routes/changeOrderPublic.js')
  const { changeOrdersForContact } = await import('../src/server/lib/changeOrders.js')
  const { snapshotQuotedCost } = await import('../src/server/lib/jobCosting.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const ND = "WV-ND 6'x8' Privacy", DS = "WV-DS 6'x8' Privacy"
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[] }
  let accountId = '', owner = '', sales = '', base = '', userId = ''
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => { const t = await r.text(); let json: any = null; try { json = JSON.parse(t) } catch { /* html */ } return { status: r.status, json, text: t } })
  let n = 0
  const request = (ft: number, walk: number, style = ND) => ({ fenceStyle: style, runs: [{ ft, rail: 'auto' }], corners: 0, ends: 2, walkGates: walk, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new' })

  /** A signed quote (112 ft, no gate, $6,000) with its quoted cost and its job, scheduled for one day. */
  async function signedJob() {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E CO', lastName: `Flow ${Date.now().toString(36)}${n++}`, phone: '3525550133' } as any })
    made.contacts.push(c.id)
    const q = await prisma.savedQuote.create({
      data: {
        // Made by the login the "sales" token names: the Salesman's own quote (lib/salesScope.ts).
        accountId, ownerId: userId, crmContactId: c.id, customerName: `E2E CO ${c.lastName}`, customerAddress: '3 Change Rd, Ocala FL', fenceStyle: ND, runs: [112], sections: 14, corners: 0, ends: 2,
        materialCost: 3000, laborCost: 1500, totalCOGS: 4500, finalPrice: 6000, gmPct: 0.25,
        pullSheet: [{ item: 'Vinyl panel', qty: 14, unitCost: 100, total: 1400 }], status: 'SOLD', soldAt: new Date(),
      } as any,
    })
    made.quotes.push(q.id)
    await snapshotQuotedCost(accountId, q.id, 'app')
    const r = await call(owner, 'POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: ND, quotePrice: 6000, contractValue: 6000, status: 'scheduled', sections: 14, totalFeet: 112, scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-02', estimatedDays: 1, crewAssigned: `E2E crew ${n}` })
    expect(r.status).toBe(201)
    made.jobs.push(r.json.data.id)
    return { contactId: c.id, quoteId: q.id, jobId: r.json.data.id as string }
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    userId = user.id
    await billing.schedulesFrom(accountId)
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    sales = jwt.sign({ sub: user.id, email: user.email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/change-orders', changeOrders)
    app.use('/api/payments', payments)
    app.use('/api/pull-sheets', pullSheets)
    app.use('/api/job-costing', jobCosting)
    app.use('/api/warranties', warranties)
    app.use('/api/follow-ups', followUps)
    app.use('/api/install-packets', packetStaff)
    app.use('/p/i', packetPublic)
    app.use('/p/co', changeOrderPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const jobs = made.jobs
    const docs = await prisma.signedDocument.findMany({ where: { quoteId: { in: made.quotes } } })
    const receipts = await prisma.receipt.findMany({ where: { jobId: { in: jobs } } })
    const fileIds = [...docs.map(d => d.portalFileId), ...receipts.map(r => r.portalFileId)].filter((x): x is string => !!x)
    const files = await prisma.portalFile.findMany({ where: { id: { in: fileIds } } })
    for (const k of [...files.map(f => f.fileKey), ...docs.map(d => d.fileKey)]) { try { fs.unlinkSync(path.resolve(process.env.UPLOAD_DIR || './uploads', k)) } catch { /* not written */ } }
    await prisma.portalFile.deleteMany({ where: { id: { in: fileIds } } })
    await prisma.signedDocument.deleteMany({ where: { quoteId: { in: made.quotes } } })
    const pays = await prisma.contractPayment.findMany({ where: { jobId: { in: jobs } } })
    await prisma.receipt.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } })
    await prisma.contractPayment.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.installPacket.deleteMany({ where: { jobId: { in: jobs } } })
    const cos = await prisma.changeOrder.findMany({ where: { quoteId: { in: made.quotes } }, select: { id: true } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...cos.map(c => c.id), ...pays.map(p => p.id)] } } })
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.notification.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: jobs } } as any }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { id: { in: jobs } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    await prisma.receiptNumberBlock.deleteMany({ where: { accountId, createdAt: { gte: new Date(Date.now() - 3600_000) } } })
    server?.close()
  })

  test('from the yard drawing, +12 ft and a walk gate, signed in person: everything follows', async () => {
    const { contactId, quoteId, jobId } = await signedJob()
    const packet = await call(owner, 'POST', '/api/install-packets', { jobId, snapshot: { style: ND, pullSheet: [{ item: 'Vinyl panel', qty: 14 }] } })
    expect(packet.status).toBe(200)

    // The reason is required (Oct 26 2026): none, spaces or two letters are refused in plain words; nothing is made.
    const noReason = { jobId, lines: [{ id: 'n1', description: 'Add 12 ft of fence', amountCents: 30000 }] }
    for (const reason of [undefined, '   ', 'ok']) {
      const r = await call(owner, 'POST', '/api/change-orders', { ...noReason, ...(reason === undefined ? {} : { reason }) })
      expect([r.status, r.json.error]).toEqual([400, expect.stringMatching(/^Type the reason for the change \(the customer sees it\)/)])
    }
    expect(await prisma.changeOrder.count({ where: { accountId, quoteId } })).toBe(0)
    const co = await call(owner, 'POST', '/api/change-orders', {
      jobId, reason: 'Add 12 ft and a walk gate',
      lines: [{ id: 'l1', description: 'Add 12 ft of fence', amountCents: 30000 }, { id: 'l2', description: 'Add 1 walk gate', amountCents: 15000 }],
      work: { request: request(124, 1), layout: { yard: null, runSections: [16] }, planSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>' },
    })
    expect(co.status).toBe(201)
    expect(co.json.data).toMatchObject({ number: 1, status: 'draft', scope: { footageFt: 12, walkGates: 1 } })
    expect(co.json.data.work).toMatchObject({ footage: 124, walkGates: 1, sections: 16 })
    expect(co.json.data.work.pullSheet.some((l: any) => 'unitCost' in l)).toBe(false) // quantities only on every phone
    expect(co.json.data.costDelta.totalCents).toBeGreaterThan(0)
    // A Salesman sees costs since Oct 25, 2026 (Jonathan): the cost difference too.
    const asSales = await call(sales, 'GET', `/api/change-orders?jobId=${jobId}`)
    expect(JSON.stringify(asSales.json)).toMatch(/costDelta/)

    // The customer signs on the office's phone.
    const signed = await call(owner, 'POST', `/api/change-orders/${co.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })
    expect(signed.status).toBe(200)
    expect(signed.json.data).toMatchObject({ status: 'approved', contractRev: 2, signedVia: 'in_person', signedBy: 'Pat Customer' })
    expect(signed.json.scheduleWarning).toMatch(/needs 2 crew days now and is booked for 1/)

    // Contract value and the job's scope and crew days.
    const job = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([job.contractValue, job.changeOrderTotal, job.sections, job.totalFeet, job.walkGates, job.estimatedDays]).toEqual([6450, 450, 16, 124, 1, 2])
    // Payment schedule: the Final follows, logged.
    const s = (await call(owner, 'GET', `/api/payments/job/${jobId}`)).json.data.schedule
    expect(s.contractCents).toBe(645000)
    expect(s.invoices.find((i: any) => i.kind === 'final').amountCents).toBe(345000)
    expect(s.log.some((l: any) => /Final \$3,000\.00 → \$3,450\.00/.test(l.text))).toBe(true)
    // Pull sheet rev 2 for the crew, what changed marked, rev 1 kept.
    const sheets = (await call(owner, 'GET', `/api/pull-sheets/customer/${contactId}`)).json.data.entries
    const e = sheets.find((x: any) => x.kind === 'job')
    expect(e.revision).toBe(2)
    expect(e.revisions.map((r: any) => r.rev)).toEqual([2, 1])
    expect(e.revisions[1].lines).toEqual([expect.objectContaining({ item: 'Vinyl panel', qty: 14 })])
    expect(e.changes).toContainEqual({ item: 'Vinyl panel', was: 14, now: 0 })
    expect(e.changes.some((c: any) => /Gate, Latch/.test(c.item) && c.now === 1)).toBe(true)
    expect([e.footageFt, e.sections]).toEqual([124, 16])
    expect(e.changeNote).toMatch(/This is pull sheet rev 2, from change order CO-1/)
    // Install packet: the crew's link shows the change; the office sees it is out of date.
    const staff = (await call(owner, 'GET', `/api/install-packets?jobId=${jobId}`)).json.data
    // Its own change, run by run (round 3 recheck), and every change order since the packet was sent.
    const what = 'added 12 ft and a walk gate (Run 1: 112 ft → 124 ft)'
    expect(staff.changedBy).toEqual({ number: 1, what, all: [{ number: 1, what }] })
    const page = await call('', 'GET', `/p/i/${staff.token}`)
    expect(page.text).toContain('data-packet-change-order')
    expect(page.text).toContain('Vinyl panel</b>: 14 → 0')
    expect(page.text).toContain('124 ft')
    // Job costing: the quoted cost includes the change order's cost difference, the price its total.
    const signedCost = (await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId } } }))!
    const jc = (await call(owner, 'GET', `/api/job-costing/job/${jobId}`)).json.data
    expect(jc.comparison.quoted.totalCents).toBe(signedCost.totalCents + co.json.data.costDelta.totalCents)
    expect(jc.comparison.quoted.priceCents).toBe(645000)
    // The signed PDF, stored once.
    expect(await prisma.signedDocument.count({ where: { changeOrderId: co.json.data.id } })).toBe(1)
    // Customer history and the job timeline.
    const hist = (await call(owner, 'GET', `/api/follow-ups/history?customerId=${contactId}`)).json.data.map((x: any) => x.title)
    expect(hist).toContainEqual(expect.stringMatching(/^Change order CO-1 approved: \+\$450 \(added 12 ft and a walk gate\), by Pat Customer \(signed\), [A-Z][a-z]{2} \d+$/))
    const tl = (await call(owner, 'GET', `/api/change-orders/timeline?jobId=${jobId}`)).json.data
    expect(tl.contractRev).toBe(2)
    expect(tl.scheduleWarning).toMatch(/no longer fits/)
    expect(tl.items.map((i: any) => i.title)).toEqual(expect.arrayContaining(['Pull sheet rev 2 for the crew (change order CO-1)', 'Contract rev 1 signed: $6,000.00']))
  })

  test('picked lines: the Repair price list and the catalog priced for the job\'s style (prices only), quantity and source kept, never shown to the customer', async () => {
    const { contactId, quoteId, jobId } = await signedJob()
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const { dataFor } = await import('../src/server/lib/quotePricing.js')
    const m = await pricingModule() as any
    // A Salesman gets the list: prices only, no cost anywhere.
    const list = await call(sales, 'GET', `/api/change-orders/pick-list?jobId=${jobId}`)
    expect(list.status).toBe(200)
    expect(list.json.data).toMatchObject({ fenceStyle: ND, noStyle: false })
    const items = list.json.data.items as any[]
    for (const i of items) expect(Object.keys(i).sort()).toEqual(['detail', 'group', 'label', 'source', 'unitCents', 'warnings'])
    expect(items.map(i => i.source)).toEqual(expect.arrayContaining(['repair:resetPost', 'repair:replacePost', 'repair:repairSection', 'repair:replaceSection', 'repair:rehangGate:walk', 'repair:rehangGate:double', 'repair:replaceGate:walk', 'repair:replaceGate:double', 'repair:haulDebris', 'repair:pullPost']))
    expect(items.every(i => Number.isInteger(i.unitCents) && i.unitCents % 100 === 0)).toBe(true)
    const part = items.find(i => i.group === 'catalog' && i.unitCents > 0)
    expect(part).toBeTruthy()
    expect(JSON.stringify(list.json)).not.toMatch(/unitCost|costCents|materialCents|laborCents|costFactor|margin/i)

    // A repair item at a quantity: exactly a repair quote of that item for the style, without the minimum job price.
    const data = await dataFor(accountId)
    const cfg = { ...(data.config as any), moveRepair: { ...((data.config as any)?.moveRepair ?? {}), minimumJobCents: 0 } }
    const repairQuote = m.quoteJobFor({ ...data, config: cfg }, {
      fenceStyle: ND, runs: [], corners: 0, ends: 0, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {},
      jobType: 'repair', repair: { what: 'other', items: { replacePost: 2 }, postType: 'nd', newPostCaps: false, gateKind: 'walk', debrisCleared: true },
    })
    const two = await call(sales, 'GET', `/api/change-orders/pick-price?quoteId=${quoteId}&source=repair:replacePost&qty=2`)
    expect(two.status).toBe(200)
    expect(two.json.data).toMatchObject({ priceCents: Math.round(repairQuote.totals.price * 100), qty: 2, label: 'Replace a post', fenceStyle: ND })
    expect((await call(sales, 'GET', `/api/change-orders/pick-price?quoteId=${quoteId}&source=repair:nope&qty=1`)).status).toBe(404)
    expect((await call(sales, 'GET', `/api/change-orders/pick-price?quoteId=${quoteId}&source=repair:resetPost&qty=0`)).status).toBe(400)
    const partTwo = (await call(sales, 'GET', `/api/change-orders/pick-price?quoteId=${quoteId}&source=${encodeURIComponent(part.source)}&qty=2`)).json.data
    expect(partTwo.priceCents % 100).toBe(0)

    // Saved with its quantity and source; a credit too; a custom line beside them.
    const co = await call(sales, 'POST', '/api/change-orders', {
      jobId, reason: 'Picked lines',
      lines: [
        { id: 'pick-1', description: '2 × Replace a post', amountCents: two.json.data.priceCents, qty: 2, source: { kind: 'repair', ref: 'repair:replacePost', label: 'Replace a post', fenceStyle: ND, listCents: two.json.data.priceCents } },
        { id: 'pick-2', description: part.label, amountCents: -part.unitCents - 50, qty: 1, source: { kind: 'catalog', ref: part.source, label: part.label, fenceStyle: ND, listCents: part.unitCents } },
        { id: 'custom', description: 'Haul the old gate', amountCents: 4000 },
      ],
    })
    expect(co.status).toBe(201)
    const lines = co.json.data.lines
    expect(lines[0]).toMatchObject({ qty: 2, source: { kind: 'repair', ref: 'repair:replacePost', fenceStyle: ND } })
    // Whole dollars as every line (a credit to the larger whole dollar credit).
    expect(lines[1]).toMatchObject({ amountCents: -part.unitCents - 100, qty: 1, source: { kind: 'catalog', ref: part.source } })
    expect(lines[2]).toEqual({ id: 'custom', description: 'Haul the old gate', amountCents: 4000 })
    expect(co.json.data.totalCents).toBe(two.json.data.priceCents - part.unitCents - 100 + 4000)
    // Edited (a sent one): the source stays.
    const ed = await call(sales, 'PATCH', `/api/change-orders/${co.json.data.id}`, { baseVersion: co.json.data.version, lines: [{ ...lines[0], amountCents: lines[0].amountCents + 100 }, lines[2]] })
    expect(ed.status).toBe(200)
    expect(ed.json.data.lines[0].source.ref).toBe('repair:replacePost')
    // A Salesman's change order waits for the owner's or the office's OK (round 2, Oct 26 2026): not sent,
    // no link, not signed on her phone, not on the customer's portal; the owner and the office are told.
    expect(co.json.data.status).toBe('needs_ok')
    expect((await call(sales, 'PATCH', `/api/change-orders/${co.json.data.id}`, { baseVersion: ed.json.data.version, status: 'sent' })).status).toBe(409)
    expect((await call(sales, 'POST', `/api/change-orders/${co.json.data.id}/link`)).status).toBe(409)
    expect((await call(sales, 'POST', `/api/change-orders/${co.json.data.id}/sign`, { name: 'Pat', signature: SIG })).status).toBe(409)
    expect((await changeOrdersForContact(contactId)).some(x => x.id === co.json.data.id)).toBe(false)
    expect(await prisma.notification.count({ where: { title: { startsWith: 'Change order to OK' }, jobId } })).toBe(2)
    // She cannot OK her own; the owner does.
    expect((await call(sales, 'PATCH', `/api/change-orders/${co.json.data.id}`, { baseVersion: ed.json.data.version, status: 'draft' })).status).toBe(403)
    const ok = await call(owner, 'PATCH', `/api/change-orders/${co.json.data.id}`, { baseVersion: ed.json.data.version, status: 'draft' })
    expect(ok.json.data.status).toBe('draft')
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Change order to OK' }, jobId } })
    await call(sales, 'PATCH', `/api/change-orders/${co.json.data.id}`, { baseVersion: ok.json.data.version, status: 'sent' })
    // The customer sees the words, quantity and amount, never where it was picked from.
    const theirs = (await changeOrdersForContact(contactId)).find(x => x.id === co.json.data.id)!
    expect(theirs.lines[0]).toEqual({ id: 'pick-1', description: '2 × Replace a post', amountCents: lines[0].amountCents + 100, qty: 2 })
    expect(JSON.stringify(theirs)).not.toContain('repair:replacePost')
  })

  test("round 2: a Salesman's change after the OK goes back to wait; the bell follows the OK and the signature; the customer sees the new contract total", async () => {
    const { jobId } = await signedJob()
    const me = (await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    const lines = [{ id: 'r2a', description: 'Add a 4 ft section by the shed', amountCents: 20000 }]
    const co = (await call(sales, 'POST', '/api/change-orders', { jobId, reason: 'Customer asked for it', lines })).json.data
    expect(co.status).toBe('needs_ok')
    // The "to OK" notice opens the job at the change order (its OK button in view).
    const toOk = await prisma.notification.findMany({ where: { jobId, title: { startsWith: 'Change order to OK' } } })
    expect(toOk.map(n => n.recipientRole).sort()).toEqual(['admin', 'office_staff'])
    for (const n of toOk) expect(n.link).toBe(`/operations?job=${jobId}&co=${co.id}`)
    // The OK clears (marks read and retitles) those notices, and tells whoever made it.
    const okAt = Date.now() - 1000
    const ok = (await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'draft' })).json.data
    expect(ok.status).toBe('draft')
    const after = await prisma.notification.findMany({ where: { id: { in: toOk.map(n => n.id) } } })
    expect(after.every(n => /^Change order OK'd: /.test(n.title))).toBe(true)
    // At the time of the OK (round 3 recheck), read for the owner who OK'd it, unread for the office.
    expect(after.every(n => n.createdAt.getTime() >= okAt)).toBe(true)
    expect(after.map(n => [n.recipientRole, n.read]).sort()).toEqual([['admin', true], ['office_staff', false]])
    expect(await prisma.notification.count({ where: { jobId, recipientId: me.email, title: { startsWith: "Change order OK'd: CO-" } } })).toBe(1)
    // Her change to the lines of an OK'd one: refused with a send, and on its own it waits for the OK again (it never stays OK'd).
    const more = [{ ...lines[0], amountCents: 90000 }]
    expect((await call(sales, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: ok.version, lines: more, status: 'sent' })).status).toBe(409)
    const back = await call(sales, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: ok.version, lines: more })
    expect([back.status, back.json.data.status, back.json.data.totalCents]).toEqual([200, 'needs_ok', 90000])
    expect((await call(sales, 'POST', `/api/change-orders/${co.id}/link`)).status).toBe(409)
    expect(await prisma.notification.count({ where: { jobId, title: { startsWith: 'Change order to OK' }, read: false, body: { contains: 'after it was OK' } } })).toBe(2)
    // Her words (the reason) too; the same lines sent again change nothing.
    const ok2 = (await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: back.json.data.version, status: 'draft' })).json.data
    const same = await call(sales, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: ok2.version, lines: ok2.lines })
    expect(same.json.data.status).toBe('draft')
    const words = await call(sales, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: same.json.data.version, reason: 'Customer asked by text' })
    expect(words.json.data.status).toBe('needs_ok')
    // The reason cannot be blanked afterwards either.
    expect((await call(sales, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: words.json.data.version, reason: '  ' })).status).toBe(400)
    // The owner's own change stays as it is (it is the OK).
    const ok3 = (await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: words.json.data.version, status: 'draft' })).json.data
    const mine = await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: ok3.version, lines: [{ ...lines[0], amountCents: 50000 }] })
    expect([mine.json.data.status, mine.json.data.totalCents]).toEqual(['draft', 50000])
    // Sent: the customer's page shows the contract now and with this change ($6,000 + $500).
    await call(sales, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: mine.json.data.version, status: 'sent' })
    const link = await call(sales, 'POST', `/api/change-orders/${co.id}/link`, {})
    const page = await call('', 'GET', `/p/co/${link.json.data.token}`)
    expect(page.text).toContain('data-co-new-contract>$6,500.00')
    expect(page.text).toContain('$6,000.00')
    // The reason she typed reads under "Why" on the customer's link (Oct 26 2026).
    expect(page.text).toContain('data-co-why><b>Why:</b> Customer asked by text</p>')
    // Signed on the link: the owner and office are told, and whoever made it.
    await call('', 'POST', `/p/co/${link.json.data.token}/sign`, { name: 'Pat Customer', signature: SIG })
    const signed = await prisma.notification.findMany({ where: { jobId, title: { startsWith: 'Signed: CO-1' } } })
    expect(signed.map(n => n.recipientRole).filter(Boolean).sort()).toEqual(['admin', 'office_staff'])
    expect(signed[0].body).toContain('on their link')
    expect(signed[0].body).toContain('$6,500')
    // Signed again (the answer was lost): no second notice.
    await call('', 'POST', `/p/co/${link.json.data.token}/sign`, { name: 'Pat Customer', signature: SIG })
    expect(await prisma.notification.count({ where: { jobId, title: { startsWith: 'Signed: CO-1' } } })).toBe(signed.length)
    // Approved: the page shows the contract before it and with it.
    const page2 = await call('', 'GET', `/p/co/${link.json.data.token}`)
    expect(page2.text).toContain('Your contract with this change')
    expect(page2.text).toContain('data-co-new-contract>$6,500.00')
  })

  test.skipIf(!OFFER_ADD_PICKS)('picked "Add a section" × 2 and "Add a walk gate", signed: the job follows as a drawing would; a second gate never pays the once per job gate parts again; voided, the job goes back', async () => {
    const CL = "CL - 5' Galv"
    const { quoteId, jobId } = await signedJob()
    // A chain link job (its kits have once per job gate parts): 112 ft = 12 sections at 10 ft.
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { fenceStyle: CL, sections: 12 } })
    await prisma.savedJob.update({ where: { id: jobId }, data: { fenceStyle: CL, sections: 12 } })
    const price = async (source: string, qty: number) => (await call(owner, 'GET', `/api/change-orders/pick-price?quoteId=${quoteId}&source=${source}&qty=${qty}`)).json.data
    const sec = await price('add:section', 2), gate1 = await price('add:walk', 1)
    const pick = (id: string, p: any, ref: string) => ({ id, description: p.qty > 1 ? `${p.qty} × ${p.label}` : p.label, amountCents: p.priceCents, qty: p.qty, source: { kind: 'repair', ref, label: p.label, fenceStyle: CL, listCents: p.priceCents } })
    const co = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Two more sections and a gate', lines: [pick('a1', sec, 'add:section'), pick('a2', gate1, 'add:walk')] })
    expect(co.status).toBe(201)
    expect(co.json.data.scope).toMatchObject({ footageFt: 20, sections: 2, walkGates: 1 })
    expect(co.json.data.work).toMatchObject({ footage: 132, sections: 14, walkGates: 1, ends: 4 })
    expect(co.json.data.totalCents).toBe(sec.priceCents + gate1.priceCents)
    // Before it is signed the job is as it was.
    expect((await prisma.savedJob.findUnique({ where: { id: jobId } }))!.sections).toBe(12)
    expect((await call(owner, 'POST', `/api/change-orders/${co.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    const job = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([job.sections, job.totalFeet, job.walkGates]).toEqual([14, 132, 1])
    // The pull sheet the job now has is the new quote engine's for the work with the pieces in it.
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const { dataFor } = await import('../src/server/lib/quotePricing.js')
    const m = await pricingModule() as any
    const data = await dataFor(accountId)
    const req = (ft: number, walk: number, ends: number) => ({ ...request(ft, walk, CL), ends })
    const was = m.quoteJobFor(data, req(112, 0, 2)).pullSheet, now = m.quoteJobFor(data, req(132, 1, 4)).pullSheet
    const stored = (await prisma.changeOrder.findUnique({ where: { id: co.json.data.id } }))!.work as any
    const qty = (sheet: any[], item: string) => sheet.filter(l => l.item === item).reduce((t, l) => t + l.qty, 0)
    for (const l of now) expect([l.item, qty(stored.pullSheet, l.item)]).toEqual([l.item, qty(now, l.item)])
    expect(now.some((l: any) => qty(now, l.item) > qty(was, l.item))).toBe(true)
    // The second walk gate: the job has one now, so the once per job gate parts are not charged again.
    const gate2 = await price('add:walk', 1)
    expect(gate2.priceCents).toBeLessThan(gate1.priceCents)
    const co2 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'One more gate', lines: [pick('b1', gate2, 'add:walk')] })
    expect(co2.json.data.work).toMatchObject({ walkGates: 2, ends: 6, sections: 14 })
    expect((await call(owner, 'POST', `/api/change-orders/${co2.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    expect((await prisma.savedJob.findUnique({ where: { id: jobId } }))!.walkGates).toBe(2)
    // Signing again changes nothing (once only); voided, the job goes back to one gate.
    await call(owner, 'POST', `/api/change-orders/${co2.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })
    const again = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([again.sections, again.walkGates, again.totalFeet]).toEqual([14, 2, 132])
    const row2 = (await prisma.changeOrder.findUnique({ where: { id: co2.json.data.id } }))!
    const voided = await call(owner, 'PATCH', `/api/change-orders/${row2.id}`, { baseVersion: row2.version, status: 'void' })
    expect(voided.status).toBe(200)
    const after = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([after.sections, after.walkGates, after.totalFeet]).toEqual([14, 1, 132])
  })

  test('approved verbally (reason required): it counts; the customer copy is not signed until they sign; dig set switches the warranty', async () => {
    const { contactId, jobId } = await signedJob()
    const before = (await call(owner, 'GET', `/api/warranties/job/${jobId}`)).json.data.warranty.name
    const lines = [{ id: 'd1', description: 'Change to dig set', amountCents: -20000 }]
    const work = { request: request(112, 0, DS) }
    expect((await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Customer asked for it', lines, work, status: 'approved' })).status).toBe(400)
    expect((await call(sales, 'POST', '/api/change-orders', { jobId, reason: 'Customer asked for it', lines, work, status: 'approved', verbalReason: 'Agreed' })).status).toBe(403)
    const co = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Customer asked for it', lines, work, status: 'approved', verbalReason: 'Customer agreed on the phone' })
    expect(co.status).toBe(201)
    expect(co.json.data).toMatchObject({ status: 'approved', contractRev: 2, verbalReason: 'Customer agreed on the phone', signedAt: null })
    expect(co.json.data.warrantyBefore.name).toBe(before)
    expect(co.json.data.warrantyAfter.name).not.toBe(before)
    // It counts for the job: contract value and the warranty on the contract.
    expect((await prisma.savedJob.findUnique({ where: { id: jobId } }))!.contractValue).toBe(5800)
    const w = (await call(owner, 'GET', `/api/warranties/job/${jobId}`)).json.data
    expect([w.warranty.name, w.from, w.changeOrder?.number]).toEqual([co.json.data.warrantyAfter.name, 'change_order', 1])
    // The customer's copy: not signed by them yet, with the Sign button; no signed PDF yet.
    const mine = (await changeOrdersForContact(contactId)).find((c: any) => c.id === co.json.data.id)!
    expect([mine.status, mine.needsSignature, mine.contractRev]).toEqual(['approved', true, 2])
    expect(await prisma.signedDocument.count({ where: { changeOrderId: co.json.data.id } })).toBe(0)
    const link = await call(owner, 'POST', `/api/change-orders/${co.json.data.id}/link`, {})
    const page = await call('', 'GET', `/p/co/${link.json.data.token}`)
    expect(page.text).toContain('data-co-not-signed')
    expect(page.text).toContain('data-co-warranty')
    expect(page.text).toContain('Contract rev 2')
    const sign = await call('', 'POST', `/p/co/${link.json.data.token}/sign`, { name: 'Pat Customer', signature: SIG })
    expect(sign.json.data.status).toBe('approved')
    const row = (await prisma.changeOrder.findUnique({ where: { id: co.json.data.id } }))!
    expect([row.contractRev, row.signedVia, row.signedBy, row.verbalBy !== null]).toEqual([2, 'link', 'Pat Customer', true])
    expect(await prisma.signedDocument.count({ where: { changeOrderId: co.json.data.id } })).toBe(1)
    expect((await changeOrdersForContact(contactId)).find((c: any) => c.id === co.json.data.id)!.needsSignature).toBe(false)
    // The contract value did not move again on signing.
    expect((await prisma.savedJob.findUnique({ where: { id: jobId } }))!.contractValue).toBe(5800)
  })

  test('after the deposit and Final are paid: an increase is its own invoice; a credit is a credit on the balance', async () => {
    const { jobId } = await signedJob()
    const s0 = (await call(owner, 'GET', `/api/payments/job/${jobId}`)).json.data.schedule
    const pid = `e2eco${Date.now().toString(36)}`
    expect((await call(owner, 'POST', '/api/payments', { id: pid, jobId, amountCents: s0.contractCents, method: 'check', checkNumber: '77' })).status).toBe(201)
    const up = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Customer asked for a post', lines: [{ id: 'u1', description: 'Add a post', amountCents: 20000 }], status: 'approved', verbalReason: 'Agreed on site' })
    expect(up.status).toBe(201)
    let s = (await call(owner, 'GET', `/api/payments/job/${jobId}`)).json.data.schedule
    const fin = s.invoices.find((i: any) => i.kind === 'final')
    expect([fin.amountCents, fin.paidCents]).toEqual([300000, 300000])
    expect(s.invoices.find((i: any) => i.kind === 'change_order')).toMatchObject({ label: 'Change order CO-1', amountCents: 20000, originalCents: 20000, paidCents: 0 })
    expect([s.contractCents, s.balanceCents]).toEqual([620000, 20000])
    // The next payment pays that invoice.
    expect((await call(owner, 'POST', '/api/payments', { id: `${pid}b`, jobId, amountCents: 20000, method: 'cash' })).status).toBe(201)
    s = (await call(owner, 'GET', `/api/payments/job/${jobId}`)).json.data.schedule
    expect(s.invoices.find((i: any) => i.kind === 'change_order').paidCents).toBe(20000)
    const receipt = s.payments.find((p: any) => p.id === `${pid}b`).receipt
    expect(receipt.says.forText).toBe('Change order CO-1')
    // A credit after everything is paid: the paid invoices stay; the balance shows a credit due back.
    const credit = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'One post less', lines: [{ id: 'c1', description: 'Credit: one less post', amountCents: -50000 }], status: 'approved', verbalReason: 'Agreed on site' })
    expect(credit.status).toBe(201)
    s = (await call(owner, 'GET', `/api/payments/job/${jobId}`)).json.data.schedule
    expect(s.invoices.find((i: any) => i.kind === 'final').amountCents).toBe(300000)
    expect(s.invoices.find((i: any) => i.kind === 'change_order').amountCents).toBe(20000)
    expect([s.contractCents, s.balanceCents, s.creditCents]).toEqual([570000, -50000, 50000])
  })

  // Round 3 (Oct 26 2026): CO-1 made the Back 50 -> 60 ft, CO-2 put a walk gate in; CO-2 was drawn from the
  // signed quote, and once both were signed the job, pull sheet and installer card had lost CO-1's 10 ft.
  test('round 3: two drawing change orders open at once, signed in either order: the job keeps both changes', async () => {
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const m = await pricingModule()
    const cfg = (await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config ?? null
    const side = (id: string, name: string, lengthIn: number, start: string, end: string, gate: any = null) => ({ id, name, on: true, lengthIn, startFinish: start, endFinish: end, gate, skip: null, heading: 0 })
    const yardOf = (back: number, gate = false) => ({ shape: 'backyard', closed: false, sides: [
      side('r3-left', 'Left side', 600, 'house', 'corner', gate ? { type: 'walk', widthIn: 48, position: 'middle' } : null),
      side('r3-back', 'Back', back, 'corner', 'house'),
    ] })
    const req = (yard: any) => { const d = m.deriveYardRuns(cfg, yard, ND)!; return { ...request(0, d.walkGates), runs: d.runs.map(ft => ({ ft, rail: 'auto' })), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates } }
    const work = (yard: any) => ({ request: req(yard), layout: { yard } })
    const { contactId, quoteId, jobId } = await signedJob()
    const q0 = req(yardOf(600))
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { runs: q0.runs.map(r => r.ft), corners: q0.corners, ends: q0.ends, layout: { yard: yardOf(600), runSections: [] } as any } })
    expect(q0.runs.reduce((s, x) => s + x.ft, 0)).toBe(100)

    // CO-1: Back 50 -> 60 ft (a draft, waiting for the customer).
    const co1 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Longer back', lines: [{ id: 'a', description: 'Add 10 ft of fence', amountCents: 25000 }], work: work(yardOf(720)) })
    expect(co1.status).toBe(201)
    expect(co1.json.notice).toBeUndefined()
    // The next change starts from the drawing with CO-1 in it.
    const start = (await call(owner, 'GET', `/api/change-orders/start?jobId=${jobId}`)).json.data
    expect(start.layout.yard.sides.find((x: any) => x.name === 'Back').lengthIn).toBe(720)
    expect(start.open.map((o: any) => o.number)).toEqual([1])
    expect(start.runs.reduce((a: number, b: number) => a + b, 0)).toBe(110)
    // CO-2: a walk gate in the Left side, drawn on top of CO-1: said, no clash.
    const co2 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Gate', lines: [{ id: 'b', description: 'Add 1 walk gate', amountCents: 30000 }], work: work(yardOf(720, true)) })
    expect(co2.status).toBe(201)
    expect(co2.json.notice).toMatch(/drawn on top of CO-1 \(not signed yet\)/)
    expect(co2.json.notice).not.toMatch(/same thing/)
    expect(co2.json.data.scope).toMatchObject({ walkGates: 1, footageFt: -4 })

    // CO-2 signed first: the job has the gate, not CO-1's 10 ft (not signed yet).
    expect((await call(owner, 'POST', `/api/change-orders/${co2.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    let job = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([job.totalFeet, job.walkGates, job.changeOrderTotal]).toEqual([96, 1, 300])
    // Then CO-1: both changes.
    expect((await call(owner, 'POST', `/api/change-orders/${co1.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    job = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([job.totalFeet, job.walkGates, job.changeOrderTotal, job.contractValue]).toEqual([106, 1, 550, 6550])
    const rows = (await call(owner, 'GET', `/api/change-orders?jobId=${jobId}`)).json.data
    const one = rows.find((r: any) => r.number === 1)
    expect(one.jobWork).toMatchObject({ footage: 106, walkGates: 1 }) // the job after CO-1: both changes
    expect(one.work).toMatchObject({ footage: 110, walkGates: 0 })    // what the customer signed for CO-1
    // The crew's pull sheet and the install packet's work follow the job's work.
    const sheet = (await call(owner, 'GET', `/api/pull-sheets/customer/${contactId}`)).json.data.entries.find((x: any) => x.kind === 'job')
    expect(sheet.footageFt).toBe(106)
    const pk = await call(owner, 'GET', `/api/install-packets/work?jobId=${jobId}`)
    expect(pk.json.data.work).toMatchObject({ footage: 106, walkGates: 1 })

    // Two open ones changing the same thing: said when the second is made.
    const co3 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Even longer', lines: [{ id: 'c', description: 'Add 10 ft of fence', amountCents: 25000 }], work: work(yardOf(840, true)) })
    expect(co3.json.notice).toBeUndefined()
    const co4 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Longer still', lines: [{ id: 'd', description: 'Add 10 ft of fence', amountCents: 25000 }], work: work(yardOf(960, true)) })
    expect(co4.json.notice).toMatch(/changes the same thing as CO-3 \(Back: length\)/)
  })

  // Round 3 recheck (Oct 26 2026): CO-1 said "(146 ft to 156 ft)" on its signing screen and signed PDF after CO-2 was
  // signed first; CO-2's link showed CO-1's unsigned side without a word; the packet named only the last change order.
  test('round 3 recheck: each change order says its own sides, its drawing names the other open one, the packet lists both', async () => {
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const m = await pricingModule()
    const cfg = (await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config ?? null
    const side = (id: string, name: string, lengthIn: number, start: string, end: string, gate: any = null) => ({ id, name, on: true, lengthIn, startFinish: start, endFinish: end, gate, skip: null, heading: 0 })
    const yardOf = (back: number, gate = false) => ({ shape: 'backyard', closed: false, sides: [
      side('rr-left', 'Left side', 600, 'house', 'corner', gate ? { type: 'walk', widthIn: 48, position: 'middle' } : null),
      side('rr-back', 'Back', back, 'corner', 'house'),
    ] })
    const req = (yard: any) => { const d = m.deriveYardRuns(cfg, yard, ND)!; return { ...request(0, d.walkGates), runs: d.runs.map(ft => ({ ft, rail: 'auto' })), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates } }
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    const work = (yard: any) => ({ request: req(yard), layout: { yard }, planSvg: SVG })
    const { jobId, quoteId } = await signedJob()
    const q0 = req(yardOf(600))
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { runs: q0.runs.map(r => r.ft), corners: q0.corners, ends: q0.ends, layout: { yard: yardOf(600), runSections: [] } as any } })
    const packet = await call(owner, 'POST', '/api/install-packets', { jobId, snapshot: { style: ND, pullSheet: [{ item: 'Vinyl panel', qty: 13 }] } })
    expect(packet.status).toBe(200)

    // CO-1, written the old way (the whole fence before and after); CO-2 drawn on top of it (a walk gate in the Left side).
    const co1 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Longer back', lines: [{ id: 'a', description: 'Add 10 ft of fence, 2 panels more (100 ft to 110 ft)', amountCents: 25000 }], work: work(yardOf(720)) })
    const co2 = await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Gate', lines: [{ id: 'b', description: 'Add 1 walk gate in the Left side (4 ft of fence becomes the gate)', amountCents: 30000 }], work: work(yardOf(720, true)) })
    expect([co1.status, co2.status]).toEqual([201, 201])
    expect(co1.json.data.change).toBe('Back 50 ft → 60 ft')
    expect(co1.json.data.lines[0].description).toBe('Add 10 ft of fence, 2 panels more (Back 50 ft → 60 ft)')
    // CO-2's drawing shows CO-1's longer Back: the job page and the customer's link say it is not part of CO-2.
    expect(co2.json.data.alsoInDrawing).toEqual([{ number: 1, status: 'draft', signed: false, change: 'Back 50 ft → 60 ft' }])
    const link2 = (await call(owner, 'POST', `/api/change-orders/${co2.json.data.id}/link`)).json.data.token
    await call(owner, 'PATCH', `/api/change-orders/${co2.json.data.id}`, { baseVersion: co2.json.data.version, status: 'sent' })
    const page2 = await call('', 'GET', `/p/co/${link2}`)
    expect(page2.text).toContain('data-co-not-part')
    expect(page2.text).toMatch(/also shows CO-1&#(39|x27);s change \(Back 50 ft → 60 ft\): not part of this change order \(CO-1, not signed yet\)\./)

    // CO-2 signed first, then CO-1: CO-1's words stay its own, and the signed copy keeps them.
    expect((await call(owner, 'POST', `/api/change-orders/${co2.json.data.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    const link1 = (await call(owner, 'POST', `/api/change-orders/${co1.json.data.id}/link`)).json.data.token
    await call(owner, 'PATCH', `/api/change-orders/${co1.json.data.id}`, { baseVersion: co1.json.data.version, status: 'sent' })
    const page1 = await call('', 'GET', `/p/co/${link1}`)
    expect(page1.text).toContain('Add 10 ft of fence, 2 panels more (Back 50 ft → 60 ft)')
    expect(page1.text).not.toContain('100 ft to 110 ft')
    expect((await call('', 'POST', `/p/co/${link1}/sign`, { name: 'Pat Customer', signature: SIG })).json.success).toBe(true)
    const row1 = (await prisma.changeOrder.findUnique({ where: { id: co1.json.data.id } }))!
    expect((row1.lines as any[])[0].description).toBe('Add 10 ft of fence, 2 panels more (Back 50 ft → 60 ft)')
    const job = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    expect([job.totalFeet, job.walkGates]).toEqual([106, 1])
    // The job page: CO-1 says its change, and the job with it (never its drawing's 110 ft).
    const rows = (await call(owner, 'GET', `/api/change-orders?jobId=${jobId}`)).json.data
    expect(rows.find((r: any) => r.number === 1)).toMatchObject({ change: 'Back 50 ft → 60 ft', jobWork: { footage: 106 } })

    // The crew's packet lists both change orders signed since it was made, in the order signed.
    const staff = (await call(owner, 'GET', `/api/install-packets?jobId=${jobId}`)).json.data
    expect(staff.changedBy.all.map((a: any) => a.number)).toEqual([2, 1])
    expect(staff.changedBy.all[1].what).toBe('added 10 ft (Back 50 ft → 60 ft)')
    const crew = await call('', 'GET', `/p/i/${staff.token}`)
    expect(crew.text).toContain('Changed: change orders CO-2 and CO-1')
    expect(crew.text).toContain('data-packet-co-item="2"')
    expect(crew.text).toContain('data-packet-co-item="1"')
  })

  // Round 4 re-check (Oct 26 2026): CO-1 signed after CO-2 said "The original price was $5,640.00. This change adds $492.00"
  // (the customer had seen "Your contract now $6,532.00, New contract total $7,024.00"), its arrow came out "!'", the
  // signing phone showed no drawing, and the crew packet said "CO-2: added a walk gate and removed 4 ft" with "Run 1-2".
  test('round 4 re-check: the signed PDF says the contract as signed; the signing phone shows the link\'s layout; the packet names sides', async () => {
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const m = await pricingModule()
    const cfg = (await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config ?? null
    const side = (id: string, name: string, lengthIn: number, start: string, end: string, gate: any = null) => ({ id, name, on: true, lengthIn, startFinish: start, endFinish: end, gate, skip: null, heading: 0 })
    const yardOf = (back: number, gate = false) => ({ shape: 'backyard', closed: false, sides: [
      side('r4-left', 'Left side', 600, 'house', 'corner', gate ? { type: 'walk', widthIn: 48, position: 'middle' } : null),
      side('r4-back', 'Back', back, 'corner', 'house'),
    ] })
    const req = (yard: any) => { const d = m.deriveYardRuns(cfg, yard, ND)!; return { ...request(0, d.walkGates), runs: d.runs.map(ft => ({ ft, rail: 'auto' })), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates } }
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    const work = (yard: any) => ({ request: req(yard), layout: { yard }, planSvg: SVG })
    const { jobId, quoteId } = await signedJob()
    const q0 = req(yardOf(600))
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { runs: q0.runs.map(r => r.ft), corners: q0.corners, ends: q0.ends, layout: { yard: yardOf(600), runSections: [] } as any } })
    const packet = await call(owner, 'POST', '/api/install-packets', { jobId, snapshot: { style: ND, pullSheet: [{ item: 'Vinyl panel', qty: 13 }] } })
    expect(packet.status).toBe(200)
    const co1 = (await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Longer back', lines: [{ id: 'a', description: 'Add 10 ft of fence, 2 panels more (100 ft to 110 ft)', amountCents: 25000 }], work: work(yardOf(720)) })).json.data
    const co2 = (await call(owner, 'POST', '/api/change-orders', { jobId, reason: 'Gate', lines: [{ id: 'b', description: 'Add 1 walk gate in the Left side (4 ft of fence becomes the gate)', amountCents: 30000 }], work: work(yardOf(720, true)) })).json.data

    // The signing phone gets what the link shows: the contract, the layout and the other open change order in it.
    const sheet2 = (await call(owner, 'GET', `/api/change-orders/${co2.id}/for-signing`)).json.data
    expect(sheet2.contract).toMatchObject({ beforeCents: 600000, afterCents: 630000 })
    expect(sheet2.planSvg).toBe(SVG)
    expect(sheet2.own).toBeNull() // its own change is a gate; the length words are CO-1's
    expect(sheet2.alsoInDrawing).toEqual(["The drawing also shows CO-1's change (Back 50 ft → 60 ft): not part of this change order (CO-1, not signed yet)."])
    expect(JSON.stringify(sheet2)).not.toMatch(/cost/i)
    expect((await call(sales, 'GET', `/api/change-orders/${co2.id}/for-signing`)).status).toBe(200)

    // CO-2 signed first, then CO-1 on its link.
    expect((await call(owner, 'POST', `/api/change-orders/${co2.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    const sheet1 = (await call(owner, 'GET', `/api/change-orders/${co1.id}/for-signing`)).json.data
    expect(sheet1.contract).toMatchObject({ beforeCents: 630000, afterCents: 655000, earlier: [{ number: 2, totalCents: 30000 }] })
    const link1 = (await call(owner, 'POST', `/api/change-orders/${co1.id}/link`)).json.data.token
    await call(owner, 'PATCH', `/api/change-orders/${co1.id}`, { baseVersion: co1.version, status: 'sent' })
    expect((await call('', 'GET', `/p/co/${link1}`)).text).toContain('data-co-new-contract>$6,550.00')
    expect((await call('', 'POST', `/p/co/${link1}/sign`, { name: 'Pat Customer', signature: SIG })).json.success).toBe(true)

    // The signed CO-1 PDF: the contract before this change (with CO-2 named), this change, the new total, as the customer saw them.
    const doc1 = (await prisma.signedDocument.findFirst({ where: { changeOrderId: co1.id } }))!
    const t1 = pdfText(fs.readFileSync(path.resolve(process.env.UPLOAD_DIR || './uploads', doc1.fileKey)))
    expect(t1).toContain('(Back 50 ft to 60 ft)')
    expect(t1).not.toContain("!'")
    expect(t1).toContain('Your contract before this change $6,300.00')
    expect(t1).toContain('plus CO-2 +$300.00 (a change order approved before this one)')
    expect(t1).toContain('This change +$250.00')
    expect(t1).toContain('New contract total $6,550.00')
    expect(t1).not.toContain('The original price was')
    // CO-2's: the first signed, before it is the price signed.
    const doc2 = (await prisma.signedDocument.findFirst({ where: { changeOrderId: co2.id } }))!
    const t2 = pdfText(fs.readFileSync(path.resolve(process.env.UPLOAD_DIR || './uploads', doc2.fileKey)))
    expect(t2).toContain('Your contract before this change $6,000.00 The price you signed.')
    expect(t2).toContain('New contract total $6,300.00')

    // The crew packet: the gate by its side, and the runs by the drawing's side names.
    const staff = (await call(owner, 'GET', `/api/install-packets?jobId=${jobId}`)).json.data
    expect(staff.changedBy.all.map((a: any) => a.what)).toEqual(['added a walk gate in the Left side (4 ft of fence becomes the gate)', 'added 10 ft (Back 50 ft → 60 ft)'])
    const crew = (await call('', 'GET', `/p/i/${staff.token}`)).text
    expect(crew).toContain('added a walk gate in the Left side (4 ft of fence becomes the gate)')
    expect(crew).not.toMatch(/removed 4 ft/)
    expect(crew).toMatch(/<td>Left side[^<]*<\/td>/)
    expect(crew).toMatch(/<td>Back<\/td>/)
    expect(crew).not.toMatch(/<td>Run \d<\/td>/)
  })

  test("round 4 re-check: the owner's read \"to OK\" notice is retitled when he OKs it; the maker's \"OK'd: send it\" is done once signed", async () => {
    const { jobId } = await signedJob()
    const me = (await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    const co = (await call(sales, 'POST', '/api/change-orders', { jobId, reason: 'Customer asked for a section', lines: [{ id: 'n4', description: 'Add a 4 ft section', amountCents: 20000 }] })).json.data
    const toOk = await prisma.notification.findMany({ where: { jobId, title: { startsWith: 'Change order to OK' } } })
    expect(toOk.length).toBe(2)
    // The owner taps his notice (it opens the job and is marked read), then OKs it there.
    const his = toOk.find(n => n.recipientRole === 'admin')!
    await prisma.notification.update({ where: { id: his.id }, data: { read: true, readAt: new Date() } })
    const ok = (await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'draft' })).json.data
    const after = await prisma.notification.findMany({ where: { id: { in: toOk.map(n => n.id) } } })
    expect(after.every(n => /^Change order OK'd: /.test(n.title))).toBe(true)
    expect(after.find(n => n.id === his.id)!.read).toBe(true)
    const sendIt = await prisma.notification.findFirst({ where: { jobId, recipientId: me.email, title: { startsWith: "Change order OK'd: CO-" } } })
    expect(sendIt?.read).toBe(false)
    // Recheck Oct 27 2026: it says what happened (OK'd) and what is next (send it), not "Sent and signed".
    expect(sendIt?.title).toMatch(/^Change order OK'd: CO-1, .+\. Send it to the customer\.$/)
    // Signed in person: her "send it" is done (read, says signed); the new "Signed" notice tells her.
    await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: ok.version, status: 'sent' })
    expect((await call(owner, 'POST', `/api/change-orders/${co.id}/sign`, { name: 'Pat Customer', signature: SIG })).status).toBe(200)
    const done = (await prisma.notification.findUnique({ where: { id: sendIt!.id } }))!
    expect([done.read, done.title.startsWith("Change order OK'd and signed: CO-1, ")]).toEqual([true, true])
    expect(done.body).not.toMatch(/Send it to/)
    expect(done.body).toMatch(/signed it\.$/)
    expect(await prisma.notification.count({ where: { jobId, title: { startsWith: "Change order OK'd: CO-" } } })).toBe(0)
  })
})
