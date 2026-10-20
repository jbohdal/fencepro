/**
 * Staff tokens are tied to a sign in session (lib/sessionGuard.ts), and every
 * Settings save is written to the change log (lib/settingsAudit.ts).
 *
 *   - a token made with the signing secret but no session id is refused off
 *     the practice database (the dev allowance switched off here);
 *   - a revoked session, or another login's session, is refused;
 *   - renewing the sign in turns an old token into one with a session id;
 *   - /api/kv and /api/ops-stages saves leave a change log row with the
 *     address, device and what changed.
 *
 * Its own company and login; database writes happen only inside beforeAll /
 * test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('session bound staff tokens and the settings change log (dev database)', () => {
  let prisma: any
  let guard: typeof import('../src/server/lib/sessionGuard.js')
  let server: Server
  let base = ''
  let secret = ''
  let accountId = ''
  let userId = ''
  let otherUserId = ''
  const stamp = Date.now().toString(36)
  const email = `session-guard-${stamp}@example.test`
  const password = `pw-${stamp}-ok`
  const UA = `SessionGuardTest/1.0 (${stamp})`

  const call = (token: string | null, method: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'User-Agent': UA },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const minted = (extra: Record<string, unknown> = {}) =>
    jwt.sign({ sub: userId, email, role: 'super_admin', firstName: 'Test', lastName: 'Guard', crmAccountId: accountId, ...extra }, secret, { expiresIn: '10m' })
  const login = async () => {
    const r = await call(null, 'POST', '/api/crm-auth/login', { email, password })
    expect(r.status).toBe(200)
    return r.json.data as { accessToken: string; refreshToken: string }
  }
  const kvVersion = async (key: string) => (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key } } }))?.version ?? 0

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    guard = await import('../src/server/lib/sessionGuard.js')
    secret = (await import('../src/server/lib/secrets.js')).resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    const account = await prisma.crmAccount.create({ data: { name: `Test session-guard-${stamp}`, status: 'active' } })
    accountId = account.id
    const user = await prisma.crmUser.create({ data: {
      email, firstName: 'Test', lastName: 'Guard', role: 'super_admin', status: 'active', mustChangePassword: false,
      passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId,
    } })
    userId = user.id
    const other = await prisma.crmUser.create({ data: {
      email: `session-guard-other-${stamp}@example.test`, firstName: 'Other', lastName: 'Guard', role: 'office_staff', status: 'active',
      mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId,
    } })
    otherUserId = other.id
    const app = express()
    app.set('trust proxy', false)
    app.use(express.json())
    app.use('/api', guard.requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    app.use('/api/kv', (await import('../src/server/routes/kv.js')).default)
    app.use('/api/ops-stages', (await import('../src/server/routes/ops-stages.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(() => guard?.setSidlessAllowedForTest(null))

  afterAll(async () => {
    server?.close()
    guard?.setSidlessAllowedForTest(null)
    if (!prisma) return
    const ids = [userId, otherUserId].filter(Boolean)
    if (ids.length) {
      await prisma.crmAuditLog.deleteMany({ where: { userId: { in: ids } } })
      await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
      await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } })
      await prisma.crmUser.deleteMany({ where: { id: { in: ids } } })
    }
    if (accountId) {
      await prisma.accountKeyValue.deleteMany({ where: { accountId } })
      await prisma.crmAccount.delete({ where: { id: accountId } })
    }
  })

  test('a token made with the secret but no session id cannot save or read off the practice database', async () => {
    guard.setSidlessAllowedForTest(false)
    const token = minted()
    const save = await call(token, 'PUT', '/api/kv/test_guard_setting', { value: { on: true }, baseVersion: 0 })
    expect(save.status).toBe(401)
    expect(save.json.error).toBe('Please sign in again')
    expect(save.json.code).toBe('NO_SESSION_ID')
    expect(await kvVersion('test_guard_setting')).toBe(0)
    expect((await call(token, 'GET', '/api/kv')).status).toBe(401)
    // The practice database lets test tokens through (never live).
    guard.setSidlessAllowedForTest(true)
    expect((await call(token, 'GET', '/api/kv')).status).toBe(200)
  })

  test('a real sign in carries a session id and saves; a revoked session is refused at once', async () => {
    guard.setSidlessAllowedForTest(false)
    const { accessToken } = await login()
    const sid = (jwt.decode(accessToken) as any).sid
    expect(typeof sid).toBe('string')
    const ok = await call(accessToken, 'PUT', '/api/kv/test_guard_setting', { value: { on: false }, baseVersion: await kvVersion('test_guard_setting') })
    expect(ok.status).toBe(200)
    await prisma.crmUserSession.update({ where: { id: sid }, data: { revokedAt: new Date() } })
    const refused = await call(accessToken, 'PUT', '/api/kv/test_guard_setting', { value: { on: true }, baseVersion: await kvVersion('test_guard_setting') })
    expect(refused.status).toBe(401)
    expect(refused.json.code).toBe('SESSION_ENDED')
  })

  test("another login's session, or one that is not there, is refused", async () => {
    guard.setSidlessAllowedForTest(false)
    const theirs = await prisma.crmUserSession.create({ data: { userId: otherUserId, tokenHash: await bcrypt.hash(`x-${stamp}`, 4), expiresAt: new Date(Date.now() + 3600_000) } })
    const borrowed = await call(minted({ sid: theirs.id }), 'PUT', '/api/kv/test_guard_setting', { value: { on: true }, baseVersion: await kvVersion('test_guard_setting') })
    expect(borrowed.status).toBe(401)
    const made_up = await call(minted({ sid: '00000000-0000-4000-8000-000000000000' }), 'PUT', '/api/kv/test_guard_setting', { value: { on: true }, baseVersion: await kvVersion('test_guard_setting') })
    expect(made_up.status).toBe(401)
  })

  test('renewing the sign in turns a token without a session id into one with it', async () => {
    guard.setSidlessAllowedForTest(false)
    const { refreshToken } = await login()
    const old = minted()                                  // as issued before session ids
    expect((await call(old, 'PUT', '/api/kv/test_guard_setting', { value: { on: true }, baseVersion: await kvVersion('test_guard_setting') })).status).toBe(401)
    const renewed = await call(old, 'POST', '/api/crm-auth/refresh', { refreshToken })
    expect(renewed.status).toBe(200)
    const fresh = renewed.json.data.accessToken as string
    const sid = (jwt.decode(fresh) as any).sid
    const row = await prisma.crmUserSession.findUnique({ where: { id: sid } })
    expect(row?.userId).toBe(userId)
    expect(row?.revokedAt).toBeNull()
    const saved = await call(fresh, 'PUT', '/api/kv/test_guard_setting', { value: { on: true }, baseVersion: await kvVersion('test_guard_setting') })
    expect(saved.status).toBe(200)
  })

  test('a /api/kv save is in the change log with who, address, device and what changed', async () => {
    const { accessToken } = await login()
    const sid = (jwt.decode(accessToken) as any).sid as string
    const before = await kvVersion('test_guard_audit')
    expect((await call(accessToken, 'PUT', '/api/kv/test_guard_audit', { value: { reminders: false, apiToken: 'never-in-the-log' }, baseVersion: before })).status).toBe(200)
    expect((await call(accessToken, 'PUT', '/api/kv/test_guard_audit', { value: { reminders: true, apiToken: 'also-never' }, baseVersion: before + 1 })).status).toBe(200)
    const rows = await prisma.crmAuditLog.findMany({ where: { userId, action: 'settings_changed', entityId: 'kv/test_guard_audit' }, orderBy: { createdAt: 'asc' } })
    expect(rows).toHaveLength(2)
    const last = rows[1]
    expect(last.entityType).toBe('Settings')
    expect(last.userEmail).toBe(email)
    expect(last.userAgent).toBe(UA)
    expect(last.ipAddress).toMatch(/127\.0\.0\.1/)
    expect(last.newValues.changes).toContain('reminders: false → true')
    expect(last.newValues.changes).toContain('apiToken changed (value hidden)')
    expect(last.newValues.session).toBe(sid.slice(0, 8))
    expect(JSON.stringify(rows)).not.toMatch(/never-in-the-log|also-never/)
  })

  test('an Operations stages save is in the change log, stage by stage', async () => {
    const { accessToken } = await login()
    const got = await call(accessToken, 'GET', '/api/ops-stages')
    expect(got.status).toBe(200)
    const { stages, version } = got.json.data
    const permit = stages.find((s: any) => s.name === 'Permit Pending')
    expect(permit).toBeTruthy()
    const next = stages.map((s: any) => s.id === permit.id ? { ...s, color: '#123456' } : s)
    const put = await call(accessToken, 'PUT', '/api/ops-stages', { stages: next, baseVersion: version })
    expect(put.status).toBe(200)
    const row = await prisma.crmAuditLog.findFirst({ where: { userId, action: 'settings_changed', entityId: 'ops-stages' }, orderBy: { createdAt: 'desc' } })
    expect(row?.userAgent).toBe(UA)
    expect(row?.ipAddress).toMatch(/127\.0\.0\.1/)
    expect(row?.newValues.changes).toContain(`Permit Pending.color: "${permit.color}" → "#123456"`)
  })
})
