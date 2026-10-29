/**
 * Unassigned website and phone leads push the owner with a one tap Assign
 * (lib/leadAssign.ts, routes/lead-assign.ts; Jonathan, Oct 28 2026).
 * Against the dev database (DEV_DB=1; refuses any other), on a throwaway
 * company, through the same middleware order as index.ts. The outbound gate
 * is shut (tests/setup/outboundGate.ts): the push lands in this run's dev
 * outbox file, never on a phone.
 */

import 'dotenv/config'
import crypto from 'crypto'
import fs from 'fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('assigning website and phone leads (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped, salesScope } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: leadAssign } = await import('../src/server/routes/lead-assign.js')
  const { recordIntake } = await import('../src/server/lib/intake.js')
  const { pushNewLead, leadPushesSettled, waitingLeads, newLeadLink } = await import('../src/server/lib/leadAssign.js')
  const { devOutboxFile } = await import('../src/server/lib/outboundGate.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `lap-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', office = '', sales = '', ownerId = '', salesId = '', sales2Id = ''
  let server: ReturnType<express.Express['listen']>

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = (firstName: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const o = await user('Olive', 'super_admin')
    const f = await user('Opal', 'office_staff')
    const s = await user('Sally', 'sales_rep')
    const s2 = await user('Sam', 'sales_rep')
    await user('Ivan', 'field_crew')
    ownerId = o.id; salesId = s.id; sales2Id = s2.id
    const sign = (u: { id: string; email: string }, role: string) => jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = sign(o, 'super_admin'); office = sign(f, 'office_staff'); sales = sign(s, 'sales_rep')
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [] } as any })
    const app = express(); app.use(express.json())
    app.use('/api/crm-contacts', salesScoped('contacts'))
    app.use('/api/crm-contacts', contacts)
    app.use('/api/lead-assign', leadAssign)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.notification.deleteMany({ where: { title: { contains: tag } } }).catch(() => {})
    await prisma.intakeLead.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const outbox = (): Array<{ channel: string; to: string; title: string; body?: string }> => {
    try { return fs.readFileSync(devOutboxFile(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] }
  }
  let leadId = ''
  const n = Math.floor(Math.random() * 9000) + 1000

  test('a new website lead with no rep: one push to the owner, held in the dev outbox; it waits to be assigned', async () => {
    const before = outbox().length
    const r = await recordIntake(accountId, {
      source: 'ez_quote', sourceRef: `${tag}-web`, name: `Dana ${tag}`, phone: `35255${n}01`, email: `${tag}-dana@example.invalid`,
      address: '12 Elm St, Ocala, FL 34470', fenceType: "Vinyl, Privacy, 6', White", feet: 152, summary: 'Website quote (EZ Quote)\n152 ft', leadSource: 'Website Quote', payload: {},
    })
    await leadPushesSettled()
    leadId = r.contactId!
    const mine = outbox().slice(before).filter(l => l.title === `New lead: Dana ${tag}`)
    expect(mine).toHaveLength(1)
    expect(mine[0].channel).toBe('push')
    expect(mine[0].to).toBe(`Olive ${tag}`)
    expect(mine[0].body).toBe(`Website quote · Ocala · Vinyl, Privacy, 6', White, 152 ft. Tap to assign. (/assign-lead?customer=${leadId})`)
    // The bell entry for the lead opens the same Assign screen (review, Oct 28 2026: it opened the customer page).
    const bell = await prisma.notification.findFirst({ where: { title: `Website quote: Dana ${tag}` } })
    expect(bell!.link).toBe(`/assign-lead?customer=${leadId}`)
    // The same delivery again: no second customer, no second push.
    const again = outbox().length
    await recordIntake(accountId, { source: 'ez_quote', sourceRef: `${tag}-web`, name: `Dana ${tag}`, phone: `35255${n}01`, summary: 'x', leadSource: 'Website Quote', payload: {} })
    await leadPushesSettled()
    expect(outbox().length).toBe(again)
    expect((await waitingLeads(accountId)).map(l => l.customerId)).toEqual([leadId])
    const list = await call('GET', '/api/lead-assign', owner)
    expect(list.json.data.leads.map((l: any) => [l.name, l.sourceWords, l.town])).toEqual([[`Dana ${tag}`, 'Website quote', 'Ocala']])
    // The owner first, then each Salesman by name; never the office or the Installer.
    expect(list.json.data.choices.map((c: any) => c.name)).toEqual([`Olive ${tag}`, `Sally ${tag}`, `Sam ${tag}`])
  })

  test('the push carries the Assign buttons and opens the Assign screen (spied sender)', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Ray', lastName: tag, serviceAddress: '9 Oak Rd, Belleview, FL 34420' } })
    const sent: any[] = []
    const r = await pushNewLead(accountId, c.id, { name: `Ray ${tag}`, source: 'retell', address: '9 Oak Rd, Belleview, FL 34420', callbackAt: 'tomorrow 3 pm' }, { allowed: true, send: async (a, msg, ids) => { sent.push({ a, msg, ids }); return { sent: 1, failed: 0, removed: 0, held: 0, subscribers: 1, errors: [] } } })
    expect(r.pushed).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].ids).toEqual([ownerId])
    expect(sent[0].msg.url).toBe(`/assign-lead?customer=${c.id}`)
    expect(sent[0].msg.body).toBe('Phone call · Belleview · call back tomorrow 3 pm. Tap to assign.')
    expect(sent[0].msg.actions).toEqual([{ action: `assign:${ownerId}`, title: 'Assign to Olive' }, { action: `assign:${salesId}`, title: 'Assign to Sally' }])
    await prisma.crmContact.delete({ where: { id: c.id } })
  })

  test('a lead that already has a rep gets no push', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Ann', lastName: tag, salesRep: `Sally ${tag}` } })
    const sent: any[] = []
    const spy = { allowed: true, send: async (...a: any[]) => { sent.push(a); return { sent: 1, failed: 0, removed: 0, held: 0, subscribers: 1, errors: [] } } }
    expect((await pushNewLead(accountId, c.id, { name: 'Ann', source: 'ez_quote' }, spy)).pushed).toBe(false)
    // Its bell entry opens the customer, not the Assign screen.
    expect(await newLeadLink(accountId, c.id, `/customers?customer=${c.id}`)).toBe(`/customers?customer=${c.id}`)
    // A card's rep or an appointment booked with someone counts too.
    const k = await prisma.crmContact.create({ data: { accountId, firstName: 'Kim', lastName: tag } })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [{ id: `${tag}-k-kim`, stage: 'new', customerId: k.id, assignedRep: 'Sam', firstName: 'Kim' }] as any } })
    expect((await pushNewLead(accountId, k.id, { name: 'Kim', source: 'ez_quote' }, spy)).pushed).toBe(false)
    expect(sent).toHaveLength(0)
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [] as any } })
    await prisma.crmContact.deleteMany({ where: { id: { in: [c.id, k.id] } } })
  })

  test('the Salesman, and the Installer\'s kind of login, cannot assign', async () => {
    const r = await call('POST', `/api/lead-assign/${leadId}`, sales, { to: salesId })
    expect(r.status).toBe(403)
    expect((await call('GET', '/api/lead-assign', sales)).status).toBe(403)
    expect((await prisma.crmContact.findUnique({ where: { id: leadId } }))!.salesRep).toBeNull()
  })

  test('one tap assigns: rep on the customer and the card, a History note, and the Salesman has it at once', async () => {
    // The card the office's phone made for the lead.
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [{ id: `intake-${tag}`, stage: 'new', customerId: leadId, assignedRep: '', firstName: 'Dana', lastName: tag }] as any } })
    // Not the Salesman's yet (and the Salesman's scope is now remembered for a few seconds).
    expect((await call('GET', `/api/crm-contacts/${leadId}/whereabouts`, sales)).status).toBe(404)
    const r = await call('POST', `/api/lead-assign/${leadId}`, office, { to: salesId })
    expect(r.status).toBe(200)
    expect(r.json.data).toEqual({ assignedTo: `Sally ${tag}`, already: false, cardIds: [`intake-${tag}`], quotesMoved: 0 })
    expect((await prisma.crmContact.findUnique({ where: { id: leadId } }))!.salesRep).toBe(`Sally ${tag}`)
    const board = await prisma.pipelineState.findUnique({ where: { accountId } })
    expect((board!.leads as any[])[0].assignedRep).toBe(`Sally ${tag}`)
    // In the Salesman's scope right away: the remembered scope was forgotten.
    expect((await call('GET', `/api/crm-contacts/${leadId}/whereabouts`, sales)).status).toBe(200)
    expect((await salesScope(salesId))!.contactIds.has(leadId)).toBe(true)
    const note = await prisma.crmContactNote.findFirst({ where: { crmContactId: leadId, body: { startsWith: 'Lead assigned to ' } } })
    expect(note!.body).toBe(`Lead assigned to Sally ${tag} by Opal ${tag}.`)
    expect(note!.createdById).toBeTruthy()
    expect(await waitingLeads(accountId)).toEqual([])
  })

  test('a lead someone else has is not taken silently: 409 says who and who assigned it; yes moves it', async () => {
    const r = await call('POST', `/api/lead-assign/${leadId}`, owner, { to: sales2Id })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('ALREADY_ASSIGNED')
    expect(r.json.error).toBe(`Already assigned to Sally ${tag} by Opal ${tag}.`)
    expect((await prisma.crmContact.findUnique({ where: { id: leadId } }))!.salesRep).toBe(`Sally ${tag}`)
    // The same person again changes nothing.
    const same = await call('POST', `/api/lead-assign/${leadId}`, owner, { to: salesId })
    expect(same.json.data.already).toBe(true)
    const moved = await call('POST', `/api/lead-assign/${leadId}`, owner, { to: sales2Id, replace: true })
    expect(moved.status).toBe(200)
    expect((await prisma.crmContact.findUnique({ where: { id: leadId } }))!.salesRep).toBe(`Sam ${tag}`)
    expect((await salesScope(salesId))!.contactIds.has(leadId)).toBe(false)
    expect((await salesScope(sales2Id))!.contactIds.has(leadId)).toBe(true)
    const notes = await prisma.crmContactNote.findMany({ where: { crmContactId: leadId, body: { startsWith: 'Lead assigned to ' } }, orderBy: { createdAt: 'asc' } })
    expect(notes.map(x => x.body)).toEqual([`Lead assigned to Sally ${tag} by Opal ${tag}.`, `Lead assigned to Sam ${tag} by Olive ${tag}. It was Sally ${tag}'s.`])
    // Only the owner or a Salesman gets a lead.
    const officeLogin = await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'office_staff' } })
    expect((await call('POST', `/api/lead-assign/${leadId}`, owner, { to: officeLogin!.id, replace: true })).status).toBe(400)
  })
})
