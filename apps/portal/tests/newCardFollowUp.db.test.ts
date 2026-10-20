/**
 * A card made with a new customer (New customer, Pipeline New lead) straight
 * into Estimating or Pending Signature starts its follow up steps, the same as
 * a card moved there on the board. A card in a stage without steps gets none.
 *
 * A throwaway company; database writes happen only inside test / afterAll.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('follow ups for a card made with a new customer (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } }))!
  let accountId = ''
  let token = ''

  const app = express()
  app.use(express.json())
  app.use('/api/crm-contacts', contacts)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  afterAll(async () => {
    server.close()
    if (!accountId) return
    const p = prisma as any
    await p.cardFollowUp.deleteMany({ where: { accountId } })
    await p.automationEvent.deleteMany({ where: { accountId } }).catch(() => {})
    await p.pipelineState.deleteMany({ where: { accountId } })
    await p.crmContact.deleteMany({ where: { accountId } })
    await p.accountKeyValue.deleteMany({ where: { accountId } })
    await p.crmAccount.delete({ where: { id: accountId } })
  })

  const create = async (stage: string) => {
    const id = crypto.randomUUID()
    const cardId = crypto.randomUUID()
    const r = await fetch(base + '/api/crm-contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, firstName: 'E2E', lastName: `Follow Up ${stage}`, lead: { id: cardId, firstName: 'E2E', lastName: `Follow Up ${stage}`, stage } }),
    })
    expect(r.status).toBe(201)
    return cardId
  }

  test('Estimating (the first card, a new board) and Pending Signature start their steps; New Lead does not', async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test new-card-follow-up-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    token = jwt.sign({ sub: user.id, email: user.email, role: 'sales_rep', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })

    const est = await create('Estimating')
    const pend = await create('Pending Signature')
    const lead = await create('New Lead')
    const rows = await (prisma as any).cardFollowUp.findMany({ where: { accountId } })
    const by = new Map(rows.map((r: any) => [r.cardId, r]))
    expect((by.get(est) as any)?.dueOn).toBeTruthy()
    expect((by.get(pend) as any)?.dueOn).toBeTruthy()
    expect(by.has(lead)).toBe(false)
  })
})
