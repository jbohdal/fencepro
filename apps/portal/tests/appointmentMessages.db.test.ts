/**
 * Appointment messages on the dev database, through the API:
 *   - booking for a person keeps the login it is (assignedToUserId) and sends
 *     that login back with its Direct phone (`rep`); a login with no phone, a
 *     name no login has, and a change of person;
 *   - the Direct phone: the owner sets anyone's (Settings > Team), each person
 *     their own (My profile), checked and kept as 10 digits; another company's
 *     login is not found;
 *   - the templates saved in Settings > Messages (config.appointmentMessages):
 *     versioned, in the Change log, and Reset to default takes them out.
 *
 * A company, its logins, a customer and appointments are made for the test and
 * removed after; database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { confirmationSms, repWarning, type RepInfo } from '../../web/src/appointmentMessages'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('appointment messages (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  const tokens: Record<string, string> = {}
  const tag = `amsg-${Date.now().toString(36)}`
  const password = `pw-${tag}`
  const accounts: string[] = []
  const users: Record<string, string> = {}
  let contactId = ''
  const company = { name: 'Getter Done Fence', phone: '3527894314' }

  const call = (method: string, path: string, who: string, body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const book = (assignedTo: string) => call('POST', '/api/appointments', 'owner', {
    crmContactId: contactId, type: 'estimate', assignedTo, address: '1 Main St, Belleview, FL', lat: 29.05, lng: -82.06,
    startAt: '2026-11-03T15:00:00.000Z', endAt: '2026-11-03T16:00:00.000Z', allDay: false,
  })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    for (const k of ['mine', 'theirs']) accounts.push((await prisma.crmAccount.create({ data: { name: `Test ${tag}-${k}`, status: 'active' } })).id)
    const make = async (key: string, accountId: string, role: string, firstName: string, lastName: string, phone: string | null) => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${key}@example.test`, firstName, lastName, phone, role, status: 'active', mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
      users[key] = u.id
    }
    await make('owner', accounts[0], 'super_admin', 'Testowner', `Beta ${tag}`, '3525550101')
    await make('rep', accounts[0], 'sales_rep', 'Testrep', `Alpha ${tag}`, '3525550142')
    await make('nophone', accounts[0], 'sales_rep', 'Testrep', `Nophone ${tag}`, null)
    await make('other', accounts[1], 'sales_rep', 'Testrep', `Other ${tag}`, null)
    contactId = (await prisma.crmContact.create({ data: { accountId: accounts[0], firstName: 'Kristi', lastName: `Test ${tag}`, phone: '3525550100' } })).id
    const { requireLiveSession } = await import('../src/server/lib/sessionGuard.js')
    const app = express()
    app.use(express.json())
    app.use('/api', requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    app.use('/api/appointments', (await import('../src/server/routes/appointments.js')).default)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
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
    await prisma.businessState.deleteMany({ where: { accountId: { in: accounts } } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUser.deleteMany({ where: { id: { in: ids } } })
    for (const id of accounts) await prisma.crmAccount.delete({ where: { id } }).catch(() => {})
  })

  test('booked for a person with a Direct phone: that login and phone come back, and the login is kept', async () => {
    const r = await book(`Testrep Alpha ${tag}`)
    expect(r.status).toBe(201)
    expect(r.json.data.rep).toEqual({ userId: users.rep, firstName: 'Testrep', lastName: `Alpha ${tag}`, phone: '3525550142' })
    expect((await prisma.appointment.findUnique({ where: { id: r.json.data.id } })).assignedToUserId).toBe(users.rep)
    const text = confirmationSms(r.json.data, { company })
    expect(text).toMatch(/^Getter Done Fence: Hi Kristi, this is Testrep with Getter Done Fence\./)
    expect(text).toContain('call or text me directly at (352) 555 0142. Reply STOP to opt out.')
    expect(repWarning(r.json.data, company)).toBeNull()
    // Read back in the list too.
    const list = await call('GET', '/api/appointments', 'owner')
    expect(list.json.data.find((a: any) => a.id === r.json.data.id).rep.phone).toBe('3525550142')
  })

  test('the owner: his name and his phone', async () => {
    const r = await book(`Testowner Beta ${tag}`)
    expect(r.json.data.rep.userId).toBe(users.owner)
    expect(confirmationSms(r.json.data, { company })).toContain('this is Testowner with Getter Done Fence')
    expect(confirmationSms(r.json.data, { company })).toContain('(352) 555 0101')
  })

  test('no Direct phone: the company number and a warning', async () => {
    const r = await book(`Testrep Nophone ${tag}`)
    const a = r.json.data as { rep: RepInfo | null }
    expect(a.rep?.userId).toBe(users.nophone)
    expect(a.rep?.phone).toBeNull()
    expect(confirmationSms(r.json.data, { company })).toContain('call or text me directly at (352) 789 4314.')
    expect(repWarning(r.json.data, company)).toMatch(/has no Direct phone saved/)
  })

  test('a name no login has (a first name alone, another company\'s person): nobody is kept, the company number', async () => {
    for (const name of ['Testrep', `Testrep Other ${tag}`]) {
      const r = await book(name)
      expect(r.json.data.rep).toBeNull()
      expect((await prisma.appointment.findUnique({ where: { id: r.json.data.id } })).assignedToUserId).toBeNull()
      expect(repWarning(r.json.data, company)).toMatch(/not matched to a login/)
    }
  })

  test('another person: the login is matched again', async () => {
    const made = await book(`Testrep Nophone ${tag}`)
    const r = await call('PATCH', `/api/appointments/${made.json.data.id}`, 'owner', { assignedTo: `Testrep Alpha ${tag}`, baseVersion: made.json.version })
    expect(r.status).toBe(200)
    expect(r.json.data.rep.phone).toBe('3525550142')
    expect((await prisma.appointment.findUnique({ where: { id: made.json.data.id } })).assignedToUserId).toBe(users.rep)
  })

  test('an appointment saved before the login was kept is matched when read', async () => {
    const row = await prisma.appointment.create({ data: { accountId: accounts[0], crmContactId: contactId, type: 'estimate', assignedTo: `Testrep Alpha ${tag}`, startAt: new Date('2026-11-04T15:00:00Z') } })
    const r = await call('GET', `/api/appointments/${row.id}`, 'owner')
    expect(r.json.data.rep.userId).toBe(users.rep)
  })

  test('the owner sets anyone\'s Direct phone; it is kept as 10 digits, empty clears it, a bad one is refused', async () => {
    expect((await call('PATCH', `/api/crm-auth/users/${users.nophone}`, 'owner', { phone: '(352) 555-0177' })).status).toBe(200)
    expect((await prisma.crmUser.findUnique({ where: { id: users.nophone } })).phone).toBe('3525550177')
    const bad = await call('PATCH', `/api/crm-auth/users/${users.nophone}`, 'owner', { phone: '555-0177' })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/10 digit/)
    expect((await call('PATCH', `/api/crm-auth/users/${users.nophone}`, 'owner', { phone: '' })).status).toBe(200)
    expect((await prisma.crmUser.findUnique({ where: { id: users.nophone } })).phone).toBeNull()
    // Another company's login: not found, unchanged.
    expect((await call('PATCH', `/api/crm-auth/users/${users.other}`, 'owner', { phone: '3525550188' })).status).toBe(404)
    expect((await prisma.crmUser.findUnique({ where: { id: users.other } })).phone).toBeNull()
  })

  test('each person sets their own Direct phone (My profile), and /me shows it', async () => {
    const r = await call('PATCH', '/api/crm-auth/me', 'rep', { phone: '+1 352 555 0143' })
    expect(r.status).toBe(200)
    expect(r.json.data.phone).toBe('3525550143')
    expect((await call('GET', '/api/crm-auth/me', 'rep')).json.data.phone).toBe('3525550143')
    expect((await call('PATCH', '/api/crm-auth/me', 'rep', { phone: 'call me' })).status).toBe(400)
    // Only the phone: a role or name sent along is refused.
    expect((await call('PATCH', '/api/crm-auth/me', 'rep', { phone: '3525550143', role: 'super_admin' })).status).toBe(400)
    expect((await prisma.crmUser.findUnique({ where: { id: users.rep } })).role).toBe('sales_rep')
    // The next appointment's text has the new number.
    const b = await book(`Testrep Alpha ${tag}`)
    expect(confirmationSms(b.json.data, { company })).toContain('(352) 555 0143')
  })

  test('templates: saved on the server (versioned, in the Change log), and Reset to default takes them out', async () => {
    const first = await call('GET', '/api/business-state', 'owner')
    const config = { ...(first.json.data.config || {}), appointmentMessages: { confirm: { estimate: 'Hey {customer_first_name}, {rep_first_name} here. See you {date_time}. {rep_phone}' } } }
    const saved = await call('PATCH', '/api/business-state', 'owner', { config, baseVersion: first.json.data.version })
    expect(saved.status).toBe(200)
    const read = await call('GET', '/api/business-state', 'owner')
    expect(read.json.data.config.appointmentMessages.confirm.estimate).toMatch(/^Hey \{customer_first_name\}/)
    const b = await book(`Testrep Alpha ${tag}`)
    expect(confirmationSms(b.json.data, { company, templates: read.json.data.config.appointmentMessages }))
      .toBe('Getter Done Fence: Hey Kristi, Testrep here. See you Tuesday, November 3 at 10:00 AM. (352) 555 0143 Reply STOP to opt out.')
    const log = await prisma.crmAuditLog.findMany({ where: { userId: users.owner, action: 'settings_changed', entityId: 'business-state/config' }, orderBy: { createdAt: 'asc' } })
    expect(log.at(-1).newValues.changes.join('\n')).toMatch(/appointmentMessages/)
    // A save built on the old copy is refused.
    expect((await call('PATCH', '/api/business-state', 'owner', { config, baseVersion: first.json.data.version })).status).toBe(409)
    // Reset to default: the saved wording is taken out.
    const { appointmentMessages: _gone, ...rest } = read.json.data.config
    expect((await call('PATCH', '/api/business-state', 'owner', { config: { ...rest, appointmentMessages: {} }, baseVersion: read.json.data.version })).status).toBe(200)
    const after = await call('GET', '/api/business-state', 'owner')
    expect(after.json.data.config.appointmentMessages).toEqual({})
    expect(confirmationSms(b.json.data, { company, templates: after.json.data.config.appointmentMessages })).toContain("You're all set for your fence estimate on Tuesday, November 3 at 10:00 AM")
    expect(await prisma.crmAuditLog.count({ where: { userId: users.owner, action: 'settings_changed', entityId: 'business-state/config' } })).toBe(2)
  })
})
