/**
 * A customer saved with an address gets its city, state and ZIP: the ones sent
 * with a picked suggestion, or read from the one line address when only that
 * was sent (every customer made in the app before Oct 19, 2026 saved the
 * address alone, with no parts). Against the dev database (DEV_DB=1; refuses
 * any other). No pipeline card. Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('city, state and ZIP on a saved customer (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  // A salesman's login, as Christa's.
  const token = jwt.sign({ sub: user.id, email: user.email, role: 'sales_rep', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })

  const app = express()
  app.use(express.json())
  app.use('/api/crm-contacts', contacts)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const send = (method: string, path: string, body: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() as any }))

  const made: string[] = []
  afterAll(async () => {
    await prisma.crmContact.deleteMany({ where: { id: { in: made } } })
    server.close()
  })
  const create = async (body: Record<string, unknown>) => {
    const id = crypto.randomUUID(); made.push(id)
    const r = await send('POST', '/api/crm-contacts', { id, firstName: 'E2E', lastName: 'Address Parts', ...body })
    expect(r.status).toBe(201)
    return prisma.crmContact.findUniqueOrThrow({ where: { id } })
  }
  const parts = (c: { city: string | null; state: string | null; zip: string | null }) => [c.city, c.state, c.zip]

  test('a picked suggestion: the parts sent are saved', async () => {
    const c = await create({ serviceAddress: '1301 SE Silver Springs Pl, Ocala, FL 34471', city: 'Ocala', state: 'FL', zip: '34471' })
    expect(parts(c)).toEqual(['Ocala', 'FL', '34471'])
  })

  test('the address alone (as every customer made in the app was): the parts are read from it', async () => {
    expect(parts(await create({ serviceAddress: '99999 Nowhere Ln, Belleview, FL 34420' }))).toEqual(['Belleview', 'FL', '34420'])
    expect(parts(await create({ serviceAddress: '99999 Nowhere Ln' }))).toEqual([null, null, null])
    expect(parts(await create({}))).toEqual([null, null, null])
  })

  test('a change of address: new parts; the same address: the saved parts stay', async () => {
    const c = await create({ serviceAddress: '99999 Nowhere Ln, Belleview, FL 34420' })
    let r = await send('PATCH', `/api/crm-contacts/${c.id}`, { serviceAddress: '99999 Nowhere Ln, Belleview, FL 34420', notes: 'x' })
    expect(parts(r.json.data)).toEqual(['Belleview', 'FL', '34420'])
    r = await send('PATCH', `/api/crm-contacts/${c.id}`, { serviceAddress: '88888 Elsewhere Rd, Ocala, FL 34471' })
    expect(parts(r.json.data)).toEqual(['Ocala', 'FL', '34471'])
    // Moved to an address that says no city or ZIP: the old ones are not left behind.
    r = await send('PATCH', `/api/crm-contacts/${c.id}`, { serviceAddress: '77777 Somewhere Way' })
    expect(parts(r.json.data)).toEqual([null, null, null])
    // Something else changed, address not sent: parts untouched.
    await send('PATCH', `/api/crm-contacts/${c.id}`, { serviceAddress: '88888 Elsewhere Rd, Ocala, FL 34471' })
    r = await send('PATCH', `/api/crm-contacts/${c.id}`, { phone: '3525550100' })
    expect(parts(r.json.data)).toEqual(['Ocala', 'FL', '34471'])
  })
})
