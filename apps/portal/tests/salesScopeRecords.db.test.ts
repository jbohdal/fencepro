/**
 * The Salesman's scope on the records the review found open (Oct 28 2026):
 * service requests, the customer portal's staff routes, the business record
 * and the key-value store (lib/salesScope.ts, lib/salesScopeRecords.ts).
 * Against the dev database (DEV_DB=1; refuses any other), on a throwaway
 * company, signed in as the Salesman and as the owner.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman\'s scope on service requests, portal, business record and kv (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: tickets } = await import('../src/server/routes/serviceTickets.js')
  const { default: portal } = await import('../src/server/routes/portal.js')
  const { default: business } = await import('../src/server/routes/business-state.js')
  const { default: kv } = await import('../src/server/routes/kv.js')
  const { default: signedDocs } = await import('../src/server/routes/signed-documents.js')
  const { default: pullSheets } = await import('../src/server/routes/pull-sheets.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { default: warranties } = await import('../src/server/routes/warranties.js')
  const { default: jobCosting } = await import('../src/server/routes/job-costing.js')
  const { walkthroughStaff } = await import('../src/server/routes/walkthroughs.js')
  const { packetStaff } = await import('../src/server/routes/installPacket.js')
  const { default: contracts } = await import('../src/server/routes/contracts.js')
  const { default: documents } = await import('../src/server/routes/documents.js')
  const { default: invoices } = await import('../src/server/routes/invoices.js')
  const { default: oldTickets } = await import('../src/server/routes/tickets.js')
  const { default: dashboard } = await import('../src/server/routes/dashboard.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { default: voice } = await import('../src/server/routes/voice.js')
  const { default: leads } = await import('../src/server/routes/leads.js')
  const { salesmanHasNone, refuseSalesman, forgetScope } = await import('../src/server/lib/salesScope.js')
  const { forgetHandedOut } = await import('../src/server/lib/salesServed.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `ssr-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', sales = '', salesId = '', sales2 = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}
  const portalFileIds: string[] = []
  const portalMsgIds: string[] = []

  // The business record as stored: one entry of the Salesman's and one of the owner's in each per customer list.
  let stored: Record<string, any> = {}

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const o = await prisma.crmUser.create({ data: { email: `${tag}-owner@example.invalid`, firstName: 'Olive', lastName: tag, role: 'super_admin', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const s = await prisma.crmUser.create({ data: { email: `${tag}-sales@example.invalid`, firstName: 'Sally', lastName: tag, role: 'sales_rep', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    owner = jwt.sign({ sub: o.id, email: o.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    sales = jwt.sign({ sub: s.id, email: s.email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    // The same Salesman's second phone (another sign in of the same login).
    sales2 = jwt.sign({ sub: s.id, email: s.email, role: 'sales_rep', crmAccountId: accountId, phone: 2 }, secret, { expiresIn: '10m' })
    salesId = s.id
    ids.cMine = (await prisma.crmContact.create({ data: { accountId, firstName: 'Mina', lastName: tag, ownerId: s.id, phone: '3525550301' } })).id
    ids.cOther = (await prisma.crmContact.create({ data: { accountId, firstName: 'Otto', lastName: tag, ownerId: o.id, salesRep: `Olive ${tag}`, phone: '3525550302', serviceAddress: '9 Other Rd' } })).id
    ids.qMine = (await prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', ownerId: s.id, salesRep: `Sally ${tag}`, crmContactId: ids.cMine, customerName: `Mina ${tag}`, finalPrice: 5000 } })).id
    ids.qOther = (await prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', ownerId: o.id, salesRep: `Olive ${tag}`, crmContactId: ids.cOther, customerName: `Otto ${tag}`, finalPrice: 8409 } })).id
    ids.jMine = (await prisma.savedJob.create({ data: { accountId, quoteId: ids.qMine, crmContactId: ids.cMine, customerName: `Mina ${tag}`, quotePrice: 5000, contractValue: 5000, gmPct: 0.38 } })).id
    ids.jOther = (await prisma.savedJob.create({ data: { accountId, quoteId: ids.qOther, crmContactId: ids.cOther, customerName: `Otto ${tag}`, customerPhone: '3525550302', customerAddress: '9 Other Rd', quotePrice: 8409, contractValue: 8409, gmPct: 0.4 } })).id
    ids.tMine = (await prisma.serviceTicket.create({ data: { accountId, jobId: ids.jMine, crmContactId: ids.cMine, quoteId: ids.qMine, issue: 'gate', notes: 'gate drags' } })).id
    ids.tOther = (await prisma.serviceTicket.create({ data: { accountId, jobId: ids.jOther, crmContactId: ids.cOther, quoteId: ids.qOther, issue: 'leaning_post', notes: 'post leans' } })).id
    for (const c of [ids.cMine, ids.cOther]) {
      portalMsgIds.push((await prisma.portalMessage.create({ data: { crmCustomerId: c, senderType: 'customer', body: `hello from ${c === ids.cMine ? 'Mina' : 'Otto'} ${tag}` } })).id)
      portalFileIds.push((await prisma.portalFile.create({ data: { crmCustomerId: c, fileKey: `test/${tag}-${c}.pdf`, originalFilename: 'Receipt.pdf', fileSizeBytes: 10, mimeType: 'application/pdf', source: 'system_generated' } })).id)
    }

    stored = {
      invoices: [
        { id: `${tag}-inv-other`, customerId: ids.cOther, customerName: `Otto ${tag}`, totalCents: 445700, status: 'paid', lineItems: [] },
        { id: `${tag}-inv-mine`, customerId: ids.cMine, customerName: `Mina ${tag}`, totalCents: 500000, status: 'sent', lineItems: [] },
        { id: `${tag}-inv-old`, customerName: 'Somebody Old', totalCents: 12300, status: 'paid', lineItems: [] },
      ],
      payments: [
        { id: `${tag}-pay-other`, customerId: ids.cOther, invoiceId: `${tag}-inv-other`, amountCents: 445700, paymentMethod: 'check' },
        { id: `${tag}-pay-mine`, customerId: ids.cMine, invoiceId: `${tag}-inv-mine`, amountCents: 250000, paymentMethod: 'card' },
        { id: `${tag}-pay-old`, invoiceId: `${tag}-inv-old`, amountCents: 12300, paymentMethod: 'cash' },
      ],
      pullSheets: [
        { id: `${tag}-ps-other`, customerId: ids.cOther, quoteId: ids.qOther, jobId: ids.jOther, customerName: `Otto ${tag}`, versionNumber: 1 },
        { id: `${tag}-ps-mine`, customerId: ids.cMine, quoteId: ids.qMine, jobId: ids.jMine, customerName: `Mina ${tag}`, versionNumber: 1 },
      ],
      pendingOrders: [
        { id: `${tag}-so-other1`, customerId: ids.cOther, quoteId: ids.qOther, jobId: ids.jOther, customerName: `Otto ${tag}`, status: 'pending', items: [], notes: '' },
        { id: `${tag}-so-mine`, customerId: ids.cMine, quoteId: ids.qMine, jobId: ids.jMine, customerName: `Mina ${tag}`, status: 'pending', items: [], notes: '' },
        { id: `${tag}-so-other2`, customerId: ids.cOther, quoteId: ids.qOther, customerName: `Otto ${tag}`, status: 'ordered', items: [], notes: 'second' },
      ],
      purchaseOrders: [
        { id: `${tag}-po-other`, jobId: ids.jOther, jobName: `Otto ${tag}`, jobAddress: '9 Other Rd', status: 'draft', lineItems: [], subtotalCents: 99900 },
        { id: `${tag}-po-stock`, status: 'ordered', lineItems: [], subtotalCents: 1000, supplier: 'Stephens' },
      ],
      jobChecklists: { [ids.jOther]: [{ id: 'm1', label: 'Permit', isComplete: true }], [ids.jMine]: [{ id: 'm2', label: 'Permit', isComplete: false }] },
      config: { company: { name: tag } },
    }
    await prisma.businessState.create({ data: { accountId, ...stored } as any })
    await prisma.accountKeyValue.createMany({ data: [
      { accountId, key: 'fencepro_customer_activity', value: [
        { id: `${tag}-a-other1`, customerId: ids.cOther, body: 'Called Otto', at: '2026-10-28T10:00:00Z', kind: 'note', actor: 'Olive' },
        { id: `${tag}-a-mine`, customerId: ids.cMine, body: 'Called Mina', at: '2026-10-28T09:00:00Z', kind: 'note', actor: 'Sally' },
        { id: `${tag}-a-other2`, customerId: ids.cOther, body: 'Otto paid', at: '2026-10-27T09:00:00Z', kind: 'payment', actor: 'Olive' },
      ] as any },
      { accountId, key: 'fencepro_siteplans', value: [{ id: `${tag}-sp`, customerId: ids.cOther, name: 'Otto plan' }] as any },
      { accountId, key: 'duplicateCheckAlerted', value: ['phone:3525550302:2'] as any },
    ] })

    ids.coMine = (await prisma.contract.create({ data: { accountId, externalCrmId: ids.qMine, name: `Mina ${tag}`, startDate: new Date() } })).id
    ids.coOther = (await prisma.contract.create({ data: { accountId, externalCrmId: ids.qOther, name: `Otto ${tag}`, startDate: new Date() } })).id
    ids.wOther = (await prisma.walkthrough.create({ data: { accountId, jobId: ids.jOther } as any })).id
    ids.pOther = (await prisma.installPacket.create({ data: { accountId, jobId: ids.jOther, token: `${tag}-tok`, snapshot: {} } as any })).id
    for (const [k, e] of [['runMine', ids.jMine], ['runOther', ids.jOther]] as const) {
      ids[k] = (await prisma.automationRun.create({ data: { accountId, ruleId: `${tag}-rule`, eventId: `${tag}-${k}`, entityKind: 'job', entityId: e } })).id
    }
    for (const [k, q, u] of [['clipMine', ids.qMine, null], ['clipOther', ids.qOther, o.id]] as const) {
      ids[k] = (await prisma.voiceClip.create({ data: { accountId, userId: u, quoteKey: q, mime: 'audio/webm', path: `/nonexistent/${tag}-${k}`, transcript: k } })).id
    }
    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/service-tickets', tickets); app.use('/api/portal', portal); app.use('/api/business-state', business); app.use('/api/kv', kv)
    app.use('/api/signed-documents', signedDocs); app.use('/api/pull-sheets', pullSheets)
    app.use('/api/change-orders', changeOrders); app.use('/api/warranties', warranties)
    app.use('/api/job-costing', jobCosting); app.use('/api/walkthroughs', walkthroughStaff); app.use('/api/install-packets', packetStaff)
    app.use('/api/automations', automations); app.use('/api/voice', voice)
    // As index.ts mounts them: the old customer portal routes, and the website leads.
    app.use('/api/leads', refuseSalesman('Website and phone leads are the office\'s until one is assigned to you.'))
    app.use('/api/documents', salesmanHasNone({ list: true })); app.use('/api/invoices', salesmanHasNone({ list: true }))
    app.use('/api/tickets', salesmanHasNone({ list: true })); app.use('/api/dashboard', salesmanHasNone())
    app.use('/api/contracts', contracts); app.use('/api/documents', documents); app.use('/api/invoices', invoices)
    app.use('/api/tickets', oldTickets); app.use('/api/dashboard', dashboard); app.use('/api/leads', leads)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.portalMessage.deleteMany({ where: { crmCustomerId: { in: [ids.cMine, ids.cOther] } } })
    await prisma.portalFile.deleteMany({ where: { id: { in: portalFileIds } } })
    await prisma.serviceTicket.deleteMany({ where: { accountId } })
    await prisma.contract.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.walkthrough.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.installPacket.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.automationRun.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.voiceClip.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const idsOf = (list: any[]) => list.map(x => x.id)

  test('service requests: the Salesman lists and opens only the Salesman\'s; another is a 404, read or changed; the owner has both', async () => {
    const list = await call('GET', '/api/service-tickets', sales)
    expect(list.status).toBe(200)
    expect(idsOf(list.json.data)).toEqual([ids.tMine])
    expect(JSON.stringify(list.json)).not.toContain('3525550302')
    expect((await call('GET', `/api/service-tickets?customerId=${ids.cOther}`, sales)).json.data).toEqual([])
    expect((await call('GET', `/api/service-tickets/${ids.tMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/service-tickets/${ids.tOther}`, sales)).status).toBe(404)
    expect((await call('POST', `/api/service-tickets/${ids.tOther}/stage`, sales, { stage: 'scheduled' })).status).toBe(404)
    expect((await call('POST', `/api/service-tickets/${ids.tOther}/photo-link`, sales)).status).toBe(404)
    expect((await call('GET', `/api/service-tickets/context?jobId=${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('POST', '/api/service-tickets', sales, { jobId: ids.jOther, issue: 'gate', notes: 'x' })).status).toBe(404)
    expect((await call('POST', '/api/service-tickets', sales, { id: ids.tOther, jobId: ids.jMine, issue: 'gate', notes: 'x' })).status).toBe(404)
    expect((await prisma.serviceTicket.findUnique({ where: { id: ids.tOther } }))!.stage).toBe('new')
    expect((await prisma.serviceTicket.count({ where: { accountId } }))).toBe(2)
    const o = await call('GET', '/api/service-tickets', owner)
    expect(idsOf(o.json.data).sort()).toEqual([ids.tMine, ids.tOther].sort())
    expect((await call('GET', `/api/service-tickets/${ids.tOther}`, owner)).status).toBe(200)
  })

  test('portal: another customer\'s messages and documents are a 404; the inbox has the Salesman\'s only; the owner has both', async () => {
    expect((await call('GET', `/api/portal/customer/${ids.cOther}/messages`, sales)).status).toBe(404)
    expect((await call('GET', `/api/portal/customer/${ids.cOther}/documents`, sales)).status).toBe(404)
    expect((await call('POST', `/api/portal/customer/${ids.cOther}/messages`, sales, { body: 'hi' })).status).toBe(404)
    expect(await prisma.portalMessage.count({ where: { crmCustomerId: ids.cOther } })).toBe(1)
    // A customer outside the scope read by the Salesman stays unread for the office.
    expect((await prisma.portalMessage.findUnique({ where: { id: portalMsgIds[1] } }))!.isReadByStaff).toBe(false)
    const mine = await call('GET', `/api/portal/customer/${ids.cMine}/messages?read=0`, sales)
    expect(mine.status).toBe(200)
    expect(mine.json.data.messages.map((m: any) => m.id)).toEqual([portalMsgIds[0]])
    const docs = await call('GET', `/api/portal/customer/${ids.cMine}/documents`, sales)
    expect(docs.json.data.map((d: any) => d.id)).toEqual([portalFileIds[0]])
    const inbox = await call('GET', '/api/portal/messages/inbox', sales)
    const threads = inbox.json.data.threads.map((t: any) => t.crmCustomerId)
    expect(threads).toContain(ids.cMine)
    expect(threads).not.toContain(ids.cOther)
    const ownerInbox = await call('GET', '/api/portal/messages/inbox', owner)
    expect(ownerInbox.json.data.threads.map((t: any) => t.crmCustomerId)).toEqual(expect.arrayContaining([ids.cMine, ids.cOther]))
    expect((await call('GET', `/api/portal/customer/${ids.cOther}/documents`, owner)).status).toBe(200)
    expect((await call('GET', `/api/portal/customer/${ids.cOther}/messages?read=0`, owner)).status).toBe(200)
  })

  test('signed documents, pull sheets, change orders and warranties of another customer are a 404 for the Salesman', async () => {
    expect((await call('GET', `/api/change-orders?quoteId=${ids.qOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/change-orders?jobId=${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/change-orders?quoteId=${ids.qMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/change-orders?quoteId=${ids.qOther}`, owner)).status).toBe(200)
    expect((await call('GET', `/api/warranties/job/${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/warranties/job/${ids.jMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/signed-documents?customerId=${ids.cOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/signed-documents?quoteId=${ids.qOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/signed-documents?jobId=${ids.jMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/pull-sheets/customer/${ids.cOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/pull-sheets/customer/${ids.cMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/signed-documents?customerId=${ids.cOther}`, owner)).status).toBe(200)
  })

  test('business record: the Salesman reads no other customer\'s entry; a save of what was read leaves every hidden entry exactly as stored', async () => {
    const read = await call('GET', '/api/business-state', sales)
    expect(read.status).toBe(200)
    const d = read.json.data
    expect(idsOf(d.invoices)).toEqual([`${tag}-inv-mine`])
    expect(idsOf(d.payments)).toEqual([`${tag}-pay-mine`])
    expect(idsOf(d.pullSheets)).toEqual([`${tag}-ps-mine`])
    expect(idsOf(d.pendingOrders)).toEqual([`${tag}-so-mine`])
    expect(idsOf(d.purchaseOrders)).toEqual([`${tag}-po-stock`])
    expect(Object.keys(d.jobChecklists)).toEqual([ids.jMine])
    expect(d.config.company.name).toBe(tag)
    const text = JSON.stringify(read.json)
    expect(text).not.toContain(ids.cOther)
    expect(text).not.toContain('445700')
    expect(text).not.toContain('Otto')

    // The Salesman changes the Salesman's Sales Order, adds one, sends the invoices back as read, and ticks a milestone.
    const pendingOrders = [
      { id: `${tag}-so-new`, customerId: ids.cMine, quoteId: ids.qMine, customerName: `Mina ${tag}`, status: 'pending', items: [], notes: 'new' },
      { ...d.pendingOrders[0], notes: 'called the supplier' },
    ]
    const jobChecklists = { [ids.jMine]: [{ id: 'm2', label: 'Permit', isComplete: true }] }
    const saved = await call('PATCH', '/api/business-state', sales, { pendingOrders, invoices: d.invoices, payments: d.payments, pullSheets: d.pullSheets, jobChecklists, baseVersion: d.version })
    expect(saved.status).toBe(200)
    expect(JSON.stringify(saved.json)).not.toContain(ids.cOther)
    expect(idsOf(saved.json.data.pendingOrders)).toEqual([`${tag}-so-new`, `${tag}-so-mine`])

    const after = await prisma.businessState.findUnique({ where: { accountId } }) as any
    // Hidden entries: byte for byte as stored, in their places.
    expect(after.invoices).toEqual(stored.invoices)
    expect(JSON.stringify(after.invoices)).toBe(JSON.stringify((await prisma.businessState.findUnique({ where: { accountId }, select: { invoices: true } }))!.invoices))
    expect(after.payments).toEqual(stored.payments)
    expect(after.pullSheets).toEqual(stored.pullSheets)
    expect(after.purchaseOrders).toEqual(stored.purchaseOrders)
    expect(after.pendingOrders.find((x: any) => x.id === `${tag}-so-other1`)).toEqual(stored.pendingOrders[0])
    expect(after.pendingOrders.find((x: any) => x.id === `${tag}-so-other2`)).toEqual(stored.pendingOrders[2])
    expect(idsOf(after.pendingOrders)).toEqual([`${tag}-so-other1`, `${tag}-so-new`, `${tag}-so-mine`, `${tag}-so-other2`])
    // The Salesman's own changes saved.
    expect(after.pendingOrders.find((x: any) => x.id === `${tag}-so-mine`).notes).toBe('called the supplier')
    expect(after.jobChecklists[ids.jOther]).toEqual(stored.jobChecklists[ids.jOther])
    expect(after.jobChecklists[ids.jMine][0].isComplete).toBe(true)

    // An entry for another customer, or a change to a hidden one: left out of the save (the rest goes through,
    // Oct 30 2026: refusing the whole save left it stuck on the phone), or the stored one kept.
    const sneaky = await call('PATCH', '/api/business-state', sales, { pendingOrders: [...saved.json.data.pendingOrders.map((x: any) => x.id === `${tag}-so-mine` ? { ...x, notes: 'sent with a sneak' } : x), { id: `${tag}-so-sneak`, customerId: ids.cOther, status: 'pending', items: [] }], baseVersion: saved.json.data.version })
    expect(sneaky.status).toBe(200)
    expect(sneaky.json.leftOut).toBe(1)
    expect(JSON.stringify(sneaky.json.data)).not.toContain(ids.cOther)
    const afterSneak = await prisma.businessState.findUnique({ where: { accountId } }) as any
    expect(afterSneak.pendingOrders.some((x: any) => x.id === `${tag}-so-sneak`)).toBe(false)
    expect(afterSneak.pendingOrders.find((x: any) => x.id === `${tag}-so-mine`).notes).toBe('sent with a sneak')
    const forged = await call('PATCH', '/api/business-state', sales, { pendingOrders: [...sneaky.json.data.pendingOrders, { id: `${tag}-so-other1`, customerId: ids.cMine, status: 'cancelled', items: [] }], baseVersion: sneaky.json.data.version })
    expect(forged.status).toBe(200)
    const after2 = await prisma.businessState.findUnique({ where: { accountId } }) as any
    expect(after2.pendingOrders.find((x: any) => x.id === `${tag}-so-other1`)).toEqual(stored.pendingOrders[0])
    expect(after2.pendingOrders.filter((x: any) => x.id === `${tag}-so-other1`)).toHaveLength(1)

    // A 409 answers the newer record as the Salesman reads it.
    const stale = await call('PATCH', '/api/business-state', sales, { pendingOrders: [], baseVersion: 0 })
    expect(stale.status).toBe(409)
    expect(JSON.stringify(stale.json)).not.toContain(ids.cOther)
    stored.pendingOrders = after2.pendingOrders
    stored.jobChecklists = after2.jobChecklists
  })

  test('business record: the owner reads and saves everything as before', async () => {
    const read = await call('GET', '/api/business-state', owner)
    const d = read.json.data
    expect(idsOf(d.invoices)).toEqual(stored.invoices.map((x: any) => x.id))
    expect(idsOf(d.purchaseOrders)).toEqual(stored.purchaseOrders.map((x: any) => x.id))
    expect(Object.keys(d.jobChecklists).sort()).toEqual([ids.jMine, ids.jOther].sort())
    const pendingOrders = d.pendingOrders.filter((x: any) => x.id !== `${tag}-so-other2`)
    const saved = await call('PATCH', '/api/business-state', owner, { pendingOrders, baseVersion: d.version })
    expect(saved.status).toBe(200)
    const after = await prisma.businessState.findUnique({ where: { accountId } }) as any
    expect(idsOf(after.pendingOrders)).toEqual(idsOf(pendingOrders))
  })

  test('kv: the Salesman reads only the Salesman\'s customers\' activity; a save keeps every other entry as stored; site plans stay company wide', async () => {
    const read = await call('GET', '/api/kv', sales)
    expect(read.status).toBe(200)
    const activity = read.json.data.fencepro_customer_activity
    expect(idsOf(activity)).toEqual([`${tag}-a-mine`])
    expect(read.json.data.duplicateCheckAlerted).toBeUndefined()
    expect(idsOf(read.json.data.fencepro_siteplans)).toEqual([`${tag}-sp`])
    const version = read.json.versions.fencepro_customer_activity
    const before = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_customer_activity' } } }))!.value as any[]

    const added = { id: `${tag}-a-new`, customerId: ids.cMine, body: 'Sent the quote', at: '2026-10-28T12:00:00Z', kind: 'quote', actor: 'Sally' }
    const put = await call('PUT', '/api/kv/fencepro_customer_activity', sales, { value: [added, ...activity], baseVersion: version })
    expect(put.status).toBe(200)
    const after = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_customer_activity' } } }))!.value as any[]
    expect(after.find(x => x.id === `${tag}-a-other1`)).toEqual(before[0])
    expect(after.find(x => x.id === `${tag}-a-other2`)).toEqual(before[2])
    expect(idsOf(after)).toEqual([`${tag}-a-other1`, `${tag}-a-new`, `${tag}-a-mine`, `${tag}-a-other2`])

    // Saved back unchanged: stored exactly as it was.
    const r2 = await call('GET', '/api/kv', sales)
    const same = await call('PUT', '/api/kv/fencepro_customer_activity', sales, { value: r2.json.data.fencepro_customer_activity, baseVersion: r2.json.versions.fencepro_customer_activity })
    expect(same.status).toBe(200)
    const again = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_customer_activity' } } }))!.value
    expect(JSON.stringify(again)).toBe(JSON.stringify(after))

    // An entry for another customer: left out (the answer is her copy as saved), nothing of it saved.
    const sneaky = await call('PUT', '/api/kv/fencepro_customer_activity', sales, { value: [{ id: `${tag}-a-sneak`, customerId: ids.cOther, body: 'x', at: '2026-10-28T13:00:00Z' }, ...r2.json.data.fencepro_customer_activity], baseVersion: same.json.version })
    expect(sneaky.status).toBe(200)
    expect(sneaky.json.leftOut).toBe(1)
    expect(idsOf(sneaky.json.data)).toEqual([`${tag}-a-new`, `${tag}-a-mine`])
    const stillSame = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_customer_activity' } } }))!.value
    expect(JSON.stringify(stillSame)).toBe(JSON.stringify(after))

    // The owner reads everything.
    const o = await call('GET', '/api/kv', owner)
    expect(idsOf(o.json.data.fencepro_customer_activity)).toEqual([`${tag}-a-other1`, `${tag}-a-new`, `${tag}-a-mine`, `${tag}-a-other2`])
    expect(o.json.data.duplicateCheckAlerted).toEqual(['phone:3525550302:2'])
  })

  // ── The phone's copy, not the scope at save time (reviewer, Oct 29 2026) ──────────────────────────────────
  // The Salesman's phone holds the record as it was handed; a customer given to the Salesman (or taken away)
  // after that must not make the Salesman's save remove or change an entry the phone never had.

  /** Each entry of a list as Postgres stores it (text), by id: the byte for byte check. */
  const businessRows = async (col: 'pullSheets' | 'pendingOrders' | 'purchaseOrders' | 'invoices') => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; t: string }>>(`SELECT e->>'id' AS id, e::text AS t FROM "BusinessState" b, jsonb_array_elements(b."${col}") e WHERE b."accountId" = $1`, accountId)
    return new Map(rows.map(r => [r.id, r.t]))
  }
  const kvRows = async (key: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; t: string }>>(`SELECT e->>'id' AS id, e::text AS t FROM "AccountKeyValue" k, jsonb_array_elements(k.value) e WHERE k."accountId" = $1 AND k.key = $2`, accountId, key)
    return new Map(rows.map(r => [r.id, r.t]))
  }
  /** The owner gives Otto (the other customer) to the Salesman, or takes him back: the customer, his quote and his job (the rep on each decides, Oct 29 2026). */
  const giveOtto = async (toSalesman: boolean) => {
    const salesRep = toSalesman ? `Sally ${tag}` : `Olive ${tag}`
    await prisma.crmContact.update({ where: { id: ids.cOther }, data: { salesRep } })
    await prisma.savedQuote.update({ where: { id: ids.qOther }, data: { salesRep } })
    await prisma.savedJob.update({ where: { id: ids.jOther }, data: { salesRep } })
    forgetScope(salesId)   // the scope is read again at the save (as after its few seconds of memory)
  }
  /** A fresh record: two pull sheets and a Sales Order of Otto's, one of each of Mina's; job costing and activity for both. */
  const fixture = async (ottoIsTheSalesmans: boolean) => {
    await giveOtto(ottoIsTheSalesmans)
    const ps = (id: string, c: 'Other' | 'Mine', v: number) => ({ id: `${tag}-${id}`, customerId: ids[`c${c}`], quoteId: ids[`q${c}`], customerName: `${c === 'Other' ? 'Otto' : 'Mina'} ${tag}`, versionNumber: v, versionSnapshot: [{ sku: 'WV6', qty: 12 + v }] })
    await prisma.businessState.update({ where: { accountId }, data: {
      pullSheets: [ps('ps-o1', 'Other', 1), ps('ps-m1', 'Mine', 1), ps('ps-o2', 'Other', 2)],
      pendingOrders: [
        { id: `${tag}-so-o`, customerId: ids.cOther, quoteId: ids.qOther, customerName: `Otto ${tag}`, status: 'pending', items: [{ itemName: 'Post', qty: 9 }], notes: 'otto' },
        { id: `${tag}-so-m`, customerId: ids.cMine, quoteId: ids.qMine, customerName: `Mina ${tag}`, status: 'pending', items: [], notes: 'mina' },
      ],
      purchaseOrders: [{ id: `${tag}-po-o`, jobId: ids.jOther, status: 'draft', lineItems: [], subtotalCents: 99900 }],
      version: { increment: 1 },
    } as any })
    for (const [key, value] of [
      ['fencepro_jobcosting', [
        { id: `${tag}-jc-o`, quoteId: ids.qOther, laborCents: 120000, materialCents: 340000 },
        { id: `${tag}-jc-m`, quoteId: ids.qMine, laborCents: 50000, materialCents: 90000 },
      ]],
      ['fencepro_customer_activity', [
        { id: `${tag}-ac-o`, customerId: ids.cOther, body: 'Called Otto', at: '2026-10-29T10:00:00Z', kind: 'note', actor: 'Olive' },
        { id: `${tag}-ac-m`, customerId: ids.cMine, body: 'Called Mina', at: '2026-10-29T09:00:00Z', kind: 'note', actor: 'Sally' },
      ]],
    ] as const) {
      await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key } }, create: { accountId, key, value: value as any }, update: { value: value as any, version: { increment: 1 } } })
    }
  }
  // Otto is the owner's again after each test (the tests below expect him outside the Salesman's scope).
  afterEach(async () => { if (accountId && ids.cOther) await giveOtto(false) })
  const ottoIds = (m: Map<string, string>) =>[...m.keys()].filter(k => /-(ps-o|so-o|po-o|jc-o|ac-o)/.test(k))

  test('reviewer\'s case, business record: Otto given to the Salesman after the phone read it; the phone\'s save leaves Otto\'s pull sheets, Sales Order and PO byte for byte', async () => {
    await fixture(false)
    const read = await call('GET', '/api/business-state', sales)
    expect(idsOf(read.json.data.pullSheets)).toEqual([`${tag}-ps-m1`])
    const before = { ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders'), po: await businessRows('purchaseOrders') }
    // The office gives Otto to the Salesman. The phone does not read again.
    await giveOtto(true)
    // The phone saves its quote: a new pull sheet version for Mina, its Sales Order changed, its POs as read.
    const d = read.json.data
    const newPs = { id: `${tag}-ps-m2`, customerId: ids.cMine, quoteId: ids.qMine, customerName: `Mina ${tag}`, versionNumber: 2, versionSnapshot: [] }
    const saved = await call('PATCH', '/api/business-state', sales, {
      pullSheets: [newPs, ...d.pullSheets],
      pendingOrders: d.pendingOrders.map((o: any) => ({ ...o, notes: 'mina, called' })),
      purchaseOrders: d.purchaseOrders,
      baseVersion: d.version,
    })
    expect(saved.status).toBe(200)
    const after = { ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders'), po: await businessRows('purchaseOrders') }
    for (const [k, m] of [['ps', after.ps], ['so', after.so], ['po', after.po]] as const) {
      for (const id of ottoIds(before[k])) expect(m.get(id), id).toBe(before[k].get(id))
    }
    expect(ottoIds(after.ps)).toHaveLength(2)
    expect([...after.ps.keys()]).toEqual([`${tag}-ps-o1`, `${tag}-ps-m2`, `${tag}-ps-m1`, `${tag}-ps-o2`])
    expect(JSON.parse(after.so.get(`${tag}-so-m`)!).notes).toBe('mina, called')

    // The phone reads again at the same version and now has Otto's entries too. It is not the only copy of this
    // version the login was handed (its own save's had no Otto), so a removal of Otto's is not taken yet: kept.
    const again = await call('GET', '/api/business-state', sales)
    expect(idsOf(again.json.data.pendingOrders)).toEqual([`${tag}-so-o`, `${tag}-so-m`])
    const early = await call('PATCH', '/api/business-state', sales, { pendingOrders: again.json.data.pendingOrders.filter((o: any) => o.id !== `${tag}-so-o`), baseVersion: again.json.data.version })
    expect(early.status).toBe(200)
    expect((await businessRows('pendingOrders')).get(`${tag}-so-o`)).toBe(before.so.get(`${tag}-so-o`))
    // Once the phone holds a copy of a version every copy of which had Otto's, the Salesman may remove it.
    const o = await call('GET', '/api/business-state', owner)
    expect((await call('PATCH', '/api/business-state', owner, { config: { company: { name: tag }, n: 1 }, baseVersion: o.json.data.version })).status).toBe(200)
    const third = await call('GET', '/api/business-state', sales)
    const removed = await call('PATCH', '/api/business-state', sales, { pendingOrders: third.json.data.pendingOrders.filter((x: any) => x.id !== `${tag}-so-o`), baseVersion: third.json.data.version })
    expect(removed.status).toBe(200)
    expect([...(await businessRows('pendingOrders')).keys()]).toEqual([`${tag}-so-m`])
  })

  test('reviewer\'s case, kv: Otto given to the Salesman after the phone read job costing and activity; Otto\'s entries stay byte for byte', async () => {
    await fixture(false)
    const read = await call('GET', '/api/kv', sales)
    expect(idsOf(read.json.data.fencepro_jobcosting)).toEqual([`${tag}-jc-m`])
    const jc0 = await kvRows('fencepro_jobcosting'), ac0 = await kvRows('fencepro_customer_activity')
    await giveOtto(true)
    // Job costing: the phone changes Mina's line.
    const jc = await call('PUT', '/api/kv/fencepro_jobcosting', sales, { value: read.json.data.fencepro_jobcosting.map((x: any) => ({ ...x, laborCents: 51000 })), baseVersion: read.json.versions.fencepro_jobcosting })
    expect(jc.status).toBe(200)
    const jc1 = await kvRows('fencepro_jobcosting')
    expect(jc1.get(`${tag}-jc-o`)).toBe(jc0.get(`${tag}-jc-o`))
    expect(JSON.parse(jc1.get(`${tag}-jc-m`)!).laborCents).toBe(51000)
    // Activity: the phone logs a call for Mina.
    const note = { id: `${tag}-ac-m2`, customerId: ids.cMine, body: 'Sent the quote', at: '2026-10-29T12:00:00Z', kind: 'quote', actor: 'Sally' }
    const ac = await call('PUT', '/api/kv/fencepro_customer_activity', sales, { value: [note, ...read.json.data.fencepro_customer_activity], baseVersion: read.json.versions.fencepro_customer_activity })
    expect(ac.status).toBe(200)
    const ac1 = await kvRows('fencepro_customer_activity')
    expect(ac1.get(`${tag}-ac-o`)).toBe(ac0.get(`${tag}-ac-o`))
    expect([...ac1.keys()]).toEqual([`${tag}-ac-o`, `${tag}-ac-m2`, `${tag}-ac-m`])
  })

  test('kv: an empty list from the Salesman removes no activity (the app only adds to it); job costing removes only the line the phone had', async () => {
    await fixture(true)
    const read = await call('GET', '/api/kv', sales)
    expect(idsOf(read.json.data.fencepro_customer_activity)).toEqual([`${tag}-ac-o`, `${tag}-ac-m`])
    const ac0 = await kvRows('fencepro_customer_activity')
    const wiped = await call('PUT', '/api/kv/fencepro_customer_activity', sales, { value: [], baseVersion: read.json.versions.fencepro_customer_activity })
    expect(wiped.status).toBe(200)
    expect(await kvRows('fencepro_customer_activity')).toEqual(ac0)
    // Job costing lines can be removed in the app (JobCostingTab): the Salesman's own, which the phone had.
    await giveOtto(false)
    const jc0 = await kvRows('fencepro_jobcosting')
    const cleared = await call('PUT', '/api/kv/fencepro_jobcosting', sales, { value: [], baseVersion: read.json.versions.fencepro_jobcosting })
    expect(cleared.status).toBe(200)
    const jc1 = await kvRows('fencepro_jobcosting')
    expect([...jc1.keys()]).toEqual([`${tag}-jc-o`])
    expect(jc1.get(`${tag}-jc-o`)).toBe(jc0.get(`${tag}-jc-o`))
  })

  test('scope shrinks between read and save: Otto taken back from the Salesman; the phone\'s change and removal of Otto\'s entries are not saved', async () => {
    await fixture(true)
    const read = await call('GET', '/api/business-state', sales)
    const d = read.json.data
    expect(idsOf(d.pendingOrders)).toEqual([`${tag}-so-o`, `${tag}-so-m`])
    const before = { ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders'), po: await businessRows('purchaseOrders') }
    await giveOtto(false)
    // The phone changes Otto's Sales Order and leaves out one of Otto's pull sheets and his PO.
    const saved = await call('PATCH', '/api/business-state', sales, {
      pendingOrders: d.pendingOrders.map((o: any) => ({ ...o, notes: 'changed on the phone' })),
      pullSheets: d.pullSheets.filter((x: any) => x.id !== `${tag}-ps-o1`),
      purchaseOrders: [],
      baseVersion: d.version,
    })
    expect(saved.status).toBe(200)
    const after = { ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders'), po: await businessRows('purchaseOrders') }
    for (const [k, m] of [['ps', after.ps], ['so', after.so], ['po', after.po]] as const) {
      for (const id of ottoIds(before[k])) expect(m.get(id), id).toBe(before[k].get(id))
    }
    expect(JSON.parse(after.so.get(`${tag}-so-m`)!).notes).toBe('changed on the phone')
    // kv the same way: job costing read with Otto in, saved after he was taken back, his line left out.
    await giveOtto(true)
    const kvRead = await call('GET', '/api/kv', sales)
    expect(idsOf(kvRead.json.data.fencepro_jobcosting)).toEqual([`${tag}-jc-o`, `${tag}-jc-m`])
    const jc0 = await kvRows('fencepro_jobcosting')
    await giveOtto(false)
    const put = await call('PUT', '/api/kv/fencepro_jobcosting', sales, { value: kvRead.json.data.fencepro_jobcosting.filter((x: any) => x.id !== `${tag}-jc-o`), baseVersion: kvRead.json.versions.fencepro_jobcosting })
    expect(put.status).toBe(200)
    expect((await kvRows('fencepro_jobcosting')).get(`${tag}-jc-o`)).toBe(jc0.get(`${tag}-jc-o`))
  })

  test('a stale or unknown base: refused with the 409 the app merges, nothing changed; the retry on the 409\'s copy keeps Otto\'s entries', async () => {
    await fixture(false)
    const read = await call('GET', '/api/business-state', sales)
    const before = { ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders') }
    // The owner saves in between: the phone's copy is one version old.
    const o = await call('GET', '/api/business-state', owner)
    expect((await call('PATCH', '/api/business-state', owner, { config: { company: { name: tag, phone: '3528442677' } }, baseVersion: o.json.data.version })).status).toBe(200)
    await giveOtto(true)
    const stale = await call('PATCH', '/api/business-state', sales, { pullSheets: [], pendingOrders: [], baseVersion: read.json.data.version })
    expect(stale.status).toBe(409)
    expect(stale.json.code).toBe('STALE_VERSION')
    expect(await businessRows('pullSheets')).toEqual(before.ps)
    expect(await businessRows('pendingOrders')).toEqual(before.so)
    // The 409 hands over Otto's entries too (now the Salesman's): that copy is the phone's from now on.
    expect(idsOf(stale.json.data.pullSheets)).toEqual([`${tag}-ps-o1`, `${tag}-ps-m1`, `${tag}-ps-o2`])

    // The server forgot what it handed out (a restart): the save is refused, never guessed.
    forgetHandedOut()
    const unknown = await call('PATCH', '/api/business-state', sales, { pendingOrders: [], baseVersion: stale.json.version })
    expect(unknown.status).toBe(409)
    expect(unknown.json.version).toBe(stale.json.version)
    expect(await businessRows('pendingOrders')).toEqual(before.so)
    // The app puts its change on the 409's copy and saves again: only Mina's Sales Order is changed.
    const retry = await call('PATCH', '/api/business-state', sales, { pendingOrders: unknown.json.data.pendingOrders.map((x: any) => x.id === `${tag}-so-m` ? { ...x, notes: 'retry' } : x), baseVersion: unknown.json.version })
    expect(retry.status).toBe(200)
    const so = await businessRows('pendingOrders')
    expect(so.get(`${tag}-so-o`)).toBe(before.so.get(`${tag}-so-o`))
    expect(JSON.parse(so.get(`${tag}-so-m`)!).notes).toBe('retry')

    // kv: an unknown base is a 409 too, with nothing saved.
    forgetHandedOut()
    const jc0 = await kvRows('fencepro_jobcosting')
    const v = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_jobcosting' } } }))!.version
    const kvUnknown = await call('PUT', '/api/kv/fencepro_jobcosting', sales, { value: [], baseVersion: v })
    expect(kvUnknown.status).toBe(409)
    expect(idsOf(kvUnknown.json.data)).toEqual([`${tag}-jc-o`, `${tag}-jc-m`])
    expect(await kvRows('fencepro_jobcosting')).toEqual(jc0)
  })

  test('both sides save at once: the office\'s change to Otto and the Salesman\'s pull sheet both land; Otto\'s other entries byte for byte', async () => {
    await fixture(false)
    const sRead = await call('GET', '/api/business-state', sales)
    const oRead = await call('GET', '/api/business-state', owner)
    expect(sRead.json.data.version).toBe(oRead.json.data.version)
    const before = { ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders') }
    await giveOtto(true)
    const newPs = { id: `${tag}-ps-m2`, customerId: ids.cMine, quoteId: ids.qMine, customerName: `Mina ${tag}`, versionNumber: 2, versionSnapshot: [] }
    const officeOrders = oRead.json.data.pendingOrders.map((x: any) => x.id === `${tag}-so-o` ? { ...x, status: 'ordered' } : x)
    const [a, b] = await Promise.all([
      call('PATCH', '/api/business-state', sales, { pullSheets: [newPs, ...sRead.json.data.pullSheets], pendingOrders: sRead.json.data.pendingOrders, baseVersion: sRead.json.data.version }),
      call('PATCH', '/api/business-state', owner, { pendingOrders: officeOrders, baseVersion: oRead.json.data.version }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    // The one refused puts its change on the 409's copy and saves again (web versionedDoc.ts).
    if (a.status === 409) {
      const r = await call('PATCH', '/api/business-state', sales, { pullSheets: [newPs, ...a.json.data.pullSheets], baseVersion: a.json.version })
      expect(r.status).toBe(200)
    } else {
      const r = await call('PATCH', '/api/business-state', owner, { pendingOrders: b.json.data.pendingOrders.map((x: any) => x.id === `${tag}-so-o` ? { ...x, status: 'ordered' } : x), baseVersion: b.json.version })
      expect(r.status).toBe(200)
    }
    const ps = await businessRows('pullSheets'), so = await businessRows('pendingOrders')
    for (const id of ottoIds(before.ps)) expect(ps.get(id), id).toBe(before.ps.get(id))
    expect(ps.has(`${tag}-ps-m2`)).toBe(true)
    expect(JSON.parse(so.get(`${tag}-so-o`)!).status).toBe('ordered')
    expect(so.get(`${tag}-so-m`)).toBe(before.so.get(`${tag}-so-m`))
  })

  test('two phones of the same Salesman read one version under different scopes: the one that never had Otto\'s entry cannot remove it', async () => {
    await fixture(false)
    const phoneA = await call('GET', '/api/business-state', sales)
    await giveOtto(true)
    const phoneB = await call('GET', '/api/business-state', sales2)
    expect(phoneB.json.data.version).toBe(phoneA.json.data.version)
    expect(idsOf(phoneB.json.data.pendingOrders)).toEqual([`${tag}-so-o`, `${tag}-so-m`])
    const before = await businessRows('pendingOrders')
    // Phone A (no Otto) sends its list: Otto's Sales Order is not its to remove.
    const a = await call('PATCH', '/api/business-state', sales, { pendingOrders: phoneA.json.data.pendingOrders.map((x: any) => ({ ...x, notes: 'from A' })), baseVersion: phoneA.json.data.version })
    expect(a.status).toBe(200)
    const after = await businessRows('pendingOrders')
    expect(after.get(`${tag}-so-o`)).toBe(before.get(`${tag}-so-o`))
    expect(JSON.parse(after.get(`${tag}-so-m`)!).notes).toBe('from A')
  })

  test('job costing, walkthroughs, install packets, permits, the run log, voice clips: another job is a 404, lists are the Salesman\'s', async () => {
    expect((await call('GET', `/api/job-costing/takeoff?jobId=${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/job-costing/takeoff?jobId=${ids.jMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/job-costing/job/${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('POST', '/api/job-costing/takeoff', sales, { id: crypto.randomUUID(), jobId: ids.jOther })).status).toBe(404)
    const report = await call('GET', '/api/job-costing/report', sales)
    expect(report.status).toBe(200)
    expect(JSON.stringify(report.json)).not.toContain(ids.jOther)
    expect((await call('GET', `/api/walkthroughs?jobId=${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/walkthroughs/${ids.wOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/walkthroughs?jobId=${ids.jMine}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/walkthroughs/${ids.wOther}`, owner)).status).toBe(200)
    expect((await call('GET', `/api/install-packets?jobId=${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/install-packets/work?jobId=${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/install-packets/crew/${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/install-packets?jobId=${ids.jMine}`, sales)).status).toBe(200)
    const op = await call('GET', `/api/install-packets?jobId=${ids.jOther}`, owner)
    expect(op.json.data.token).toBe(`${tag}-tok`)
    expect((await call('GET', `/api/automations/permits/${ids.jOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/automations/permits/${ids.jMine}`, sales)).status).toBe(200)
    const runs = await call('GET', '/api/automations/runs', sales)
    expect(runs.json.data.map((r: any) => r.id)).toEqual([ids.runMine])
    const oruns = await call('GET', '/api/automations/runs', owner)
    expect(oruns.json.data.map((r: any) => r.id).sort()).toEqual([ids.runMine, ids.runOther].sort())
    const samples = await call('GET', '/api/automations/samples?board=ops', sales)
    expect(samples.json.data.map((j: any) => j.id)).toEqual([ids.jMine])
    expect((await call('POST', '/api/automations/stage-check', sales, { board: 'ops', entityId: ids.jOther, stage: 'x' })).status).toBe(404)
    const clips = await call('GET', '/api/voice/clips', sales)
    expect(clips.json.data.map((c: any) => c.id)).toEqual([ids.clipMine])
    expect((await call('DELETE', `/api/voice/clips/${ids.clipOther}`, sales)).json.data.deleted).toBe(0)
    expect((await call('GET', '/api/voice/clips', owner)).json.data).toHaveLength(2)
  })

  test('the old customer portal routes: none is the Salesman\'s; contracts follow the quotes; website leads are the office\'s', async () => {
    const c = await call('GET', '/api/contracts', sales)
    expect(c.json.data.map((x: any) => x.id)).toEqual([ids.coMine])
    const oc = await call('GET', '/api/contracts', owner)
    expect(oc.json.data.map((x: any) => x.id)).toEqual(expect.arrayContaining([ids.coMine, ids.coOther]))
    for (const p of ['/api/documents', '/api/invoices', '/api/tickets']) expect((await call('GET', p, sales)).json.data).toEqual([])
    expect((await call('GET', '/api/tickets/anything', sales)).status).toBe(404)
    expect((await call('GET', '/api/invoices/statement/pdf', sales)).status).toBe(404)
    expect((await call('GET', '/api/dashboard', sales)).status).toBe(404)
    expect((await call('GET', '/api/leads', sales)).status).toBe(403)
  })
})
