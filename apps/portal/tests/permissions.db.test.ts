/**
 * Who may do what, through the real routes, against the dev database (DEV_DB=1
 * and ezbiz_dev only; vitest does not even load this file anywhere else).
 * Everything runs on a company made for the test, with its own owner,
 * salesman, field crew and office logins, all removed after it.
 *
 *   - A salesman (sales_rep) may: add a customer with a pipeline card, move
 *     the card, add a note, book an appointment, create and edit a quote, send
 *     a proposal link, upload a photo, save a quote's material list.
 *   - A salesman may not (403 with a plain sentence): change settings, prices,
 *     kits, tier sets, automations, the schedule, vendors, billing, users;
 *     delete a customer, quote, job, card, note or photo; change the stages.
 *   - The owner still may do all of it.
 *   - Field crew may not write quotes; the office may remove a photo but not a customer.
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('roles and permissions (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  let accountId = ''
  const tag = `perm-${Date.now().toString(36)}`
  const users: Record<string, { id: string; token: string }> = {}
  const invitedEmails: string[] = []

  type Who = 'owner' | 'sales' | 'crew' | 'office'
  const call = (who: Who, method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const refused = (r: { status: number; json: any }, words: RegExp) => {
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('NOT_ALLOWED')
    expect(r.json.error).toMatch(words)
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    const roles: Record<Who, string> = { owner: 'super_admin', sales: 'sales_rep', crew: 'field_crew', office: 'office_staff' }
    for (const [who, role] of Object.entries(roles) as [Who, string][]) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${who}@example.test`, firstName: 'Test', lastName: who, role, status: 'active', crmAccountId: accountId, mustChangePassword: false } })
      users[who] = { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role, firstName: 'Test', lastName: who, crmAccountId: accountId }, secret, { expiresIn: '15m' }) }
    }
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/crm-contacts', (await import('../src/server/routes/crm-contacts.js')).default)
    app.use('/api/pipeline', (await import('../src/server/routes/pipeline.js')).default)
    app.use('/api/pipeline-stages', (await import('../src/server/routes/pipeline-stages.js')).default)
    app.use('/api/saved-quotes', (await import('../src/server/routes/saved-quotes.js')).default)
    app.use('/api/saved-jobs', (await import('../src/server/routes/saved-jobs.js')).default)
    app.use('/api/appointments', (await import('../src/server/routes/appointments.js')).default)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
    app.use('/api/inventory-state', (await import('../src/server/routes/inventory.js')).default)
    app.use('/api/vendor-state', (await import('../src/server/routes/vendors-state.js')).default)
    app.use('/api/tier-sets', (await import('../src/server/routes/tier-sets.js')).default)
    app.use('/api/automations', (await import('../src/server/routes/automations.js')).default)
    app.use('/api/schedule', (await import('../src/server/routes/schedule.js')).default)
    app.use('/api/media', (await import('../src/server/routes/media.js')).default)
    app.use('/api/kv', (await import('../src/server/routes/kv.js')).default)
    app.use('/api/style-photos', (await import('../src/server/routes/proposal.js')).stylePhotos)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const media = await prisma.mediaItem.findMany({ where: { accountId } })
    for (const m of media) for (const f of [m.path, m.thumbPath, m.webPath, m.markupPath].filter(Boolean)) fs.rmSync(f, { force: true })
    fs.rmSync(path.resolve(process.env.UPLOAD_DIR || './uploads', 'media', accountId), { recursive: true, force: true })
    const userIds = Object.values(users).map(u => u.id)
    const invited = await prisma.crmUser.findMany({ where: { email: { in: invitedEmails } }, select: { id: true } })
    const allUsers = [...userIds, ...invited.map((u: any) => u.id)]
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: allUsers } } }).catch(() => {})
    const models = ['automationRun', 'automationEvent', 'automationRule', 'stageRule', 'calendarEventLink', 'calendarSyncState', 'geoPoint',
      'mediaItem', 'mediaUpload', 'voiceClip', 'crmContactNote', 'appointment', 'savedJob', 'savedQuote', 'scheduledGridJob', 'scheduleRainDay',
      'scheduleSettings', 'pipelineState', 'businessState', 'inventoryState', 'vendorState', 'accountKeyValue', 'proposalTierSet', 'stylePhoto',
      'scheduledDeletion', 'crmContact']
    for (let round = 0; round < 2; round++) {
      for (const m of models) await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    }
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: allUsers } } }).catch(() => {})
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: allUsers } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { id: { in: allUsers } } }).catch((e: unknown) => console.error('[permissions test] users cleanup:', e))
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[permissions test] account cleanup:', e))
  })

  const contactId = crypto.randomUUID()
  const cardId = `lead-${tag}`
  const quoteId = crypto.randomUUID()

  test('salesman: adds a customer with a card, moves it, adds a note, books an appointment', async () => {
    const made = await call('sales', 'POST', '/api/crm-contacts', { id: contactId, firstName: 'Perm', lastName: 'Test', phone: '3525550100', lead: { id: cardId, firstName: 'Perm', lastName: 'Test', stage: 'New Lead', customerId: contactId } })   // an old app's stage word
    expect([200, 201]).toContain(made.status)
    const board = await call('sales', 'GET', '/api/pipeline')
    expect(board.status).toBe(200)
    const card = board.json.data.leads.find((l: any) => l.id === cardId)
    expect(card).toBeTruthy()
    // A stage not in Settings > Pipeline Stages: the new card lands in the first stage.
    expect(card.stage).toBe('First Contact')
    const moved = await call('sales', 'PATCH', '/api/pipeline', { upsert: [{ lead: { ...card, stage: 'Appointment' } }], remove: [], baseVersion: board.json.data.version })
    expect(moved.status).toBe(200)
    // A stage list sent along (an old app) is ignored.
    const again = await call('sales', 'PATCH', '/api/pipeline', { upsert: [{ lead: { ...card, stage: 'Estimating' } }], remove: [], stages: board.json.data.stages, baseVersion: moved.json.version })
    expect(again.status).toBe(200)
    const note = await call('sales', 'POST', `/api/crm-contacts/${contactId}/notes`, { id: crypto.randomUUID(), body: 'Called, wants a quote' })
    expect([200, 201]).toContain(note.status)
    const appt = await call('sales', 'POST', '/api/appointments', { id: crypto.randomUUID(), crmContactId: contactId, type: 'estimate', startAt: new Date(Date.now() + 86_400_000).toISOString() })
    expect([200, 201]).toContain(appt.status)
  })

  test('salesman: cannot remove a card, change the stages, or drop a card with a whole board save', async () => {
    const board = (await call('sales', 'GET', '/api/pipeline')).json.data
    refused(await call('sales', 'PATCH', '/api/pipeline', { upsert: [], remove: [cardId], baseVersion: board.version }), /owner or an admin can delete/)
    // The stages are Settings > Pipeline Stages (owner and admin only); a stage list sent with the board is ignored, never saved.
    const ignored = await call('sales', 'PATCH', '/api/pipeline', { upsert: [], remove: [], stages: [{ id: 'x', name: 'Renamed' }], baseVersion: board.version })
    expect(ignored.status).toBe(200)
    expect((await call('sales', 'GET', '/api/pipeline')).json.data.stages).toEqual(board.stages)
    refused(await call('sales', 'PUT', '/api/pipeline-stages', { stages: [], baseVersion: 0 }), /owner or an admin can change the pipeline stages/)
    const fresh = (await call('sales', 'GET', '/api/pipeline')).json.data
    const dropped = await call('sales', 'PUT', '/api/pipeline', { leads: fresh.leads.filter((l: any) => l.id !== cardId), stages: fresh.stages, baseVersion: fresh.version })
    refused(dropped, /owner or an admin can delete/)
    expect(dropped.json.data.leads.some((l: any) => l.id === cardId)).toBe(true)
    // Adding a card with a whole board save is fine.
    const added = await call('sales', 'PUT', '/api/pipeline', { leads: [...fresh.leads, { id: `${cardId}-2`, firstName: 'Second', stage: 'First Contact' }], stages: fresh.stages, baseVersion: fresh.version })
    expect(added.status).toBe(200)
  })

  test('salesman: creates and edits a quote, sends a proposal link; cannot delete it', async () => {
    const q = await call('sales', 'POST', '/api/saved-quotes', { id: quoteId, crmContactId: contactId, customerName: 'Perm Test', fenceStyle: "CL - 4' Galv", runs: [40], finalPrice: 1500, status: 'DRAFT' })
    expect([200, 201]).toContain(q.status)
    const e = await call('sales', 'PATCH', `/api/saved-quotes/${quoteId}`, { customerName: 'Perm Test', fenceStyle: "CL - 4' Galv", runs: [40, 20], finalPrice: 2100, status: 'DRAFT' })
    expect(e.status).toBe(200)
    const link = await call('sales', 'POST', `/api/saved-quotes/${quoteId}/share-token`, {})
    expect(link.status).toBe(200)
    refused(await call('sales', 'DELETE', `/api/saved-quotes/${quoteId}`), /owner or an admin can delete/)
  })

  test('salesman: uploads a photo; cannot delete it', async () => {
    const clientId = `perm-photo-${tag}`
    const bytes = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')
    const start = await call('sales', 'POST', '/api/media/uploads', { clientId, size: bytes.length, meta: { kind: 'photo', mime: 'image/jpeg', customerId: contactId } })
    expect(start.status).toBe(200)
    const chunk = await fetch(`${base}/api/media/uploads/${clientId}?offset=0`, { method: 'PUT', headers: { Authorization: `Bearer ${users.sales.token}`, 'Content-Type': 'application/octet-stream' }, body: bytes })
    expect(chunk.status).toBe(200)
    const done = await call('sales', 'POST', `/api/media/uploads/${clientId}/finish`)
    expect(done.status).toBe(200)
    const id = done.json.data.id
    refused(await call('sales', 'DELETE', `/api/media/${id}`), /cannot delete/)
    // The office may remove a photo.
    const off = await call('office', 'DELETE', `/api/media/${id}`)
    expect(off.status).toBe(200)
    expect(off.json.data.deleted).toBe(1)
  })

  test('salesman: cannot delete a customer, a note or a job', async () => {
    refused(await call('sales', 'DELETE', `/api/crm-contacts/${contactId}`), /owner or an admin can delete/)
    const notes = await call('sales', 'GET', `/api/crm-contacts/${contactId}/notes`)
    const noteId = notes.json.data[0].id
    refused(await call('sales', 'DELETE', `/api/crm-contacts/${contactId}/notes/${noteId}`), /cannot delete/)
    const job = await call('sales', 'POST', '/api/saved-jobs', { id: crypto.randomUUID(), crmContactId: contactId, customerName: 'Perm Test', fenceStyle: "CL - 4' Galv", quoteId })
    expect([200, 201]).toContain(job.status)
    // The Salesman's jobs are read only (audit #49, lib/salesmanJobs.ts).
    refused(await call('sales', 'DELETE', `/api/saved-jobs/${job.json.data.id}`), /read only/)
    refused(await call('office', 'DELETE', `/api/crm-contacts/${contactId}`), /owner or an admin can delete/)
  })

  test('salesman: business data — settings, billing and the books refused, a quote\'s own data allowed', async () => {
    const cur = (await call('owner', 'GET', '/api/business-state')).json.data
    const owner = await call('owner', 'PATCH', '/api/business-state', { config: { fenceStyles: [{ name: 'Test style' }], voice: { onFor: [] } }, baseVersion: cur.version })
    expect(owner.status).toBe(200)
    let v = owner.json.data.version
    // The Salesman's phone reads the record first: a save may build only on a copy the server handed out (lib/salesServed.ts).
    expect((await call('sales', 'GET', '/api/business-state')).json.data.version).toBe(v)
    const cfg = refused
    cfg(await call('sales', 'PATCH', '/api/business-state', { config: { fenceStyles: [{ name: 'Cheaper style' }], voice: { onFor: [] } }, baseVersion: v }), /cannot change settings/)
    cfg(await call('sales', 'PATCH', '/api/business-state', { emailTemplates: { welcome: 'hi' }, baseVersion: v }), /cannot change settings/)
    cfg(await call('sales', 'PATCH', '/api/business-state', { invoices: [{ id: 'inv-1', amount: 1 }], baseVersion: v }), /cannot change billing/)
    cfg(await call('sales', 'PATCH', '/api/business-state', { plEntries: [{ id: 'pl-1' }], baseVersion: v }), /cannot change the books/)
    // An unchanged settings key sent along is not a change.
    const same = await call('sales', 'PATCH', '/api/business-state', { config: owner.json.data.config, pullSheets: [{ id: 'ps-1', quoteId }], baseVersion: v })
    expect(same.status).toBe(200)
    v = same.json.data.version
    // Voice on for themselves in the quote screen is the one config change a salesman makes.
    const voice = await call('sales', 'PATCH', '/api/business-state', { config: { ...owner.json.data.config, voice: { onFor: [users.sales.id] } }, baseVersion: v })
    expect(voice.status).toBe(200)
    v = voice.json.data.version
    cfg(await call('sales', 'PATCH', '/api/business-state', { config: { ...owner.json.data.config, voice: { onFor: [users.sales.id, users.owner.id] } }, baseVersion: v }), /cannot change settings/)
    const refusedWithCopy = await call('sales', 'PATCH', '/api/business-state', { budget: { year: 1 }, baseVersion: v })
    expect(refusedWithCopy.status).toBe(403)
    expect(refusedWithCopy.json.version).toBe(v)
    expect(refusedWithCopy.json.data).toBeTruthy()
    // The owner still may.
    expect((await call('owner', 'PATCH', '/api/business-state', { budget: { year: 1 }, invoices: [{ id: 'inv-1', amount: 1 }], baseVersion: v })).status).toBe(200)
  })

  test('salesman: inventory prices and kits refused, setting stock aside for a sale allowed', async () => {
    const cur = (await call('owner', 'GET', '/api/inventory-state')).json.data
    const items = [{ id: 'it-1', name: 'Post', unitCost: 10, category: 'Test', reservedQty: 0 }]
    const owner = await call('owner', 'PUT', '/api/inventory-state', { items, bundles: [], locations: [], stockLevels: [], transactions: [], kits: [], baseVersion: cur.version })
    expect(owner.status).toBe(200)
    const v = owner.json.data.version
    refused(await call('sales', 'PUT', '/api/inventory-state', { items: [{ ...items[0], unitCost: 1 }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [], baseVersion: v }), /cannot change prices/)
    refused(await call('sales', 'PUT', '/api/inventory-state', { items, bundles: [], locations: [], stockLevels: [], transactions: [], kits: [{ id: 'k1', style: 'x' }], baseVersion: v }), /cannot change prices/)
    refused(await call('sales', 'PUT', '/api/inventory-state', { items: [...items, { id: 'it-2', name: 'New', unitCost: 1, category: 'Test' }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [], baseVersion: v }), /cannot change prices/)
    const reserve = await call('sales', 'PUT', '/api/inventory-state', { items: [{ ...items[0], reservedQty: 4 }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [], baseVersion: v })
    expect(reserve.status).toBe(200)
    // The office may count stock but not change a price.
    const v2 = reserve.json.data.version
    expect((await call('office', 'PUT', '/api/inventory-state', { items: [{ ...items[0], reservedQty: 4, qtyOnHand: 30 }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [], baseVersion: v2 })).status).toBe(200)
    refused(await call('office', 'PUT', '/api/inventory-state', { items: [{ ...items[0], unitCost: 99 }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [], baseVersion: v2 + 1 }), /cannot change prices/)
  })

  test('salesman: tier sets, automations, schedule, vendors, style photos, ops stages refused', async () => {
    refused(await call('sales', 'POST', '/api/tier-sets', { category: 'Vinyl', name: 'Cheap', tiers: [] }), /cannot change prices/)
    refused(await call('sales', 'POST', '/api/automations/rules', { name: 'x' }), /cannot change automations/)
    refused(await call('sales', 'PUT', '/api/automations/stage-rules', { rules: [] }), /cannot change automations/)
    refused(await call('sales', 'PUT', '/api/schedule/board', { settings: { workDays: [1, 2, 3, 4], crews: [] }, jobs: [], baseVersion: 0 }), /cannot change the crew schedule/)
    refused(await call('sales', 'PUT', '/api/schedule/settings', { workDays: [1, 2, 3, 4, 5], crews: [], baseVersion: 0 }), /cannot change the crew schedule|cannot change settings/)  // D5: every Schedule write from a Salesman is refused first
    refused(await call('sales', 'PUT', '/api/vendor-state', { vendors: [{ id: 'v1', name: 'Vendor' }], bills: [], payments: [], baseVersion: 0 }), /cannot change billing/)
    refused(await call('sales', 'PUT', '/api/kv/fencepro_ops_stages', { value: [{ id: 's1', name: 'Mine' }], baseVersion: 0 }), /cannot change settings/)
    refused(await call('sales', 'POST', '/api/style-photos', {}), /cannot change settings/)
    // Its own working lists still save (customer activity).
    expect((await call('sales', 'PUT', '/api/kv/fencepro_customer_activity', { value: [{ id: 'a1', body: 'called' }], baseVersion: 0 })).status).toBe(200)
    // The office may not change working days, the owner may.
    refused(await call('office', 'PUT', '/api/schedule/board', { settings: { workDays: [1, 2, 3, 4, 5], crews: [] }, jobs: [], baseVersion: 0 }), /cannot change settings/)
    expect((await call('owner', 'PUT', '/api/schedule/board', { settings: { workDays: [1, 2, 3, 4], crews: [] }, jobs: [], baseVersion: 0 })).status).toBe(200)
  })

  test('users: only the owner or an admin may invite or change roles; an invite can be a salesman', async () => {
    refused(await call('sales', 'POST', '/api/crm-auth/invite', { firstName: 'X', lastName: 'Y', email: `${tag}-x@example.test`, role: 'sales_rep' }), /owner or an admin/)
    refused(await call('sales', 'PATCH', `/api/crm-auth/users/${users.sales.id}`, { role: 'admin' }), /owner or an admin/)
    refused(await call('office', 'GET', '/api/crm-auth/users'), /owner or an admin/)
    const email = `${tag}-invited@example.test`
    invitedEmails.push(email)
    const inv = await call('owner', 'POST', '/api/crm-auth/invite', { firstName: 'Invited', lastName: 'Salesman', email, role: 'sales_rep' })
    expect(inv.status).toBe(201)
    const row = await prisma.crmUser.findUnique({ where: { email } })
    expect(row.role).toBe('sales_rep')
    expect(row.crmAccountId).toBe(accountId)
    expect(row.inviteTokenExpiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000)
    // The owner changes the role; it applies at once (that person's sessions are signed out).
    const ch = await call('owner', 'PATCH', `/api/crm-auth/users/${row.id}`, { role: 'field_crew' })
    expect(ch.status).toBe(200)
    expect(ch.json.data.role).toBe('field_crew')
  })

  test('field crew: no quote writes; office: quotes yes, deleting a quote no', async () => {
    refused(await call('crew', 'POST', '/api/saved-quotes', { id: crypto.randomUUID(), customerName: 'Crew', fenceStyle: 'x', runs: [10] }), /cannot change quotes/)
    refused(await call('crew', 'PATCH', `/api/saved-quotes/${quoteId}`, { customerName: 'Crew' }), /cannot change quotes/)
    expect((await call('office', 'PATCH', `/api/saved-quotes/${quoteId}`, { customerName: 'Perm Test', fenceStyle: "CL - 4' Galv", runs: [40], finalPrice: 1500, status: 'DRAFT' })).status).toBe(200)
    refused(await call('office', 'DELETE', `/api/saved-quotes/${quoteId}`), /owner or an admin can delete/)
  })

  test('owner: still may delete the card, the note, the quote and the customer', async () => {
    const board = (await call('owner', 'GET', '/api/pipeline')).json.data
    expect((await call('owner', 'PATCH', '/api/pipeline', { upsert: [], remove: [cardId, `${cardId}-2`], baseVersion: board.version })).status).toBe(200)
    const notes = await call('owner', 'GET', `/api/crm-contacts/${contactId}/notes`)
    expect((await call('owner', 'DELETE', `/api/crm-contacts/${contactId}/notes/${notes.json.data[0].id}`)).status).toBe(200)
    expect((await call('owner', 'DELETE', `/api/saved-quotes/${quoteId}`)).status).toBe(200)
    expect((await call('owner', 'DELETE', `/api/crm-contacts/${contactId}`)).status).toBe(200)
  })
})
