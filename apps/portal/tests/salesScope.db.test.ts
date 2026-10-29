/**
 * The Salesman sees only the Salesman's own quotes and customers plus the
 * ones assigned (lib/salesScope.ts), and the quote list is slim
 * (lib/quoteSlim.ts). Against the dev database (DEV_DB=1; refuses any other),
 * on a throwaway company, through the same middleware order as index.ts.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman\'s scope and the slim quote list (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: pipeline } = await import('../src/server/routes/pipeline.js')
  const { default: followUps } = await import('../src/server/routes/follow-ups.js')
  const { default: matches } = await import('../src/server/routes/customer-matches.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { listTables } = await import('../src/server/lib/listTable.js')
  const { fromTable } = await import('../../web/src/listTable')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `ssc-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', sales = '', salesId = '', ownerId = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}
  const proposal = {
    version: 1, createdAt: '2026-10-20T12:00:00Z', planSvg: `<svg>${'x'.repeat(5000)}</svg>`, recommended: 0, footageFt: 150, gatesText: '1 walk gate',
    included: [], includedNote: '', warranty: '', depositPct: 50, depositNote: '', financing: null,
    company: { name: tag, phone: '', email: '' }, customer: { name: 'Otto', address: '1 Main' },
    options: [
      { label: 'WV ND 6x8', fenceStyle: 'WV ND 6x8', finalPrice: 8409, perFoot: 56.06, sections: 19, snapshot: { materialCost: 3000, laborCost: 1500, tearOutCost: 0, totalCOGS: 4500, gmPct: 0.46, pullSheet: [{ item: 'Post', qty: 21, unitCost: 30, total: 630 }], runRails: ['8ft'], runSections: [19] } },
      { label: 'TV ND 6x8', fenceStyle: 'TV ND 6x8', finalPrice: 9100, perFoot: 60.67, sections: 19, snapshot: { materialCost: 3400, laborCost: 1500, tearOutCost: 0, totalCOGS: 4900, gmPct: 0.46, pullSheet: [{ item: 'Post', qty: 21, unitCost: 34, total: 714 }], runRails: ['8ft'], runSections: [19] } },
    ],
  }

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const o = await prisma.crmUser.create({ data: { email: `${tag}-owner@example.invalid`, firstName: 'Olive', lastName: tag, role: 'super_admin', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const s = await prisma.crmUser.create({ data: { email: `${tag}-sales@example.invalid`, firstName: 'Sally', lastName: tag, role: 'sales_rep', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    ownerId = o.id; salesId = s.id
    owner = jwt.sign({ sub: o.id, email: o.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    sales = jwt.sign({ sub: s.id, email: s.email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const contact = (data: any) => prisma.crmContact.create({ data: { accountId, lastName: tag, ...data } }).then(c => c.id)
    ids.cMine = await contact({ firstName: 'Mina', ownerId: s.id, phone: '3525550201' })
    ids.cOther = await contact({ firstName: 'Otto', ownerId: o.id, salesRep: `Olive ${tag}`, phone: '3525550202', email: `${tag}-otto@example.invalid` })
    ids.cAssigned = await contact({ firstName: 'Ava', ownerId: o.id })
    const quote = (data: any) => prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', ...data } }).then(q => q.id)
    ids.qMine = await quote({ ownerId: s.id, salesRep: `Sally ${tag}`, crmContactId: ids.cMine, customerName: `Mina ${tag}`, finalPrice: 5000 })
    ids.qOther = await quote({ ownerId: o.id, salesRep: `Olive ${tag}`, crmContactId: ids.cOther, customerName: `Otto ${tag}`, finalPrice: 8409, status: 'SENT', proposal })
    ids.qAssigned = await quote({ ownerId: o.id, salesRep: `Sally ${tag}`, crmContactId: ids.cAssigned, customerName: `Ava ${tag}`, finalPrice: 6000 })
    ids.qOtherOnAssigned = await quote({ ownerId: o.id, salesRep: `Olive ${tag}`, crmContactId: ids.cAssigned, customerName: `Ava ${tag}`, finalPrice: 6100 })
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [
      { id: `${tag}-k-mine`, stage: 'Estimating', firstName: 'Mina', lastName: tag, customerId: ids.cMine, assignedRep: 'Sally' },
      { id: `${tag}-k-other`, stage: 'Estimating', firstName: 'Otto', lastName: tag, customerId: ids.cOther, assignedRep: `Olive ${tag}` },
    ] } as any })
    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api', listTables)
    app.use('/api/crm-contacts', salesScoped('contacts')); app.use('/api/saved-quotes', salesScoped('quotes')); app.use('/api/pipeline', salesScoped('pipeline'))
    app.use('/api/crm-contacts', contacts); app.use('/api/saved-quotes', quotes); app.use('/api/pipeline', pipeline)
    app.use('/api/follow-ups', followUps); app.use('/api/customer-matches', matches)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.pipelineState.deleteMany({ where: { accountId } })
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
  const rows = (d: any) => (fromTable(d) as any[])

  test('lists: the Salesman gets only the Salesman\'s own and assigned quotes and customers; the owner everything', async () => {
    const sq = await call('GET', '/api/saved-quotes?shape=table', sales)
    expect(rows(sq.json.data).map(q => q.id).sort()).toEqual([ids.qAssigned, ids.qMine].sort())
    const sc = await call('GET', '/api/crm-contacts', sales)
    expect(sc.json.data.map((c: any) => c.id).sort()).toEqual([ids.cAssigned, ids.cMine].sort())
    const oq = await call('GET', '/api/saved-quotes', owner)
    expect(oq.json.data.map((q: any) => q.id).sort()).toEqual([ids.qMine, ids.qOther, ids.qAssigned, ids.qOtherOnAssigned].sort())
    const oc = await call('GET', '/api/crm-contacts', owner)
    expect(oc.json.data).toHaveLength(3)
  })

  test('one record outside the scope by id is a 404 (read, its notes, a change, a create naming its id); the owner opens it', async () => {
    expect((await call('GET', `/api/saved-quotes/${ids.qOther}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/saved-quotes/${ids.qOtherOnAssigned}`, sales)).status).toBe(404)
    expect((await call('GET', `/api/saved-quotes/${ids.qAssigned}`, sales)).status).toBe(200)
    expect((await call('GET', `/api/crm-contacts/${ids.cOther}/whereabouts`, sales)).status).toBe(404)
    expect((await call('GET', `/api/crm-contacts/${ids.cOther}/notes`, sales)).status).toBe(404)
    expect((await call('GET', `/api/crm-contacts/${ids.cAssigned}/whereabouts`, sales)).json.data.state).toBe('active')
    expect((await call('PATCH', `/api/saved-quotes/${ids.qOther}`, sales, { notes: 'mine now' })).status).toBe(404)
    expect((await call('PATCH', `/api/crm-contacts/${ids.cOther}`, sales, { notes: 'mine now' })).status).toBe(404)
    expect((await call('POST', '/api/saved-quotes', sales, { id: ids.qOther, customerName: 'x' })).status).toBe(404)
    expect((await call('POST', '/api/crm-contacts', sales, { id: ids.cOther, firstName: 'x' })).status).toBe(404)
    const q = await prisma.savedQuote.findUnique({ where: { id: ids.qOther } })
    expect(q!.notes).toBe('')
    expect((await call('GET', `/api/saved-quotes/${ids.qOther}`, owner)).status).toBe(200)
    expect((await call('GET', `/api/crm-contacts/${ids.cOther}/whereabouts`, owner)).json.data.state).toBe('active')
  })

  test('the pipeline and its follow up badges: the Salesman\'s cards only; another card cannot be changed', async () => {
    const p = await call('GET', '/api/pipeline?shape=table', sales)
    expect(rows(p.json.data.leads).map(l => l.id)).toEqual([`${tag}-k-mine`])
    const op = await call('GET', '/api/pipeline', owner)
    expect(op.json.data.leads).toHaveLength(2)
    const b = await call('GET', '/api/follow-ups/board', sales)
    expect(Object.keys(b.json.data.cards)).toEqual([`${tag}-k-mine`])
    expect((await call('GET', `/api/pipeline/cards/${tag}-k-other`, sales)).status).toBe(404)
    const version = op.json.data.version
    const moveOther = await call('PATCH', '/api/pipeline', sales, { upsert: [{ lead: { ...op.json.data.leads[1], stage: 'Lost' } }], remove: [], baseVersion: version })
    expect(moveOther.status).toBe(404)
    // A whole board sent from the Salesman's copy keeps every other card.
    const put = await call('PUT', '/api/pipeline', sales, { leads: [{ ...op.json.data.leads[0], notes: 'called' }], baseVersion: version })
    expect(put.status).toBe(200)
    expect(put.json.data.leads.map((l: any) => l.id)).toEqual([`${tag}-k-mine`])
    const saved = await prisma.pipelineState.findUnique({ where: { accountId } }) as any
    expect(saved.leads.map((l: any) => l.id)).toEqual([`${tag}-k-mine`, `${tag}-k-other`])
    expect(saved.leads[0].notes).toBe('called')
  })

  test('a new customer with someone else\'s phone: saved new, a Possible match for the office, nothing of theirs shown', async () => {
    const id = crypto.randomUUID()
    const r = await call('POST', '/api/crm-contacts', sales, { id, firstName: 'Otto', lastName: 'Again', phone: '(352) 555-0202' })
    expect(r.status).toBe(201)
    expect(r.json.onFileElsewhere).toBe(1)
    expect(r.json.data.phone).toBe('(352) 555-0202')
    // Saved with no Sales rep: the Salesman's, as the Salesman's quote is (review Oct 28 2026).
    expect(r.json.data.salesRep).toBe(`Sally ${tag}`)
    const m = await prisma.customerPossibleMatch.findMany({ where: { accountId, contactId: id } })
    expect(m.map(x => x.matchId)).toEqual([ids.cOther])
    // The Salesman's new customer is the Salesman's; its match with the other customer is not shown to the Salesman.
    expect((await call('GET', `/api/crm-contacts/${id}/whereabouts`, sales)).json.data.state).toBe('active')
    const sv = await call('GET', `/api/customer-matches/customer/${id}`, sales)
    expect(sv.json.data.matches).toEqual([])
    expect(JSON.stringify(sv.json)).not.toContain('555-0202')
    expect((await call('POST', `/api/customer-matches/${m[0].id}/merge`, sales)).status).toBe(404)
    const ov = await call('GET', `/api/customer-matches/customer/${id}`, owner)
    expect(ov.json.data.matches.map((x: any) => x.customer.id)).toEqual([ids.cOther])
    // Opening the other customer's matches as the Salesman: nothing.
    expect((await call('GET', `/api/customer-matches/customer/${ids.cOther}`, sales)).json.data.matches).toEqual([])
  })

  test('the list is whole by default; slim only on ?slim=1; a save of a slim copy changes nothing sent', async () => {
    const whole = await call('GET', '/api/saved-quotes', owner)
    expect(rows(whole.json.data).find(q => q.id === ids.qOther).proposal).toEqual(proposal)
    const list = await call('GET', '/api/saved-quotes?shape=table&slim=1', owner)
    const slim = rows(list.json.data).find(q => q.id === ids.qOther)
    expect(slim.proposal.slim).toBe(true)
    expect(slim.proposal.planSvg).toBeUndefined()
    expect(slim.proposal.options.map((o: any) => o.snapshot)).toEqual([undefined, undefined])
    expect(slim.proposal.options.map((o: any) => o.finalPrice)).toEqual([8409, 9100])
    expect(slim.finalPrice).toBe(8409)
    const full = await call('GET', '/api/saved-quotes', owner)
    expect(full.json.data.find((q: any) => q.id === ids.qOther).proposal).toEqual(proposal)
    const one = await call('GET', `/api/saved-quotes/${ids.qOther}`, owner)
    expect(one.json.data.proposal).toEqual(proposal)

    // An older screen sends the list's slim copy back with a note: the sent proposal is as it was.
    const before = await prisma.savedQuote.findUnique({ where: { id: ids.qOther } })
    const saved = await call('PATCH', `/api/saved-quotes/${ids.qOther}`, owner, { notes: 'called back', proposal: slim.proposal })
    expect(saved.status).toBe(200)
    const after = await prisma.savedQuote.findUnique({ where: { id: ids.qOther } }) as any
    expect(after.notes).toBe('called back')
    expect(after.finalPrice).toBe(before!.finalPrice)
    expect(after.proposal.planSvg).toBe(proposal.planSvg)
    expect(after.proposal.options.map((o: any) => [o.finalPrice, o.snapshot])).toEqual(proposal.options.map(o => [o.finalPrice, o.snapshot]))
    expect(after.proposal.slim).toBeUndefined()
    // A status change with no proposal keeps it too.
    await call('PATCH', `/api/saved-quotes/${ids.qOther}`, owner, { leadTemp: 2 })
    const again = await prisma.savedQuote.findUnique({ where: { id: ids.qOther } }) as any
    expect(again.proposal.planSvg).toBe(proposal.planSvg)
    expect(again.finalPrice).toBe(8409)
    void ownerId; void salesId
  })

  test('a new customer\'s Sales rep: the one sent stays; with none, the Salesman\'s name for the Salesman, none for the owner', async () => {
    const sent = await call('POST', '/api/crm-contacts', sales, { id: crypto.randomUUID(), firstName: 'Rae', lastName: tag, salesRep: `Olive ${tag}` })
    expect(sent.json.data.salesRep).toBe(`Olive ${tag}`)
    const byOwner = await call('POST', '/api/crm-contacts', owner, { id: crypto.randomUUID(), firstName: 'Ola', lastName: tag })
    expect(byOwner.status).toBe(201)
    expect(byOwner.json.data.salesRep ?? null).toBeNull()
  })
})
