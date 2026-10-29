/**
 * D7 and D8 (Jonathan, Oct 29 2026), against the dev database (DEV_DB=1;
 * refuses any other), on a throwaway company:
 *   D7 "Yes, the callback moves with the lead." (lib/leadCallback.ts)
 *   D8 "Push again once after 2 hours, then once at 8 am the next day. No
 *      more after that." (lib/leadRepush.ts)
 * The outbound gate is shut (tests/setup/outboundGate.ts): pushes land in this
 * run's dev outbox, or in a spy; never on a phone.
 */

import 'dotenv/config'
import crypto from 'crypto'
import fs from 'fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the call back moves with the lead; repeat pushes (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped, salesScope } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: leadAssign } = await import('../src/server/routes/lead-assign.js')
  const { recordIntake } = await import('../src/server/lib/intake.js')
  const { leadPushesSettled } = await import('../src/server/lib/leadAssign.js')
  const { leadRepushSweep, repushKey } = await import('../src/server/lib/leadRepush.js')
  const { devOutboxFile } = await import('../src/server/lib/outboundGate.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `lcb-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', office = '', ownerId = '', salesId = '', sales2Id = ''
  let server: ReturnType<express.Express['listen']>
  const made: string[] = []

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = (firstName: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const o = await user('Olive', 'super_admin')
    const f = await user('Opal', 'office_staff')
    const s = await user('Sally', 'sales_rep')
    const s2 = await user('Sam', 'sales_rep')
    ownerId = o.id; salesId = s.id; sales2Id = s2.id
    const sign = (u: { id: string; email: string }, role: string) => jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = sign(o, 'super_admin'); office = sign(f, 'office_staff')
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
    await prisma.automationEffect.deleteMany({ where: { key: { in: made.flatMap(id => [repushKey(id, '2h'), repushKey(id, '8am')]) } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { title: { contains: tag } } }).catch(() => {})
    await prisma.intakeLead.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
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
  const n = () => String(Math.floor(Math.random() * 900000) + 100000)

  /** A phone lead as routes/intake.ts files it: the customer, then its call back with nobody on it. */
  async function phoneLead(name: string, at?: Date) {
    const ref = `${tag}-${crypto.randomUUID().slice(0, 6)}`
    const r = await recordIntake(accountId, { source: 'retell', sourceRef: ref, name: `${name} ${tag}`, phone: `352${n()}0`, address: '9 Oak Rd, Belleview, FL 34420', summary: 'Phone call', callbackAt: 'tomorrow 3 pm', leadSource: 'Phone (AI receptionist)', payload: {} })
    await leadPushesSettled()
    const id = r.contactId!
    made.push(id)
    if (at) await prisma.intakeLead.updateMany({ where: { crmContactId: id }, data: { createdAt: at } })
    const cb = await prisma.appointment.create({ data: { accountId, crmContactId: id, type: 'call_back', status: 'scheduled', startAt: new Date(Date.now() + 86_400_000), source: 'phone_agent', sourceRef: `retell:${ref}`, createdBy: 'Phone agent', history: [] } })
    return { id, cb }
  }
  const apptOf = (id: string) => prisma.appointment.findUnique({ where: { id }, select: { assignedTo: true, assignedToUserId: true, status: true, version: true } })

  // ── D7: the call back moves with the lead ─────────────────────────────────

  test('Assign screen (and the push\'s Assign button, the same POST): the open call back goes to the Salesman; a finished one stays', async () => {
    const { id, cb } = await phoneLead('Rita')
    const r = await call('POST', `/api/lead-assign/${id}`, office, { to: salesId })
    expect(r.status).toBe(200)
    const a = await apptOf(cb.id)
    expect([a!.assignedTo, a!.assignedToUserId]).toEqual([`Sally ${tag}`, salesId])
    expect(a!.version).toBe(cb.version + 1)
    const note = await prisma.crmContactNote.findFirst({ where: { crmContactId: id, body: { startsWith: 'Lead assigned to ' } } })
    expect(note!.body).toBe(`Lead assigned to Sally ${tag} by Opal ${tag}. The call back went with it.`)

    // Sally made an earlier call back, done; then the lead moves to Sam (asked first): the open call back follows,
    // the done one stays Sally's.
    const old = await prisma.appointment.create({ data: { accountId, crmContactId: id, type: 'call_back', status: 'completed', startAt: new Date(Date.now() - 86_400_000), assignedTo: `Sally ${tag}`, assignedToUserId: salesId, history: [] } })
    expect((await call('POST', `/api/lead-assign/${id}`, owner, { to: sales2Id })).status).toBe(409)
    expect((await apptOf(cb.id))!.assignedToUserId).toBe(salesId)
    expect((await call('POST', `/api/lead-assign/${id}`, owner, { to: sales2Id, replace: true })).status).toBe(200)
    expect(await apptOf(cb.id)).toMatchObject({ assignedTo: `Sam ${tag}`, assignedToUserId: sales2Id })
    expect(await apptOf(old.id)).toMatchObject({ assignedTo: `Sally ${tag}`, assignedToUserId: salesId, status: 'completed' })
    expect((await salesScope(sales2Id))!.contactIds.has(id)).toBe(true)
    // Without that finished call back of hers, Sally no longer has the customer: the open one left her.
    await prisma.appointment.delete({ where: { id: old.id } })
    expect((await salesScope(salesId))!.contactIds.has(id)).toBe(false)
  })

  test('push tap on a lead already the Salesman\'s (rep on its card, call back on nobody): the call back is put with her', async () => {
    const { id, cb } = await phoneLead('Tess')
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [{ id: `${tag}-card-tess`, stage: 'new', customerId: id, assignedRep: `Sally ${tag}`, firstName: 'Tess' }] as any } })
    const r = await call('POST', `/api/lead-assign/${id}`, owner, { to: salesId })
    expect(r.json.data.already).toBe(true)
    expect(await apptOf(cb.id)).toMatchObject({ assignedTo: `Sally ${tag}`, assignedToUserId: salesId })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [] as any } })
  })

  test('customer page Sales rep change: the open call back moves (full name or a first name one login has); a name that is nobody\'s moves nothing', async () => {
    const { id, cb } = await phoneLead('Uma')
    const cancelled = await prisma.appointment.create({ data: { accountId, crmContactId: id, type: 'call_back', status: 'cancelled', assignedTo: '', history: [] } })
    // The office gives the lead (no Salesman yet) its first one.
    expect((await call('PATCH', `/api/crm-contacts/${id}`, office, { salesRep: 'Sam' })).status).toBe(200)
    expect(await apptOf(cb.id)).toMatchObject({ assignedTo: `Sam ${tag}`, assignedToUserId: sales2Id })
    expect(await apptOf(cancelled.id)).toMatchObject({ assignedTo: '', assignedToUserId: null })
    // Once it has one, only the owner changes it (Oct 29 2026): the office's save keeps Sam and moves nothing.
    expect((await call('PATCH', `/api/crm-contacts/${id}`, office, { salesRep: `Sally ${tag}` })).json.salesRepKept).toBe(true)
    expect(await apptOf(cb.id)).toMatchObject({ assignedTo: `Sam ${tag}`, assignedToUserId: sales2Id })
    expect((await call('PATCH', `/api/crm-contacts/${id}`, owner, { salesRep: `Sally ${tag}` })).status).toBe(200)
    expect(await apptOf(cb.id)).toMatchObject({ assignedTo: `Sally ${tag}`, assignedToUserId: salesId })
    expect((await call('PATCH', `/api/crm-contacts/${id}`, owner, { salesRep: 'Nobody Here' })).status).toBe(200)
    expect(await apptOf(cb.id)).toMatchObject({ assignedTo: `Sally ${tag}`, assignedToUserId: salesId })
    // Another field saved, same rep: nothing touched.
    const v = (await apptOf(cb.id))!.version
    expect((await call('PATCH', `/api/crm-contacts/${id}`, owner, { salesRep: 'Nobody Here', notes: 'x' })).status).toBe(200)
    expect((await apptOf(cb.id))!.version).toBe(v)
  })

  // ── D8: repeat pushes ─────────────────────────────────────────────────────

  test('a lead still waiting: one push at 2 hours, one at 8 am the next day, none after; a restart or two passes at once never send one twice', async () => {
    const came = new Date('2026-10-20T19:10:00Z') // Tue 3:10 pm EDT
    const { id } = await phoneLead('Vera', came)
    const sent: Array<{ title: string; body: string; ids: string[]; renotify?: boolean }> = []
    const deps = { accountIds: [accountId], allowed: true, send: async (_a: string, m: any, ids: string[]) => { sent.push({ title: m.title, body: m.body, ids, renotify: m.renotify }); return { sent: 1, failed: 0, removed: 0, held: 0, subscribers: 1, errors: [] } } }
    const mine = () => sent.filter(s => s.title === `Still not assigned: Vera ${tag}`)
    const at = (iso: string) => new Date(iso)

    await leadRepushSweep(at('2026-10-20T21:09:00Z'), deps)
    expect(mine()).toHaveLength(0)
    // Two servers (or a restart racing the timer) at the same moment: one push.
    await Promise.all([leadRepushSweep(at('2026-10-20T21:10:30Z'), deps), leadRepushSweep(at('2026-10-20T21:10:30Z'), deps)])
    expect(mine()).toHaveLength(1)
    expect(mine()[0]).toMatchObject({ ids: [ownerId], renotify: true, body: 'Phone call · Belleview · Call back tomorrow 3 pm. Came in at 3:10 PM. Tap to assign.' })
    expect((await prisma.automationEffect.findUnique({ where: { key: repushKey(id, '2h') } }))!.status).toBe('done')
    // The rest of the night: nothing more.
    for (const t of ['2026-10-20T23:00:00Z', '2026-10-21T05:00:00Z', '2026-10-21T11:59:00Z']) await leadRepushSweep(at(t), deps)
    expect(mine()).toHaveLength(1)
    await Promise.all([leadRepushSweep(at('2026-10-21T12:00:10Z'), deps), leadRepushSweep(at('2026-10-21T12:00:10Z'), deps)])
    expect(mine()).toHaveLength(2)
    expect(mine()[1].body).toBe('Phone call · Belleview · Call back tomorrow 3 pm. Came in yesterday at 3:10 PM. Tap to assign.')
    // No more after that, whatever the clock says.
    for (const t of ['2026-10-21T12:30:00Z', '2026-10-21T20:00:00Z', '2026-10-22T12:00:00Z']) await leadRepushSweep(at(t), deps)
    expect(mine()).toHaveLength(2)
  })

  test('assigned before the 2 hour mark: no repeat push at all', async () => {
    const { id } = await phoneLead('Wynn', new Date('2026-10-20T19:10:00Z'))
    const sent: string[] = []
    const deps = { accountIds: [accountId], allowed: true, send: async (_a: string, m: any) => { sent.push(m.title); return { sent: 1, failed: 0, removed: 0, held: 0, subscribers: 1, errors: [] } } }
    expect((await call('POST', `/api/lead-assign/${id}`, office, { to: salesId })).status).toBe(200)
    for (const t of ['2026-10-20T21:10:30Z', '2026-10-21T12:00:10Z']) await leadRepushSweep(new Date(t), deps)
    expect(sent.filter(s => s.includes('Wynn'))).toEqual([])
    expect(await prisma.automationEffect.findUnique({ where: { key: repushKey(id, '2h') } })).toBeNull()
  })

  test('assigned after the 2 hour push: no 8 am push', async () => {
    const { id } = await phoneLead('Xena', new Date('2026-10-20T19:10:00Z'))
    const sent: string[] = []
    const deps = { accountIds: [accountId], allowed: true, send: async (_a: string, m: any) => { sent.push(m.title); return { sent: 1, failed: 0, removed: 0, held: 0, subscribers: 1, errors: [] } } }
    await leadRepushSweep(new Date('2026-10-20T21:10:30Z'), deps)
    expect(sent.filter(s => s.includes('Xena'))).toHaveLength(1)
    expect((await call('POST', `/api/lead-assign/${id}`, office, { to: sales2Id })).status).toBe(200)
    await leadRepushSweep(new Date('2026-10-21T12:00:10Z'), deps)
    expect(sent.filter(s => s.includes('Xena'))).toHaveLength(1)
  })

  test('a push cut off by a restart mid send is not sent again; down through 8 am gives one push, not two', async () => {
    const { id } = await phoneLead('Yara', new Date('2026-10-20T19:10:00Z'))
    const sent: string[] = []
    const deps = { accountIds: [accountId], allowed: true, send: async (_a: string, m: any) => { sent.push(m.title); return { sent: 1, failed: 0, removed: 0, held: 0, subscribers: 1, errors: [] } } }
    // The server stopped while the 2 hour push was going out: written down as "sending".
    await prisma.automationEffect.create({ data: { key: repushKey(id, '2h'), runId: 'lead-repush', status: 'sending' } })
    await leadRepushSweep(new Date('2026-10-20T21:30:00Z'), deps)
    expect(sent.filter(s => s.includes('Yara'))).toHaveLength(0)

    // Another lead; the app was down from before its 2 hour mark until 9 am the next day.
    const z = await phoneLead('Zoe', new Date('2026-10-20T19:10:00Z'))
    await leadRepushSweep(new Date('2026-10-21T13:00:00Z'), deps)
    expect(sent.filter(s => s.includes('Zoe'))).toHaveLength(1)
    expect((await prisma.automationEffect.findUnique({ where: { key: repushKey(z.id, '2h') } }))!.status).toBe('skipped')
    await leadRepushSweep(new Date('2026-10-21T13:01:00Z'), deps)
    expect(sent.filter(s => s.includes('Zoe'))).toHaveLength(1)
  })

  test('off the live install the repeat push is held in the dev outbox, not sent', async () => {
    await phoneLead('Abby', new Date('2026-10-20T19:10:00Z'))
    const before = outbox().length
    await leadRepushSweep(new Date('2026-10-20T21:10:30Z'), { accountIds: [accountId] })
    const held = outbox().slice(before).filter(l => l.title === `Still not assigned: Abby ${tag}`)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ channel: 'push', to: `Olive ${tag}` })
  })
})
