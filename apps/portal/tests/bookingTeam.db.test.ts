/**
 * The booking team on the dev database, through the API: who appointments can
 * be with is the company's active staff logins (Settings > Team), not a list
 * of names.
 *   - GET /api/appointments/team: the owner first and the default, each with
 *     its Direct phone; switched off, suspended, invited, customer logins and
 *     another company's logins are not on it;
 *   - booking with a login keeps the login and takes its name;
 *   - switched off in Team: gone from the team on the next read, cannot be
 *     booked, and its appointments keep the name; switched back on: back;
 *   - a name alone (an older phone's queued booking) is still matched exactly.
 *
 * Companies, logins, a customer and appointments are made for the test and
 * removed after; database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('booking team = active logins (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  const tokens: Record<string, string> = {}
  const tag = `bteam-${Date.now().toString(36)}`
  const password = `pw-${tag}`
  const accounts: string[] = []
  const users: Record<string, string> = {}
  let contactId = ''

  const call = (method: string, path: string, who: string, body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const team = async () => (await call('GET', '/api/appointments/team', 'owner')).json.data as Array<{ userId: string; name: string; phone: string | null; isDefault: boolean }>
  const book = (who: { assignedToUserId?: string; assignedTo?: string }) => call('POST', '/api/appointments', 'owner', {
    crmContactId: contactId, type: 'estimate', ...who, address: '1 Main St, Belleview, FL', lat: 29.05, lng: -82.06,
    startAt: '2026-11-03T15:00:00.000Z', endAt: '2026-11-03T16:00:00.000Z', allDay: false,
  })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    for (const k of ['mine', 'theirs']) accounts.push((await prisma.crmAccount.create({ data: { name: `Test ${tag}-${k}`, status: 'active' } })).id)
    const make = async (key: string, accountId: string, role: string, firstName: string, lastName: string, phone: string | null, status = 'active') => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${key}@example.test`, firstName, lastName, phone, role, status, mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
      users[key] = u.id
    }
    await make('rep', accounts[0], 'sales_rep', 'Testrep', `Alpha ${tag}`, '3525550142')
    await make('owner', accounts[0], 'super_admin', 'Testowner', `Beta ${tag}`, '3525550101')
    await make('crew', accounts[0], 'field_crew', 'Testcrew', `Gamma ${tag}`, null)
    await make('held', accounts[0], 'sales_rep', 'Testheld', `Delta ${tag}`, null, 'suspended')
    await make('invited', accounts[0], 'sales_rep', 'Testinvited', `Eps ${tag}`, null, 'invited')
    await make('customer', accounts[0], 'customer', 'Testcustomer', `Zeta ${tag}`, null)
    await make('other', accounts[1], 'sales_rep', 'Testother', `Eta ${tag}`, null)
    contactId = (await prisma.crmContact.create({ data: { accountId: accounts[0], firstName: 'Kristi', lastName: `Test ${tag}`, phone: '3525550100' } })).id
    const { requireLiveSession } = await import('../src/server/lib/sessionGuard.js')
    const app = express()
    app.use(express.json())
    app.use('/api', requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    app.use('/api/appointments', (await import('../src/server/routes/appointments.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const k of ['owner', 'rep']) {
      const r = await fetch(`${base}/api/crm-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${k}@example.test`, password }) })
      tokens[k] = ((await r.json()) as any).data.accessToken
    }
  })

  afterAll(async () => {
    server?.close()
    if (!prisma) return
    const ids = Object.values(users)
    await prisma.appointment.deleteMany({ where: { accountId: { in: accounts } } })
    await prisma.crmContact.deleteMany({ where: { accountId: { in: accounts } } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUser.deleteMany({ where: { id: { in: ids } } })
    for (const id of accounts) await prisma.crmAccount.delete({ where: { id } }).catch(() => {})
  })

  test('the team: active staff logins of this company, the owner first and the default, each with its Direct phone', async () => {
    const t = await team()
    expect(t.map(m => m.userId)).toEqual([users.owner, users.crew, users.rep])  // owner, then by name
    expect(t[0]).toMatchObject({ name: `Testowner Beta ${tag}`, isDefault: true, phone: '3525550101' })
    expect(t[2]).toMatchObject({ name: `Testrep Alpha ${tag}`, isDefault: false, phone: '3525550142' })
    // Any staff login can read it (it is the "With" list on their phone too).
    expect((await call('GET', '/api/appointments/team', 'rep')).json.data.map((m: any) => m.userId)).toEqual(t.map(m => m.userId))
  })

  let apptId = ''
  test('booked with a login: that login is kept and its name is taken from it', async () => {
    const r = await book({ assignedToUserId: users.rep, assignedTo: 'whatever the phone had' })
    expect(r.status).toBe(201)
    expect(r.json.data).toMatchObject({ assignedTo: `Testrep Alpha ${tag}`, assignedToUserId: users.rep })
    expect(r.json.data.rep).toMatchObject({ userId: users.rep, phone: '3525550142' })
    apptId = r.json.data.id
  })

  test('a login not on the team cannot be booked: suspended, invited, a customer, another company', async () => {
    for (const k of ['held', 'invited', 'customer', 'other']) {
      const r = await book({ assignedToUserId: users[k] })
      expect(r.status, k).toBe(400)
      expect(r.json.code).toBe('NOT_ON_TEAM')
    }
  })

  test('switched off in Team: off the team at once, cannot be booked, its appointment keeps the name; back on: back', async () => {
    const off = await call('PATCH', `/api/crm-auth/users/${users.rep}`, 'owner', { status: 'deactivated' })
    expect(off.status).toBe(200)
    expect((await team()).map(m => m.userId)).toEqual([users.owner, users.crew])
    expect((await book({ assignedToUserId: users.rep })).json.code).toBe('NOT_ON_TEAM')

    const kept = await call('GET', `/api/appointments/${apptId}`, 'owner')
    expect(kept.json.data).toMatchObject({ assignedTo: `Testrep Alpha ${tag}`, assignedToUserId: users.rep, rep: null })
    // Changing something else on it (the phone sends the person it had): saved, the name stays.
    const v = kept.json.version
    const edit = await call('PATCH', `/api/appointments/${apptId}`, 'owner', { baseVersion: v, notes: 'gate on the left', assignedToUserId: users.rep, assignedTo: `Testrep Alpha ${tag}` })
    expect(edit.status).toBe(200)
    expect(edit.json.data).toMatchObject({ notes: 'gate on the left', assignedTo: `Testrep Alpha ${tag}`, assignedToUserId: users.rep })
    // Given to someone on the team: the new login and its name.
    const moved = await call('PATCH', `/api/appointments/${apptId}`, 'owner', { baseVersion: edit.json.version, assignedToUserId: users.crew })
    expect(moved.json.data).toMatchObject({ assignedTo: `Testcrew Gamma ${tag}`, assignedToUserId: users.crew })

    expect((await call('PATCH', `/api/crm-auth/users/${users.rep}`, 'owner', { status: 'active' })).status).toBe(200)
    expect((await team()).map(m => m.userId)).toEqual([users.owner, users.crew, users.rep])
  })

  test('a name alone (an older phone\'s queued booking) is matched to its login exactly', async () => {
    const r = await book({ assignedTo: `testrep  alpha ${tag}` })
    expect(r.status).toBe(201)
    expect(r.json.data.assignedToUserId).toBe(users.rep)
  })
})
