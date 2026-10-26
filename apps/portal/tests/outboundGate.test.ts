/**
 * The outbound gate (lib/outboundGate.ts): nothing outside the live install
 * reaches a real person (Oct 26, 2026: test runs on the dev copy pushed
 * "Automation failed" to Jonathan's phone).
 *
 *   - the gate opens only for production + the live database + code in ~/ezbiz + not tests;
 *   - each channel's lowest level sender (push, SendGrid, SMTP, Gmail, Twilio
 *     text, Google Calendar, webhook) refuses outside live and writes the dev
 *     outbox instead; the real library call is never made;
 *   - the test setup keeps the gate shut.
 *
 * No database: prisma, web-push, nodemailer and googleapis are fakes here that
 * record any call that would have gone out.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const calls = vi.hoisted(() => ({ webpush: 0, createTransport: 0, gmailSend: 0, calendar: [] as string[], fetch: [] as string[] }))

vi.mock('../src/server/lib/prisma.js', () => {
  const sub = { id: 's1', userId: 'u1', accountId: 'a1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'x' }
  const prisma: any = {
    crmUser: { findMany: async () => [{ id: 'u1' }], findFirst: async () => ({ email: 'owner@example.invalid' }) },
    pushSubscription: { findMany: async () => [sub], deleteMany: async () => ({ count: 0 }) },
    accountKeyValue: {
      findUnique: async ({ where }: any) => where.accountId_key.key === 'push_vapid'
        ? { value: { publicKey: 'BPub', privateKey: 'priv' } }
        : { value: { email: 'owner@gmail.example', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000 } },
      update: async () => ({}),
    },
    googleCalendarToken: { findUnique: async () => ({ email: 'owner@gmail.example', accessToken: 't', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000) }), update: async () => ({}) },
  }
  return { default: prisma, prisma }
})
vi.mock('web-push', () => ({ default: { sendNotification: async () => { calls.webpush++ }, generateVAPIDKeys: () => ({ publicKey: 'k', privateKey: 'k' }) } }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => { calls.createTransport++; return { sendMail: async () => ({ rejected: [] }), close() {} } } } }))
vi.mock('googleapis', () => {
  class OAuth2 { setCredentials() {} on() {} generateAuthUrl() { return '' } }
  const ev = (name: string) => async () => { calls.calendar.push(name); return { data: { id: 'x' } } }
  return {
    google: {
      auth: { OAuth2 },
      gmail: () => ({ users: { messages: { send: async () => { calls.gmailSend++; return { data: { id: 'g' } } } } } }),
      calendar: () => ({ events: { insert: ev('events.insert'), update: ev('events.update'), delete: ev('events.delete') }, calendars: { insert: ev('calendars.insert'), patch: ev('calendars.patch'), get: ev('calendars.get') } }),
      oauth2: () => ({ userinfo: { get: async () => ({ data: {} }) } }),
    },
  }
})

import { outboundBlockReason, realDeliveryAllowed, isTestLoopback, holdOutbound, devOutboxFile } from '../src/server/lib/outboundGate.js'

const HOME = '/Users/someone'
const LIVE_CODE = `${HOME}/ezbiz/apps/portal/dist/server/lib`
const LIVE_URL = 'postgresql://ezbiz:pw@localhost:5432/ezbiz?schema=public'
const DEV_URL = 'postgresql://ezbiz_dev:pw@localhost:5432/ezbiz_dev?schema=public'
const live = (env: Record<string, string> = {}, codeDir = LIVE_CODE) => ({ home: HOME, codeDir, env: { NODE_ENV: 'production', DATABASE_URL: LIVE_URL, ...env } as NodeJS.ProcessEnv })

describe('the gate opens only for the live install', () => {
  test('production + live database + ~/ezbiz + not tests: open', () => {
    expect(outboundBlockReason(live())).toBeNull()
    expect(realDeliveryAllowed(live({}, `${HOME}/ezbiz/apps/portal/src/server/lib`))).toBe(true)
  })
  test('the dev database, even in production from ~/ezbiz: shut', () => {
    expect(outboundBlockReason(live({ DATABASE_URL: DEV_URL }))).toMatch(/ezbiz_dev.*not the live database/)
    expect(realDeliveryAllowed(live({ DATABASE_URL: '' }))).toBe(false)
    expect(realDeliveryAllowed(live({ DATABASE_URL: 'postgresql://x@db.example.com/ezbiz_copy' }))).toBe(false)
  })
  test('not production: shut', () => {
    expect(outboundBlockReason(live({ NODE_ENV: 'development' }))).toMatch(/not production/)
    expect(realDeliveryAllowed(live({ NODE_ENV: '' }))).toBe(false)
  })
  test('any copy outside ~/ezbiz (the working folder, a worktree, ~/ezbiz-copy): shut', () => {
    expect(outboundBlockReason(live({}, `${HOME}/Downloads/ALL MY SHIT/project/ez-biz-final/apps/portal/src/server/lib`))).toMatch(/not the live install/)
    expect(realDeliveryAllowed(live({}, `${HOME}/Downloads/x/.claude/worktrees/agent-1/apps/portal/src/server/lib`))).toBe(false)
    expect(realDeliveryAllowed(live({}, `${HOME}/ezbiz-copy/apps/portal/dist/server/lib`))).toBe(false)
  })
  test('under tests, or switched off: shut', () => {
    expect(outboundBlockReason(live({ VITEST: 'true' }))).toMatch(/tests/)
    expect(outboundBlockReason(live({ NODE_ENV: 'test' }))).toMatch(/tests/)
    expect(outboundBlockReason(live({ OUTBOUND_GATE: 'closed' }))).toMatch(/OUTBOUND_GATE/)
  })
  test('this test run itself is shut (tests/setup/outboundGate.ts), whatever its settings say', () => {
    expect(process.env.OUTBOUND_GATE).toBe('closed')
    expect(realDeliveryAllowed()).toBe(false)
    expect(outboundBlockReason({ env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: LIVE_URL }, home: HOME, codeDir: LIVE_CODE })).not.toBeNull()
  })
  test('a test may talk only to its own fake server on this machine', () => {
    expect(isTestLoopback('127.0.0.1')).toBe(true)
    expect(isTestLoopback('localhost')).toBe(true)
    expect(isTestLoopback('smtp.gmail.com')).toBe(false)
    expect(isTestLoopback('127.0.0.1', { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false)
  })
})

// ── Each channel ────────────────────────────────────────────────────────────

let outbox: string
const ENV_KEYS = ['DEV_OUTBOX_FILE', 'SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']
const saved: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch
const held = () => (fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  outbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-outbox-')), 'dev-outbox.log')
  process.env.DEV_OUTBOX_FILE = outbox
  calls.webpush = 0; calls.createTransport = 0; calls.gmailSend = 0; calls.calendar = []; calls.fetch = []
  globalThis.fetch = (async (url: any) => { calls.fetch.push(String(url)); return new Response('{}', { status: 200 }) }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('every channel refuses outside live and writes the dev outbox', () => {
  test('the outbox file is apps/portal/logs/dev-outbox.log unless set', () => {
    expect(devOutboxFile({} as NodeJS.ProcessEnv)).toMatch(/apps\/portal\/logs\/dev-outbox\.log$/)
    const h = holdOutbound('push', 'Jonathan', 'Hello', 'body')
    expect(h.reason).toMatch(/OUTBOUND_GATE|tests/)
    expect(held()).toMatchObject([{ channel: 'push', to: 'Jonathan', title: 'Hello' }])
  })

  test('push: web-push is never called; held, not sent', async () => {
    const { sendPush } = await import('../src/server/lib/automations/push.js')
    const r = await sendPush('a1', { title: 'Automation failed: E2E test', body: 'step 2' })
    expect(r).toMatchObject({ subscribers: 1, sent: 0, held: 1, failed: 0 })
    expect(calls.webpush).toBe(0)
    expect(held()).toMatchObject([{ channel: 'push', title: 'Automation failed: E2E test', body: 'step 2' }])
  })

  test('email through SendGrid: no request to SendGrid', async () => {
    Object.assign(process.env, { SENDGRID_API_KEY: 'SG.fake', SMTP_FROM_EMAIL: 'office@example.invalid' })
    const { sendEmail } = await import('../src/server/lib/emailService.js')
    const r = await sendEmail({ to: 'customer@gmail.com', subject: 'Your receipt', body: '<p>Thanks</p>' })
    expect(r).toMatchObject({ success: false, held: true, provider: 'sendgrid' })
    expect(calls.fetch).toEqual([])
    expect(held()).toMatchObject([{ channel: 'email', to: 'customer@gmail.com', title: 'Your receipt' }])
  })

  test('email through SMTP: no mail server is opened', async () => {
    Object.assign(process.env, { SENDGRID_API_KEY: '', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'office@example.invalid', SMTP_PASS: 'x' })
    const { sendEmail } = await import('../src/server/lib/emailService.js')
    const r = await sendEmail({ to: 'customer@gmail.com', subject: 'Contract', body: 'hi' })
    expect(r).toMatchObject({ success: false, held: true, provider: 'smtp' })
    expect(calls.createTransport).toBe(0)
    expect(held()[0]).toMatchObject({ channel: 'email', to: 'customer@gmail.com' })
  })

  test('email not set up: still not sent, and the outbox shows what would have gone', async () => {
    Object.assign(process.env, { SENDGRID_API_KEY: '', SMTP_HOST: '' })
    const { sendEmail } = await import('../src/server/lib/emailService.js')
    expect((await sendEmail({ to: 'c@gmail.com', subject: 'Invite', body: 'x' })).notConfigured).toBe(true)
    expect(held()[0]).toMatchObject({ channel: 'email', title: 'Invite' })
  })

  test('email through Gmail: the Gmail API is never called', async () => {
    Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'http://localhost/cb' })
    const { emailSenderFor, setEmailSenderForTests, HELD_EMAIL_ID } = await import('../src/server/lib/automations/gmail.js')
    setEmailSenderForTests(undefined) // the real sender
    const sender = await emailSenderFor('a1')
    const r = await sender.send({ to: 'customer@gmail.com', subject: 'Your install date', text: 'Monday', messageId: 'm@x' })
    expect(r.id).toBe(HELD_EMAIL_ID)
    expect(calls.gmailSend).toBe(0)
    expect(held()[0]).toMatchObject({ channel: 'email', to: 'customer@gmail.com', title: 'Your install date' })
  })

  test('text: no request to Twilio, even with Twilio set up', async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+13520000000' })
    vi.resetModules()
    const { sendSms } = await import('../src/server/lib/sms.js')
    const r = await sendSms('+13525551234', 'Your fence is on the way')
    expect(r).toMatchObject({ success: false, held: true })
    expect(calls.fetch).toEqual([])
    expect(held()[0]).toMatchObject({ channel: 'text', to: '+13525551234', body: 'Your fence is on the way' })
  })

  test('Google Calendar: no event or calendar is written', async () => {
    Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'http://localhost/cb' })
    const { googleApiFor, HELD_CALENDAR_ID } = await import('../src/server/lib/calendarSync/google.js')
    const api = await googleApiFor('owner@gmail.example')
    const spec: any = { summary: 'Install: Smith', description: 'd', startDate: '2026-11-02', endDate: '2026-11-02', source: 'job', recordId: 'j1' }
    await api.insert('cal', 'ev1', spec)
    await api.update('cal', 'ev1', spec)
    await api.remove('cal', 'ev1')
    expect(await api.createCalendar('GD Fence Pro (TEST)')).toBe(HELD_CALENDAR_ID)
    await api.renameCalendar('cal', 'x')
    expect(calls.calendar).toEqual([])
    expect(held().map(h => h.channel)).toEqual(['calendar', 'calendar', 'calendar', 'calendar', 'calendar'])
    expect(held()[0].title).toContain('Install: Smith')
  })

  test('webhook (Zapier): nothing is posted to an outside address', async () => {
    const { fireWebhookWithRetry } = await import('../src/server/integrations/adapters/zapier/index.js')
    const r = await fireWebhookWithRetry('https://hooks.zapier.com/hooks/catch/1/2', { event: 'new_lead' })
    expect(r).toMatchObject({ success: false, attempts: 0 })
    expect(calls.fetch).toEqual([])
    expect(held()[0]).toMatchObject({ channel: 'webhook', to: 'https://hooks.zapier.com/hooks/catch/1/2' })
  })
})
