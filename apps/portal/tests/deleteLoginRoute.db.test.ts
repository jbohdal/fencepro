/**
 * DELETE /api/crm-auth/users/:id deletes only a login of the caller's own
 * company (another company's is "not found", and stays), and the deleted
 * login's push subscriptions go with it.
 *
 * Two companies made for the test and removed after; database writes happen
 * only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('deleting a login through the API (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  let token = ''
  const tag = `dlr-${Date.now().toString(36)}`
  const password = `pw-${tag}`
  const accounts: string[] = []
  const users: Record<string, string> = {}

  const del = (id: string) => fetch(`${base}/api/crm-auth/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    for (const k of ['mine', 'theirs']) accounts.push((await prisma.crmAccount.create({ data: { name: `Test ${tag}-${k}`, status: 'active' } })).id)
    const make = async (key: string, accountId: string, role: string) => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${key}@example.test`, firstName: 'Test', lastName: key, role, status: 'active', mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
      users[key] = u.id
      await prisma.pushSubscription.create({ data: { accountId, userId: u.id, endpoint: `https://push.example.test/${tag}-${key}`, p256dh: 'k', auth: 'a' } })
    }
    await make('owner', accounts[0], 'super_admin')
    await make('worker', accounts[0], 'sales_rep')
    await make('other', accounts[1], 'sales_rep')
    const { requireLiveSession } = await import('../src/server/lib/sessionGuard.js')
    const app = express()
    app.use(express.json())
    app.use('/api', requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const r = await fetch(`${base}/api/crm-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-owner@example.test`, password }) })
    token = ((await r.json()) as any).data.accessToken
  })

  afterAll(async () => {
    server?.close()
    if (!prisma) return
    const ids = Object.values(users)
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUser.deleteMany({ where: { id: { in: ids } } })
    for (const id of accounts) await prisma.crmAccount.delete({ where: { id } }).catch(() => {})
  })

  test("another company's login is not found and stays", async () => {
    const r = await del(users.other)
    expect(r.status).toBe(404)
    expect(await prisma.crmUser.findUnique({ where: { id: users.other } })).not.toBeNull()
    expect(await prisma.pushSubscription.count({ where: { userId: users.other } })).toBe(1)
  })

  test("a login of the caller's company is deleted with its push subscriptions", async () => {
    const r = await del(users.worker)
    expect(r.status).toBe(200)
    expect(await prisma.crmUser.findUnique({ where: { id: users.worker } })).toBeNull()
    expect(await prisma.pushSubscription.count({ where: { userId: users.worker } })).toBe(0)
    expect(await prisma.pushSubscription.count({ where: { userId: users.owner } })).toBe(1)
  })
})
