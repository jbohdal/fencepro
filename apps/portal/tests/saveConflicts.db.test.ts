/**
 * Ordinary saves make no 409 (review, Oct 27 2026: PATCH /api/pipeline and
 * PATCH /api/business-state answered 409 while booking a visit, saving a quote
 * and scheduling an install, then went through on the second try).
 *
 * The cause: the server writes the board and the business record itself as
 * part of other saves (a new job adds its checklist and moves its card;
 * scheduling an install moves the card), and the browser's next save of
 * either was built on the version it had before. Now every answer to a staff
 * save carries X-Doc-Versions (lib/docVersions.ts), and the app reads its copy
 * again before saving when the server is ahead (apps/web/src/docVersions.ts,
 * pipelineStore, businessStateStore).
 *
 * The header's parsing (no database), then against the dev database
 * (DEV_DB=1; refuses any other) on a throwaway company, through the real
 * routes, as the office's browser does it: a tab that follows the app's rule
 * makes no 409 in the three flows; a tab that ignores the header is still
 * refused (the version check is unchanged) and nothing the server wrote is lost.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { parseDocVersions as serverParse } from '../src/server/lib/docVersions.js'
import { parseDocVersions as appParse } from '../../web/src/docVersions.js'

describe('X-Doc-Versions', () => {
  test('the server\'s and the app\'s reading agree', () => {
    for (const h of ['pipeline=3921, business=3219', 'pipeline=7', 'business=0', '', 'pipeline=x, business=12']) {
      expect(appParse(h)).toEqual(serverParse(h))
    }
    expect(appParse('pipeline=3921, business=3219')).toEqual({ pipeline: 3921, business: 3219 })
    expect(appParse(null)).toEqual({})
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('no 409 on ordinary saves (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { tagDocVersions } = await import('../src/server/lib/docVersions.js')
  const { default: pipelineRoutes } = await import('../src/server/routes/pipeline.js')
  const { default: businessStateRoutes } = await import('../src/server/routes/business-state.js')
  const { default: savedJobsRoutes } = await import('../src/server/routes/saved-jobs.js')
  const { default: scheduleRoutes } = await import('../src/server/routes/schedule.js')
  const { START_IDS } = await import('../src/server/lib/pipelineStageModel.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `sc-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', baseUrl = '', token = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = await prisma.crmUser.create({ data: { email: `${tag}-office@example.invalid`, firstName: 'Olive', lastName: tag, role: 'office_staff', crmAccountId: accountId, passwordHash: 'x' } as any })
    token = jwt.sign({ sub: user.id, email: user.email, role: 'office_staff', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Getter Done Fence', phone: '3528442677' } } as any } })
    await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: [{ id: 'c1', name: 'Crew One', color: 'bg-blue-500' }] } })
    for (const k of ['a', 'b']) {
      const c = await prisma.crmContact.create({ data: { accountId, firstName: k === 'a' ? 'Ann' : 'Bo', lastName: tag, phone: k === 'a' ? '3525550161' : '3525550162' } as any })
      ids[`contact_${k}`] = c.id
      ids[`card_${k}`] = `card-${k}-${tag}`
    }
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [
      { id: ids.card_a, customerId: ids.contact_a, firstName: 'Ann', lastName: tag, stage: START_IDS.signedContract, createdAt: new Date().toISOString() },
      { id: ids.card_b, customerId: ids.contact_b, firstName: 'Bo', lastName: tag, stage: START_IDS.firstContact, createdAt: new Date().toISOString() },
    ] as any } })
    const app = express()
    app.use(express.json())
    app.use('/api', tagDocVersions)
    app.use('/api/pipeline', pipelineRoutes)
    app.use('/api/business-state', businessStateRoutes)
    app.use('/api/saved-jobs', savedJobsRoutes)
    app.use('/api/schedule', scheduleRoutes)
    server = app.listen(0); baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const jobs = (await prisma.savedJob.findMany({ where: { accountId }, select: { id: true } })).map(j => j.id)
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.deletionLog.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.scheduleSettings.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.task.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...Object.values(ids)] } } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  /**
   * The office's browser tab, by the app's rule: it keeps the versions it loaded, notes X-Doc-Versions on
   * every answer, and reads its copy again before a save when the server said it is ahead. `follow: false`
   * is a tab from before the fix (it ignores the header).
   */
  function tab(follow = true) {
    const t = {
      newest: { pipeline: -1, business: -1 } as Record<string, number>,
      v: { pipeline: 0, business: 0 } as Record<string, number>,
      saves: [] as Array<{ what: string; status: number }>,
      reads: 0,
      async call(method: string, path: string, body?: unknown) {
        const r = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
        const seen = parseDocVersions(r.headers.get('X-Doc-Versions'))
        for (const [k, n] of Object.entries(seen)) if (n > t.newest[k]) t.newest[k] = n
        return { status: r.status, json: await r.json() as any }
      },
      async load(doc: 'pipeline' | 'business') {
        t.reads++
        const r = await t.call('GET', doc === 'pipeline' ? '/api/pipeline' : '/api/business-state')
        t.v[doc] = r.json.data.version
        return r.json.data
      },
      async saveCard(lead: any) {
        if (follow && t.newest.pipeline > t.v.pipeline) await t.load('pipeline')
        const r = await t.call('PATCH', '/api/pipeline', { upsert: [{ lead }], remove: [], baseVersion: t.v.pipeline })
        t.saves.push({ what: `card ${lead.id}`, status: r.status })
        if (r.status === 200) t.v.pipeline = r.json.version
        return r
      },
      async saveBusiness(patch: Record<string, unknown>) {
        if (follow && t.newest.business > t.v.business) await t.load('business')
        const r = await t.call('PATCH', '/api/business-state', { ...patch, baseVersion: t.v.business })
        t.saves.push({ what: Object.keys(patch).join(','), status: r.status })
        if (r.status === 200) t.v.business = r.json.data.version
        return r
      },
    }
    return t
  }
  const parseDocVersions = serverParse
  const cardNow = async (id: string) => (((await prisma.pipelineState.findUnique({ where: { accountId } }))!.leads as any[]) ?? []).find(l => l.id === id)

  test('book a visit, save a quote, schedule an install: every save goes once, no 409', async () => {
    const office = tab()
    const board = await office.load('pipeline')
    await office.load('business')
    const b0 = board.leads.find((l: any) => l.id === ids.card_b)

    // Book a visit: the card to Appointment; the answer's header is the version the save made (nothing to read).
    const booked = await office.saveCard({ ...b0, stage: START_IDS.appointment })
    expect(booked.status).toBe(200)
    expect(office.newest.pipeline).toBe(office.v.pipeline)

    // Sold: the job is made. The server adds its checklist (business record) and moves its card itself.
    const before = { ...office.v }
    const made = await office.call('POST', '/api/saved-jobs', { crmContactId: ids.contact_a, customerName: `Ann ${tag}`, customerPhone: '3525550161', customerAddress: '110 SE Watula Ave, Ocala, FL 34471', fenceStyle: "WV-ND 6'x8' Privacy", sections: 20, totalFeet: 160, contractValue: 6000, status: 'staging' })
    expect(made.status).toBe(201)
    ids.job = made.json.data.id
    expect(office.newest.business).toBeGreaterThan(before.business)
    expect(office.newest.pipeline).toBeGreaterThan(before.pipeline)
    expect((await cardNow(ids.card_a)).stage).not.toBe(START_IDS.signedContract)
    const checklist = ((await prisma.businessState.findUnique({ where: { accountId } }))!.jobChecklists as any)?.[ids.job]
    expect(Array.isArray(checklist) && checklist.length > 0).toBe(true)

    // Save a quote: its pull sheet goes to the business record, after the server's own write.
    const pull = { id: `ps-${tag}`, customerId: ids.contact_b, customerName: `Bo ${tag}`, quoteId: `q-${tag}`, quoteName: 'White vinyl', versionSnapshot: [], versionNumber: 1, linkedAt: new Date().toISOString(), linkedBy: 'auto' }
    const saved = await office.saveBusiness({ pullSheets: [pull] })
    expect(saved.status).toBe(200)

    // Schedule the install (the server moves the job's card along with the job when it is behind).
    const sched = await office.call('POST', '/api/schedule/install', { jobId: ids.job, start: '2027-03-04', crew: 'c1', days: 1 })
    expect(sched.status).toBe(200)
    // The board in this tab is older than the server's (the job's card moved): the answer said so.
    expect(office.newest.pipeline).toBeGreaterThan(office.v.pipeline)

    // The next visit, booked from the same tab: its card is read again first, then saved once.
    const reads = office.reads
    const b1 = await cardNow(ids.card_b)
    const next = await office.saveCard({ ...b1, notes: 'Second visit: gate measurements' })
    expect(next.status).toBe(200)
    expect(office.reads).toBe(reads + 1)

    expect(office.saves.filter(s => s.status === 409)).toEqual([])
    expect(office.saves.every(s => s.status === 200)).toBe(true)
    // What the server wrote itself is still there after the office's saves.
    const bs = (await prisma.businessState.findUnique({ where: { accountId } }))!
    expect((bs.jobChecklists as any)[ids.job]?.length).toBeGreaterThan(0)
    expect((bs.pullSheets as any[]).some(p => p.id === pull.id)).toBe(true)
    const job = (await prisma.savedJob.findUnique({ where: { id: ids.job } }))!
    expect(job.scheduledDate).toBe('2027-03-04')
  })

  test('the version check is unchanged: a tab that ignores the header is refused with 409 and the server\'s copy', async () => {
    const old = tab(false)
    await old.load('pipeline')
    await old.load('business')
    // The server writes both itself (another job: its checklist; its card).
    const made = await old.call('POST', '/api/saved-jobs', { crmContactId: ids.contact_b, customerName: `Bo ${tag}`, customerPhone: '3525550162', customerAddress: '110 SE Watula Ave, Ocala, FL 34471', fenceStyle: "WV-ND 6'x8' Privacy", status: 'staging' })
    expect(made.status).toBe(201)
    const header = old.newest.business
    expect(header).toBeGreaterThan(old.v.business)
    const r = await old.saveBusiness({ pullSheets: [] })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('STALE_VERSION')
    expect(r.json.version).toBe(header)
    // Nothing was written by the refused save.
    expect(((await prisma.businessState.findUnique({ where: { accountId } }))!.pullSheets as any[]).length).toBe(1)
    // Two people at once: a save on an old board is still refused.
    const stale = await old.call('PATCH', '/api/pipeline', { upsert: [], remove: [], baseVersion: 0 })
    expect(stale.status).toBe(409)
  })

  test('the header is on staff saves only: not on a read, not without a login', async () => {
    const r = await fetch(`${baseUrl}/api/pipeline`, { headers: { Authorization: `Bearer ${token}` } })
    expect(r.headers.get('X-Doc-Versions')).toBeNull()
    const anon = await fetch(`${baseUrl}/api/business-state`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(anon.status).toBe(401)
    expect(anon.headers.get('X-Doc-Versions')).toBeNull()
  })
})
