/**
 * What the Salesman sees after the owner moves her work (Jonathan, Oct 29
 * 2026: "Christa's quotes after a move: unsold ones leave her list. Signed
 * ones she sold stay with her."). lib/salesScope.ts: the rep on a quote or
 * job decides; a customer stays on her list only through something still hers.
 *
 * Against the dev database (DEV_DB=1; refuses any other), on a throwaway
 * company, through the same middleware order as index.ts, with the owner's
 * real moves (the customer page's Change, lib/leadAssign.ts with
 * lib/quotesFollowCustomer.ts; one quote or job, lib/salesmanMove.ts):
 *
 *   1. the owner moves a customer with her unsold and signed quotes;
 *   2. the owner moves a single unsold quote of hers;
 *   3. the owner moves her signed quote (and its job);
 *   4. her phone read the business record and the activity before the moves
 *      and saves after them, at the same time as the office: every entry of
 *      the customers she no longer sees stays byte for byte, and nothing she
 *      lost comes back.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman\'s scope after the owner moves her work (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: leadAssign } = await import('../src/server/routes/lead-assign.js')
  const { default: followUps } = await import('../src/server/routes/follow-ups.js')
  const { default: business } = await import('../src/server/routes/business-state.js')
  const { default: kv } = await import('../src/server/routes/kv.js')
  const { default: pipeline } = await import('../src/server/routes/pipeline.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `sam-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = ''
  const tok: Record<string, string> = {}
  const id: Record<string, string> = {}
  let server: ReturnType<express.Express['listen']>
  const SALLY = () => `Sally ${tag}`, SAM = () => `Sam ${tag}`, OLIVE = () => `Olive ${tag}`

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = async (key: string, firstName: string, role: string) => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
      id[key] = u.id
      tok[key] = jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    await user('owner', 'Olive', 'super_admin')
    await user('office', 'Opal', 'office_staff')
    await user('sally', 'Sally', 'sales_rep')
    await user('sam', 'Sam', 'sales_rep')

    const contact = (firstName: string, salesRep: string, ownerId: string) => prisma.crmContact.create({ data: { accountId, firstName, lastName: tag, ownerId, salesRep, phone: `35255${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}` } }).then(c => c.id)
    const quote = (data: any) => prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', salesRep: SALLY(), ownerId: id.sally, finalPrice: 8000, totalCOGS: 4500, gmPct: 0.3, hasSalesman: true, ...data } }).then(q => q.id)
    // Cleo: Sally's customer, entered by Sally: a draft and a sent quote she wrote, and a signed one with its job.
    id.cleo = await contact('Cleo', SALLY(), id.sally)
    id.qCleoDraft = await quote({ crmContactId: id.cleo, customerName: `Cleo ${tag}`, status: 'DRAFT' })
    id.qCleoSent = await quote({ crmContactId: id.cleo, customerName: `Cleo ${tag}`, status: 'SENT' })
    id.qCleoSigned = await quote({ crmContactId: id.cleo, customerName: `Cleo ${tag}`, status: 'SOLD', soldAt: new Date(), finalPrice: 9000 })
    id.jCleo = (await prisma.savedJob.create({ data: { accountId, quoteId: id.qCleoSigned, crmContactId: id.cleo, customerName: `Cleo ${tag}`, salesRep: SALLY(), quotePrice: 9000, contractValue: 9000, gmPct: 0.3 } })).id
    // Dina: Sally's customer with one unsold quote (the owner moves only the quote).
    id.dina = await contact('Dina', SALLY(), id.sally)
    id.qDina = await quote({ crmContactId: id.dina, customerName: `Dina ${tag}`, status: 'SENT' })
    // Fay: the owner's customer; Sally sold her fence (the owner moves the signed quote and its job).
    id.fay = await contact('Fay', OLIVE(), id.owner)
    id.qFay = await quote({ crmContactId: id.fay, customerName: `Fay ${tag}`, status: 'SOLD', soldAt: new Date(), ownerId: id.owner, finalPrice: 12000 })
    id.jFay = (await prisma.savedJob.create({ data: { accountId, quoteId: id.qFay, crmContactId: id.fay, customerName: `Fay ${tag}`, salesRep: SALLY(), quotePrice: 12000, contractValue: 12000, gmPct: 0.3 } })).id
    // Mina: Sally's, untouched by any move. Otto: the owner's, never Sally's.
    id.mina = await contact('Mina', SALLY(), id.sally)
    id.qMina = await quote({ crmContactId: id.mina, customerName: `Mina ${tag}`, status: 'DRAFT' })
    id.otto = await contact('Otto', OLIVE(), id.owner)
    id.qOtto = await quote({ crmContactId: id.otto, customerName: `Otto ${tag}`, status: 'SOLD', soldAt: new Date(), ownerId: id.owner, salesRep: OLIVE() })
    // Sally's open card on Cleo, and a won card of hers on Fay.
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [
      { id: `${tag}-k-cleo`, stage: 'new_lead', firstName: 'Cleo', lastName: tag, customerId: id.cleo, quoteId: id.qCleoDraft, assignedRep: SALLY() },
      { id: `${tag}-k-fay`, stage: 'won', firstName: 'Fay', lastName: tag, customerId: id.fay, quoteId: id.qFay, assignedRep: SALLY() },
    ] } as any })

    // The company-wide records: entries of every customer (other customers' payments and invoices in them).
    const per = (c: string, q: string, j?: string) => ({ customerId: id[c], quoteId: id[q], ...(j ? { jobId: id[j] } : {}), customerName: `${c} ${tag}` })
    await prisma.businessState.create({ data: { accountId,
      invoices: [
        { id: `${tag}-inv-cleo`, ...per('cleo', 'qCleoSigned', 'jCleo'), totalCents: 900000, status: 'sent', lineItems: [{ d: 'fence', c: 900000 }] },
        { id: `${tag}-inv-fay`, ...per('fay', 'qFay', 'jFay'), totalCents: 1200000, status: 'paid', lineItems: [] },
        { id: `${tag}-inv-otto`, ...per('otto', 'qOtto'), totalCents: 445700, status: 'paid', lineItems: [] },
        { id: `${tag}-inv-mina`, ...per('mina', 'qMina'), totalCents: 500000, status: 'draft', lineItems: [] },
      ],
      payments: [
        { id: `${tag}-pay-cleo`, customerId: id.cleo, invoiceId: `${tag}-inv-cleo`, amountCents: 450000, paymentMethod: 'check' },
        { id: `${tag}-pay-fay`, customerId: id.fay, invoiceId: `${tag}-inv-fay`, amountCents: 1200000, paymentMethod: 'card' },
        { id: `${tag}-pay-otto`, invoiceId: `${tag}-inv-otto`, amountCents: 445700, paymentMethod: 'cash' },
      ],
      pullSheets: [
        { id: `${tag}-ps-cleo-draft`, ...per('cleo', 'qCleoDraft'), versionNumber: 1, versionSnapshot: [{ sku: 'WV6', qty: 14 }] },
        { id: `${tag}-ps-cleo-signed`, ...per('cleo', 'qCleoSigned', 'jCleo'), versionNumber: 1, versionSnapshot: [{ sku: 'WV6', qty: 20 }] },
        { id: `${tag}-ps-dina`, ...per('dina', 'qDina'), versionNumber: 1 },
        { id: `${tag}-ps-fay`, ...per('fay', 'qFay', 'jFay'), versionNumber: 1 },
        { id: `${tag}-ps-mina`, ...per('mina', 'qMina'), versionNumber: 1 },
      ],
      pendingOrders: [
        { id: `${tag}-so-cleo`, ...per('cleo', 'qCleoSigned', 'jCleo'), status: 'pending', items: [{ itemName: 'Post', qty: 21 }], notes: 'cleo' },
        { id: `${tag}-so-fay`, ...per('fay', 'qFay', 'jFay'), status: 'ordered', items: [], notes: 'fay' },
        { id: `${tag}-so-mina`, ...per('mina', 'qMina'), status: 'pending', items: [], notes: 'mina' },
      ],
      jobChecklists: { [id.jCleo]: [{ id: 'm1', label: 'Permit', isComplete: true }], [id.jFay]: [{ id: 'm2', label: 'Permit', isComplete: false }] },
      config: { company: { name: tag } },
    } as any })
    await prisma.accountKeyValue.createMany({ data: [
      { accountId, key: 'fencepro_customer_activity', value: [
        { id: `${tag}-ac-cleo`, customerId: id.cleo, body: 'Called Cleo', at: '2026-10-29T10:00:00Z', kind: 'note', actor: 'Sally' },
        { id: `${tag}-ac-fay`, customerId: id.fay, body: 'Fay paid', at: '2026-10-29T09:30:00Z', kind: 'payment', actor: 'Olive' },
        { id: `${tag}-ac-dina`, customerId: id.dina, body: 'Called Dina', at: '2026-10-29T09:00:00Z', kind: 'note', actor: 'Sally' },
        { id: `${tag}-ac-otto`, customerId: id.otto, body: 'Otto paid', at: '2026-10-28T09:00:00Z', kind: 'payment', actor: 'Olive' },
      ] as any },
      { accountId, key: 'fencepro_jobcosting', value: [
        { id: `${tag}-jc-cleo-draft`, quoteId: id.qCleoDraft, laborCents: 120000, materialCents: 340000 },
        { id: `${tag}-jc-dina`, quoteId: id.qDina, laborCents: 60000, materialCents: 100000 },
        { id: `${tag}-jc-mina`, quoteId: id.qMina, laborCents: 50000, materialCents: 90000 },
      ] as any },
    ] })

    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/crm-contacts', salesScoped('contacts')); app.use('/api/saved-jobs', salesScoped('jobs')); app.use('/api/saved-quotes', salesScoped('quotes'))
    app.use('/api/crm-contacts', contacts); app.use('/api/saved-jobs', jobs); app.use('/api/saved-quotes', quotes)
    app.use('/api/lead-assign', leadAssign); app.use('/api/follow-ups', followUps)
    app.use('/api/business-state', business); app.use('/api/kv', kv)
    app.use('/api/pipeline', salesScoped('pipeline')); app.use('/api/pipeline', pipeline)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.cardFollowUp.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.appointment.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const idsOf = (list: any[]) => (Array.isArray(list) ? list.map(x => x.id) : [])
  /** Exactly what Sally's phone has: her customers, quotes and jobs (lists), each also checked opened by id. */
  const sallySees = async () => {
    const [c, q, j] = await Promise.all([call('GET', '/api/crm-contacts', tok.sally), call('GET', '/api/saved-quotes', tok.sally), call('GET', '/api/saved-jobs', tok.sally)])
    const mine = (list: any[]) => idsOf(list).filter(x => Object.values(id).includes(x))
    const name = (x: string) => Object.entries(id).find(([, v]) => v === x)![0]
    const out = { customers: mine(c.json.data).map(name).sort(), quotes: mine(q.json.data).map(name).sort(), jobs: mine(j.json.data).map(name).sort() }
    // Opened by id: the same answer as the lists.
    for (const [kind, path, keys] of [['customers', 'crm-contacts', ['cleo', 'dina', 'fay', 'mina', 'otto']], ['quotes', 'saved-quotes', ['qCleoDraft', 'qCleoSent', 'qCleoSigned', 'qDina', 'qFay', 'qMina', 'qOtto']], ['jobs', 'saved-jobs', ['jCleo', 'jFay']]] as const) {
      for (const k of keys) {
        // A customer by its notes (the History); a quote or job by itself.
        const r = await call('GET', `/api/${path}/${id[k]}${path === 'crm-contacts' ? '/notes' : ''}`, tok.sally)
        expect([k, r.status]).toEqual([k, (out as any)[kind].includes(k) ? 200 : 404])
      }
    }
    return out
  }
  const businessRows = async (col: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; t: string }>>(`SELECT e->>'id' AS id, e::text AS t FROM "BusinessState" b, jsonb_array_elements(b."${col}") e WHERE b."accountId" = $1`, accountId)
    return new Map(rows.map(r => [r.id, r.t]))
  }
  const checklistsRaw = async () => (await prisma.$queryRawUnsafe<Array<{ t: string }>>(`SELECT b."jobChecklists"::text AS t FROM "BusinessState" b WHERE b."accountId" = $1`, accountId))[0]?.t
  const kvRows = async (key: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; t: string }>>(`SELECT e->>'id' AS id, e::text AS t FROM "AccountKeyValue" k, jsonb_array_elements(k.value) e WHERE k."accountId" = $1 AND k.key = $2`, accountId, key)
    return new Map(rows.map(r => [r.id, r.t]))
  }

  // The phone's copies, read before any move.
  let phoneBiz: any, phoneKv: any
  let stored: Record<string, Map<string, string>> = {}
  let storedChecklists = ''

  test('before: Sally sees her customers, the quotes she wrote and the jobs she sold; never Otto', async () => {
    expect(await sallySees()).toEqual({
      customers: ['cleo', 'dina', 'fay', 'mina'],
      quotes: ['qCleoDraft', 'qCleoSent', 'qCleoSigned', 'qDina', 'qFay', 'qMina'],
      jobs: ['jCleo', 'jFay'],
    })
    phoneBiz = (await call('GET', '/api/business-state', tok.sally)).json.data
    phoneKv = (await call('GET', '/api/kv', tok.sally)).json
    expect(idsOf(phoneBiz.invoices)).toEqual([`${tag}-inv-cleo`, `${tag}-inv-fay`, `${tag}-inv-mina`])
    expect(idsOf(phoneKv.data.fencepro_customer_activity)).toEqual([`${tag}-ac-cleo`, `${tag}-ac-fay`, `${tag}-ac-dina`])
    for (const col of ['invoices', 'payments', 'pullSheets', 'pendingOrders']) stored[col] = await businessRows(col)
    stored.activity = await kvRows('fencepro_customer_activity')
    stored.jobcosting = await kvRows('fencepro_jobcosting')
    storedChecklists = (await checklistsRaw())!
  })

  test('1. the owner moves Cleo to Sam: her unsold quotes leave Sally\'s list (even the ones she wrote); the signed one and its job stay, and keep Cleo on her list', async () => {
    const r = await call('POST', `/api/lead-assign/${id.cleo}`, tok.owner, { to: id.sam, replace: true })
    expect(r.status).toBe(200)
    expect(r.json.data.quotesMoved).toBe(2)
    expect(await sallySees()).toEqual({
      customers: ['cleo', 'dina', 'fay', 'mina'],
      quotes: ['qCleoSigned', 'qDina', 'qFay', 'qMina'],
      jobs: ['jCleo', 'jFay'],
    })
    // Nothing of the moved quotes reaches her phone: not the price, the cost or the margin.
    const list = JSON.stringify((await call('GET', '/api/saved-quotes', tok.sally)).json)
    for (const k of ['qCleoDraft', 'qCleoSent']) expect(list).not.toContain(id[k])
    // Sam has them.
    for (const k of ['qCleoDraft', 'qCleoSent']) expect((await call('GET', `/api/saved-quotes/${id[k]}`, tok.sam)).status).toBe(200)
    // Cleo's open card (for the draft, now Sam's) left Sally's board with it, price and all; her won card on Fay is still there.
    const board = await call('GET', '/api/pipeline', tok.sally)
    expect(board.status).toBe(200)
    const cards = [...(board.json.data.leads ?? []), ...(board.json.data.archivedLeads ?? [])].map((k: any) => k.id)
    expect(cards).not.toContain(`${tag}-k-cleo`)
    expect(cards).toContain(`${tag}-k-fay`)
  })

  test('2. the owner moves Dina\'s unsold quote to Sam: it leaves Sally; Dina (still her customer) stays', async () => {
    const r = await call('POST', `/api/saved-quotes/${id.qDina}/salesman`, tok.owner, { to: id.sam })
    expect(r.status).toBe(200)
    expect(await sallySees()).toEqual({
      customers: ['cleo', 'dina', 'fay', 'mina'],
      quotes: ['qCleoSigned', 'qFay', 'qMina'],
      jobs: ['jCleo', 'jFay'],
    })
  })

  test('3. the owner moves Fay\'s signed quote to Sam (its commission with it): the quote, its job and Fay leave Sally; her won card on Fay is not shown; Fay\'s History is a 404', async () => {
    expect((await call('POST', `/api/saved-jobs/${id.jFay}/salesman`, tok.owner, { to: id.sam })).json.code).toBe('CONFIRM_SIGNED')
    expect((await call('POST', `/api/saved-jobs/${id.jFay}/salesman`, tok.owner, { to: id.sam, confirm: true })).status).toBe(200)
    expect(await sallySees()).toEqual({
      customers: ['cleo', 'dina', 'mina'],
      quotes: ['qCleoSigned', 'qMina'],
      jobs: ['jCleo'],
    })
    expect((await call('GET', `/api/follow-ups/history?customerId=${id.fay}`, tok.sally)).status).toBe(404)
    expect((await call('GET', `/api/follow-ups/history?customerId=${id.cleo}`, tok.sally)).status).toBe(200)
    expect((await call('GET', `/api/follow-ups/history?cardId=${tag}-k-fay`, tok.sally)).status).toBe(404)
    const board = await call('GET', '/api/pipeline', tok.sally)
    expect([...(board.json.data.leads ?? []), ...(board.json.data.archivedLeads ?? [])].map((k: any) => k.id)).not.toContain(`${tag}-k-fay`)
  })

  test('4. her phone\'s save, built on its copy from before the moves, at the same time as the office\'s: every entry she no longer sees stays byte for byte; the office\'s change lands', async () => {
    // Sally's phone saves its whole copy: the invoices and payments as it read them (it cannot change billing; Fay's
    // invoice and payment are on its copy, Otto's are not), a new pull sheet for Mina, a note on every Sales Order it
    // holds (Fay's, no longer hers, too), Cleo's draft's pull sheet left out, and only Cleo's job milestones (Fay's left out).
    const newPs = { id: `${tag}-ps-mina2`, customerId: id.mina, quoteId: id.qMina, customerName: `mina ${tag}`, versionNumber: 2 }
    const sallyPatch = (d: any) => ({
      invoices: d.invoices,
      payments: d.payments,
      pullSheets: [newPs, ...d.pullSheets.filter((x: any) => x.id !== `${tag}-ps-cleo-draft`)],
      pendingOrders: d.pendingOrders.map((x: any) => ({ ...x, notes: 'from the phone' })),
      jobChecklists: { [id.jCleo]: [{ id: 'm1', label: 'Permit', isComplete: false }] },
    })
    expect(idsOf(phoneBiz.payments)).toEqual([`${tag}-pay-cleo`, `${tag}-pay-fay`])
    expect(Object.keys(phoneBiz.jobChecklists).sort()).toEqual([id.jCleo, id.jFay].sort())
    // The office, on a fresh copy: marks Otto's invoice and Fay's Sales Order.
    const officeRead = (await call('GET', '/api/business-state', tok.office)).json.data
    const officePatch = {
      invoices: officeRead.invoices.map((x: any) => x.id === `${tag}-inv-otto` ? { ...x, note: 'office' } : x),
      pendingOrders: officeRead.pendingOrders.map((x: any) => x.id === `${tag}-so-fay` ? { ...x, status: 'received' } : x),
      baseVersion: officeRead.version,
    }
    const [a, b] = await Promise.all([call('PATCH', '/api/business-state', tok.sally, { ...sallyPatch(phoneBiz), baseVersion: phoneBiz.version }), call('PATCH', '/api/business-state', tok.office, officePatch)])
    // Both read the same version: one saves, the other is handed the newer copy (409).
    expect([a.status, b.status].sort()).toEqual([200, 409])
    // The one refused puts its change on the 409's copy and saves again (web versionedDoc.ts).
    if (b.status === 409) {
      const d = b.json.data
      const r = await call('PATCH', '/api/business-state', tok.office, {
        invoices: d.invoices.map((x: any) => x.id === `${tag}-inv-otto` ? { ...x, note: 'office' } : x),
        pendingOrders: d.pendingOrders.map((x: any) => x.id === `${tag}-so-fay` ? { ...x, status: 'received' } : x),
        baseVersion: b.json.version,
      })
      expect(r.status).toBe(200)
    }
    if (a.status === 409) {
      const d = a.json.data
      const r = await call('PATCH', '/api/business-state', tok.sally, { ...sallyPatch(d), baseVersion: a.json.version })
      expect(r.status).toBe(200)
    }
    const now: Record<string, Map<string, string>> = {}
    for (const col of ['invoices', 'payments', 'pullSheets', 'pendingOrders']) now[col] = await businessRows(col)
    // Every entry of a customer, quote or job Sally no longer has (Fay; Cleo's moved draft) and of Otto: byte for byte.
    const gone = new RegExp(`-(fay|otto|cleo-draft)$`)
    for (const col of ['invoices', 'payments', 'pullSheets', 'pendingOrders']) {
      for (const [k, t] of stored[col]) {
        if (!gone.test(k)) continue
        if (k === `${tag}-inv-otto`) { expect(JSON.parse(now[col].get(k)!).note).toBe('office'); continue }
        if (k === `${tag}-so-fay`) { expect(JSON.parse(now[col].get(k)!).status).toBe('received'); continue }
        expect([col, k, now[col].get(k)]).toEqual([col, k, t])
      }
    }
    // The office's change to Otto: only the note added, the rest as stored.
    expect({ ...JSON.parse(now.invoices.get(`${tag}-inv-otto`)!), note: undefined }).toEqual({ ...JSON.parse(stored.invoices.get(`${tag}-inv-otto`)!), note: undefined })
    // Every invoice and payment of every customer: as stored (only the office's note on Otto's).
    for (const col of ['invoices', 'payments']) {
      expect([...now[col].keys()]).toEqual([...stored[col].keys()])
      for (const [k, t] of stored[col]) if (k !== `${tag}-inv-otto`) expect([col, k, now[col].get(k)]).toEqual([col, k, t])
    }
    expect(JSON.parse(now.pendingOrders.get(`${tag}-so-fay`)!).notes).toBe('fay')
    // Fay's job milestones: hers no more, kept exactly.
    const lists = JSON.parse((await checklistsRaw())!)
    expect(lists[id.jFay]).toEqual(JSON.parse(storedChecklists)[id.jFay])
    expect(lists[id.jCleo]).toEqual([{ id: 'm1', label: 'Permit', isComplete: false }])
    // Fay's Sales Order: the office's change, not the phone's note.
    expect(JSON.parse(now.pendingOrders.get(`${tag}-so-fay`)!)).toEqual({ ...JSON.parse(stored.pendingOrders.get(`${tag}-so-fay`)!), status: 'received' })
    // What is still hers took her change: Mina's new pull sheet, Cleo's signed Sales Order.
    expect(now.pullSheets.has(`${tag}-ps-mina2`)).toBe(true)
    expect(JSON.parse(now.pendingOrders.get(`${tag}-so-cleo`)!).notes).toBe('from the phone')
    // Pull sheets are only ever added to: Cleo's draft's stays (and it is not hers to remove anyway).
    expect(now.pullSheets.get(`${tag}-ps-cleo-draft`)).toBe(stored.pullSheets.get(`${tag}-ps-cleo-draft`))
  })

  test('4. kv across the moves: activity of Fay and job costing of the moved quotes stay byte for byte; her own entries take her change', async () => {
    const note = { id: `${tag}-ac-mina`, customerId: id.mina, body: 'Sent Mina the quote', at: '2026-10-29T12:00:00Z', kind: 'quote', actor: 'Sally' }
    const ac = await call('PUT', '/api/kv/fencepro_customer_activity', tok.sally, { value: [note], baseVersion: phoneKv.versions.fencepro_customer_activity })
    expect(ac.status).toBe(200)
    const ac1 = await kvRows('fencepro_customer_activity')
    for (const [k, t] of stored.activity) expect([k, ac1.get(k)]).toEqual([k, t])
    expect(ac1.has(`${tag}-ac-mina`)).toBe(true)
    // Job costing: the phone clears its list. Cleo's draft and Dina's quote moved: their lines stay; Mina's (hers) goes.
    const jc = await call('PUT', '/api/kv/fencepro_jobcosting', tok.sally, { value: [], baseVersion: phoneKv.versions.fencepro_jobcosting })
    expect(jc.status).toBe(200)
    const jc1 = await kvRows('fencepro_jobcosting')
    expect(jc1.get(`${tag}-jc-cleo-draft`)).toBe(stored.jobcosting.get(`${tag}-jc-cleo-draft`))
    expect(jc1.get(`${tag}-jc-dina`)).toBe(stored.jobcosting.get(`${tag}-jc-dina`))
    expect(jc1.has(`${tag}-jc-mina`)).toBe(false)
  })

  test('her phone after the moves: the next load has none of what left, with no error; saving that copy again changes nothing of theirs and brings nothing back', async () => {
    const biz = await call('GET', '/api/business-state', tok.sally)
    expect(biz.status).toBe(200)
    const all = JSON.stringify(biz.json.data)
    expect(all).not.toContain(id.fay)
    expect(all).not.toContain(id.qCleoDraft)
    expect(all).not.toContain(id.otto)
    expect(Object.keys(biz.json.data.jobChecklists)).toEqual([id.jCleo])
    const k = await call('GET', '/api/kv', tok.sally)
    expect(idsOf(k.json.data.fencepro_customer_activity).sort()).toEqual([`${tag}-ac-cleo`, `${tag}-ac-dina`, `${tag}-ac-mina`].sort())
    expect(idsOf(k.json.data.fencepro_jobcosting)).toEqual([])
    const before = { inv: await businessRows('invoices'), ps: await businessRows('pullSheets'), so: await businessRows('pendingOrders'), ac: await kvRows('fencepro_customer_activity') }
    const d = biz.json.data
    const again = await call('PATCH', '/api/business-state', tok.sally, { invoices: d.invoices, payments: d.payments, pullSheets: d.pullSheets, pendingOrders: d.pendingOrders, jobChecklists: d.jobChecklists, baseVersion: d.version })
    expect(again.status).toBe(200)
    const kv2 = await call('PUT', '/api/kv/fencepro_customer_activity', tok.sally, { value: k.json.data.fencepro_customer_activity, baseVersion: k.json.versions.fencepro_customer_activity })
    expect(kv2.status).toBe(200)
    expect(await businessRows('invoices')).toEqual(before.inv)
    expect(await businessRows('pullSheets')).toEqual(before.ps)
    expect(await businessRows('pendingOrders')).toEqual(before.so)
    expect(await kvRows('fencepro_customer_activity')).toEqual(before.ac)
    // An entry for a customer that left her is refused (404), never saved.
    const sneak = await call('PUT', '/api/kv/fencepro_customer_activity', tok.sally, { value: [{ id: `${tag}-ac-sneak`, customerId: id.fay, body: 'x', at: '2026-10-29T13:00:00Z', kind: 'note' }, ...k.json.data.fencepro_customer_activity], baseVersion: kv2.json.version ?? k.json.versions.fencepro_customer_activity + 1 })
    expect([404, 409]).toContain(sneak.status)
    expect((await kvRows('fencepro_customer_activity')).has(`${tag}-ac-sneak`)).toBe(false)
    // The moved quotes and job stay Sam's; nothing Sally did brought one back.
    const reps = await prisma.savedQuote.findMany({ where: { id: { in: [id.qCleoDraft, id.qCleoSent, id.qDina, id.qFay] } }, select: { salesRep: true } })
    expect(reps.map(r => r.salesRep)).toEqual([SAM(), SAM(), SAM(), SAM()])
    expect((await prisma.savedJob.findUnique({ where: { id: id.jFay } }))!.salesRep).toBe(SAM())
    expect(await sallySees()).toEqual({ customers: ['cleo', 'dina', 'mina'], quotes: ['qCleoSigned', 'qMina'], jobs: ['jCleo'] })
  })

  test('the owner moves Cleo\'s signed quote too: Cleo leaves Sally entirely (nothing of hers keeps the customer)', async () => {
    expect((await call('POST', `/api/saved-quotes/${id.qCleoSigned}/salesman`, tok.owner, { to: id.sam, confirm: true })).status).toBe(200)
    expect(await sallySees()).toEqual({ customers: ['dina', 'mina'], quotes: ['qMina'], jobs: [] })
    expect((await call('GET', `/api/follow-ups/history?customerId=${id.cleo}`, tok.sally)).status).toBe(404)
    const k = await call('GET', '/api/kv', tok.sally)
    expect(idsOf(k.json.data.fencepro_customer_activity).sort()).toEqual([`${tag}-ac-dina`, `${tag}-ac-mina`].sort())
  })
})
