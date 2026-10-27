/**
 * Staff sign in by the `ezbiz_staff` cookie (lib/staffSession.ts), against the
 * dev database (DEV_DB=1, ezbiz_dev only).
 *
 *   - signing in sets the cookie (HttpOnly, SameSite=Strict, Path=/api), the
 *     server keeps only its hash, and the cookie alone signs requests in;
 *   - 30 days since last use, 90 days at most;
 *   - sign out, ending the session in Team, a password change and a removed
 *     login stop that device at once;
 *   - a save signed in by cookie needs `X-Staff-Request: 1` (CSRF);
 *   - the old Bearer token still works during the switch window, and is
 *     refused with the stage D switch on (STAFF_COOKIE_ONLY);
 *   - the one time move over swaps an old token for a cookie;
 *   - a read only session (scripts/readonly-session.ts) refuses every save and
 *     works only on the Mac itself;
 *   - THE TRAP: a salesman signed in by cookie gets no cost on any cost
 *     bearing endpoint (quotes, jobs, job costing, pull sheets, inventory,
 *     reports, payments, account documents, vendors), with the middleware in
 *     the same order as index.ts.
 *
 * Its own company and logins; database writes only inside beforeAll / tests / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('staff sign in by cookie (dev database)', () => {
  let prisma: any
  let ss: typeof import('../src/server/lib/staffSession.js')
  let guard: typeof import('../src/server/lib/sessionGuard.js')
  let isCostKey: (k: string) => boolean
  let server: Server
  let base = ''
  let secret = ''
  let accountId = ''
  let contactId = ''
  let quoteId = ''
  let jobId = ''
  const ids: Record<string, string> = {}
  const stamp = Date.now().toString(36)
  const pw = `pw-${stamp}-ok`
  const UA = `StaffCookieTest/1.0 (${stamp})`
  const emailOf = (who: string) => `staff-cookie-${who}-${stamp}@example.test`

  type Answer = { status: number; json: any; cookies: string[] }
  const call = async (method: string, p: string, opts: { cookie?: string | null; bearer?: string; app?: boolean; body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer> => {
    const r = await fetch(base + p, {
      method,
      headers: {
        'Content-Type': 'application/json', 'User-Agent': UA,
        ...(opts.cookie ? { Cookie: `ezbiz_staff=${opts.cookie}` } : {}),
        ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
        ...(opts.app === false ? {} : { 'X-Staff-Request': '1' }),
        ...(opts.headers ?? {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    return { status: r.status, json: await r.json().catch(() => ({})), cookies: r.headers.getSetCookie() }
  }
  const cookieValue = (set: string[]) => set.map(c => c.match(/^ezbiz_staff=([^;]*)/)?.[1]).find(v => v !== undefined) ?? null
  const signIn = async (who: string): Promise<string> => {
    const r = await call('POST', '/api/crm-auth/login', { body: { email: emailOf(who), password: pw, cookie: true } })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const v = cookieValue(r.cookies)
    expect(v).toBeTruthy()
    return decodeURIComponent(v!)
  }
  const sessionOf = (value: string) => prisma.crmUserSession.findUnique({ where: { tokenHash: ss.cookieHash(value) } })
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach(x => keysOf(x, out))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) }
    return out
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    ss = await import('../src/server/lib/staffSession.js')
    guard = await import('../src/server/lib/sessionGuard.js')
    const cr = await import('../src/server/lib/costRedact.js')
    isCostKey = cr.isCostKey
    secret = (await import('../src/server/lib/secrets.js')).resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    const account = await prisma.crmAccount.create({ data: { name: `Test staff-cookie-${stamp}`, status: 'active' } })
    accountId = account.id
    for (const [who, role] of [['owner', 'super_admin'], ['sales', 'sales_rep'], ['other', 'office_staff'], ['gone', 'office_staff'], ['crew', 'field_crew']] as const) {
      const u = await prisma.crmUser.create({ data: {
        email: emailOf(who), firstName: 'Test', lastName: who, role, status: 'active', mustChangePassword: false,
        passwordHash: await bcrypt.hash(pw, 4), crmAccountId: accountId,
      } })
      ids[who] = u.id
    }
    // Cost bearing records of this company.
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Cookie', lastName: `Test ${stamp}` } as any })
    contactId = c.id
    const q = await prisma.savedQuote.create({ data: {
      accountId, crmContactId: contactId, ownerId: ids.sales, customerName: `Cookie Test ${stamp}`, fenceStyle: '6ft WV Privacy', runs: [40, 30],
      sections: 10, materialCost: 1234.5, laborCost: 456.7, totalCOGS: 1691.2, finalPrice: 4200, status: 'SOLD',
      pullSheet: [{ item: 'Post', qty: 10, unitCost: 13.5, total: 135, costSource: 'inventory' }],
    } as any })
    quoteId = q.id
    const j = await prisma.savedJob.create({ data: { accountId, quoteId, crmContactId: contactId, customerName: `Cookie Test ${stamp}`, fenceStyle: '6ft WV Privacy', quotePrice: 4200, contractValue: 4200, gmPct: 0.41 } as any })
    jobId = j.id
    await prisma.inventoryState.create({ data: { accountId, items: [{ id: 'i1', name: 'Cookie Post', unitCost: 13.5, price: 20 }], bundles: [], locations: [], stockLevels: [], transactions: [] } })
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Test' }, pricing: { overheadPct: 0.24, targetMarginPct: 0.4, wage: 22 } }, budget: { revenueGoal: 500000, overheadPct: 0.24 }, plEntries: [{ id: 'p1', label: 'Rent', amountCents: 100000 }] } })
    await prisma.accountKeyValue.create({ data: { accountId, key: 'fencepro_jobcosting', value: { [jobId]: { actualMaterialCost: 999 } } } })
    await prisma.vendorState.create({ data: { accountId, vendors: [{ id: 'v1', name: 'Cookie Supply' }], bills: [{ id: 'b1', vendorId: 'v1', amountCents: 5000, unitCost: 12 }], payments: [] } })

    // The same order as index.ts: JSON, the cookie check, the cost hiding, the session check, the routes.
    const app = express()
    app.set('trust proxy', false)
    app.use(express.json({ limit: '10mb' }))
    app.use('/api', ss.staffCookieAuth)
    app.use('/api', cr.hideCostsFromLimitedLogins)
    app.use('/api', guard.requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    app.use('/api/kv', (await import('../src/server/routes/kv.js')).default)
    app.use('/api/saved-quotes', (await import('../src/server/routes/saved-quotes.js')).default)
    app.use('/api/saved-jobs', (await import('../src/server/routes/saved-jobs.js')).default)
    app.use('/api/job-costing', (await import('../src/server/routes/job-costing.js')).default)
    app.use('/api/pull-sheets', (await import('../src/server/routes/pull-sheets.js')).default)
    app.use('/api/inventory-state', (await import('../src/server/routes/inventory.js')).default)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
    app.use('/api/payments', (await import('../src/server/routes/payments.js')).default)
    app.use('/api/vendor-state', (await import('../src/server/routes/vendors-state.js')).default)
    app.use('/api/change-orders', (await import('../src/server/routes/change-orders.js')).default)
    server = app.listen(0, '127.0.0.1')
    await new Promise(r => server.once('listening', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(() => { ss.setCookieOnlyForTest(null); guard.setSidlessAllowedForTest(null) })

  afterAll(async () => {
    server?.close()
    ss?.setCookieOnlyForTest(null)
    if (!prisma) return
    const userIds = Object.values(ids)
    if (userIds.length) {
      await prisma.crmAuditLog.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.crmUserActivity.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.crmUserSession.deleteMany({ where: { userId: { in: userIds } } })
    }
    if (accountId) {
      await prisma.accountKeyValue.deleteMany({ where: { accountId } })
      await prisma.savedJob.deleteMany({ where: { accountId } })
      await prisma.savedQuote.deleteMany({ where: { accountId } })
      await prisma.inventoryState.deleteMany({ where: { accountId } })
      await prisma.businessState.deleteMany({ where: { accountId } })
      await prisma.vendorState.deleteMany({ where: { accountId } })
      await prisma.crmContact.deleteMany({ where: { accountId } })
    }
    if (userIds.length) await prisma.crmUser.deleteMany({ where: { id: { in: userIds } } })
    if (accountId) await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('sign in sets an HttpOnly, SameSite=Strict cookie on /api; the server keeps only its hash; the cookie alone signs in', async () => {
    const r = await call('POST', '/api/crm-auth/login', { body: { email: emailOf('owner'), password: pw, cookie: true } })
    expect(r.status).toBe(200)
    expect(r.json.data.accessToken).toBeUndefined()
    expect(r.json.data.refreshToken).toBeUndefined()
    const set = r.cookies.find(c => c.startsWith('ezbiz_staff='))!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=Strict/i)
    expect(set).toMatch(/Path=\/api(;|$)/)
    // Plain http is let through only on this machine (127.0.0.1 here); elsewhere Secure.
    expect(set).not.toMatch(/Secure/i)
    const value = decodeURIComponent(cookieValue(r.cookies)!)
    expect(value.length).toBeGreaterThanOrEqual(40)
    const row = await sessionOf(value)
    expect(row).toBeTruthy()
    expect(row.kind).toBe('cookie')
    expect(row.tokenHash).toBe(ss.cookieHash(value))
    expect(row.tokenHash).not.toContain(value)
    // 90 days at most.
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(90)
    // The staff mark for the customer pages (/p): HttpOnly, Strict, on /p only, naming this session (never its value).
    const mark = r.cookies.find(c => c.startsWith('ezbiz_staff_p='))!
    expect(mark).toMatch(/HttpOnly/i)
    expect(mark).toMatch(/SameSite=Strict/i)
    expect(mark).toMatch(/Path=\/p(;|$)/)
    expect(mark).not.toContain(encodeURIComponent(value))
    expect(await ss.staffOnCustomerPage({ headers: { cookie: mark.split(';')[0] } })).toMatchObject({ userId: row.userId })
    const me = await call('GET', '/api/crm-auth/me', { cookie: value, app: false })
    expect(me.status).toBe(200)
    expect(me.json.data.email).toBe(emailOf('owner'))
    expect(me.json.data.signedInBy).toBe('cookie')
    // No cookie: not signed in.
    expect((await call('GET', '/api/kv')).status).toBe(401)
    expect((await call('GET', '/api/kv', { cookie: value })).status).toBe(200)
    // A made up cookie: not signed in, and the cookie is cleared.
    const fake = await call('GET', '/api/kv', { cookie: crypto.randomBytes(32).toString('base64url') })
    expect(fake.status).toBe(401)
    expect(fake.cookies.some(c => /^ezbiz_staff=;/.test(c))).toBe(true)
  })

  test('a cookie sign in must come from the app (the header), and a wrong password sets no cookie', async () => {
    const noHeader = await call('POST', '/api/crm-auth/login', { app: false, body: { email: emailOf('owner'), password: pw, cookie: true } })
    expect(noHeader.status).toBe(403)
    expect(cookieValue(noHeader.cookies)).toBeNull()
    const wrong = await call('POST', '/api/crm-auth/login', { body: { email: emailOf('owner'), password: 'nope-nope', cookie: true } })
    expect(wrong.status).toBe(401)
    expect(cookieValue(wrong.cookies)).toBeNull()
    await prisma.crmUser.update({ where: { id: ids.owner }, data: { failedLoginAttempts: 0, lockedUntil: null } })
  })

  test('30 days since last use, 90 days at most; a use moves the 30 days on', async () => {
    const value = await signIn('owner')
    const row = await sessionOf(value)
    const day = 86_400_000
    // Used 29 days ago: still good, and the use is noted.
    await prisma.crmUserSession.update({ where: { id: row.id }, data: { lastUsedAt: new Date(Date.now() - 29 * day) } })
    expect((await call('GET', '/api/kv', { cookie: value })).status).toBe(200)
    await new Promise(r => setTimeout(r, 300))
    const touched = await prisma.crmUserSession.findUnique({ where: { id: row.id } })
    expect(Date.now() - touched.lastUsedAt.getTime()).toBeLessThan(60_000)
    // Not used for 31 days: ended.
    await prisma.crmUserSession.update({ where: { id: row.id }, data: { lastUsedAt: new Date(Date.now() - 31 * day) } })
    expect((await call('GET', '/api/kv', { cookie: value })).status).toBe(401)
    // Used yesterday, but signed in 90 days ago: ended.
    const v2 = await signIn('owner')
    const r2 = await sessionOf(v2)
    await prisma.crmUserSession.update({ where: { id: r2.id }, data: { createdAt: new Date(Date.now() - 90 * day), lastUsedAt: new Date(Date.now() - day), expiresAt: new Date(Date.now() - 1000) } })
    expect((await call('GET', '/api/kv', { cookie: v2 })).status).toBe(401)
    expect(ss.sessionEndsAt({ kind: 'cookie', createdAt: new Date(0), lastUsedAt: new Date(10 * day), expiresAt: new Date(100 * day) }).getTime()).toBe(40 * day)
    expect(ss.sessionEndsAt({ kind: 'cookie', createdAt: new Date(0), lastUsedAt: new Date(80 * day), expiresAt: new Date(90 * day) }).getTime()).toBe(90 * day)
  })

  test('sign out ends this device at once; the other device of the same login keeps working', async () => {
    const a = await signIn('owner')
    const b = await signIn('owner')
    const out = await call('POST', '/api/crm-auth/logout', { cookie: a, body: {} })
    expect(out.status).toBe(200)
    expect(out.cookies.some(c => /^ezbiz_staff=;/.test(c))).toBe(true)
    expect(out.cookies.some(c => /^ezbiz_staff_p=;/.test(c))).toBe(true)
    expect((await call('GET', '/api/kv', { cookie: a })).status).toBe(401)
    expect((await call('GET', '/api/kv', { cookie: b })).status).toBe(200)
  })

  test('ending a session in Settings > Team stops that device at once; Team lists it with its end time', async () => {
    const admin = await signIn('owner')
    const phone = await signIn('other')
    const row = await sessionOf(phone)
    const list = await call('GET', '/api/crm-auth/sessions', { cookie: admin })
    expect(list.status).toBe(200)
    const shown = list.json.data.find((s: any) => s.id === row.id)
    expect(shown.kind).toBe('cookie')
    expect(new Date(shown.endsAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
    expect(JSON.stringify(list.json)).not.toContain(row.tokenHash)
    expect(list.json.data.find((s: any) => s.current)?.userId).toBe(ids.owner)
    expect((await call('GET', '/api/kv', { cookie: phone })).status).toBe(200)
    expect((await call('DELETE', `/api/crm-auth/sessions/${row.id}`, { cookie: admin })).status).toBe(200)
    expect((await call('GET', '/api/kv', { cookie: phone })).status).toBe(401)
    expect((await call('PUT', '/api/kv/test_cookie_after_end', { cookie: phone, body: { value: 1, baseVersion: 0 } })).status).toBe(401)
  })

  test('a password change signs every other device out at once; this one stays signed in', async () => {
    const here = await signIn('other')
    const there = await signIn('other')
    const r = await call('POST', '/api/crm-auth/change-password', { cookie: here, body: { currentPassword: pw, newPassword: `${pw}-2` } })
    expect(r.status).toBe(200)
    expect(r.json.data.accessToken).toBeUndefined()
    expect((await call('GET', '/api/kv', { cookie: there })).status).toBe(401)
    expect((await call('GET', '/api/kv', { cookie: here })).status).toBe(200)
    await prisma.crmUser.update({ where: { id: ids.other }, data: { passwordHash: await bcrypt.hash(pw, 4) } })
  })

  test('a removed login (switched off, or deleted) stops at once', async () => {
    const off = await signIn('gone')
    await prisma.crmUser.update({ where: { id: ids.gone }, data: { status: 'suspended' } })
    expect((await call('GET', '/api/kv', { cookie: off })).status).toBe(401)
    await prisma.crmUser.update({ where: { id: ids.gone }, data: { status: 'active' } })
    const del = await signIn('gone')
    const admin = await signIn('owner')
    expect((await call('DELETE', `/api/crm-auth/users/${ids.gone}`, { cookie: admin })).status).toBe(200)
    delete ids.gone
    expect((await call('GET', '/api/kv', { cookie: del })).status).toBe(401)
  })

  test('CSRF: a save signed in by cookie needs X-Staff-Request: 1; without it nothing is saved as the login', async () => {
    const v = await signIn('owner')
    const before = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'test_cookie_csrf' } } }))?.version ?? 0
    const bare = await call('PUT', '/api/kv/test_cookie_csrf', { cookie: v, app: false, body: { value: { x: 1 }, baseVersion: 0 } })
    expect(bare.status).toBe(401)
    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'test_cookie_csrf' } } })).toBeNull()
    const ok = await call('PUT', '/api/kv/test_cookie_csrf', { cookie: v, body: { value: { x: 1 }, baseVersion: before } })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    // Reads need no header.
    expect((await call('GET', '/api/kv', { cookie: v, app: false })).status).toBe(200)
  })

  test('the old Bearer token works during the switch window and is refused with the stage D switch on', async () => {
    const old = await call('POST', '/api/crm-auth/login', { app: false, body: { email: emailOf('owner'), password: pw } })
    expect(old.status).toBe(200)
    const { accessToken, refreshToken } = old.json.data
    expect(accessToken && refreshToken).toBeTruthy()
    expect(cookieValue(old.cookies)).toBeNull()
    expect((await call('GET', '/api/kv', { bearer: accessToken, app: false })).status).toBe(200)
    ss.setCookieOnlyForTest(true)
    const refused = await call('GET', '/api/kv', { bearer: accessToken, app: false })
    expect(refused.status).toBe(401)
    expect(refused.json.code).toBe('BEARER_RETIRED')
    // A test token without a session id is refused too (the dev allowance does not open stage D).
    guard.setSidlessAllowedForTest(true)
    const sidless = jwt.sign({ sub: ids.owner, email: emailOf('owner'), role: 'super_admin', firstName: 'Test', lastName: 'owner', crmAccountId: accountId }, secret, { expiresIn: '5m' })
    expect((await call('GET', '/api/kv', { bearer: sidless, app: false })).status).toBe(401)
    // Renewing and moving over are closed; every sign in is a cookie.
    expect((await call('POST', '/api/crm-auth/refresh', { app: false, body: { refreshToken } })).status).toBe(401)
    expect((await call('POST', '/api/crm-auth/move-over', { bearer: accessToken, body: { refreshToken } })).status).toBe(410)
    const forced = await call('POST', '/api/crm-auth/login', { body: { email: emailOf('owner'), password: pw } })
    expect(forced.status).toBe(200)
    expect(forced.json.data.accessToken).toBeUndefined()
    expect(cookieValue(forced.cookies)).toBeTruthy()
    // The cookie still works with the switch on.
    expect((await call('GET', '/api/kv', { cookie: decodeURIComponent(cookieValue(forced.cookies)!) })).status).toBe(200)
  })

  test('move over: the old refresh token becomes a cookie once (and is used up); an access token works too; neither: sign in again', async () => {
    const old = await call('POST', '/api/crm-auth/login', { app: false, body: { email: emailOf('sales'), password: pw } })
    const { accessToken, refreshToken } = old.json.data
    const noHeader = await call('POST', '/api/crm-auth/move-over', { app: false, body: { refreshToken } })
    expect(noHeader.status).toBe(403)
    const m = await call('POST', '/api/crm-auth/move-over', { body: { refreshToken } })
    expect(m.status).toBe(200)
    expect(m.json.data.user.id).toBe(ids.sales)
    const v = decodeURIComponent(cookieValue(m.cookies)!)
    expect((await call('GET', '/api/crm-auth/me', { cookie: v })).json.data.id).toBe(ids.sales)
    // The refresh token is used up.
    expect((await call('POST', '/api/crm-auth/move-over', { body: { refreshToken } })).status).toBe(401)
    expect((await call('POST', '/api/crm-auth/refresh', { app: false, body: { refreshToken } })).status).toBe(401)
    // A still valid access token whose session is live (its session was the refresh token's: ended above).
    const old2 = await call('POST', '/api/crm-auth/login', { app: false, body: { email: emailOf('sales'), password: pw } })
    const m2 = await call('POST', '/api/crm-auth/move-over', { bearer: old2.json.data.accessToken, body: { refreshToken: 'e2e' } })
    expect(m2.status).toBe(200)
    // An access token whose session ended, and no good refresh token: sign in again.
    expect((await call('POST', '/api/crm-auth/move-over', { bearer: accessToken, body: {} })).status).toBe(401)
  }, 15_000) // two real password sign ins (bcrypt, slow on purpose) and ten requests: ~5 s on this Mac

  test('read only session: every save refused, reads work, only on this machine, listed in Team with its end', async () => {
    const value = crypto.randomBytes(32).toString('base64url')
    const row = await prisma.crmUserSession.create({ data: {
      userId: ids.owner, tokenHash: ss.cookieHash(value), kind: 'readonly', readOnly: true, label: 'Read only checker on the Mac',
      expiresAt: new Date(Date.now() + 3 * 3600_000), lastUsedAt: new Date(),
    } })
    const me = await call('GET', '/api/crm-auth/me', { cookie: value })
    expect(me.status).toBe(200)
    expect(me.json.data.readOnly).toBe(true)
    expect((await call('GET', '/api/saved-quotes', { cookie: value })).status).toBe(200)
    for (const [method, p] of [['PUT', '/api/kv/test_cookie_ro'], ['POST', '/api/crm-auth/logout'], ['DELETE', `/api/saved-quotes/${quoteId}`], ['PATCH', `/api/crm-auth/users/${ids.sales}`]] as const) {
      const r = await call(method, p, { cookie: value, body: { value: 1, baseVersion: 0, firstName: 'X' } })
      expect(r.status, `${method} ${p}`).toBe(403)
      expect(r.json.code).toBe('READ_ONLY')
    }
    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'test_cookie_ro' } } })).toBeNull()
    expect((await prisma.savedQuote.findUnique({ where: { id: quoteId } })).deletedAt ?? null).toBeNull()
    // Through a proxy (Tailscale serve adds forwarding headers and the public name): refused.
    for (const headers of [{ 'X-Forwarded-For': '100.101.102.103' }, { 'Tailscale-User-Login': 'someone@example.com' }, { Forwarded: 'for=100.64.0.9' }]) {
      const r = await call('GET', '/api/crm-auth/me', { cookie: value, headers })
      expect(r.status, JSON.stringify(headers)).toBe(401)
      expect(r.json.code).toBe('READ_ONLY_NOT_HERE')
    }
    const own = ss.ownAddresses()
    const req = (peer: string, host: string, extra: Record<string, string> = {}) => ({ socket: { remoteAddress: peer }, headers: { host, ...extra } }) as any
    expect(ss.fromThisMachine(req('127.0.0.1', 'localhost:4000'), own)).toBe(true)
    expect(ss.fromThisMachine(req('::1', '[::1]:4000'), own)).toBe(true)
    expect(ss.fromThisMachine(req('127.0.0.1', 'jonathans-mac-mini.tail40fb4a.ts.net'), own)).toBe(false)
    expect(ss.fromThisMachine(req('192.0.2.50', 'localhost:4000'), new Set(['127.0.0.1']))).toBe(false)
    expect(ss.fromThisMachine(req('100.70.1.2', '100.70.1.2:4000'), new Set(['127.0.0.1', '100.70.1.2']))).toBe(true)
    expect(ss.fromThisMachine(req('100.70.1.2', '100.70.1.2:4000'), new Set(['127.0.0.1', '100.99.9.9']))).toBe(false)
    // Listed in Team with its label and end time.
    const admin = await signIn('owner')
    const listed = (await call('GET', '/api/crm-auth/sessions', { cookie: admin })).json.data.find((s: any) => s.id === row.id)
    expect(listed.kind).toBe('readonly')
    expect(listed.label).toBe('Read only checker on the Mac')
    expect(Math.abs(new Date(listed.endsAt).getTime() - row.expiresAt.getTime())).toBeLessThan(1000)
    // Run out after 3 hours.
    await prisma.crmUserSession.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await call('GET', '/api/crm-auth/me', { cookie: value })).status).toBe(401)
  })

  // Since Oct 25, 2026 the Salesman sees costs (Jonathan); the installer sees no cost and no price.
  test('THE TRAP: an installer signed in by cookie gets no cost on any cost bearing endpoint; the owner does', async () => {
    const owner = await signIn('owner')
    const sales = await signIn('crew')
    const endpoints = [
      '/api/saved-quotes', `/api/saved-quotes/${quoteId}`,
      '/api/saved-jobs', `/api/saved-jobs/${jobId}`,
      `/api/job-costing/job/${jobId}`, '/api/job-costing/report', '/api/job-costing/finance', `/api/job-costing/takeoff?jobId=${jobId}`,
      `/api/pull-sheets/customer/${contactId}`,
      '/api/inventory-state',
      '/api/business-state',
      `/api/payments/job/${jobId}`, `/api/payments/customer/${contactId}`,
      '/api/kv', '/api/vendor-state', `/api/change-orders?quoteId=${quoteId}`,
    ]
    const ownerSaw = new Set<string>()
    for (const p of endpoints) {
      const o = await call('GET', p, { cookie: owner })
      for (const k of keysOf(o.json)) if (isCostKey(k)) ownerSaw.add(k)
      const s = await call('GET', p, { cookie: sales })
      expect([200, 403, 404], `${p}: ${s.status} ${JSON.stringify(s.json).slice(0, 200)}`).toContain(s.status)
      const leaked = [...keysOf(s.json)].filter(isCostKey)
      expect(leaked, `${p} leaked to the installer: ${leaked.join(', ')}`).toEqual([])
      if (p === '/api/kv') expect(Object.keys(s.json.data ?? {})).not.toContain('fencepro_jobcosting')
      if (p === '/api/business-state') {
        expect(s.json.data.budget).toBeUndefined()
        expect(s.json.data.plEntries).toBeUndefined()
      }
    }
    // The control: the same records do carry costs for the owner.
    for (const k of ['materialCost', 'laborCost', 'totalCOGS', 'gmPct', 'unitCost']) expect([...ownerSaw], k).toContain(k)
    // The installer is the cookie's login, whatever role a token might claim: a forged header is not mixed in.
    const forged = jwt.sign({ sub: ids.owner, role: 'super_admin', crmAccountId: accountId }, 'not-the-secret')
    const mixed = await call('GET', `/api/saved-quotes/${quoteId}`, { cookie: sales, bearer: forged })
    expect([...keysOf(mixed.json)].filter(isCostKey)).toEqual([])
  })

  test('index.ts mounts the cookie check before the cost hiding, the session check and every route', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/server/index.ts'), 'utf8')
    const at = (s: string) => { const i = src.indexOf(s); expect(i, s).toBeGreaterThan(0); return i }
    const cookie = at("app.use('/api', staffCookieAuth)")
    expect(cookie).toBeLessThan(at("app.use('/api', hideCostsFromLimitedLogins)"))
    expect(cookie).toBeLessThan(at("app.use('/api', requireLiveSession)"))
    expect(cookie).toBeLessThan(at("app.use('/api/saved-quotes'"))
    expect(cookie).toBeGreaterThan(at("app.use(express.json("))
  })
})
