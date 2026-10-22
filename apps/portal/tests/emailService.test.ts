/**
 * Email through SMTP (lib/emailService.ts), against a fake mail server started
 * here on 127.0.0.1 (smtp-server, messages kept in memory). Nothing leaves
 * this machine and no real mail server is ever named.
 *
 *   - a message arrives with the right from, to, reply to, subject, HTML and
 *     text bodies and a PDF attachment; the from address is SMTP_USER when
 *     SMTP_FROM_EMAIL is empty;
 *   - 465 means TLS from the start, 587 means STARTTLS and it is required
 *     (a server that does not offer it is refused, not used in the clear);
 *   - a refused login, a refused connection: a plain reason, never the password;
 *   - no settings: { success: false, notConfigured: true }, never a fake "sent".
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { SMTPServer } from 'smtp-server'
import net from 'net'
import type { AddressInfo } from 'net'
import {
  sendEmail, smtpMode, emailSetup, isEmailServiceConfigured, setEmailTestTlsOptions, closeEmailTransport, EMAIL_NOT_SET_UP,
} from '../src/server/lib/emailService.js'

const KEYS = ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_REPLY_TO', 'COMPANY_NAME']
const saved: Record<string, string | undefined> = {}
const USER = 'office@gdfence.test'
const PASS = 'app-password-abcd-efgh'

interface Got { from: string; to: string[]; raw: string; secure: boolean; user: string }

/** A fake mail server: `secure` = TLS from the start; `noStartTls` = it does not offer STARTTLS. */
async function fakeSmtp(opts: { secure?: boolean; noStartTls?: boolean; password?: string } = {}) {
  const got: Got[] = []
  const server = new SMTPServer({
    secure: !!opts.secure,
    ...(opts.noStartTls ? { disabledCommands: ['STARTTLS'], allowInsecureAuth: true } : {}),
    authMethods: ['PLAIN', 'LOGIN'],
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === USER && auth.password === (opts.password ?? PASS)) cb(null, { user: auth.username })
      else cb(Object.assign(new Error('5.7.8 Username and Password not accepted'), { responseCode: 535 }))
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => {
        got.push({
          from: (session.envelope.mailFrom && session.envelope.mailFrom.address) || '',
          to: session.envelope.rcptTo.map(r => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
          secure: session.secure,
          user: String(session.user ?? ''),
        })
        cb()
      })
    },
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.server.address() as AddressInfo).port
  // The pooled connection stays open between messages: hang it up before closing the server.
  return { got, port, close: () => { closeEmailTransport(); return new Promise<void>(resolve => server.close(() => resolve())) } }
}

function useSmtp(port: number, extra: Record<string, string> = {}) {
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: USER, SMTP_PASS: PASS, SMTP_FROM: 'Getter Done Fence Pros', SMTP_FROM_EMAIL: '', SMTP_REPLY_TO: '', SMTP_SECURE: '', ...extra })
}

