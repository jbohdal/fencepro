/**
 * Messages from Code against the dev database (DEV_DB=1; refuses any other)
 * (lib/codeMessages.ts, routes/code-messages.ts, scripts/code-message.ts):
 *
 *   - a message is saved and its title pushed to the owner's phones only:
 *     another admin (Christa's kind of login), the office, a Salesman and an
 *     Installer each have a phone signed up too, and none of them gets it;
 *   - the push opens the message (/messages-from-code?m=<id>);
 *   - the script, run as a command, saves it and writes the push to the dev
 *     outbox (the gate is shut in tests), for the owner only;
 *   - the API: the owner lists them newest first, opens one (all its
 *     details), and opening marks it read (the unread count drops); another
 *     admin, the office, a Salesman and an Installer get 403 everywhere and
 *     "owner: false" from /status.
 *
 * Makes its own logins and phone sign ups (fake addresses) and removes them,
 * and every message it made.
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
describe.skipIf(!process.env.DEV_DB || !onDev)('Messages from Code (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: routes } = await import('../src/server/routes/code-messages.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { setPushSenderForTests } = await import('../src/server/lib/automations/push.js')
  const { createCodeMessage, ownerLoginIds } = await import('../src/server/lib/codeMessages.js')
  const { parseCodeMessageArgs } = await import('../scripts/code-message.js')

  const owner = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin', status: 'active' }, orderBy: { createdAt: 'asc' } }))!
  const accountId = owner.crmAccountId!
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tokenFor = (u: { id: string; email: string; role: string; firstName: string; lastName: string }) =>
    jwt.sign({ sub: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })

  const tag = `e2e-codemsg-${crypto.randomUUID().slice(0, 8)}`
  const others: Record<string, { id: string; email: string; role: string; firstName: string; lastName: string }> = {}
  const subIds: string[] = []
  const ownerEndpoint = `https://push.example.invalid/${tag}/owner`
  const pushed: string[] = []

  const app = express()
  app.use(express.json())
  app.use('/api/code-messages', routes)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(base + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }

  beforeAll(async () => {
    // Every other kind of login, each with a phone signed up for push.
    for (const role of ['admin', 'office_staff', 'sales_rep', 'field_crew']) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${role}@example.invalid`, firstName: role, lastName: tag, role: role as any, status: 'active', crmAccountId: accountId, passwordHash: 'x' } })
      others[role] = { id: u.id, email: u.email, role, firstName: u.firstName, lastName: u.lastName }
      const s = await prisma.pushSubscription.create({ data: { accountId, userId: u.id, endpoint: `https://push.example.invalid/${tag}/${role}`, p256dh: 'x', auth: 'x' } })
      subIds.push(s.id)
    }
    const s = await prisma.pushSubscription.create({ data: { accountId, userId: owner.id, endpoint: ownerEndpoint, p256dh: 'x', auth: 'x' } })
    subIds.push(s.id)
    setPushSenderForTests({ async send(sub) { pushed.push(sub.endpoint) } })
  })

  afterAll(async () => {
    setPushSenderForTests(null)
    await prisma.codeMessage.deleteMany({ where: { accountId, title: { contains: tag } } })
    await prisma.pushSubscription.deleteMany({ where: { id: { in: subIds } } })
    await prisma.crmUser.deleteMany({ where: { id: { in: Object.values(others).map(o => o.id) } } })
    server.close()
  })

  test('the owner is the super_admin login, never another admin', async () => {
    const ids = await ownerLoginIds(accountId)
    expect(ids).toContain(owner.id)
    expect(ids).not.toContain(others.admin.id)
  })

  test('saved, and the push goes to the owner\'s phone only, opening the message', async () => {
    const payloads: string[] = []
    setPushSenderForTests({ async send(sub, payload) { pushed.push(sub.endpoint); payloads.push(payload) } })
    pushed.length = 0
    const saved = await createCodeMessage(accountId, { kind: 'needs_answer', title: `${tag} Which hinge for the 5 ft gate?`, body: 'Line one\n\n- a\n- b' })
    const mine = pushed.filter(e => e.includes(tag))
    expect(mine).toEqual([ownerEndpoint])
    expect(saved.push?.sent).toBeGreaterThanOrEqual(1)
    const p = JSON.parse(payloads[pushed.indexOf(ownerEndpoint)])
    expect(p.title).toBe('Needs your answer')
    expect(p.body).toBe(`${tag} Which hinge for the 5 ft gate?`)
    expect(p.url).toBe(`/messages-from-code?m=${saved.id}`)
    const row = await prisma.codeMessage.findUnique({ where: { id: saved.id } })
    expect(row?.kind).toBe('needs_answer')
    expect(row?.body).toBe('Line one\n\n- a\n- b')
    expect(row?.readAt).toBeNull()
  })

  test('--no-push saves without a push; a wrong kind or no title is refused', async () => {
    pushed.length = 0
    const saved = await createCodeMessage(accountId, { kind: 'info', title: `${tag} quiet` }, { push: false })
    expect(saved.push).toBeNull()
    expect(pushed.filter(e => e.includes(tag))).toEqual([])
    await expect(createCodeMessage(accountId, { kind: 'nope' as any, title: 'x' })).rejects.toThrow(/kind/)
    await expect(createCodeMessage(accountId, { kind: 'info', title: '   ' })).rejects.toThrow(/title/)
    expect(() => parseCodeMessageArgs(['--kind', 'live'])).toThrow(/--title/)
    expect(() => parseCodeMessageArgs(['--kind', 'later', '--title', 'x'])).toThrow(/--kind/)
    expect(() => parseCodeMessageArgs(['--kind', 'live', '--title', 'x', '--body', 'a', '--body-file', 'b'])).toThrow(/not both/)
    expect(parseCodeMessageArgs(['--kind', 'failed', '--title', 'x', '--body-file', 'f.md', '--no-push'], () => 'from file')).toEqual({ kind: 'failed', title: 'x', body: 'from file', push: false, account: null })
  })

  test('the script, run as a command: saved, and the push is held in the dev outbox for the owner only', () => {
    const outbox = path.join(os.tmpdir(), `${tag}-outbox.log`)
    const bodyFile = path.join(os.tmpdir(), `${tag}-body.md`)
    fs.writeFileSync(bodyFile, '## What is live\n\n- Messages from Code\n')
    try {
      const out = execFileSync('pnpm', ['exec', 'tsx', 'scripts/code-message.ts', '--kind', 'live', '--title', `${tag} Messages from Code is live`, '--body-file', bodyFile, '--account', accountId], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, OUTBOUND_GATE: 'closed', DEV_OUTBOX_FILE: outbox },
      })
      expect(out).toMatch(/Saved message .+ in database "ezbiz_dev" \(live\)/)
      expect(out).toMatch(/Push to the owner only .*held [1-9]/)
      const lines = fs.readFileSync(outbox, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.body?.includes(tag))
      expect(lines).toHaveLength(1)
      expect(lines[0].channel).toBe('push')
      expect(lines[0].title).toBe('Live now')
      expect(lines[0].to).toContain(owner.id)
    } finally {
      fs.rmSync(outbox, { force: true }); fs.rmSync(bodyFile, { force: true })
    }
  })

  test('the owner lists them newest first, opens one, and opening marks it read', async () => {
    const t = tokenFor({ id: owner.id, email: owner.email, role: 'super_admin', firstName: owner.firstName, lastName: owner.lastName })
    const a = await createCodeMessage(accountId, { kind: 'failed', title: `${tag} older`, body: 'x'.repeat(500) }, { push: false })
    await new Promise(r => setTimeout(r, 5))
    const b = await createCodeMessage(accountId, { kind: 'live', title: `${tag} newer` }, { push: false })
    const before = await call('GET', '/api/code-messages/status', t)
    expect(before.status).toBe(200)
    expect(before.json.data.owner).toBe(true)
    const list = await call('GET', '/api/code-messages', t)
    expect(list.status).toBe(200)
    const ids = (list.json.data as any[]).map(m => m.id)
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id))
    expect((list.json.data as any[]).find(m => m.id === a.id).body).toHaveLength(200)
    const one = await call('GET', `/api/code-messages/${a.id}`, t)
    expect(one.json.data.body).toHaveLength(500)
    expect(one.json.data.readAt).toBeNull()
    const read = await call('POST', `/api/code-messages/${a.id}/read`, t)
    expect(read.status).toBe(200)
    expect(read.json.data.readAt).toBeTruthy()
    const after = await call('GET', '/api/code-messages/status', t)
    expect(after.json.data.unread).toBe(before.json.data.unread - 1)
    // Opening again keeps the first time.
    const again = await call('POST', `/api/code-messages/${a.id}/read`, t)
    expect(again.json.data.readAt).toBe(read.json.data.readAt)
    const answered = await call('POST', `/api/code-messages/${b.id}/answered`, t, { answered: true })
    expect(answered.json.data.answeredAt).toBeTruthy()
    expect(answered.json.data.readAt).toBeTruthy()
    expect((await call('GET', '/api/code-messages/no-such-id', t)).status).toBe(404)
  })

  test('another admin, the office, a Salesman and an Installer: 403, and /status says not the owner', async () => {
    const m = await createCodeMessage(accountId, { kind: 'info', title: `${tag} private` }, { push: false })
    for (const role of ['admin', 'office_staff', 'sales_rep', 'field_crew']) {
      const t = tokenFor(others[role])
      expect((await call('GET', '/api/code-messages', t)).status, role).toBe(403)
      expect((await call('GET', `/api/code-messages/${m.id}`, t)).status, role).toBe(403)
      expect((await call('POST', `/api/code-messages/${m.id}/read`, t)).status, role).toBe(403)
      expect((await call('POST', `/api/code-messages/${m.id}/answered`, t, { answered: true })).status, role).toBe(403)
      const s = await call('GET', '/api/code-messages/status', t)
      expect(s.json.data, role).toEqual({ owner: false, unread: 0 })
    }
    const row = await prisma.codeMessage.findUnique({ where: { id: m.id } })
    expect(row?.readAt).toBeNull()
    expect(row?.answeredAt).toBeNull()
  })
})
