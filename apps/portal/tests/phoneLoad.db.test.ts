/**
 * What a phone loads (audit #17), against the dev database (DEV_DB=1; refuses
 * any other), on a throwaway company:
 *   - /api/business-state?omit=jobChecklists,pendingOrders leaves both out of
 *     the read and of a save's answer, and a save that does not send them keeps
 *     them exactly as saved.
 *   - /api/appointments?since= gives only what changed: a moved visit, a
 *     cancelled one (with archivedAt, so the phone drops it), one whose
 *     customer's name changed; nothing else.
 *   - On the dev company (read only): the follow up board as a table reads as
 *     the very same cards.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('what a phone loads (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: businessState } = await import('../src/server/routes/business-state.js')
  const { default: appointments } = await import('../src/server/routes/appointments.js')
  const { default: followUps } = await import('../src/server/routes/follow-ups.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { fromTable } = await import('../../web/src/listTable')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `pld-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', owner = '', devOwner = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  // The dev company's owner, for the read only board check.
  const dev = await prisma.crmUser.findFirst({ where: { role: 'super_admin', status: 'active', email: { endsWith: '@example.invalid' }, NOT: { email: { startsWith: 'pld-' } } }, orderBy: { createdAt: 'asc' } })
  if (dev) devOwner = jwt.sign({ sub: dev.id, email: dev.email, role: 'super_admin', crmAccountId: dev.crmAccountId }, secret, { expiresIn: '10m' })

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const u = await prisma.crmUser.create({ data: { email: `${tag}-owner@example.invalid`, firstName: 'Olive', lastName: tag, role: 'super_admin', crmAccountId: accountId, passwordHash: 'x' } as any })
    owner = jwt.sign({ sub: u.id, email: u.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    await prisma.businessState.create({ data: { accountId, config: { company: { name: tag } }, jobChecklists: { 'job-1': [{ id: 'm:job-1:locate', jobId: 'job-1', label: 'Locate', isComplete: true }] }, pendingOrders: [{ id: 'po-1', status: 'pending', items: [] }] } as any })
    const contact = await prisma.crmContact.create({ data: { accountId, firstName: 'Walker', lastName: tag, phone: '3525550111' } as any })
    const other = await prisma.crmContact.create({ data: { accountId, firstName: 'Nora', lastName: tag, phone: '3525550112' } as any })
    const at = (d: number) => new Date(Date.now() + d * 86_400_000)
    for (const [k, c, d] of [['same', contact.id, 1], ['moved', contact.id, 2], ['cancelled', contact.id, 3], ['renamed', other.id, 4]] as const) {
      ids[k] = (await prisma.appointment.create({ data: { accountId, crmContactId: c, type: 'estimate', startAt: at(d), assignedTo: `Olive ${tag}` } as any })).id
    }
    ids.other = other.id
    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/business-state', businessState); app.use('/api/appointments', appointments); app.use('/api/follow-ups', followUps)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    // The settings change log line the save made (lib/settingsAudit.ts).
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const get = (p: string, token = owner) => fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()) as Promise<any>

  test('business state: the read and a save\'s answer leave both parts out; a save keeps them as saved', async () => {
    const full = await get('/api/business-state')
    expect(full.data.jobChecklists).toHaveProperty('job-1')
    expect(full.data.pendingOrders).toHaveLength(1)
    const lean = await get('/api/business-state?omit=jobChecklists,pendingOrders')
    expect(lean.data).not.toHaveProperty('jobChecklists')
    expect(lean.data).not.toHaveProperty('pendingOrders')
    expect(lean.data.config).toEqual({ company: { name: tag } })
    expect(lean.data.version).toBe(full.data.version)
    // Only the Sales Orders asked for (a phone on Inventory > Sales Orders).
    const withOrders = await get('/api/business-state?omit=jobChecklists')
    expect(withOrders.data.pendingOrders).toHaveLength(1)
    expect(withOrders.data).not.toHaveProperty('jobChecklists')

    const saved = await fetch(`${base}/api/business-state?omit=jobChecklists,pendingOrders`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { company: { name: `${tag} 2` } }, baseVersion: lean.data.version }),
    }).then(r => r.json()) as any
    expect(saved.success).toBe(true)
    expect(saved.data).not.toHaveProperty('jobChecklists')
    expect(saved.data).not.toHaveProperty('pendingOrders')
    const row = await prisma.businessState.findUnique({ where: { accountId } }) as any
    expect(row.config.company.name).toBe(`${tag} 2`)
    expect(row.jobChecklists['job-1'][0].isComplete).toBe(true)
    expect(row.pendingOrders).toEqual([{ id: 'po-1', status: 'pending', items: [] }])

    // A save built on an old copy: refused with the newest, lean too.
    const stale = await fetch(`${base}/api/business-state?omit=jobChecklists,pendingOrders`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { company: { name: 'old' } }, baseVersion: lean.data.version }),
    })
    expect(stale.status).toBe(409)
    const sj = await stale.json() as any
    expect(sj.data.config.company.name).toBe(`${tag} 2`)
    expect(sj.data).not.toHaveProperty('jobChecklists')
    expect(sj.data).not.toHaveProperty('pendingOrders')
  })

  test('appointments: ?since= gives only what changed (a move, a cancel, a customer renamed)', async () => {
    const first = await get('/api/appointments')
    expect(first.data.map((a: any) => a.id).sort()).toEqual([ids.same, ids.moved, ids.cancelled, ids.renamed].sort())
    expect(typeof first.serverTime).toBe('string')
    expect(first.partial).toBeUndefined()
    // Nothing changed: nothing (the 5 second overlap aside, which these rows are older than).
    await sleep(5_200)
    const since = new Date(Date.now() - 100).toISOString()
    expect((await get(`/api/appointments?since=${encodeURIComponent(since)}`)).data).toEqual([])
    await sleep(50)
    await prisma.appointment.update({ where: { id: ids.moved }, data: { startAt: new Date(Date.now() + 9 * 86_400_000) } })
    await prisma.appointment.update({ where: { id: ids.cancelled }, data: { archivedAt: new Date(), status: 'cancelled' } })
    await prisma.crmContact.update({ where: { id: ids.other }, data: { firstName: 'Norah' } })
    const delta = await get(`/api/appointments?since=${encodeURIComponent(since)}`)
    expect(delta.partial).toBe(true)
    expect(typeof delta.serverTime).toBe('string')
    const byId = new Map(delta.data.map((a: any) => [a.id, a]))
    expect([...byId.keys()].sort()).toEqual([ids.moved, ids.cancelled, ids.renamed].sort())
    expect((byId.get(ids.cancelled) as any).archivedAt).toBeTruthy()
    expect((byId.get(ids.renamed) as any).customerName).toBe(`Norah ${tag}`)
    // The whole list (no since) still leaves the cancelled one out.
    const all = await get('/api/appointments')
    expect(all.data.map((a: any) => a.id)).not.toContain(ids.cancelled)
    // As one table it reads the same.
    const t = await get(`/api/appointments?since=${encodeURIComponent(since)}`)
    expect(t.data.length).toBe(3)
  })

  test.skipIf(!devOwner)('the follow up board as one table is the very same cards (dev company, read only)', async () => {
    const plain = await get('/api/follow-ups/board', devOwner)
    const table = await get('/api/follow-ups/board?shape=table', devOwner)
    expect(table.data.today).toBe(plain.data.today)
    expect(table.data.cards.$table).toBe(1)
    const back: Record<string, unknown> = {}
    for (const { id, ...c } of fromTable<any>(table.data.cards) as any[]) back[id] = c
    expect(back).toEqual(plain.data.cards)
    expect(JSON.stringify(table).length).toBeLessThan(JSON.stringify(plain).length * 0.7)
  })
})
