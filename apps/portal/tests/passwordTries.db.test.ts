/**
 * Changing a password while signed in (routes/crm-auth.ts) against the dev database (DEV_DB=1; refuses any other):
 * a session on a stolen phone must not be able to guess the password there (lib/passwordTries.ts).
 * Makes its own login and removes it.
 */
import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('changing a password while signed in: guesses (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: routes } = await import('../src/server/routes/crm-auth.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { PASSWORD_WRONG_MAX } = await import('../src/server/lib/passwordTries.js')

  const tag = `e2e-pwtry-${crypto.randomUUID().slice(0, 8)}`
  const RIGHT = `Right-${crypto.randomUUID()}`
  const NEXT = `Next-${crypto.randomUUID()}`
  const app = express()
  app.use(express.json())
  app.use('/api/crm-auth', routes)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/crm-auth/change-password`
  let id = '', token = ''
  const change = async (currentPassword: string, newPassword: string) => {
    const r = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const count = (action: string) => prisma.auditLog.count({ where: { action, metadata: { path: ['userId'], equals: id } } })
  const clear = () => prisma.auditLog.deleteMany({ where: { action: { startsWith: 'password_' }, metadata: { path: ['userId'], equals: id } } })

  beforeAll(async () => {
    const u = await prisma.crmUser.create({ data: { email: `${tag}@example.invalid`, firstName: 'Try', lastName: tag, role: 'sales_rep', status: 'active', passwordHash: await bcrypt.hash(RIGHT, 4) } })
    id = u.id
    token = jwt.sign({ sub: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
  })
  beforeEach(clear)
  afterAll(async () => {
    await clear()
    await prisma.crmUserSession.deleteMany({ where: { userId: id } })
    await prisma.crmUser.deleteMany({ where: { id } })
    server.close()
  })

  test('30 guesses: the limit stops them, and the right password after that is refused too', async () => {
    const answers = []
    for (let i = 0; i < 30; i++) answers.push((await change(`guess-${i}-guess`, NEXT)).status)
    expect(answers.filter(s => s === 400).length).toBe(PASSWORD_WRONG_MAX - 1)
    expect(answers.filter(s => s === 429).length).toBe(30 - (PASSWORD_WRONG_MAX - 1))
    expect(await count('password_wrong')).toBe(PASSWORD_WRONG_MAX)
    expect(await count('password_refused')).toBeGreaterThan(0)
    expect((await change(RIGHT, NEXT)).status).toBe(429)
    expect(await bcrypt.compare(RIGHT, (await prisma.crmUser.findUnique({ where: { id } }))!.passwordHash!)).toBe(true)
  })
  test('tries side by side do not get past it', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, i) => change(`side-${i}-guess`, NEXT)))
    expect(await count('password_wrong')).toBeLessThanOrEqual(PASSWORD_WRONG_MAX)
  })
  test('the same password as old and new tells nothing: same answer right or wrong, and no try is used', async () => {
    const right = await change(RIGHT, RIGHT)
    const wrong = await change('not-the-password', 'not-the-password')
    expect(right).toEqual(wrong)
    expect(await count('password_wrong')).toBe(0)
  })
  test('the password is never in the log', async () => {
    await change('secret-guess-here', NEXT)
    const rows = await prisma.auditLog.findMany({ where: { action: 'password_wrong', metadata: { path: ['userId'], equals: id } } })
    expect(rows.length).toBe(1)
    expect(JSON.stringify(rows)).not.toContain('secret-guess-here')
  })
  test('the sign in is not locked by these, and the right password still works under the limit', async () => {
    await change('one-wrong-guess', NEXT)
    const u = await prisma.crmUser.findUnique({ where: { id } })
    expect(u?.failedLoginAttempts).toBe(0)
    expect(u?.lockedUntil).toBeNull()
    expect((await change(RIGHT, NEXT)).status).toBe(200)
    expect(await bcrypt.compare(NEXT, (await prisma.crmUser.findUnique({ where: { id } }))!.passwordHash!)).toBe(true)
  })
})
