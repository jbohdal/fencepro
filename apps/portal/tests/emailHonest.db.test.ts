/**
 * Every screen that emails tells the truth (dev database, DEV_DB=1 only).
 *
 * With no email settings (the dev copy) nothing is sent and the answers say so:
 *   - team invite and resend: emailSent false, emailNotSetUp, the link to text;
 *     "resend all pending" refuses (new links would break ones already texted);
 *   - forgot password: "not sent, email is not set up" (to every address alike);
 *   - customer portal invite: emailSent false, emailNotSetUp, the link to copy;
 *     the public "send me a new link": not_configured, and the link already
 *     handed out keeps working (no new token);
 *   - Settings > Integrations: Email not set up; the test email says not sent.
 * With a mail server (a fake one started here on 127.0.0.1, messages kept in
 * memory): the portal invite and the test email arrive, to the right people.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const KEYS = ['SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_REPLY_TO']

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('email: never a fake "sent" (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: crmAuth } = await import('../src/server/routes/crm-auth.js')
  const { default: portal } = await import('../src/server/routes/portal.js')
  const { default: integrations } = await import('../src/server/routes/integrations.js')
  const mail = await import('../src/server/lib/emailService.js')
  const { SMTPServer } = await import('smtp-server')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const tag = `eh-${Date.now().toString(36)}`
  const ownerEmail = `${tag}-owner@example.test`
  let accountId = '', ownerId = '', contactId = '', token = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const saved: Record<string, string | undefined> = {}

  const call = async (method: string, p: string, body?: unknown, auth = true) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }

  beforeAll(async () => {
    for (const k of KEYS) { saved[k] = process.env[k]; process.env[k] = '' }
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const owner = await prisma.crmUser.create({ data: { email: ownerEmail, firstName: 'Test', lastName: 'Owner', role: 'super_admin', status: 'active', mustChangePassword: false, crmAccountId: accountId } })
    ownerId = owner.id
    token = jwt.sign({ sub: owner.id, email: owner.email, role: 'super_admin', firstName: 'Test', lastName: 'Owner', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    contactId = (await prisma.crmContact.create({ data: { accountId, firstName: 'Email', lastName: tag, phone: '3525550199' } as any })).id
    const app = express()
    app.use(express.json())
    app.use('/api/crm-auth', crmAuth)
    app.use('/api/portal', portal)
    app.use('/api/integrations', integrations)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    mail.closeEmailTransport()
    mail.setEmailTestTlsOptions(null)
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    const users = await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })
    const ids = users.map(u => u.id)
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { id: { in: ids } } })
    await prisma.portalAccount.deleteMany({ where: { crmCustomerId: contactId } }) // its invites go with it
    await prisma.crmContact.deleteMany({ where: { id: contactId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('not set up: team invite, resend and resend-all say not sent', async () => {
    const inv = await call('POST', '/api/crm-auth/invite', { firstName: 'New', lastName: 'Hire', email: `${tag}-new@example.test`, role: 'office_staff' })
    expect(inv.status).toBe(201)
    expect(inv.json.data).toMatchObject({ emailSent: false, emailNotSetUp: true, emailError: mail.EMAIL_NOT_SET_UP })
    expect(inv.json.data.inviteUrl).toMatch(/accept-invite\?token=/)
    const again = await call('POST', `/api/crm-auth/invite/${inv.json.data.id}/resend`)
    expect(again.status).toBe(200)
    expect(again.json.data).toMatchObject({ emailSent: false, emailNotSetUp: true })
    const hashBefore = (await prisma.crmUser.findUnique({ where: { id: inv.json.data.id } }))!.inviteTokenHash
    const all = await call('POST', '/api/crm-auth/invites/resend-all-pending')
    expect(all.status).toBe(409)
    expect(all.json).toMatchObject({ success: false })
    expect(all.json.error).toMatch(/Not sent: Email is not set up/)
    expect((await prisma.crmUser.findUnique({ where: { id: inv.json.data.id } }))!.inviteTokenHash).toBe(hashBefore)
  })

  test('not set up: forgot password says not sent, for a real login and an unknown one alike', async () => {
    for (const email of [ownerEmail, `${tag}-nobody@example.test`]) {
      const r = await call('POST', '/api/crm-auth/forgot-password', { email }, false)
      expect(r.status).toBe(503)
      expect(r.json).toMatchObject({ success: false, notConfigured: true })
      expect(r.json.error).toMatch(/^Not sent: email is not set up/)
    }
    expect((await prisma.crmUser.findUnique({ where: { id: ownerId } }))!.inviteTokenHash).toBeNull()
  })

  test('not set up: portal invite says not sent; the public resend keeps the link that was handed out', async () => {
    const email = `${tag}-cust@example.invalid`
    const inv = await call('POST', '/api/portal/invite', { crmCustomerId: contactId, email, firstName: 'Email' })
    expect(inv.status).toBe(200)
    expect(inv.json.data).toMatchObject({ emailSent: false, emailNotSetUp: true, emailError: mail.EMAIL_NOT_SET_UP })
    expect(inv.json.data.activationUrl).toMatch(/activate\?token=[0-9a-f]{64}/)
    const before = (await prisma.portalAccount.findUnique({ where: { email } }))!.inviteToken
    const rs = await call('POST', '/api/portal/resend-invite', { email }, false)
    expect(rs.json.data.status).toBe('not_configured')
    expect((await prisma.portalAccount.findUnique({ where: { email } }))!.inviteToken).toBe(before)
  })

  test('not set up: Settings > Integrations shows Email not set up; the test email says not sent', async () => {
    const list = await call('GET', '/api/integrations')
    const card = list.json.data.find((c: any) => c.slug === 'email')
    expect(card).toMatchObject({ builtIn: true, isActive: false, email: { configured: false, provider: null } })
    expect(card.setupNote).toMatch(/Not set up/)
    const t = await call('POST', '/api/integrations/email/test')
    expect(t.json.data).toMatchObject({ to: ownerEmail, sent: false, notConfigured: true })
    expect(t.json.data.message).toBe(`Not sent: ${mail.EMAIL_NOT_SET_UP}`)
  })

  test('with a mail server: the portal invite and the test email arrive; Settings shows the server, never the password', async () => {
    const got: { to: string[]; raw: string }[] = []
    const srv = new SMTPServer({
      logger: false,
      onAuth(a, _s, cb) { cb(a.password === 'fake-app-password' ? null : new Error('bad login'), { user: a.username }) },
      onData(stream, s, cb) { const c: Buffer[] = []; stream.on('data', (b: Buffer) => c.push(b)); stream.on('end', () => { got.push({ to: s.envelope.rcptTo.map(r => r.address), raw: Buffer.concat(c).toString('utf8') }); cb() }) },
    })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
    mail.setEmailTestTlsOptions({ rejectUnauthorized: false }) // the fake server's own certificate
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String((srv.server.address() as AddressInfo).port), SMTP_SECURE: 'false', SMTP_USER: 'office@gdfence.test', SMTP_PASS: 'fake-app-password', SMTP_FROM: 'Getter Done Fence Pros' })
    try {
      const email = `${tag}-cust2@example.invalid`
      const inv = await call('POST', '/api/portal/invite', { crmCustomerId: contactId, email, firstName: 'Email' })
      expect(inv.json.data).toMatchObject({ emailSent: true })
      expect(inv.json.data.emailNotSetUp).toBeUndefined()
      const m = got.find(g => g.to.includes(email))!
      expect(m.raw).toMatch(/^From: Getter Done Fence Pros <office@gdfence\.test>/m)
      expect(m.raw).toMatch(/customer portal is ready/)

      // A team invite names the role as people read it (review Oct 28 2026: an Installer's said "as field crew").
      const words: Record<string, string> = { field_crew: 'Installer', sales_rep: 'Salesman', office_staff: 'Office', manager: 'Manager', admin: 'Admin' }
      for (const [role, word] of Object.entries(words)) {
        const to = `${tag}-${role.replace('_', '')}@example.test`
        const ti = await call('POST', '/api/crm-auth/invite', { firstName: 'Role', lastName: 'Words', email: to, role })
        expect(ti.json.data).toMatchObject({ emailSent: true })
        const rs = await call('POST', `/api/crm-auth/invite/${ti.json.data.id}/resend`)
        expect(rs.json.data).toMatchObject({ emailSent: true })
        const sent = got.filter(g => g.to.includes(to)).map(g => g.raw.replace(/=\r?\n/g, ''))
        expect(sent).toHaveLength(2)
        for (const raw of sent) {
          expect(raw).toContain(`as <strong>${word}</strong>`)
          expect(raw).not.toMatch(/field crew|sales rep|office staff/i)
        }
      }

      const list = await call('GET', '/api/integrations')
      const card = list.json.data.find((c: any) => c.slug === 'email')
      expect(card).toMatchObject({ isActive: true, email: { configured: true, provider: 'smtp', host: '127.0.0.1', fromEmail: 'office@gdfence.test', mode: 'starttls' } })
      expect(JSON.stringify(list.json)).not.toContain('fake-app-password')

      const t = await call('POST', '/api/integrations/email/test')
      expect(t.json.data).toMatchObject({ to: ownerEmail, sent: true })
      expect(got.some(g => g.to.includes(ownerEmail) && /test email from EZ Biz/.test(g.raw))).toBe(true)

      // A wrong password: the test says exactly why, without the password.
      process.env.SMTP_PASS = 'wrong-password'
      const bad = await call('POST', '/api/integrations/email/test')
      expect(bad.json.data.sent).toBe(false)
      expect(bad.json.data.message).toMatch(/^Not sent: The mail server refused the login/)
      expect(JSON.stringify(bad.json)).not.toContain('wrong-password')
      // The card keeps the newest test: the error now, then a later success replaces it.
      expect((await call('GET', '/api/integrations/email')).json.data.lastTest).toMatchObject({ sent: false })
      process.env.SMTP_PASS = 'fake-app-password'
      mail.closeEmailTransport()
      const good = await call('POST', '/api/integrations/email/test')
      expect(good.json.data.sent).toBe(true)
      expect(good.json.data.setup.lastTest).toMatchObject({ sent: true, user: 'office@gdfence.test' })
      const after = (await call('GET', '/api/integrations/email')).json.data
      expect(after.lastTest.sent).toBe(true)
      expect(after.lastTest.message).toMatch(/^Test email sent to /)
    } finally {
      mail.closeEmailTransport()
      for (const k of KEYS) process.env[k] = ''
      await new Promise<void>(r => srv.close(() => r()))
    }
  })
})
