/**
 * The push signing key and the Gmail sign-in token live in AccountKeyValue
 * for the server only: GET /api/kv never returns them, to any role, and
 * PUT /api/kv/:key cannot change them. Ordinary keys still work.
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('server-only keys (dev database)', () => {
  let prisma: any
  let accountId = ''
  let base = ''
  let server: Server
  const tokens: Record<string, string> = {}
  const call = (role: string, method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test kv-server-only-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    await prisma.accountKeyValue.createMany({ data: [
      { accountId, key: 'push_vapid', value: { publicKey: 'test-public', privateKey: 'test-private-never-sent' } },
      { accountId, key: 'gmail_token', value: { refresh_token: 'test-refresh-never-sent' } },
      { accountId, key: 'test_plain_setting', value: { on: true } },
    ] })
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    for (const role of ['owner', 'admin', 'sales_rep', 'installer'])
      tokens[role] = jwt.sign({ sub: user.id, email: user.email, role, firstName: 'Test', lastName: 'Kv', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json())
    app.use('/api/kv', (await import('../src/server/routes/kv.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('no role gets the push key or the Gmail token; ordinary keys still come back', async () => {
    for (const role of Object.keys(tokens)) {
      const r = await call(role, 'GET', '/api/kv')
      expect(r.status, role).toBe(200)
      const text = JSON.stringify(r.json)
      expect(text, role).not.toContain('never-sent')
      expect(r.json.data.push_vapid, role).toBeUndefined()
      expect(r.json.data.gmail_token, role).toBeUndefined()
      expect(r.json.data.test_plain_setting, role).toEqual({ on: true })
    }
  })

  test('no role can replace or remove them', async () => {
    for (const role of Object.keys(tokens)) {
      for (const key of ['push_vapid', 'gmail_token', 'some_api_token']) {
        const r = await call(role, 'PUT', `/api/kv/${key}`, { value: null, baseVersion: 1 })
        expect(r.status, `${role} ${key}`).toBe(403)
      }
    }
    const kept = await prisma.accountKeyValue.findMany({ where: { accountId, key: { in: ['push_vapid', 'gmail_token'] } } })
    expect(kept).toHaveLength(2)
  })
})