beforeAll(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; process.env[k] = '' }
  setEmailTestTlsOptions({ rejectUnauthorized: false }) // the fake server's own certificate
})
afterEach(() => { closeEmailTransport(); for (const k of KEYS) process.env[k] = '' })
afterAll(() => {
  setEmailTestTlsOptions(null)
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('SMTP settings', () => {
  test('465 is TLS from the start; 587 (and the default) is STARTTLS, required', () => {
    expect(smtpMode('465', '')).toEqual({ port: 465, secure: true, requireTLS: false })
    expect(smtpMode('587', '')).toEqual({ port: 587, secure: false, requireTLS: true })
    expect(smtpMode('', '')).toEqual({ port: 587, secure: false, requireTLS: true })
    expect(smtpMode('2465', 'true')).toEqual({ port: 2465, secure: true, requireTLS: false })
    expect(smtpMode('465', 'false')).toEqual({ port: 465, secure: false, requireTLS: true })
  })

  test('Settings shows the server and from address, never the password', () => {
    useSmtp(465)
    const s = emailSetup()
    expect(s).toMatchObject({ configured: true, provider: 'smtp', host: '127.0.0.1', port: 465, mode: 'tls', user: USER, fromEmail: USER, fromName: 'Getter Done Fence Pros' })
    expect(JSON.stringify(s)).not.toContain(PASS)
  })

  test('an address in SMTP_FROM is not used as the name; SMTP_FROM_EMAIL wins over SMTP_USER', () => {
    useSmtp(587, { SMTP_FROM: 'noreply@fencepro.com', SMTP_FROM_EMAIL: 'jobs@gdfence.test', COMPANY_NAME: 'Getter Done Fence' })
    expect(emailSetup()).toMatchObject({ fromName: 'Getter Done Fence', fromEmail: 'jobs@gdfence.test' })
  })
})

describe('sending through a fake mail server', () => {
  test('STARTTLS (587 mode): from, to, reply to, subject, HTML, text and a PDF attachment arrive', async () => {
    const srv = await fakeSmtp()
    try {
      useSmtp(srv.port, { SMTP_SECURE: 'false', SMTP_REPLY_TO: 'office-replies@gdfence.test' })
      const pdf = Buffer.from('%PDF-1.4 receipt 1042 test')
      const r = await sendEmail({
        to: 'customer@example.test',
        subject: 'Receipt 1042, $1,000.00 received',
        body: '<p>Hi Pat,</p><p>Your receipt: <a href="https://example.test/p/r/abc">open it</a></p>',
        attachments: [{ filename: 'receipt-1042.pdf', content: pdf, contentType: 'application/pdf' }],
      })
      expect(r).toMatchObject({ success: true, provider: 'smtp' })
      expect(srv.got).toHaveLength(1)
      const m = srv.got[0]
      expect(m.secure).toBe(true) // STARTTLS happened before the login
      expect(m.user).toBe(USER)
      expect(m.from).toBe(USER) // SMTP_FROM_EMAIL empty: the mailbox itself
      expect(m.to).toEqual(['customer@example.test'])
      expect(m.raw).toMatch(/^From: Getter Done Fence Pros <office@gdfence\.test>/m)
      expect(m.raw).toMatch(/^To: customer@example\.test/m)
      expect(m.raw).toMatch(/^Reply-To: office-replies@gdfence\.test/m)
      expect(m.raw).toMatch(/^Subject: Receipt 1042, \$1,000\.00 received/m)
      expect(m.raw).toContain('Content-Type: text/html')
      expect(m.raw).toContain('Content-Type: text/plain')
      expect(m.raw).toContain('open it (https://example.test/p/r/abc)') // the text part keeps the link
      expect(m.raw).toMatch(/Content-Type: application\/pdf; name=receipt-1042\.pdf/)
      expect(m.raw).toMatch(/Content-Disposition: attachment; filename=receipt-1042\.pdf/)
      expect(m.raw).toContain(pdf.toString('base64'))
      expect(m.raw).not.toContain(PASS)
    } finally { await srv.close() }
  })

  test('TLS from the start (465 mode) delivers', async () => {
    const srv = await fakeSmtp({ secure: true })
    try {
      useSmtp(srv.port, { SMTP_SECURE: 'true', SMTP_FROM_EMAIL: 'jobs@gdfence.test' })
      const r = await sendEmail({ to: 'a@example.test', subject: 'TLS test', body: 'Plain words only.' })
      expect(r).toMatchObject({ success: true })
      expect(srv.got[0].secure).toBe(true)
      expect(srv.got[0].from).toBe('jobs@gdfence.test')
      expect(srv.got[0].raw).toContain('Plain words only.')
      expect(srv.got[0].raw).not.toContain('text/html')
    } finally { await srv.close() }
  })

  test('587 mode refuses a server that does not offer STARTTLS (no login in the clear)', async () => {
    const srv = await fakeSmtp({ noStartTls: true })
    try {
      useSmtp(srv.port, { SMTP_SECURE: 'false' })
      const r = await sendEmail({ to: 'a@example.test', subject: 'x', body: 'x' })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/secure connection/i)
      expect(srv.got).toHaveLength(0)
    } finally { await srv.close() }
  })

  test('two messages go out over the one pooled transport', async () => {
    const srv = await fakeSmtp()
    try {
      useSmtp(srv.port, { SMTP_SECURE: 'false' })
      const rs = await Promise.all([1, 2].map(n => sendEmail({ to: `p${n}@example.test`, subject: `n${n}`, body: `m${n}` })))
      expect(rs.every(r => r.success)).toBe(true)
      expect(srv.got.map(g => g.to[0]).sort()).toEqual(['p1@example.test', 'p2@example.test'])
    } finally { await srv.close() }
  })
})

describe('failures say what went wrong', () => {
  test('a refused login: plain reason, no password', async () => {
    const srv = await fakeSmtp({ password: 'the-right-one' })
    try {
      useSmtp(srv.port, { SMTP_SECURE: 'false' })
      const r = await sendEmail({ to: 'a@example.test', subject: 'x', body: 'x' })
      expect(r.success).toBe(false)
      expect(r.notConfigured).toBeUndefined()
      expect(r.error).toMatch(/refused the login for office@gdfence\.test/)
      expect(r.error).toMatch(/App Password/)
      expect(r.error).not.toContain(PASS)
      expect(r.error).not.toContain(Buffer.from(PASS).toString('base64'))
      expect(srv.got).toHaveLength(0)
    } finally { await srv.close() }
  })

  test('nothing listening: connection refused', async () => {
    const probe = net.createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>(resolve => probe.close(() => resolve()))
    useSmtp(port, { SMTP_SECURE: 'false' })
    const r = await sendEmail({ to: 'a@example.test', subject: 'x', body: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(new RegExp(`refused the connection on port ${port}`))
  })

  test('no email settings: not configured, not sent, never a fake success', async () => {
    expect(isEmailServiceConfigured()).toBe(false)
    const r = await sendEmail({ to: 'a@example.test', subject: 'x', body: '<p>x</p>' })
    expect(r).toEqual({ success: false, notConfigured: true, error: EMAIL_NOT_SET_UP })
    expect(emailSetup()).toMatchObject({ configured: false, provider: null, fromEmail: '' })
    // Half the settings is still not set up.
    process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_USER = USER
    expect((await sendEmail({ to: 'a@example.test', subject: 'x', body: 'x' })).notConfigured).toBe(true)
  })
})
