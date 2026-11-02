/**
 * Team changes that could take over a login ask for the caller's own password (routes/crm-auth.ts), on the dev
 * database (DEV_DB=1; refuses any other): a session on a stolen phone must not be able to make an owner or an
 * admin, or move an owner's sign in. Everything else on the Team screen works as before. Makes its own logins.
 */
import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('Team changes that need a password (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: routes } = await import('../src/server/routes/crm-auth.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')

  const tag = `e2e-raise-${crypto.randomUUID().slice(0, 8)}`
  const RIGHT = `Right-${crypto.randomUUID()}`
  const outbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'raise-')), 'outbox.log')
  const app = express()
  app.use(express.json())
  app.use('/api/crm-auth', routes)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/crm-auth`
  const realOwner = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin', status: 'active' }, orderBy: { createdAt: 'asc' } }))!
  const accountId = realOwner.crmAccountId!
  let me: any, office: any, boss: string
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, { method, headers: { Authorization: `Bearer ${boss}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const roleOf = async (id: string) => (await prisma.crmUser.findUnique({ where: { id } }))?.role
  const made = async (role: any) => prisma.crmUser.create({ data: { email: `${tag}-${crypto.randomUUID().slice(0, 6)}@example.invalid`, firstName: 'T', lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } })

  beforeAll(async () => {
    process.env.DEV_OUTBOX_FILE = outbox
    me = await prisma.crmUser.create({ data: { email: `${tag}-owner@example.invalid`, firstName: 'Owner', lastName: tag, role: 'super_admin', status: 'active', crmAccountId: accountId, passwordHash: await bcrypt.hash(RIGHT, 4) } })
    await prisma.pushSubscription.create({ data: { id: `${tag}-sub`, accountId, userId: realOwner.id, endpoint: `https://push.example.invalid/${tag}`, p256dh: 'x', auth: 'x' } })
    boss = jwt.sign({ sub: me.id, email: me.email, role: 'super_admin', firstName: 'Owner', lastName: tag, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
  })
  beforeEach(async () => {
    office = await made('office_staff')
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'password_' }, metadata: { path: ['userId'], equals: me.id } } })
  })
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'password_' }, metadata: { path: ['userId'], equals: me.id } } })
    await prisma.pushSubscription.deleteMany({ where: { id: `${tag}-sub` } })
    await prisma.crmUser.deleteMany({ where: { email: { startsWith: tag } } })
    delete process.env.DEV_OUTBOX_FILE
    server.close()
  })

  test.each(['admin', 'super_admin'])('a session alone cannot raise anyone to %s', async role => {
    const r = await call('PATCH', `/users/${office.id}`, { role })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('PASSWORD_NEEDED')
    expect(await roleOf(office.id)).toBe('office_staff')
    expect((await call('PATCH', `/users/${office.id}`, { role, currentPassword: 'wrong' })).json.code).toBe('WRONG_PASSWORD')
    expect(await roleOf(office.id)).toBe('office_staff')
  })
  test('with the password it goes through, and the owner gets a push', async () => {
    const r = await call('PATCH', `/users/${office.id}`, { role: 'admin', currentPassword: RIGHT })
    expect(r.status).toBe(200)
    expect(await roleOf(office.id)).toBe('admin')
    expect(fs.readFileSync(outbox, 'utf8')).toContain('A login was made an admin')
  })
  test('a session alone cannot invite an admin; the link never comes back', async () => {
    const email = `${tag}-new@example.invalid`
    const r = await call('POST', '/invite', { firstName: 'New', lastName: tag, email, role: 'admin' })
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.json)).not.toContain('accept-invite')
    expect(await prisma.crmUser.count({ where: { email } })).toBe(0)
    expect((await call('POST', '/invite', { firstName: 'New', lastName: tag, email, role: 'admin', currentPassword: RIGHT })).status).toBe(201)
  })
  test('wrong tries here count with the shared limit', async () => {
    for (let i = 0; i < 4; i++) await call('PATCH', `/users/${office.id}`, { role: 'admin', currentPassword: `no-${i}` })
    expect((await call('PATCH', `/users/${office.id}`, { role: 'admin', currentPassword: 'no-5' })).status).toBe(429)
    expect((await call('PATCH', `/users/${office.id}`, { role: 'admin', currentPassword: RIGHT })).status).toBe(429)
  })
  test('a session alone cannot move an owner\'s or admin\'s sign in, its own included', async () => {
    const admin = await made('admin')
    for (const id of [me.id, admin.id]) {
      expect((await call('PATCH', `/users/${id}/email`, { email: `${tag}-moved@example.invalid` })).status).toBe(403)
    }
    expect((await prisma.crmUser.findUnique({ where: { id: me.id } }))?.email).toBe(me.email)
    expect((await call('PATCH', `/users/${admin.id}/email`, { email: `${tag}-moved@example.invalid`, currentPassword: RIGHT })).status).toBe(200)
  })

  describe('the Team screen as it was', () => {
    test('saving with the role unchanged asks nothing, an admin included', async () => {
      const admin = await made('admin')
      expect((await call('PATCH', `/users/${admin.id}`, { firstName: 'Renamed', lastName: tag, phone: '', role: 'admin', status: 'active' })).status).toBe(200)
      expect((await prisma.crmUser.findUnique({ where: { id: admin.id } }))?.firstName).toBe('Renamed')
    })
    test('moving someone sideways or down asks nothing', async () => {
      expect((await call('PATCH', `/users/${office.id}`, { role: 'sales_rep' })).status).toBe(200)
      expect((await call('PATCH', `/users/${office.id}`, { role: 'manager' })).status).toBe(200)
      const admin = await made('admin')
      expect((await call('PATCH', `/users/${admin.id}`, { role: 'manager' })).status).toBe(200)
    })
    test('suspending and turning off asks nothing', async () => {
      expect((await call('PATCH', `/users/${office.id}`, { status: 'suspended' })).status).toBe(200)
      expect((await call('PATCH', `/users/${office.id}`, { status: 'active' })).status).toBe(200)
    })
    test('inviting anyone below admin asks nothing', async () => {
      for (const role of ['manager', 'sales_rep', 'field_crew', 'office_staff']) {
        const r = await call('POST', '/invite', { firstName: 'New', lastName: tag, email: `${tag}-${role}@example.invalid`, role })
        expect(r.status, role).toBe(201)
        expect(r.json.data.inviteUrl).toContain('accept-invite')
      }
    })
    test('changing a Salesman\'s email asks nothing', async () => {
      const rep = await made('sales_rep')
      expect((await call('PATCH', `/users/${rep.id}/email`, { email: `${tag}-rep2@example.invalid` })).status).toBe(200)
    })
  })
})
