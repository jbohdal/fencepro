/**
 * D3 (Jonathan, Oct 29 2026): "Yes, unsold quotes and their commission move
 * with the customer. Signed jobs stay with whoever sold them."
 * (lib/quotesFollowCustomer.ts.) Against the dev database (DEV_DB=1; refuses
 * any other), on a throwaway company, through the same middleware order as
 * index.ts: the customer page's Change (POST /api/lead-assign/:id), the
 * customer edit (PATCH /api/crm-contacts/:id), the Salesman scope, a stale
 * quote save, the History, and what the phones hold (kv put back).
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('open quotes move with the customer\'s Salesman (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped, forgetAllScopes } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: leadAssign } = await import('../src/server/routes/lead-assign.js')
  const { default: followUps } = await import('../src/server/routes/follow-ups.js')
  const { default: kv } = await import('../src/server/routes/kv.js')
  const { quoteCommissionCents } = await import('../src/server/lib/quotesFollowCustomer.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `qfc-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', office = '', sally = '', sam = ''
  const id: Record<string, string> = {}
  let server: ReturnType<express.Express['listen']>
  const SALLY = () => `Sally ${tag}`, SAM = () => `Sam ${tag}`, OLIVE = () => `Olive ${tag}`

  // The reviewer's quote: $13,407, Salesman on, $1,206.63 commission (9%) out of the price.
  const PRICE = 13407, COGS = 7000, COMMISSION = 1206.63
  const GM = (PRICE - COGS - COMMISSION) / PRICE

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = (firstName: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const sign = (u: { id: string; email: string }, role: string) => jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const o = await user('Olive', 'super_admin'); owner = sign(o, 'super_admin'); id.owner = o.id
    const f = await user('Opal', 'office_staff'); office = sign(f, 'office_staff'); id.office = f.id
    const s = await user('Sally', 'sales_rep'); sally = sign(s, 'sales_rep'); id.sally = s.id
    const s2 = await user('Sam', 'sales_rep'); sam = sign(s2, 'sales_rep'); id.sam = s2.id

    // Gwen: the owner entered her for Sally.
    id.gwen = (await prisma.crmContact.create({ data: { accountId, firstName: 'Gwen', lastName: tag, ownerId: o.id, salesRep: SALLY() } })).id
    id.hank = (await prisma.crmContact.create({ data: { accountId, firstName: 'Hank', lastName: tag, ownerId: o.id, salesRep: SALLY() } })).id
    const quote = (data: any) => prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', crmContactId: id.gwen, customerName: `Gwen ${tag}`, salesRep: SALLY(), ownerId: o.id, ...data } }).then(q => q.id)
    id.qDraft = await quote({ status: 'DRAFT', finalPrice: PRICE, totalCOGS: COGS, gmPct: GM, hasSalesman: true })
    id.qSentBySally = await quote({ status: 'SENT', ownerId: s.id, finalPrice: 5000, totalCOGS: 3000, gmPct: 0.4, shareToken: `${tag}-share` })
    id.qSold = await quote({ status: 'SOLD', soldAt: new Date(), finalPrice: 9000, totalCOGS: 5000, gmPct: 0.35, hasSalesman: true })
    id.qAccepted = await quote({ status: 'SENT', acceptedAt: new Date(), finalPrice: 7000, totalCOGS: 4000, gmPct: 0.33, hasSalesman: true })
    id.qWithJob = await quote({ status: 'DRAFT', finalPrice: 6000, totalCOGS: 3500, gmPct: 0.32, hasSalesman: true })
    id.qLost = await quote({ status: 'LOST', finalPrice: 4000, totalCOGS: 2500, gmPct: 0.3 })
    id.qDeleted = await quote({ status: 'DRAFT', deletedAt: new Date(), finalPrice: 3000 })
    id.qHank = await quote({ crmContactId: id.hank, customerName: `Hank ${tag}`, status: 'DRAFT', finalPrice: 8000 })
    id.job = (await prisma.savedJob.create({ data: { accountId, quoteId: id.qWithJob, crmContactId: id.gwen, customerName: `Gwen ${tag}`, salesRep: SALLY(), quotePrice: 6000, contractValue: 6000, gmPct: 0.32 } })).id
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [
      { id: `${tag}-k-gwen`, stage: 'new_lead', firstName: 'Gwen', lastName: tag, customerId: id.gwen, quoteId: id.qDraft, assignedRep: SALLY() },
    ] } as any })
    // Job costing lines tied to quotes (a per quote list both phones read and save back whole).
    await prisma.accountKeyValue.create({ data: { accountId, key: 'fencepro_jobcosting', value: [
      { id: `${tag}-jc-draft`, quoteId: id.qDraft, laborCents: 120000, materialCents: 340000 },
      { id: `${tag}-jc-hank`, quoteId: id.qHank, laborCents: 50000, materialCents: 90000 },
    ] as any } })

    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/crm-contacts', salesScoped('contacts')); app.use('/api/saved-quotes', salesScoped('quotes'))
    app.use('/api/crm-contacts', contacts); app.use('/api/saved-quotes', quotes)
    app.use('/api/lead-assign', leadAssign); app.use('/api/follow-ups', followUps); app.use('/api/kv', kv)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.cardFollowUp.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
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
  const quoteRows = async () => new Map((await prisma.savedQuote.findMany({ where: { accountId } })).map(q => [q.id, q]))
  const seesQuote = async (token: string, quoteId: string) => {
    const list = await call('GET', '/api/saved-quotes', token)
    const inList = (list.json.data as any[]).some(q => q.id === quoteId)
    expect((await call('GET', `/api/saved-quotes/${quoteId}`, token)).status === 200).toBe(inList)
    return inList
  }
  const kvRows = async (key: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; t: string }>>(`SELECT e->>'id' AS id, e::text AS t FROM "AccountKeyValue" k, jsonb_array_elements(k.value) e WHERE k."accountId" = $1 AND k.key = $2`, accountId, key)
    return new Map(rows.map(r => [r.id, r.t]))
  }

  test('the reviewer\'s quote carries $1,206.63 commission, as the app shows it', async () => {
    const q = (await quoteRows()).get(id.qDraft)!
    expect(quoteCommissionCents(q)).toBe(120663)
  })

  let before: Map<string, any>
  let sallyKv: any, samKv: any, sallyStaleDraft: any, sallyStaleSent: any, ownerStaleDraft: any
  test('the owner changes Gwen from Sally to Sam: her open quotes (draft and sent) go to Sam; sold, accepted, with a job, lost, deleted and Hank\'s stay', async () => {
    before = await quoteRows()
    // The phones read first: Sally's copies (job costing, the quotes), Sam's job costing; the owner's tab has the draft open.
    expect(await seesQuote(sally, id.qDraft)).toBe(true)
    expect(await seesQuote(sam, id.qDraft)).toBe(false)
    sallyKv = (await call('GET', '/api/kv', sally)).json
    samKv = (await call('GET', '/api/kv', sam)).json
    expect(sallyKv.data.fencepro_jobcosting.map((x: any) => x.id)).toEqual([`${tag}-jc-draft`, `${tag}-jc-hank`])
    expect(samKv.data.fencepro_jobcosting).toEqual([])
    sallyStaleDraft = (await call('GET', `/api/saved-quotes/${id.qDraft}`, sally)).json.data
    sallyStaleSent = (await call('GET', `/api/saved-quotes/${id.qSentBySally}`, sally)).json.data
    ownerStaleDraft = (await call('GET', `/api/saved-quotes/${id.qDraft}`, owner)).json.data

    const r = await call('POST', `/api/lead-assign/${id.gwen}`, owner, { to: id.sam, replace: true })
    expect(r.status).toBe(200)
    expect(r.json.data.assignedTo).toBe(SAM())
    expect(r.json.data.quotesMoved).toBe(2)

    const after = await quoteRows()
    expect(after.get(id.qDraft)!.salesRep).toBe(SAM())
    expect(after.get(id.qSentBySally)!.salesRep).toBe(SAM())
    for (const k of ['qSold', 'qAccepted', 'qWithJob', 'qLost', 'qDeleted', 'qHank']) expect([k, after.get(id[k])!.salesRep]).toEqual([k, SALLY()])
    // The sold job keeps who sold it.
    expect((await prisma.savedJob.findUnique({ where: { id: id.job } }))!.salesRep).toBe(SALLY())
    // Nothing else on any quote changed: the customer's price, cost, margin, the commission switch, the status.
    for (const [qid, q] of after) {
      const was = before.get(qid)!
      expect([qid, q.finalPrice, q.totalCOGS, q.gmPct, q.hasSalesman, q.status]).toEqual([qid, was.finalPrice, was.totalCOGS, was.gmPct, was.hasSalesman, was.status])
    }
    // The commission moves with the quote: the same $1,206.63, now under Sam (what Sales by rep and the board group by).
    expect(quoteCommissionCents(after.get(id.qDraft)!)).toBe(120663)
    // The open card goes with the customer.
    const board = await prisma.pipelineState.findUnique({ where: { accountId } }) as any
    expect(board.leads.find((l: any) => l.customerId === id.gwen).assignedRep).toBe(SAM())
    // The audit log has the quotes, prices and commission moved.
    const log = await prisma.crmAuditLog.findFirst({ where: { userId: id.owner, entityId: id.gwen }, orderBy: { createdAt: 'desc' } }) as any
    const moved = (log?.newValues as any)?.quotesMoved ?? []
    expect(moved.map((m: any) => [m.id, m.from, m.to, m.priceCents, m.commissionCents]).sort()).toEqual([
      [id.qDraft, SALLY(), SAM(), 1340700, 120663],
      [id.qSentBySally, SALLY(), SAM(), 500000, 0],
    ].sort())
  })

  test('the History says the quotes moved, with no money; the owner, and Sam, read it', async () => {
    for (const token of [owner, sam]) {
      const h = await call('GET', `/api/follow-ups/history?customerId=${id.gwen}`, token)
      expect(h.status).toBe(200)
      const line = (h.json.data as any[]).find(x => x.title === 'Quotes moved')
      expect(line?.detail).toBe(`Open quotes moved to ${SAM()} with the customer by ${OLIVE()}: 2 quotes not sold yet, they were ${SALLY()}'s. Signed jobs stay with whoever sold them.`)
      expect(line.detail).not.toMatch(/\$|commission/i)
    }
  })

  test('scope: Sam has the moved quotes on the next request; Sally no longer has them, not even the one she wrote; she keeps the ones still hers', async () => {
    expect(await seesQuote(sam, id.qDraft)).toBe(true)
    expect(await seesQuote(sam, id.qSentBySally)).toBe(true)
    expect(await seesQuote(sally, id.qDraft)).toBe(false)
    // Jonathan, Oct 29 2026: "Christa's quotes after a move: unsold ones leave her list. Signed ones she sold stay with her."
    expect(await seesQuote(sally, id.qSentBySally)).toBe(false)
    expect(await seesQuote(sally, id.qHank)).toBe(true)
    for (const k of ['qSold', 'qAccepted', 'qWithJob', 'qLost']) expect([k, await seesQuote(sally, id[k])]).toEqual([k, true])
  })

  test('older copies saved afterwards keep everything else but never take a quote back to Sally', async () => {
    // The owner's tab, open on the draft from before the change.
    const o = await call('PATCH', `/api/saved-quotes/${id.qDraft}`, owner, { ...ownerStaleDraft, notes: 'gate on the left' })
    expect(o.status).toBe(200)
    let q = (await quoteRows()).get(id.qDraft)!
    expect([q.salesRep, q.notes, q.finalPrice]).toEqual([SAM(), 'gate on the left', PRICE])
    // Sally's phone: neither the draft nor the quote she wrote is hers any more (404, nothing saved, Sam kept).
    expect((await call('PATCH', `/api/saved-quotes/${id.qDraft}`, sally, { ...sallyStaleDraft, notes: 'sally was here' })).status).toBe(404)
    expect((await quoteRows()).get(id.qDraft)!.notes).toBe('gate on the left')
    const sentBefore = (await quoteRows()).get(id.qSentBySally)!
    const s = await call('PATCH', `/api/saved-quotes/${id.qSentBySally}`, sally, { ...sallyStaleSent, salesRep: SALLY(), notes: 'called her back' })
    expect(s.status).toBe(404)
    q = (await quoteRows()).get(id.qSentBySally)!
    expect([q.salesRep, q.notes, q.finalPrice]).toEqual([SAM(), sentBefore.notes, 5000])
  })

  test('what the phones held is put back: Sally\'s empty save and Sam\'s older copy leave the draft\'s job costing line byte for byte', async () => {
    const jc0 = await kvRows('fencepro_jobcosting')
    // Sally's phone clears its list (the draft's line is no longer hers; Hank's is, and goes).
    const a = await call('PUT', '/api/kv/fencepro_jobcosting', sally, { value: [], baseVersion: sallyKv.versions.fencepro_jobcosting })
    expect(a.status).toBe(200)
    let jc1 = await kvRows('fencepro_jobcosting')
    expect(jc1.get(`${tag}-jc-draft`)).toBe(jc0.get(`${tag}-jc-draft`))
    expect(jc1.has(`${tag}-jc-hank`)).toBe(false)
    // Sam's phone, read before the draft was his: saves its copy (none of the draft's) with a line of its own.
    const mine = { id: `${tag}-jc-sam`, quoteId: id.qSentBySally, laborCents: 1000, materialCents: 2000 }
    const b = await call('PUT', '/api/kv/fencepro_jobcosting', sam, { value: [...samKv.data.fencepro_jobcosting, mine], baseVersion: samKv.versions.fencepro_jobcosting })
    if (b.status === 409) {
      // The phone's base is older than the save above: the app puts its change on the current copy and saves again.
      const again = await call('PUT', '/api/kv/fencepro_jobcosting', sam, { value: [...b.json.data, mine], baseVersion: b.json.version })
      expect(again.status).toBe(200)
    } else expect(b.status).toBe(200)
    jc1 = await kvRows('fencepro_jobcosting')
    expect(jc1.get(`${tag}-jc-draft`)).toBe(jc0.get(`${tag}-jc-draft`))
    expect(jc1.has(`${tag}-jc-sam`)).toBe(true)
  })

  test('the owner changes the Salesman on the customer edit too (the office no longer can): the open quotes go to the owner with the same commission; sold ones stay', async () => {
    // The office's save (an older copy of the customer, as no office screen changes it): saved, Sam kept, nothing moves.
    const no = await call('PATCH', `/api/crm-contacts/${id.gwen}`, office, { salesRep: OLIVE(), notes: 'office note' })
    expect(no.status).toBe(200)
    expect(no.json.salesRepKept).toBe(true)
    const gwen = await prisma.crmContact.findUnique({ where: { id: id.gwen } })
    expect([gwen!.salesRep, gwen!.notes]).toEqual([SAM(), 'office note'])
    expect((await quoteRows()).get(id.qDraft)!.salesRep).toBe(SAM())
    const r = await call('PATCH', `/api/crm-contacts/${id.gwen}`, owner, { salesRep: OLIVE() })
    expect(r.status).toBe(200)
    const after = await quoteRows()
    expect(after.get(id.qDraft)!.salesRep).toBe(OLIVE())
    expect(after.get(id.qSentBySally)!.salesRep).toBe(OLIVE())
    expect(after.get(id.qSold)!.salesRep).toBe(SALLY())
    expect([after.get(id.qDraft)!.finalPrice, after.get(id.qDraft)!.gmPct, after.get(id.qDraft)!.hasSalesman]).toEqual([PRICE, GM, true])
    expect(quoteCommissionCents(after.get(id.qDraft)!)).toBe(120663)
    forgetAllScopes()
    expect(await seesQuote(sam, id.qDraft)).toBe(false)
    const notes = await prisma.crmContactNote.findMany({ where: { crmContactId: id.gwen, body: { startsWith: 'Open quotes moved to ' } }, orderBy: { createdAt: 'asc' } })
    expect(notes.map(n => n.body)).toEqual([
      `Open quotes moved to ${SAM()} with the customer by ${OLIVE()}: 2 quotes not sold yet, they were ${SALLY()}'s. Signed jobs stay with whoever sold them.`,
      `Open quotes moved to ${OLIVE()} with the customer by ${OLIVE()}: 2 quotes not sold yet, they were ${SAM()}'s. Signed jobs stay with whoever sold them.`,
    ])
  })

  test('the same Salesman again moves nothing and writes no History line', async () => {
    const r = await call('POST', `/api/lead-assign/${id.gwen}`, owner, { to: id.owner, replace: true })
    expect(r.status).toBe(200)
    expect(r.json.data.already).toBe(true)
    expect(r.json.data.quotesMoved).toBe(0)
    expect(await prisma.crmContactNote.count({ where: { crmContactId: id.gwen, body: { startsWith: 'Open quotes moved to ' } } })).toBe(2)
  })
})
