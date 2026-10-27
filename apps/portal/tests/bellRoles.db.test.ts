/**
 * The bell by role (dev database, DEV_DB=1; refuses any other): an office
 * notice (no recipient, no job: "Possible duplicates") reaches the owner and
 * the office, never the Salesman or the Installer; a notice about a job
 * reaches the Salesman of that job and the Installer whose crew has it; a
 * notice to a person reaches that person. Oct 25 2026: everyone saw 50.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the bell by role (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `bell-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const users: Record<string, { id: string; email: string; token: string }> = {}
  const ids: string[] = []
  const jobs: Record<string, string> = {}

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    for (const [k, role, first] of [['office', 'office_staff', 'Olive'], ['sales', 'sales_rep', 'Sally'], ['crew', 'field_crew', 'Carl']] as const) {
      const email = `${tag}-${k}@example.invalid`
      const u = await prisma.crmUser.create({ data: { email, firstName: first, lastName: tag, role, crmAccountId: accountId, passwordHash: 'x' } as any })
      users[k] = { id: u.id, email, token: jwt.sign({ sub: u.id, email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' }) }
    }
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    jobs.sally = (await prisma.savedJob.create({ data: { accountId, customerName: `Job A ${tag}`, salesRep: `Sally ${tag}`, scheduledDate: tomorrow } as any })).id
    jobs.other = (await prisma.savedJob.create({ data: { accountId, customerName: `Job B ${tag}`, salesRep: 'Someone Else' } as any })).id
    // The crew's install: its Schedule entry from tomorrow (lib/crewScope.ts).
    await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: jobs.sally, clientName: 'A', crewId: 'c1', date: tomorrow } })
    const mk = async (data: any) => { const n = await prisma.notification.create({ data: { body: '', ...data, title: `${tag} ${data.title}` } }); ids.push(n.id) }
    await mk({ title: 'office notice' })
    await mk({ title: 'about job A', jobId: jobs.sally })
    await mk({ title: 'about job B', jobId: jobs.other })
    await mk({ title: 'to Sally', recipientId: users.sales.email })
    const app = express(); app.use(express.json()); app.use('/api/automations', automations)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.notification.deleteMany({ where: { id: { in: ids } } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const seen = async (who: string) => {
    const r = await fetch(`${base}/api/automations/notifications`, { headers: { Authorization: `Bearer ${users[who].token}` } }).then(r => r.json())
    if (!r.data) throw new Error(JSON.stringify(r))
    if (process.env.BELL_DEBUG) console.log(who, r.data.notifications.length, r.data.notifications.slice(0, 3).map((n: any) => n.title + " " + n.createdAt))
    return (r.data.notifications as any[]).map(n => n.title).filter((t: string) => t.startsWith(tag)).map((t: string) => t.slice(tag.length + 1)).sort()
  }

  test('the office sees the office notices; the Salesman and the Installer only theirs', async () => {
    expect(await seen('office')).toEqual(['about job A', 'about job B', 'office notice'])
    expect(await seen('sales')).toEqual(['about job A', 'to Sally'])
    expect(await seen('crew')).toEqual(['about job A'])
  })

  test('the office\'s notices about a job (permit reminder, failed automation) never reach the Salesman or the Installer (audit Oct 26 2026)', async () => {
    const titles = async (who: string) => {
      const r = await fetch(`${base}/api/automations/notifications`, { headers: { Authorization: `Bearer ${users[who].token}` } }).then(r => r.json())
      return (r.data.notifications as any[]).filter(n => n.jobId === jobs.sally).map(n => n.title as string)
    }
    const add = async (data: any) => { const n = await prisma.notification.create({ data: { body: '', jobId: jobs.sally, ...data } }); ids.push(n.id) }
    // As made now (marked the office's), and as made before (by their words).
    await add({ title: `Permit still Needed: Job A ${tag}`, type: 'warning', recipientRole: 'office' })
    await add({ title: `Permit still Applied: Job A ${tag}`, type: 'warning' })
    await add({ title: `Automation failed: ${tag}`, type: 'error', recipientRole: 'office' })
    await add({ title: `Automation failed (old): ${tag}`, type: 'error' })
    const office = await titles('office')
    expect(office.filter(t => t.includes('Permit still') || t.startsWith('Automation failed'))).toHaveLength(4)
    for (const who of ['sales', 'crew']) {
      const t = await titles(who)
      expect(t.some(x => x.includes('Permit still') || x.startsWith('Automation failed'))).toBe(false)
      expect(t).toContain(`${tag} about job A`)
    }
  })

  test('a permit reminder takes the place of the last one for the job: one on the bell, the office\'s', async () => {
    const { permitReminders } = await import('../src/server/lib/automations/queue.js')
    const job = (await prisma.savedJob.create({ data: { accountId, customerName: `Permit job ${tag}`, customerAddress: '1 Test St', status: 'staging' } as any })).id
    const permit = await prisma.permit.create({ data: { accountId, jobId: job, status: 'needed' } })
    await prisma.$executeRaw`UPDATE "Permit" SET "updatedAt" = now() - interval '10 days' WHERE id = ${permit.id}`
    const day = 86_400_000
    await permitReminders(new Date(), accountId)
    await permitReminders(new Date(Date.now() + 4 * day), accountId)
    const rows = await prisma.notification.findMany({ where: { jobId: job } })
    ids.push(...rows.map(r => r.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: `Permit still Needed: Permit job ${tag}`, recipientRole: 'office' })
    await prisma.automationEffect.deleteMany({ where: { key: { startsWith: `permit-reminder:${permit.id}:` } } })
    await prisma.permit.delete({ where: { id: permit.id } })
  })
})
