/**
 * "Send feedback" against the dev database (DEV_DB=1; refuses any other): a
 * feedback sent 3 times (one after another, and 3 at once) is one row, with
 * one notification; someone who is not the owner or an admin can send but
 * cannot list, change or see screenshots; the screenshot is served to the
 * owner. Screenshots go to a temporary folder. Removes what it made.
 *
 * Also: the screen's name, the record (from the page address, named from the
 * sender's company only), the app version and the role are kept; Needs
 * Jonathan is a status; scripts/feedback-report.ts --since lists it with a
 * link to the screenshot.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { execFileSync } from 'child_process'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('send feedback (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: feedback } = await import('../src/server/routes/feedback.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const tokenAs = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
  const owner = tokenAs('super_admin'), sales = tokenAs('sales_rep')

  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/feedback', feedback)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, p: string, token: string | null, body?: unknown) =>
    fetch(base + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null) as any })

  const MARK = `e2e-feedback-${crypto.randomUUID().slice(0, 8)}`
  const made: string[] = []
  // A small JPEG (the server checks it starts like one).
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000), Buffer.from([0xff, 0xd9])])
  const body = (text: string) => {
    const id = crypto.randomUUID(); made.push(id)
    return { id, text: `${MARK} ${text}`, path: '/customers?tab=all', screen: '390x844 @3x', userAgent: 'vitest', appFile: '/assets/index-test.js', screenshot: `data:image/jpeg;base64,${jpeg.toString('base64')}`, errors: [{ at: new Date().toISOString(), message: 'Test error' }] }
  }
  let dir = ''
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-feedback-')); process.env.UPLOAD_DIR = dir })
  afterAll(async () => {
    await prisma.feedback.deleteMany({ where: { id: { in: made } } })
    await prisma.notification.deleteMany({ where: { link: '/feedback', body: { contains: MARK } } })
    server.close()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  test('sent 3 times one after another: one feedback, one notification', async () => {
    const b = body('sequential')
    const answers = [await json(await call('POST', '/api/feedback', sales, b)), await json(await call('POST', '/api/feedback', sales, b)), await json(await call('POST', '/api/feedback', sales, b))]
    expect(answers.map(a => a.status)).toEqual([201, 200, 200])
    expect(answers.every(a => a.json?.data?.id === b.id)).toBe(true)
    expect(await prisma.feedback.count({ where: { id: b.id } })).toBe(1)
    const row = (await prisma.feedback.findUnique({ where: { id: b.id } }))!
    expect(row.role).toBe('sales_rep')
    expect(row.path).toBe('/customers?tab=all')
    expect(row.screenshotPath && fs.existsSync(row.screenshotPath)).toBe(true)
    expect(await prisma.notification.count({ where: { link: '/feedback', body: { contains: `${MARK} sequential` } } })).toBe(1)
  })

  test('sent 3 times at once: one feedback, no errors', async () => {
    const b = body('at once')
    const answers = await Promise.all([0, 1, 2].map(async () => json(await call('POST', '/api/feedback', sales, b))))
    expect(answers.every(a => a.status === 200 || a.status === 201)).toBe(true)
    expect(answers.filter(a => a.status === 201).length).toBeLessThanOrEqual(1)
    expect(await prisma.feedback.count({ where: { id: b.id } })).toBe(1)
  })

  test('someone who is not the owner or an admin cannot list, change or see screenshots', async () => {
    const id = made[0]
    expect((await call('GET', '/api/feedback', sales)).status).toBe(403)
    expect((await call('PATCH', `/api/feedback/${id}`, sales, { status: 'done' })).status).toBe(403)
    expect((await call('GET', `/api/feedback/${id}/screenshot`, sales)).status).toBe(403)
    expect((await call('GET', `/api/feedback/${id}/screenshot`, null)).status).toBe(401)
    expect((await prisma.feedback.findUnique({ where: { id } }))!.status).toBe('new')
  })

  test('the owner lists it, sees the screenshot and marks it', async () => {
    const id = made[0]
    const list = await json(await call('GET', '/api/feedback', owner))
    expect(list.status).toBe(200)
    const mine = (list.json.data as any[]).find(f => f.id === id)
    expect(mine).toBeTruthy()
    expect(mine.hasScreenshot).toBe(true)
    expect(mine.screenshotPath).toBeUndefined()
    const shot = await call('GET', `/api/feedback/${id}/screenshot`, owner)
    expect(shot.status).toBe(200)
    expect(shot.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await shot.arrayBuffer()).equals(jpeg)).toBe(true)
    const marked = await json(await call('PATCH', `/api/feedback/${id}`, owner, { status: 'seen' }))
    expect(marked.status).toBe(200)
    expect(marked.json.data.status).toBe('seen')
    expect((await call('PATCH', `/api/feedback/${id}`, owner, { status: 'nope' })).status).toBe(400)
  })

  test('a screenshot that is not a JPEG is refused, and nothing is saved', async () => {
    const b = { ...body('bad picture'), screenshot: `data:image/jpeg;base64,${Buffer.from('not a picture at all').toString('base64')}` }
    expect((await call('POST', '/api/feedback', sales, b)).status).toBe(400)
    expect(await prisma.feedback.count({ where: { id: b.id } })).toBe(0)
  })

  test('the screen, the record (named in this company only), the role and the app version are kept', async () => {
    const contact = await prisma.crmContact.findFirst({ where: { accountId, firstName: { not: '' } }, select: { id: true, firstName: true, lastName: true } })
    expect(contact).toBeTruthy()
    const b = { ...body('on a customer'), path: `/customers/${contact!.id}?tab=photos`, screenTitle: 'Customers', appVersion: 'abc1234 built 2026-10-26 18:00 UTC' }
    const r = await json(await call('POST', '/api/feedback', sales, b))
    expect(r.status).toBe(201)
    expect(r.json.data).toMatchObject({ screenTitle: 'Customers', recordType: 'customer', recordId: contact!.id, recordName: `${contact!.firstName} ${contact!.lastName}`.trim(), appVersion: 'abc1234 built 2026-10-26 18:00 UTC', role: 'sales_rep' })
    const n = await prisma.notification.findFirst({ where: { link: '/feedback', body: { contains: `${MARK} on a customer` } } })
    expect(n?.body).toContain('(on Customers, Customer: ')

    // A record id that is not this company's: kept as sent, never named.
    const other = { ...body('odd record'), path: '/operations?job=not-a-real-job-id', screenTitle: 'Operations' }
    const o = await json(await call('POST', '/api/feedback', sales, other))
    expect(o.json.data).toMatchObject({ recordType: 'job', recordId: 'not-a-real-job-id', recordName: '' })
  })

  test('Needs Jonathan is a status the owner can set, and the list filters by it', async () => {
    const id = made[0]
    const marked = await json(await call('PATCH', `/api/feedback/${id}`, owner, { status: 'needs_jonathan' }))
    expect(marked.status).toBe(200)
    expect(marked.json.data.status).toBe('needs_jonathan')
    expect(marked.json.data.statusBy).toBeTruthy()
    const list = await json(await call('GET', '/api/feedback?status=needs_jonathan', owner))
    expect((list.json.data as any[]).some(f => f.id === id)).toBe(true)
    expect((list.json.data as any[]).every(f => f.status === 'needs_jonathan')).toBe(true)
  })

  test('the daily review script lists it since today, with a link to the screenshot (read only)', () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-feedback-shots-'))
    try {
      const out = execFileSync('npx', ['tsx', 'scripts/feedback-report.ts', '--since', today, '--limit', '200', '--json', '--copy-shots', shots], { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' })
      const rows = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const mine = rows.find(r => r.id === made[0])
      expect(mine).toBeTruthy()
      expect(mine.statusWords).toBe('Needs Jonathan')
      expect(mine.screenshotUrl).toMatch(/^file:\/\//)
      expect(fs.existsSync(path.join(shots, `${made[0]}.jpg`))).toBe(true)
      const text = execFileSync('npx', ['tsx', 'scripts/feedback-report.ts', '--since', today, '--status', 'needs_jonathan'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' })
      expect(text).toContain(made[0])
      expect(text).toContain('[NEEDS JONATHAN]')
    } finally { fs.rmSync(shots, { recursive: true, force: true }) }
  }, 60_000)
})
