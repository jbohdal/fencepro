/**
 * A customer's properties end to end on the dev database (DEV_DB=1 and
 * ezbiz_dev only), in a throwaway company (Jonathan, Nov 5 2026):
 *   - a new customer has their address as their first property, Primary;
 *   - Add property (a rental): the list says it, search has its address;
 *   - a quote for the rental takes its address; the job from it, its property;
 *     a visit booked there, its address; a record with only an address goes on
 *     the property with it (or a new one);
 *   - the rental's address corrected: the draft quote follows, a sold one keeps
 *     the address it was signed with;
 *   - the Primary cannot be "No longer theirs"; another one Primary first; the
 *     customer's own address follows the Primary;
 *   - a new lead at the rental's address is a Possible match;
 *   - a merge leaves the kept customer one Primary;
 *   - a Salesman sees her own customers' properties only;
 *   - a quote moved to another customer: the first one keeps the property only
 *     when it was already theirs (Jonathan, Nov 6 2026).
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('customer properties (dev database)', () => {
  let prisma: any, lib: any
  let accountId = '', base = ''
  let server: Server
  const tok: Record<string, string> = {}
  const tag = `props-${Date.now().toString(36)}`
  const HOME = '10438 SW 75th Terrace, Ocala, FL 34476'
  const RENTAL = '8447 SW 58th Loop, Ocala, FL 34481'
  const call = (method: string, p: string, who: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${tok[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const newCustomer = async (who: string, body: Record<string, unknown>) => {
    const id = crypto.randomUUID()
    const r = await call('POST', '/api/crm-contacts', who, { id, firstName: 'E2E', lastName: tag, ...body })
    expect(r.status).toBe(201)
    return id
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    lib = await import('../src/server/lib/properties.js')
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const { salesScoped } = await import('../src/server/lib/salesScope.js')
    const { crewScoped } = await import('../src/server/lib/crewScope.js')
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    const mk = async (role: string, first: string) => prisma.crmUser.create({ data: { email: `${first.toLowerCase()}-${tag}@example.invalid`, passwordHash: 'x', firstName: first, lastName: 'Test', role, crmAccountId: accountId, status: 'active' } })
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    for (const [who, role, first] of [['owner', 'super_admin', 'Owner'], ['sally', 'sales_rep', 'Sally'], ['sam', 'sales_rep', 'Sam']] as const) {
      const u = await mk(role, first)
      tok[who] = jwt.sign({ sub: u.id, email: u.email, role, firstName: first, lastName: 'Test', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/crm-contacts', crewScoped('contacts'))
    app.use('/api/crm-contacts', salesScoped('contacts'))
    app.use('/api/crm-contacts', (await import('../src/server/routes/crm-contacts.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    for (const m of ['customerPossibleMatch', 'appointment', 'savedJob', 'savedQuote', 'customerProperty', 'auditLog']) await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmContact.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } }).catch(() => {})
    for (const m of ['pipelineState', 'businessState']) await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('first property, a rental, its quote, job and visit, a corrected address, Primary rules', async () => {
    const id = await newCustomer('owner', { serviceAddress: HOME, phone: '3525550101' })
    let list = (await call('GET', `/api/crm-contacts/${id}/properties`, 'owner')).json.data
    expect(list.map((p: any) => [p.label, p.address, p.isPrimary])).toEqual([['Home', HOME, true]])

    // Add the rental, with its notes.
    const add = await call('POST', `/api/crm-contacts/${id}/properties`, 'owner', { label: 'Rental', address: RENTAL, gateCode: '4321', tenantName: 'Tia Tenant', tenantPhone: '3525550199', accessNotes: 'Dog in back' })
    expect(add.status).toBe(201)
    const rental = add.json.data
    expect([rental.label, rental.city, rental.zip, rental.isPrimary, rental.gateCode]).toEqual(['Rental', 'Ocala', '34481', false, '4321'])
    expect(add.json.properties.map((p: any) => p.label)).toEqual(['Home', 'Rental'])
    // Search has it: the customer list carries every property address.
    const row = (await call('GET', '/api/crm-contacts', 'owner')).json.data.find((c: any) => c.id === id)
    expect(row.propertyAddresses.sort()).toEqual([HOME, RENTAL].sort())

    // A quote picked for the rental takes its address; one typed with the home's address goes on Home.
    const q = await lib.placeRecord(prisma, accountId, id, { propertyId: rental.id, address: HOME })
    expect(q).toEqual({ propertyId: rental.id, address: RENTAL })
    expect((await lib.placeRecord(prisma, accountId, id, { address: '10438 SW 75 Ter Ocala' })).propertyId).toBe(list[0].id)
    // A third address typed (no property yet): a new one, Other.
    const other = await lib.placeRecord(prisma, accountId, id, { address: '1 NE 1st Ave, Ocala, FL 34470' })
    expect((await prisma.customerProperty.findUnique({ where: { id: other.propertyId } })).label).toBe('Other')

    const draft = await prisma.savedQuote.create({ data: { accountId, crmContactId: id, propertyId: rental.id, customerAddress: RENTAL, runs: [100], pullSheet: [], fenceStyle: 'x', status: 'DRAFT' } })
    const sold = await prisma.savedQuote.create({ data: { accountId, crmContactId: id, propertyId: rental.id, customerAddress: RENTAL, runs: [100], pullSheet: [], fenceStyle: 'x', status: 'SOLD', soldAt: new Date() } })
    // The job from the sold quote: its property.
    expect(await lib.jobPropertyId(prisma, accountId, id, { quoteId: sold.id, address: HOME })).toBe(rental.id)

    // The rental's address corrected: the draft follows; the sold quote keeps what was signed.
    const FIXED = '8449 SW 58th Loop, Ocala, FL 34481'
    // A signed job is at the rental: the change is asked first (it moves the crew); confirmed, the job follows.
    const job = await prisma.savedJob.create({ data: { accountId, crmContactId: id, quoteId: sold.id, propertyId: rental.id, customerAddress: RENTAL, status: 'staging' } })
    const ask = await call('PATCH', `/api/crm-contacts/${id}/properties/${rental.id}`, 'owner', { address: FIXED })
    expect([ask.status, ask.json.code, ask.json.moves?.jobs]).toEqual([409, 'MOVES_RECORDS', 1])
    expect((await prisma.customerProperty.findUnique({ where: { id: rental.id } })).address).toBe(RENTAL)
    const fix = await call('PATCH', `/api/crm-contacts/${id}/properties/${rental.id}`, 'owner', { address: FIXED, confirmMove: true })
    expect(fix.status).toBe(200)
    expect((await prisma.savedJob.findUnique({ where: { id: job.id } })).customerAddress).toBe(FIXED)
    expect((await prisma.savedQuote.findUnique({ where: { id: draft.id } })).customerAddress).toBe(FIXED)
    expect((await prisma.savedQuote.findUnique({ where: { id: sold.id } })).customerAddress).toBe(RENTAL)

    // The Primary cannot be no longer theirs; make the rental Primary first: the customer's address follows.
    const refuse = await call('PATCH', `/api/crm-contacts/${id}/properties/${list[0].id}`, 'owner', { noLongerTheirs: true })
    expect(refuse.status).toBe(409)
    expect((await call('PATCH', `/api/crm-contacts/${id}/properties/${rental.id}`, 'owner', { primary: true })).status).toBe(200)
    const gone = await call('PATCH', `/api/crm-contacts/${id}/properties/${list[0].id}`, 'owner', { noLongerTheirs: true })
    expect(gone.status).toBe(200)
    expect(gone.json.data.noLongerTheirsAt).toBeTruthy()
    const c = await prisma.crmContact.findUnique({ where: { id } })
    expect([c.serviceAddress, c.zip]).toEqual([FIXED, '34481'])
    list = gone.json.properties
    expect(list.filter((p: any) => p.isPrimary).map((p: any) => p.id)).toEqual([rental.id])
    // The old customer form changing the customer's address changes the Primary's; its job stays where it was
    // (as before properties: that form asks nothing), a draft follows.
    await call('PATCH', `/api/crm-contacts/${id}`, 'owner', { serviceAddress: '8451 SW 58th Loop, Ocala, FL 34481' })
    expect((await prisma.customerProperty.findUnique({ where: { id: rental.id } })).address).toBe('8451 SW 58th Loop, Ocala, FL 34481')
    expect((await prisma.savedJob.findUnique({ where: { id: job.id } })).customerAddress).toBe(FIXED)
    expect((await prisma.savedQuote.findUnique({ where: { id: draft.id } })).customerAddress).toBe('8451 SW 58th Loop, Ocala, FL 34481')
    // The list says how many are still theirs (one sold): a new quote asks which only when more than one.
    expect((await call('GET', '/api/crm-contacts', 'owner')).json.data.find((c: any) => c.id === id).activeProperties).toBe(2)
  })

  test('a new lead at a property of a customer on file is a Possible match; a merge leaves one Primary', async () => {
    const a = await newCustomer('owner', { serviceAddress: HOME })
    await call('POST', `/api/crm-contacts/${a}/properties`, 'owner', { label: 'Airbnb', address: RENTAL })
    // Another name at the Airbnb's address (a guest, a new owner): a new customer, with a Possible match.
    const b = crypto.randomUUID()
    expect((await call('POST', '/api/crm-contacts', 'owner', { id: b, firstName: 'Other', lastName: tag, serviceAddress: '8447 SW 58 Lp Ocala, FL', recordMatches: true })).status).toBe(201)
    const m = await prisma.customerPossibleMatch.findFirst({ where: { accountId, contactId: b } })
    expect([m?.matchId, m?.reason]).toEqual([a, 'address'])

    const { mergeMatch } = await import('../src/server/lib/customerMerge.js')
    const owner = await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin' } })
    await mergeMatch({ accountId, userId: owner.id }, m!.id)
    const props = await prisma.customerProperty.findMany({ where: { accountId, crmContactId: a } })
    expect(props.length).toBe(3)
    expect(props.filter((p: any) => p.isPrimary).map((p: any) => p.address)).toEqual([HOME])
  })

  test('a Salesman sees and adds properties of her own customers only', async () => {
    const hers = await newCustomer('sally', { serviceAddress: HOME })
    const his = await newCustomer('sam', { serviceAddress: RENTAL })
    expect((await call('GET', `/api/crm-contacts/${hers}/properties`, 'sally')).status).toBe(200)
    expect((await call('POST', `/api/crm-contacts/${hers}/properties`, 'sally', { label: 'Rental', address: '1 NE 1st Ave, Ocala, FL 34470' })).status).toBe(201)
    expect((await call('GET', `/api/crm-contacts/${his}/properties`, 'sally')).status).toBe(404)
    expect((await call('POST', `/api/crm-contacts/${his}/properties`, 'sally', { label: 'Rental', address: '2 NE 1st Ave' })).status).toBe(404)
    // Her list carries her customers' property addresses, not his.
    const rows = (await call('GET', '/api/crm-contacts', 'sally')).json.data
    expect(rows.some((c: any) => c.id === his)).toBe(false)
    expect(rows.find((c: any) => c.id === hers).propertyAddresses.length).toBe(2)
  })

  test('a quote moved to another customer: the first keeps the property only when it was already theirs (Nov 6 2026)', async () => {
    const first = await newCustomer('owner', { serviceAddress: HOME, phone: '3525550111' })
    const second = await newCustomer('owner', { serviceAddress: '2 NE 2nd Ave, Ocala, FL 34470', phone: '3525550112' })
    const quoteAt = async (contactId: string, address: string) => {
      const place = await lib.placeRecord(prisma, accountId, contactId, { address })
      return prisma.savedQuote.create({ data: { accountId, crmContactId: contactId, propertyId: place.propertyId, customerName: 'E2E Move', customerAddress: address, fenceStyle: 'x', runs: [], pullSheet: [] } })
    }
    const propsOf = async (id: string) => (await prisma.customerProperty.findMany({ where: { accountId, crmContactId: id } })).map((p: any) => p.address).sort()

    // Typed at a new address: the quote's save made the property, so it goes with the move.
    const q1 = await quoteAt(first, '3 NE 3rd Ave, Ocala, FL 34470')
    expect(await propsOf(first)).toEqual([HOME, '3 NE 3rd Ave, Ocala, FL 34470'].sort())
    await prisma.savedQuote.update({ where: { id: q1.id }, data: { crmContactId: second, propertyId: (await lib.placeRecord(prisma, accountId, second, { address: q1.customerAddress })).propertyId } })
    expect(await lib.dropMovedQuoteProperty(prisma, accountId, q1.propertyId, q1)).toBe(true)
    expect(await propsOf(first)).toEqual([HOME])

    // At their Primary (their home): kept.
    const q2 = await quoteAt(first, HOME)
    expect(await lib.dropMovedQuoteProperty(prisma, accountId, q2.propertyId, q2)).toBe(false)
    // A rental added on the customer before the quote, with notes: theirs already, kept.
    const rental = (await call('POST', `/api/crm-contacts/${first}/properties`, 'owner', { label: 'Rental', address: RENTAL, gateCode: '11' })).json.data
    const q3 = await quoteAt(first, RENTAL)
    expect(q3.propertyId).toBe(rental.id)
    expect(await lib.dropMovedQuoteProperty(prisma, accountId, rental.id, q3)).toBe(false)
    // Made by this quote, but another quote of theirs is there too: kept.
    const q4 = await quoteAt(first, '4 NE 4th Ave, Ocala, FL 34470')
    await quoteAt(first, '4 NE 4th Ave, Ocala, FL 34470')
    expect(await lib.dropMovedQuoteProperty(prisma, accountId, q4.propertyId, q4)).toBe(false)
    // Made long before this quote (an older property, written as Other): kept.
    const old = await prisma.customerProperty.create({ data: { accountId, crmContactId: first, label: 'Other', address: '5 NE 5th Ave, Ocala, FL 34470', createdAt: new Date(Date.now() - 86_400_000) } })
    const q5 = await quoteAt(first, '5 NE 5th Ave, Ocala, FL 34470')
    expect(q5.propertyId).toBe(old.id)
    expect(await lib.dropMovedQuoteProperty(prisma, accountId, old.id, q5)).toBe(false)
    expect(await propsOf(first)).toEqual([HOME, RENTAL, '4 NE 4th Ave, Ocala, FL 34470', '5 NE 5th Ave, Ocala, FL 34470'].sort())
  })
})
