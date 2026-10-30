/**
 * The owner changes a team member's login email (lib/loginEmailChange.ts,
 * PATCH /api/crm-auth/users/:id/email): the owner only (an admin under an
 * owner, the office and a Salesman get a 403), a proper address stored
 * trimmed and lower case, one already used by another login (any status)
 * refused, the email-keyed references follow, the person stays signed in, and
 * the next sign in works with the new email and not the old one.
 *
 * One company made for the test and removed after; database writes happen only
 * inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { normalizeLoginEmail, EMAIL_IN_USE, OWNER_ONLY } from '../src/server/lib/loginEmailChange.js'

describe('a login email as it is stored', () => {
  test('trimmed and lower case; not an address is refused', () => {
    expect(normalizeLoginEmail('  Christa.F@Example.COM ')).toEqual({ ok: true, value: 'christa.f@example.com' })
    expect(normalizeLoginEmail('christa').ok).toBe(false)
    expect(normalizeLoginEmail('   ').ok).toBe(false)
    expect(normalizeLoginEmail(undefined).ok).toBe(false)
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('changing a login email through the API (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  const tag = `lec-${Date.now().toString(36)}`
  const password = `pw-${tag}`
  let accountId = ''
  const users: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  const mail = (k: string) => `${tag}-${k}@example.test`
  const newMail = `${tag}-worker-new@example.test`
  let contactId = ''

  const login = (email: string) => fetch(`${base}/api/crm-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const change = (as: string, id: string, email: unknown) => fetch(`${base}/api/crm-auth/users/${id}/email`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[as]}` }, body: JSON.stringify({ email }) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const get = (as: string, path: string) => fetch(`${base}/api/crm-auth${path}`, { headers: { Authorization: `Bearer ${tokens[as]}` } })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const make = async (key: string, role: string, status = 'active') => {
      const u = await prisma.crmUser.create({ data: { email: mail(key), firstName: 'Test', lastName: key, role, status, mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
      users[key] = u.id
    }
    await make('owner', 'super_admin')
    await make('admin', 'admin')
    await make('office', 'office_staff')
    await make('sales', 'sales_rep')
    await make('worker', 'sales_rep')
    await make('gone', 'sales_rep', 'deactivated')
    // What keys the worker by email: a bell notice, a task, a lead, a note's author; and a customer who happens to use the same address.
    await prisma.notification.create({ data: { recipientId: mail('worker'), title: `${tag} notice`, body: 'b' } })
    await prisma.task.create({ data: { title: `${tag} task`, assignedTo: mail('worker') } })
    await prisma.lead.create({ data: { firstName: tag, assignedRepEmail: mail('worker'), assignedRepName: 'Test worker' } })
    const contact = await prisma.crmContact.create({ data: { firstName: tag, lastName: 'Customer', email: mail('worker'), accountId } })
    contactId = contact.id
    await prisma.crmContactNote.create({ data: { crmContactId: contact.id, accountId, body: `${tag} note`, createdBy: mail('worker') } })

    const { requireLiveSession } = await import('../src/server/lib/sessionGuard.js')
    const app = express()
    app.use(express.json())
    app.use('/api', requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const k of ['owner', 'admin', 'office', 'sales', 'worker']) {
      const r = await login(mail(k))
      tokens[k] = r.json.data.accessToken
    }
  })

  afterAll(async () => {
    server?.close()
    if (!prisma) return
    const ids = Object.values(users)
    await prisma.notification.deleteMany({ where: { title: `${tag} notice` } })
    await prisma.task.deleteMany({ where: { title: `${tag} task` } })
    await prisma.lead.deleteMany({ where: { firstName: tag } })
    await prisma.crmContactNote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityType: 'CrmUser', entityId: { in: ids } } })
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUser.deleteMany({ where: { id: { in: ids } } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('the Team page offers the change to the owner only', async () => {
    expect((await get('owner', '/team-rights')).json.data.canChangeEmail).toBe(true)
    for (const k of ['admin', 'office', 'sales']) expect((await get(k, '/team-rights')).json.data.canChangeEmail).toBe(false)
  })

  test('an admin under an owner, the office and a Salesman are refused (403) and nothing changes', async () => {
    for (const k of ['admin', 'office', 'sales']) {
      const r = await change(k, users.worker, newMail)
      expect(r.status).toBe(403)
      expect(r.json.error).toBe(OWNER_ONLY)
    }
    expect((await prisma.crmUser.findUnique({ where: { id: users.worker } })).email).toBe(mail('worker'))
  })

  test("an email another login uses (even a switched off one) is refused without naming it; not an address is refused", async () => {
    const r = await change('owner', users.worker, `  ${mail('gone').toUpperCase()} `)
    expect(r.status).toBe(409)
    expect(r.json.error).toBe(EMAIL_IN_USE)
    expect(JSON.stringify(r.json)).not.toContain('gone')
    expect((await change('owner', users.worker, 'not-an-email')).status).toBe(400)
    expect((await prisma.crmUser.findUnique({ where: { id: users.worker } })).email).toBe(mail('worker'))
  })

  test('the owner changes it: stored lower case, the email-keyed references follow, history records old and new', async () => {
    const r = await change('owner', users.worker, `  ${newMail.toUpperCase()} `)
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ email: newMail, changed: true })
    expect((await prisma.crmUser.findUnique({ where: { id: users.worker } })).email).toBe(newMail)
    expect((await prisma.notification.findFirst({ where: { title: `${tag} notice` } })).recipientId).toBe(newMail)
    expect((await prisma.task.findFirst({ where: { title: `${tag} task` } })).assignedTo).toBe(newMail)
    expect((await prisma.lead.findFirst({ where: { firstName: tag } })).assignedRepEmail).toBe(newMail)
    expect((await prisma.crmContactNote.findFirst({ where: { accountId } })).createdBy).toBe(newMail)
    // The customer's own email is the customer's: it stays.
    expect((await prisma.crmContact.findUnique({ where: { id: contactId } })).email).toBe(mail('worker'))
    const a = await prisma.crmAuditLog.findFirst({ where: { entityType: 'CrmUser', entityId: users.worker, action: 'update' }, orderBy: { createdAt: 'desc' } })
    expect(a.userId).toBe(users.owner)
    expect(a.oldValues).toEqual({ email: mail('worker') })
    expect(a.newValues).toEqual({ email: newMail })
    const act = await prisma.crmUserActivity.findFirst({ where: { userId: users.owner, action: 'email_changed', entityId: users.worker } })
    expect(act.metadata).toMatchObject({ oldEmail: mail('worker'), newEmail: newMail })
  })

  test("the Team page's Edit save after the email (role sent unchanged) does not sign the person out", async () => {
    const r = await fetch(`${base}/api/crm-auth/users/${users.worker}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.owner}` }, body: JSON.stringify({ firstName: 'Test', lastName: 'worker', phone: '', role: 'sales_rep', status: 'active' }) })
    expect(r.status).toBe(200)
    expect(await prisma.crmUserSession.count({ where: { userId: users.worker, revokedAt: null } })).toBeGreaterThan(0)
    const a = await prisma.crmAuditLog.findFirst({ where: { entityType: 'CrmUser', entityId: users.worker }, orderBy: { createdAt: 'desc' } })
    expect(a.userId).toBe(users.owner)
  })

  test('the person stays signed in; the next sign in is with the new email and the same password, never the old email', async () => {
    const me = await get('worker', '/me')
    expect(me.status).toBe(200)
    expect(me.json.data.email).toBe(newMail)
    expect((await login(mail('worker'))).status).toBe(401)
    const fresh = await login(newMail)
    expect(fresh.status).toBe(200)
    expect(fresh.json.data.user.id).toBe(users.worker)
  })

  test('the owner can change his own email too', async () => {
    const own = `${tag}-owner-new@example.test`
    const r = await change('owner', users.owner, own)
    expect(r.status).toBe(200)
    expect((await login(own)).status).toBe(200)
    expect((await login(mail('owner'))).status).toBe(401)
  })
})
