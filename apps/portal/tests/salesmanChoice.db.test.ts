/**
 * The Salesman choice on a new customer or lead (lib/salesmanChoice.ts;
 * Jonathan, Oct 28 2026): it lists the owner and every Salesman, the person
 * entering preselected; the chosen Salesman sees the customer on the next
 * request; a Salesman who gives a customer away no longer sees it; once saved
 * only the owner and office change it (the Salesman's change is refused in
 * words). Against the dev database (DEV_DB=1; refuses any other), on a
 * throwaway company, through the same middleware order as index.ts.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman choice (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: leadAssign } = await import('../src/server/routes/lead-assign.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `smc-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', office = '', sally = '', sam = ''
  const id: Record<string, string> = {}
  let server: ReturnType<express.Express['listen']>

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = (firstName: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const sign = (u: { id: string; email: string }, role: string) => jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const o = await user('Olive', 'super_admin'); owner = sign(o, 'super_admin'); id.owner = o.id
    const f = await user('Opal', 'office_staff'); office = sign(f, 'office_staff'); id.office = f.id
    const s = await user('Sally', 'sales_rep'); sally = sign(s, 'sales_rep'); id.sally = s.id
    const s2 = await user('Sam', 'sales_rep'); sam = sign(s2, 'sales_rep'); id.sam = s2.id
    await user('Ivan', 'field_crew')
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
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } }).catch(() => {})
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
  const sees = async (token: string, contactId: string) => {
    const list = await call('GET', '/api/crm-contacts', token)
    const inList = (list.json.data as any[]).some(c => c.id === contactId)
    const one = await call('GET', `/api/crm-contacts/${contactId}/whereabouts`, token)
    expect(one.status === 200).toBe(inList)
    return inList
  }
  const newLead = (token: string, firstName: string, extra: Record<string, unknown> = {}) => {
    const cid = crypto.randomUUID()
    return call('POST', '/api/crm-contacts', token, { id: cid, firstName, lastName: tag, ...extra, lead: { id: `${tag}-k-${firstName}`, stage: 'new_lead', firstName, lastName: tag, assignedRep: (extra as any).salesRep ?? '' } })
  }

  test('the choices: the owner, then each Salesman by name; the person entering marked; where it starts (D4: the office on the owner); who may change it', async () => {
    const o = (await call('GET', '/api/crm-contacts/salesmen', owner)).json.data
    expect(o.choices.map((c: any) => c.name)).toEqual([`Olive ${tag}`, `Sally ${tag}`, `Sam ${tag}`])
    expect(o.choices.filter((c: any) => c.me).map((c: any) => c.name)).toEqual([`Olive ${tag}`])
    expect(o.preselect).toBe(`Olive ${tag}`)
    expect(o.choices.filter((c: any) => c.preselected).map((c: any) => c.name)).toEqual([`Olive ${tag}`])
    expect(o.canChange).toBe(true)
    // D4 (Oct 29 2026): "Office entries default to me, and the Salesman choice lets the office pick someone else."
    const f = (await call('GET', '/api/crm-contacts/salesmen', office)).json.data
    expect(f.choices.map((c: any) => c.name)).toEqual([`Olive ${tag}`, `Sally ${tag}`, `Sam ${tag}`])
    expect(f.choices.some((c: any) => c.me)).toBe(false)
    expect(f.preselect).toBe(`Olive ${tag}`)
    expect(f.choices.filter((c: any) => c.preselected).map((c: any) => c.name)).toEqual([`Olive ${tag}`])
    expect(f.canChange).toBe(true)
    const s = (await call('GET', '/api/crm-contacts/salesmen', sally))
    expect(s.status).toBe(200)
    expect(s.json.data.choices.find((c: any) => c.me).name).toBe(`Sally ${tag}`)
    expect(s.json.data.preselect).toBe(`Sally ${tag}`)
    expect(s.json.data.canChange).toBe(false)
  })

  test('the owner enters a lead for Sally: Sally sees it and its card on the very next request; Sam does not', async () => {
    // Read first, so a remembered scope (4 s) is in place: the save must clear it.
    await sees(sally, 'none')
    const r = await newLead(owner, 'Gina', { salesRep: `Sally ${tag}` })
    expect(r.status).toBe(201)
    id.gina = r.json.data.id
    expect(await sees(sally, id.gina)).toBe(true)
    expect(await sees(sam, id.gina)).toBe(false)
    const board = await prisma.pipelineState.findUnique({ where: { accountId } }) as any
    expect(board.leads.find((l: any) => l.customerId === id.gina).assignedRep).toBe(`Sally ${tag}`)
  })

  test('no Salesman sent: the owner\'s own and the office\'s go to the owner (D4), the Salesman\'s to the Salesman; the CSV import keeps it blank', async () => {
    const byOwner = await newLead(owner, 'Hal')
    expect(byOwner.json.data.salesRep).toBe(`Olive ${tag}`)
    const board = await prisma.pipelineState.findUnique({ where: { accountId } }) as any
    expect(board.leads.find((l: any) => l.customerId === byOwner.json.data.id).assignedRep).toBe(`Olive ${tag}`)
    const byOffice = await newLead(office, 'Ike')
    expect(byOffice.json.data.salesRep).toBe(`Olive ${tag}`)
    const board2 = await prisma.pipelineState.findUnique({ where: { accountId } }) as any
    expect(board2.leads.find((l: any) => l.customerId === byOffice.json.data.id).assignedRep).toBe(`Olive ${tag}`)
    // The office picks someone else: that one is kept.
    const picked = await newLead(office, 'Ivy', { salesRep: `Sam ${tag}` })
    expect(picked.json.data.salesRep).toBe(`Sam ${tag}`)
    const bySally = await newLead(sally, 'Iris')
    expect(bySally.json.data.salesRep).toBe(`Sally ${tag}`)
    const imported = await call('POST', '/api/crm-contacts', owner, { id: crypto.randomUUID(), firstName: 'Jo', lastName: tag, keepRepBlank: true })
    expect(imported.json.data.salesRep ?? null).toBeNull()
  })

  test('Sally enters one for herself (sees it), and one for Sam (Sam sees it; Sally does not, though Sally entered it)', async () => {
    const own = await newLead(sally, 'Kim', { salesRep: `Sally ${tag}` })
    expect(own.status).toBe(201)
    expect(await sees(sally, own.json.data.id)).toBe(true)
    const given = await newLead(sally, 'Lou', { salesRep: `Sam ${tag}` })
    expect(given.status).toBe(201)
    id.lou = given.json.data.id
    expect(await sees(sam, id.lou)).toBe(true)
    expect(await sees(sally, id.lou)).toBe(false)
    expect((await call('PATCH', `/api/crm-contacts/${id.lou}`, sally, { notes: 'x' })).status).toBe(404)
  })

  test('once saved, the Salesman cannot change it: refused in words, nothing saved; the same name sent again is fine', async () => {
    const own = await newLead(sally, 'Max', { salesRep: `Sally ${tag}` })
    const cid = own.json.data.id
    const r = await call('PATCH', `/api/crm-contacts/${cid}`, sally, { notes: 'gate on the left', salesRep: `Sam ${tag}` })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('NOT_ALLOWED')
    expect(r.json.error).toMatch(/Only the owner or the office can change a customer's Salesman/)
    const row = await prisma.crmContact.findUnique({ where: { id: cid } })
    expect(row!.salesRep).toBe(`Sally ${tag}`)
    expect(row!.notes ?? '').toBe('')
    const same = await call('PATCH', `/api/crm-contacts/${cid}`, sally, { notes: 'gate on the left', salesRep: ` sally ${tag.toUpperCase()} ` })
    expect(same.status).toBe(200)
    // Sally cannot use the customer page's change either.
    expect((await call('POST', `/api/lead-assign/${cid}`, sally, { to: id.sam, replace: true })).status).toBe(403)
  })

  test('the owner changes Gina from Sally to Sam on the customer page: Sam sees Gina, Sally no longer; then the office gives Gina back', async () => {
    const r = await call('POST', `/api/lead-assign/${id.gina}`, owner, { to: id.sam, replace: true })
    expect(r.status).toBe(200)
    expect(r.json.data.assignedTo).toBe(`Sam ${tag}`)
    expect(await sees(sam, id.gina)).toBe(true)
    expect(await sees(sally, id.gina)).toBe(false)
    const board = await prisma.pipelineState.findUnique({ where: { accountId } }) as any
    expect(board.leads.find((l: any) => l.customerId === id.gina).assignedRep).toBe(`Sam ${tag}`)
    const back = await call('POST', `/api/lead-assign/${id.gina}`, office, { to: id.sally, replace: true })
    expect(back.status).toBe(200)
    expect(await sees(sally, id.gina)).toBe(true)
    expect(await sees(sam, id.gina)).toBe(false)
    const notes = await prisma.crmContactNote.findMany({ where: { crmContactId: id.gina }, orderBy: { createdAt: 'asc' } })
    expect(notes.map(n => n.body)).toEqual([`Lead assigned to Sam ${tag} by Olive ${tag}. It was Sally ${tag}'s.`, `Lead assigned to Sally ${tag} by Opal ${tag}. It was Sam ${tag}'s.`])
  })

  test('a customer Sally entered and the owner moves to Sam leaves Sally\'s list', async () => {
    const own = await newLead(sally, 'Ned', { salesRep: `Sally ${tag}` })
    const cid = own.json.data.id
    expect(await sees(sally, cid)).toBe(true)
    expect((await call('POST', `/api/lead-assign/${cid}`, owner, { to: id.sam, replace: true })).status).toBe(200)
    expect(await sees(sally, cid)).toBe(false)
    expect(await sees(sam, cid)).toBe(true)
  })
})
