/**
 * The notes typed in Add lead reach the Salesman's visit (audit Oct 26 2026:
 * her card window and her appointment said "No notes yet"; the notes were
 * only on the customer page). Against the dev database (DEV_DB=1; refuses any
 * other): an appointment carries the customer record's notes; the Installer
 * reads them with the dollar amount left out.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('an appointment carries the customer\'s notes (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: appointments } = await import('../src/server/routes/appointments.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `acn-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = '', sales = '', crew = '', apptId = ''
  let server: ReturnType<express.Express['listen']>
  const notes = 'wants 6 ft white vinyl, ~150 ft, one walk gate. Budget about $4000.'

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const mk = async (role: string, first: string) => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${role}@example.invalid`, firstName: first, lastName: tag, role, crmAccountId: accountId, passwordHash: 'x' } as any })
      return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' }) }
    }
    const s = await mk('sales_rep', 'Sally'); sales = s.token
    const c = await mk('field_crew', 'Carl'); crew = c.token
    const contact = await prisma.crmContact.create({ data: { accountId, firstName: 'Walker', lastName: tag, phone: '3525550111', notes } as any })
    apptId = (await prisma.appointment.create({ data: { accountId, crmContactId: contact.id, type: 'estimate', startAt: new Date(Date.now() + 86_400_000), assignedTo: `Sally ${tag}`, assignedToUserId: s.id, notes: 'measure back yard' } as any })).id
    const app = express(); app.use(express.json()); app.use('/api/appointments', appointments)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the Salesman\'s list and the one visit have the notes typed in Add lead, beside the booking\'s', async () => {
    const list = await fetch(`${base}/api/appointments`, { headers: { Authorization: `Bearer ${sales}` } }).then(r => r.json()) as any
    const a = list.data.find((x: any) => x.id === apptId)
    expect(a).toMatchObject({ customerNotes: notes, notes: 'measure back yard' })
    const one = await fetch(`${base}/api/appointments/${apptId}`, { headers: { Authorization: `Bearer ${sales}` } }).then(r => r.json()) as any
    expect(one.data.customerNotes).toBe(notes)
  })

  test('the Installer never reads the amount', async () => {
    const list = await fetch(`${base}/api/appointments`, { headers: { Authorization: `Bearer ${crew}` } }).then(r => r.json()) as any
    const a = list.data.find((x: any) => x.id === apptId)
    expect(a.customerNotes).toContain('wants 6 ft white vinyl')
    expect(a.customerNotes).not.toContain('4000')
  })
})
