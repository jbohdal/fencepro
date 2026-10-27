/**
 * Round 6 review, Oct 27 2026, against the dev database (DEV_DB=1; refuses any other):
 *   6. the task list: overdue and today's first, then later, then no due day; as many as asked for
 *      ("Show more"), not a fixed 100; the Done view lists recently closed tasks, newest first, with
 *      "Closed by itself on …";
 *   7. a job's Automations shows its pipeline card's runs (the Signed Contract rule runs on the card).
 * Everything made is removed.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('tasks and a job\'s automations (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { loadLeads, jobForCard } = await import('../src/server/lib/automations/context.js')

  const admin = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = admin.crmAccountId!
  const tag = `round6-${crypto.randomUUID().slice(0, 8)}`
  // A Salesman's login: her list is only the tasks named for her, so the dev data's other tasks stay out of it.
  const email = `${tag}@example.invalid`
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const salesToken = jwt.sign({ sub: `${tag}-user`, email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '30m' })
  const adminToken = jwt.sign({ sub: admin.id, email: admin.email, role: admin.role, crmAccountId: accountId }, secret, { expiresIn: '30m' })
  const app = express()
  app.use(express.json())
  app.use('/api/automations', automations)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const get = (path: string, token = salesToken) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }).then(async r => ({ status: r.status, json: await r.json() as any }))
  const runIds: string[] = []

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { assignedTo: email } })
    if (runIds.length) await prisma.automationRun.deleteMany({ where: { id: { in: runIds } } })
    server.close()
  })

  test('open: overdue, then today, then later, then no due day; "Show more" gets more than 100', async () => {
    const day = 86_400_000
    const now = Date.now()
    await prisma.task.createMany({ data: [
      { title: `${tag} later`, assignedTo: email, dueDate: new Date(now + 5 * day) },
      { title: `${tag} no day`, assignedTo: email, dueDate: null },
      { title: `${tag} today`, assignedTo: email, dueDate: new Date(now) },
      { title: `${tag} overdue`, assignedTo: email, dueDate: new Date(now - 3 * day) },
    ] })
    const r = await get('/api/automations/tasks')
    expect(r.status).toBe(200)
    expect(r.json.data.map((t: any) => t.title.replace(`${tag} `, ''))).toEqual(['overdue', 'today', 'later', 'no day'])

    await prisma.task.createMany({ data: Array.from({ length: 110 }, (_v, i) => ({ title: `${tag} bulk ${i}`, assignedTo: email, dueDate: new Date(now + 10 * day) })) })
    expect((await get('/api/automations/tasks')).json.data).toHaveLength(100)
    expect((await get('/api/automations/tasks?limit=51')).json.data).toHaveLength(51)
    const all = (await get('/api/automations/tasks?limit=200')).json.data
    expect(all).toHaveLength(114)
    expect(all.at(-1).title).toBe(`${tag} no day`)
  })

  test('done: recently closed, newest first, with why it closed; older than the days asked for is left out', async () => {
    const day = 86_400_000
    const now = Date.now()
    await prisma.task.createMany({ data: [
      { title: `${tag} closed by itself`, assignedTo: email, status: 'completed', completedAt: new Date(now - day), description: 'Permit packet.\n\nClosed by itself on 10/26/2026: the permit is marked Not needed.' },
      { title: `${tag} ticked`, assignedTo: email, status: 'completed', completedAt: new Date(now - 60_000) },
      { title: `${tag} long ago`, assignedTo: email, status: 'completed', completedAt: new Date(now - 30 * day) },
    ] })
    const r = await get('/api/automations/tasks?status=completed&days=14&limit=51')
    expect(r.json.data.map((t: any) => t.title.replace(`${tag} `, ''))).toEqual(['ticked', 'closed by itself'])
    expect(r.json.data[1].description).toContain('Closed by itself on 10/26/2026: the permit is marked Not needed.')
    expect(r.json.data[1].completedAt).toBeTruthy()
  })

  test('a job\'s runs include its pipeline card\'s', async () => {
    const { leads } = await loadLeads(accountId)
    let pair: { card: any; job: any } | null = null
    for (const card of leads.filter(l => l?.id && (l.jobId || l.quoteId))) {
      const job = await jobForCard(accountId, card)
      if (job) { pair = { card, job }; break }
    }
    expect(pair, "a card on dev with a job").not.toBeNull()
    if (!pair) return
    const run = await prisma.automationRun.create({ data: { accountId, ruleId: `${tag}-rule`, eventId: `${tag}-event`, entityKind: 'card', entityId: String(pair.card.id), status: 'succeeded', log: [] } })
    runIds.push(run.id)
    const byJob = await get(`/api/automations/runs?jobId=${pair.job.id}&limit=100`, adminToken)
    expect(byJob.status).toBe(200)
    const mine = byJob.json.data.find((r: any) => r.id === run.id)
    expect(mine?.onCard).toBe(true)
    // The card's own log, as before.
    expect((await get(`/api/automations/runs?entityId=${pair.card.id}&limit=100`, adminToken)).json.data.some((r: any) => r.id === run.id)).toBe(true)
  })
})
