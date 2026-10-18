/**
 * A new customer sent from a phone with bad signal arrives more than once: the
 * answer never reached the phone, so it sends again. Against the dev database
 * (DEV_DB=1; refuses any other), the same create (customer and card, one ID
 * each) is sent 3 times one after another and 3 times at once: exactly one
 * customer and one pipeline card, every answer a success. The same for a note,
 * a quote and a job. Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the same create sent 3 times (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use('/api/crm-contacts', contacts)
  app.use('/api/saved-quotes', quotes)
  app.use('/api/saved-jobs', jobs)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() as any }))

  const made: string[] = []
  const cardsFor = async (customerId: string) => {
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    return ((p?.leads as any[]) ?? []).filter(l => l?.customerId === customerId)
  }
  afterAll(async () => {
    // Only onto the copy it read (other test files save the board at the same time).
    for (let i = 0; i < 10; i++) {
      const p = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (!p) break
      const done = await prisma.pipelineState.updateMany({ where: { accountId, version: p.version }, data: { leads: ((p.leads as any[]) ?? []).filter(l => !made.includes(l?.customerId)), version: { increment: 1 } } })
      if (done.count) break
    }
    await prisma.crmContactNote.deleteMany({ where: { crmContactId: { in: made } } })
    await prisma.savedJob.deleteMany({ where: { crmContactId: { in: made } } })
    await prisma.savedQuote.deleteMany({ where: { crmContactId: { in: made } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made } } })
    server.close()
  })

  const createBody = (name: string) => {
    const id = crypto.randomUUID()
    made.push(id)
    return {
      id, firstName: 'E2E', lastName: name, phone: '3525550199', leadSource: 'Other',
      lead: { id: crypto.randomUUID(), customerId: id, firstName: 'E2E', lastName: name, phone: '3525550199', stage: 'First Contact', leadSource: 'Other', createdAt: '2026-10-18', lastMoved: '2026-10-18' },
      leadBefore: null,
    }
  }

  test('one after another: one customer, one card', async () => {
    const body = createBody('Repeat Sequential')
    const answers = [await post('/api/crm-contacts', body), await post('/api/crm-contacts', body), await post('/api/crm-contacts', body)]
    expect(answers.map(a => a.status)).toEqual([201, 200, 200])
    expect(await prisma.crmContact.count({ where: { id: body.id } })).toBe(1)
    expect(await cardsFor(body.id)).toHaveLength(1)
  })

  test('all three at once: one customer, one card, no errors', async () => {
    const body = createBody('Repeat At Once')
    const answers = await Promise.all([post('/api/crm-contacts', body), post('/api/crm-contacts', body), post('/api/crm-contacts', body)])
    expect(answers.every(a => a.status === 200 || a.status === 201)).toBe(true)
    expect(answers.filter(a => a.status === 201).length).toBeLessThanOrEqual(1)
    expect(await prisma.crmContact.count({ where: { id: body.id } })).toBe(1)
    expect(await cardsFor(body.id)).toHaveLength(1)
  })

  test('sent again with a new card ID (an older app): still one card for that customer', async () => {
    const body = createBody('Repeat New Card')
    await post('/api/crm-contacts', body)
    await post('/api/crm-contacts', { ...body, lead: { ...body.lead, id: crypto.randomUUID() } })
    expect(await cardsFor(body.id)).toHaveLength(1)
  })

  test('a note, a quote and a job sent 3 times at once: one of each', async () => {
    const body = createBody('Repeat Others')
    await post('/api/crm-contacts', body)
    const note = { id: crypto.randomUUID(), body: 'Gate code 1234 (test)' }
    const notes = await Promise.all([1, 2, 3].map(() => post(`/api/crm-contacts/${body.id}/notes`, note)))
    expect(notes.every(a => a.status < 300)).toBe(true)
    expect(await prisma.crmContactNote.count({ where: { id: note.id } })).toBe(1)

    const quote = { id: crypto.randomUUID(), crmContactId: body.id, customerName: 'E2E Repeat Others', fenceStyle: "WV-ND 6'x6' Privacy", runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0, sections: 17, status: 'DRAFT', date: '2026-10-18' }
    const qs = await Promise.all([1, 2, 3].map(() => post('/api/saved-quotes', quote)))
    expect(qs.every(a => a.status < 300)).toBe(true)
    expect(await prisma.savedQuote.count({ where: { id: quote.id } })).toBe(1)

    const job = { id: crypto.randomUUID(), crmContactId: body.id, quoteId: quote.id, customerName: 'E2E Repeat Others', status: 'staging' }
    const js = await Promise.all([1, 2, 3].map(() => post('/api/saved-jobs', job)))
    expect(js.every(a => a.status < 300), JSON.stringify(js.map(a => [a.status, a.json?.error]))).toBe(true)
    expect(await prisma.savedJob.count({ where: { id: job.id } })).toBe(1)

    // A second job for the same quote (another phone, its own id): still one job, the first.
    const other = { ...job, id: crypto.randomUUID() }
    const again = await Promise.all([1, 2, 3].map(() => post('/api/saved-jobs', other)))
    expect(again.every(a => a.status < 300)).toBe(true)
    expect(await prisma.savedJob.count({ where: { quoteId: quote.id } })).toBe(1)
  })
}, 60_000)
