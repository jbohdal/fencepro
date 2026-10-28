/**
 * Delete, restore, archive and unarchive through the API (dev database).
 *
 * Jonathan's test (Oct 20, 2026): a customer with a pipeline card and a job;
 * delete the customer; the pipeline (GET /api/pipeline leads) and the
 * operations board (GET /api/saved-jobs) show nothing of theirs and the
 * deletion log has one row with the children in its snapshot; restore; both
 * boards show them again. The same for Archive and Unarchive (no log row;
 * search and reports still have them). Then the other deletes: a quote (with
 * its job), a job (with its schedule entry), a card, a login, a catalog item
 * and a vendor; restore skipping a child changed after the delete; an older
 * screen cannot put a deleted card back; a salesman and a manager cannot
 * delete; nothing deletes a log row.
 *
 * A company made for the test and removed after; database writes happen only
 * inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('delete, restore, archive (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  const tag = `dar-${Date.now().toString(36)}`
  const password = `pw-${tag}`
  let accountId = ''
  const users: Record<string, string> = {}
  const tokens: Record<string, string> = {}

  const call = async (who: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  const boardCards = async () => ((await call('owner', 'GET', '/api/pipeline')).json.data?.leads ?? []) as any[]
  const boardJobs = async () => ((await call('owner', 'GET', '/api/saved-jobs')).json.data ?? []) as any[]
  const logRows = (entityId: string) => prisma.deletionLog.findMany({ where: { accountId, entityId } })

  /** A customer with a card on the pipeline, a sold quote, a job from it, an appointment and a schedule entry. */
  async function makeCustomer(name: string) {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Test', lastName: `${name} ${tag}`, phone: '3525550100' } })
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `Test ${name}`, fenceStyle: 'WV 6ft Privacy', runs: [100], pullSheet: [], finalPrice: 5000, status: 'SOLD' } })
    const j = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, quoteId: q.id, customerName: `Test ${name}`, contractValue: 5000 } })
    const a = await prisma.appointment.create({ data: { accountId, crmContactId: c.id, jobId: j.id, type: 'install' } })
    const g = await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: j.id, clientName: `Test ${name}`, date: '2026-11-02' } })
    const card = { id: `card-${name}-${tag}`, customerId: c.id, firstName: 'Test', lastName: name, stage: 'Signed Contract', createdAt: new Date().toISOString() }
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [...(p.leads as any[]), card], version: { increment: 1 } } })
    return { c, q, j, a, g, card }
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    for (const [key, role] of [['owner', 'super_admin'], ['manager', 'manager'], ['sales', 'sales_rep'], ['worker', 'office_staff']] as const) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${key}@example.test`, firstName: 'Test', lastName: key, role, status: 'active', mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
      users[key] = u.id
    }
    await prisma.pipelineState.create({ data: { accountId, leads: [], stages: [{ id: 'Signed Contract', name: 'Signed Contract' }] } })
    await prisma.inventoryState.create({ data: { accountId, items: [{ id: `item-${tag}`, name: 'Test post', unitCost: 10 }, { id: `keep-${tag}`, name: 'Kept post', unitCost: 11 }], bundles: [], locations: [], stockLevels: [{ itemId: `item-${tag}`, locationId: 'yard', quantity: 7 }], transactions: [] } })
    await prisma.vendorState.create({ data: { accountId, vendors: [{ id: `vendor-${tag}`, name: 'Test Supply' }], bills: [], payments: [] } })
    const { requireLiveSession } = await import('../src/server/lib/sessionGuard.js')
    const app = express()
    app.use(express.json({ limit: '5mb' }))
    app.use('/api', requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    app.use('/api/crm-contacts', (await import('../src/server/routes/crm-contacts.js')).default)
    app.use('/api/saved-quotes', (await import('../src/server/routes/saved-quotes.js')).default)
    app.use('/api/saved-jobs', (await import('../src/server/routes/saved-jobs.js')).default)
    app.use('/api/pipeline', (await import('../src/server/routes/pipeline.js')).default)
    app.use('/api/schedule', (await import('../src/server/routes/schedule.js')).default)
    app.use('/api/inventory', (await import('../src/server/routes/inventory.js')).default)
    app.use('/api/vendors-state', (await import('../src/server/routes/vendors-state.js')).default)
    app.use('/api/deleted-records', (await import('../src/server/routes/deleted-records.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const key of Object.keys(users)) {
      const r = await fetch(`${base}/api/crm-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${key}@example.test`, password }) })
      tokens[key] = ((await r.json()) as any).data.accessToken
    }
  })

  afterAll(async () => {
    server?.close()
    if (!prisma || !accountId) return
    const ids = Object.values(users)
    // Test data only: the deletion log rows of this throwaway company go with it.
    await prisma.deletionLog.deleteMany({ where: { accountId } })
    await prisma.automationRun.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.pendingTouch.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.changeOrder.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContactNote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    for (const m of ['pipelineState', 'inventoryState', 'vendorState', 'businessState', 'scheduleSettings']) await prisma[m].deleteMany({ where: { accountId } }).catch(() => {})
    const all = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map((u: any) => u.id)
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: [...ids, ...all] } } })
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: [...ids, ...all] } } })
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: [...ids, ...all] } } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('delete a customer: both boards drop them, one log row holds the children; restore brings them back', async () => {
    const x = await makeCustomer('del')
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(true)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(true)

    const del = await call('owner', 'DELETE', `/api/crm-contacts/${x.c.id}`)
    expect(del.status).toBe(200)
    expect((await boardCards()).some(l => l.customerId === x.c.id)).toBe(false)
    expect((await boardJobs()).some(j => j.crmContactId === x.c.id)).toBe(false)
    expect(((await call('owner', 'GET', '/api/crm-contacts')).json.data as any[]).some(c => c.id === x.c.id)).toBe(false)
    expect(((await call('owner', 'GET', '/api/saved-quotes')).json.data as any[]).some(q => q.id === x.q.id)).toBe(false)
    expect(((await call('owner', 'GET', '/api/schedule/jobs')).json.data as any[]).some(g => g.id === x.g.id)).toBe(false)

    const rows = await logRows(x.c.id)
    expect(rows).toHaveLength(1)
    const snap = rows[0].snapshot
    expect(rows[0].entityType).toBe('customer')
    expect(rows[0].entityLabel).toContain('del')
    expect(rows[0].deletedByUserId).toBe(users.owner)
    const has = (model: string, id: string) => snap.rows.some((r: any) => r.model === model && r.id === id)
    expect(has('crmContact', x.c.id) && has('savedQuote', x.q.id) && has('savedJob', x.j.id) && has('appointment', x.a.id) && has('scheduledGridJob', x.g.id)).toBe(true)
    expect(snap.items.some((i: any) => i.doc === 'pipeline.leads' && i.id === x.card.id)).toBe(true)
    // Soft: the rows are still there, stamped.
    expect((await prisma.savedJob.findUnique({ where: { id: x.j.id } })).deletedAt).not.toBeNull()

    // In the list, newest first, with what went with it.
    const list = await call('owner', 'GET', '/api/deleted-records?type=customer')
    expect(list.json.data[0].entityId).toBe(x.c.id)
    expect(list.json.data[0].counts.savedJob).toBe(1)

    const back = await call('owner', 'POST', `/api/deleted-records/${rows[0].id}/restore`)
    expect(back.status).toBe(200)
    expect(back.json.data.skipped).toEqual([])
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(true)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(true)
    expect(((await call('owner', 'GET', '/api/schedule/jobs')).json.data as any[]).some(g => g.id === x.g.id)).toBe(true)
    const after = await logRows(x.c.id)
    expect(after).toHaveLength(1)
    expect(after[0].restoredAt).not.toBeNull()
    // Restored once; a second restore is refused.
    expect((await call('owner', 'POST', `/api/deleted-records/${rows[0].id}/restore`)).status).toBe(409)
  })

  test('archive a customer: off both boards, still found as archived, no log row; unarchive brings them back', async () => {
    const x = await makeCustomer('arch')
    const r = await call('sales', 'POST', `/api/crm-contacts/${x.c.id}/archive`)
    expect(r.status).toBe(200)
    expect((await boardCards()).some(l => l.customerId === x.c.id)).toBe(false)
    expect((await boardJobs()).some(j => j.crmContactId === x.c.id)).toBe(false)
    // Search and reports read the archived lists.
    expect(((await call('owner', 'GET', '/api/crm-contacts?archived=1')).json.data as any[]).some(c => c.id === x.c.id)).toBe(true)
    expect(((await call('owner', 'GET', '/api/saved-jobs?archived=1')).json.data as any[]).some(j => j.id === x.j.id)).toBe(true)
    expect(((await call('owner', 'GET', '/api/saved-quotes?archived=1')).json.data as any[]).some(q => q.id === x.q.id)).toBe(true)
    expect(((await call('owner', 'GET', '/api/pipeline')).json.data.archivedLeads as any[]).some(l => l.id === x.card.id)).toBe(true)
    expect(await logRows(x.c.id)).toHaveLength(0)

    const u = await call('owner', 'POST', `/api/crm-contacts/${x.c.id}/unarchive`)
    expect(u.status).toBe(200)
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(true)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(true)
    expect(await logRows(x.c.id)).toHaveLength(0)
  })

  test('unarchiving a customer leaves a job archived on its own before', async () => {
    const x = await makeCustomer('own')
    expect((await call('owner', 'POST', `/api/saved-jobs/${x.j.id}/archive`)).status).toBe(200)
    await new Promise(r => setTimeout(r, 20))
    await call('owner', 'POST', `/api/crm-contacts/${x.c.id}/archive`)
    await call('owner', 'POST', `/api/crm-contacts/${x.c.id}/unarchive`)
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(true)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(false)
    expect((await call('owner', 'POST', `/api/saved-jobs/${x.j.id}/unarchive`)).status).toBe(200)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(true)
  })

  test('delete a quote: its job goes with it; restore', async () => {
    const x = await makeCustomer('quote')
    expect((await call('owner', 'DELETE', `/api/saved-quotes/${x.q.id}`)).status).toBe(200)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(false)
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(true)
    const [row] = await logRows(x.q.id)
    expect(row.snapshot.rows.map((r: any) => r.id)).toEqual(expect.arrayContaining([x.q.id, x.j.id, x.a.id, x.g.id]))
    expect((await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)).status).toBe(200)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(true)
  })

  test('delete a job: its schedule entry goes with it; restore', async () => {
    const x = await makeCustomer('job')
    expect((await call('owner', 'DELETE', `/api/saved-jobs/${x.j.id}`)).status).toBe(200)
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(false)
    expect(((await call('owner', 'GET', '/api/schedule/jobs')).json.data as any[]).some(g => g.id === x.g.id)).toBe(false)
    const [row] = await logRows(x.j.id)
    expect((await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)).status).toBe(200)
    expect(((await call('owner', 'GET', '/api/schedule/jobs')).json.data as any[]).some(g => g.id === x.g.id)).toBe(true)
  })

  test('delete a card: off the board and logged; an older screen cannot put it back; restore', async () => {
    const x = await makeCustomer('card')
    expect((await call('owner', 'DELETE', `/api/pipeline/cards/${x.card.id}`)).status).toBe(200)
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(false)
    const [row] = await logRows(x.card.id)
    expect(row.entityType).toBe('card')
    // An older phone still holding the card sends it again: it stays deleted.
    const v = (await call('owner', 'GET', '/api/pipeline')).json.data.version
    const p = await call('owner', 'PATCH', '/api/pipeline', { upsert: [{ lead: { ...x.card, stage: 'Signed Contract' } }], remove: [], baseVersion: v })
    expect(p.status).toBe(200)
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(false)
    expect((await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)).status).toBe(200)
    expect((await boardCards()).some(l => l.id === x.card.id)).toBe(true)
  })

  test('a card dropped by a whole board save is logged too', async () => {
    const x = await makeCustomer('put')
    const cur = (await call('owner', 'GET', '/api/pipeline')).json.data
    const r = await call('owner', 'PUT', '/api/pipeline', { leads: (cur.leads as any[]).filter(l => l.id !== x.card.id), stages: cur.stages, baseVersion: cur.version })
    expect(r.status).toBe(200)
    expect(await logRows(x.card.id)).toHaveLength(1)
  })

  test('restore skips a child changed after the delete, and says so', async () => {
    const x = await makeCustomer('skip')
    await call('owner', 'DELETE', `/api/crm-contacts/${x.c.id}`)
    await prisma.savedQuote.update({ where: { id: x.q.id }, data: { notes: 'changed after the delete' } })
    const [row] = await logRows(x.c.id)
    const r = await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)
    expect(r.status).toBe(200)
    expect(r.json.data.skipped.map((s: any) => s.why)).toContain('it changed after it was deleted')
    expect((await prisma.savedQuote.findUnique({ where: { id: x.q.id } })).deletedAt).not.toBeNull()
    expect((await boardJobs()).some(j => j.id === x.j.id)).toBe(true)
  })

  test('a quote of a deleted customer waits for the customer', async () => {
    const x = await makeCustomer('order')
    await call('owner', 'DELETE', `/api/saved-quotes/${x.q.id}`)
    await call('owner', 'DELETE', `/api/crm-contacts/${x.c.id}`)
    const [qRow] = await logRows(x.q.id)
    const r = await call('owner', 'POST', `/api/deleted-records/${qRow.id}/restore`)
    expect(r.status).toBe(409)
    expect(r.json.error).toMatch(/Restore the customer first/)
  })

  test('delete a login: logged without its password; restore makes it again as invited', async () => {
    const u = await prisma.crmUser.create({ data: { email: `${tag}-gone@example.test`, firstName: 'Gone', lastName: 'Login', role: 'sales_rep', status: 'active', mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
    expect((await call('owner', 'DELETE', `/api/crm-auth/users/${u.id}`)).status).toBe(200)
    expect(await prisma.crmUser.findUnique({ where: { id: u.id } })).toBeNull()
    const [row] = await logRows(u.id)
    expect(row.entityType).toBe('login')
    expect(JSON.stringify(row.snapshot)).not.toContain('passwordHash')
    expect((await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)).status).toBe(200)
    const again = await prisma.crmUser.findUnique({ where: { id: u.id } })
    expect(again?.status).toBe('invited')
    expect(again?.passwordHash).toBeNull()
  })

  test('remove a catalog item: logged with its stock count; restore puts both back', async () => {
    const inv = (await prisma.inventoryState.findUnique({ where: { accountId } }))
    const r = await call('owner', 'PUT', '/api/inventory', { items: (inv.items as any[]).filter(i => i.id !== `item-${tag}`), bundles: [], locations: [], stockLevels: [], transactions: [], baseVersion: inv.version })
    expect(r.status).toBe(200)
    const [row] = await logRows(`item-${tag}`)
    expect(row.entityType).toBe('inventory_item')
    expect(row.snapshot.items.map((i: any) => i.doc).sort()).toEqual(['inventory.items', 'inventory.stockLevels'])
    expect((await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)).status).toBe(200)
    const now = await prisma.inventoryState.findUnique({ where: { accountId } })
    expect((now.items as any[]).some(i => i.id === `item-${tag}`)).toBe(true)
    expect((now.stockLevels as any[]).some(l => l.itemId === `item-${tag}` && l.quantity === 7)).toBe(true)
  })

  test('remove a vendor: logged; restore puts it back', async () => {
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    expect((await call('owner', 'PUT', '/api/vendors-state', { vendors: [], bills: [], payments: [], baseVersion: vs.version })).status).toBe(200)
    const [row] = await logRows(`vendor-${tag}`)
    expect(row.entityType).toBe('vendor')
    expect((await call('owner', 'POST', `/api/deleted-records/${row.id}/restore`)).status).toBe(200)
    expect(((await prisma.vendorState.findUnique({ where: { accountId } })).vendors as any[]).some(v => v.id === `vendor-${tag}`)).toBe(true)
  })

  test('only the owner or an admin deletes; a salesman, the office and a manager archive instead', async () => {
    const x = await makeCustomer('roles')
    // The salesman's own customer (Oct 28 2026: the Salesman reaches only the Salesman's own records).
    await prisma.crmContact.update({ where: { id: x.c.id }, data: { ownerId: users.sales } })
    for (const who of ['sales', 'worker', 'manager']) {
      expect((await call(who, 'DELETE', `/api/crm-contacts/${x.c.id}`)).status).toBe(403)
      expect((await call(who, 'DELETE', `/api/pipeline/cards/${x.card.id}`)).status).toBe(403)
      expect((await call(who, 'GET', '/api/deleted-records')).status).toBe(403)
    }
    expect((await call('manager', 'DELETE', `/api/saved-jobs/${x.j.id}`)).status).toBe(403)
    // The salesman archives a card but not a job (that is the office's board).
    expect((await call('sales', 'POST', `/api/pipeline/cards/${x.card.id}/archive`)).status).toBe(200)
    expect((await call('sales', 'POST', `/api/saved-jobs/${x.j.id}/archive`)).status).toBe(403)
    expect((await call('worker', 'POST', `/api/saved-jobs/${x.j.id}/archive`)).status).toBe(200)
    expect(await logRows(x.c.id)).toHaveLength(0)
  })

  test('there is no way to delete a log row', async () => {
    const [row] = await prisma.deletionLog.findMany({ where: { accountId }, take: 1 })
    expect((await call('owner', 'DELETE', `/api/deleted-records/${row.id}`)).status).toBe(404)
    expect(await prisma.deletionLog.findUnique({ where: { id: row.id } })).not.toBeNull()
  })
})
