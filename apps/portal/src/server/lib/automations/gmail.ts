/**
 * Email to customers from Jonathan's Google Workspace Gmail (Gmail API,
 * gmail.send scope only: it can send, it cannot read his mail). Same Internal
 * Google project and the same redirect address as Google Calendar; the
 * callback in routes/google-calendar.ts hands a "gmail" sign in to
 * connectGmail. The sign in is kept in AccountKeyValue "gmail_token".
 *
 * When Gmail is not connected (always the case in dev, which has no Google
 * keys on purpose) an email step fails with "Gmail is not connected".
 * Outside the live install the send itself is held by the outbound gate
 * (lib/outboundGate.ts): written to the dev outbox, id "held-dev-outbox".
 */

import { google } from 'googleapis'
import prisma from '../prisma.js'
import { googleConfigured } from '../calendarSync/google.js'
import { holdOutbound, outboundBlockReason } from '../outboundGate.js'

const KEY = 'gmail_token'
const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email']

export const GMAIL_NOT_CONNECTED = 'Gmail is not connected. Connect it on the Automations screen (Connect Gmail), then press Run again.'

export class GmailNotConnectedError extends Error { constructor() { super(GMAIL_NOT_CONNECTED) } }

export interface OutgoingEmail { to: string; subject: string; text: string; /** Our own Message-ID, so one step's email is recognisable in Sent. */ messageId: string }
export interface EmailSender { from: string; send(mail: OutgoingEmail): Promise<{ id: string }> }

let testSender: EmailSender | null | undefined
/** The id a held (not sent) email reports. */
export const HELD_EMAIL_ID = 'held-dev-outbox'

/** Tests: a fake sender (null = act as if Gmail is not connected). Pass undefined to go back to the real one. */
export function setEmailSenderForTests(s: EmailSender | null | undefined) { testSender = s }

function client() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI)
}

export function gmailConsentUrl(state: string): string {
  if (!googleConfigured()) throw new Error('Google is not set up in this copy of the app (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are empty), so Gmail cannot be connected here.')
  return client().generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent', state })
}

/** Trade Google's code for a sign in that can send mail, and keep it. Returns the Gmail address. */
export async function connectGmail(accountId: string, code: string): Promise<string> {
  const c = client()
  const { tokens } = await c.getToken(code)
  c.setCredentials(tokens)
  if (!String(tokens.scope || '').includes('gmail.send')) throw new Error('Google did not grant permission to send email. Press Connect Gmail again and allow sending.')
  const { data } = await google.oauth2({ version: 'v2', auth: c }).userinfo.get()
  if (!data.email) throw new Error('Google did not say which account was connected.')
  if (!tokens.refresh_token) throw new Error('Google did not return a long lived token. Remove EZ Biz under your Google Account, Security, Third party access, then connect again.')
  const value = { email: data.email, accessToken: tokens.access_token || '', refreshToken: tokens.refresh_token, expiresAt: tokens.expiry_date || Date.now() + 3600_000, connectedAt: new Date().toISOString() }
  await prisma.accountKeyValue.upsert({
    where: { accountId_key: { accountId, key: KEY } },
    create: { accountId, key: KEY, value, updatedBy: 'gmail' },
    update: { value, version: { increment: 1 }, updatedBy: 'gmail' },
  })
  return data.email
}

export async function gmailStatus(accountId: string): Promise<{ configured: boolean; connected: boolean; email: string | null }> {
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KEY } } })
  const v = row?.value as any
  return { configured: googleConfigured(), connected: !!(v?.refreshToken && googleConfigured()), email: v?.email ?? null }
}

export async function disconnectGmail(accountId: string): Promise<void> {
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KEY } } })
  const v = row?.value as any
  if (v?.refreshToken && googleConfigured()) { try { await client().revokeToken(v.refreshToken) } catch { /* already revoked */ } }
  await prisma.accountKeyValue.deleteMany({ where: { accountId, key: KEY } })
}

/** RFC 2822 message, base64url, as the Gmail API wants it. Header values are kept on one line. */
export function rawMessage(from: string, mail: OutgoingEmail): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
  const plain = clean(mail.subject)
  const subject = /^[\x20-\x7e]*$/.test(plain) ? plain : `=?UTF-8?B?${Buffer.from(plain).toString('base64')}?=`
  const msg = [
    `From: ${clean(from)}`,
    `To: ${clean(mail.to)}`,
    `Subject: ${subject}`,
    `Message-ID: <${clean(mail.messageId)}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n')
  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The sender for this company, or GmailNotConnectedError. */
export async function emailSenderFor(accountId: string): Promise<EmailSender> {
  if (testSender !== undefined) { if (!testSender) throw new GmailNotConnectedError(); return testSender }
  if (!googleConfigured()) throw new GmailNotConnectedError()
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KEY } } })
  const v = row?.value as any
  if (!v?.refreshToken) throw new GmailNotConnectedError()
  const c = client()
  c.setCredentials({ access_token: v.accessToken, refresh_token: v.refreshToken, expiry_date: v.expiresAt })
  c.on('tokens', t => {
    prisma.accountKeyValue.update({
      where: { accountId_key: { accountId, key: KEY } },
      data: { value: { ...v, accessToken: t.access_token || v.accessToken, expiresAt: t.expiry_date || Date.now() + 3600_000, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}) } },
    }).catch(err => console.error('[gmail] could not store the refreshed token:', (err as Error).message))
  })
  const gmail = google.gmail({ version: 'v1', auth: c })
  return {
    from: v.email,
    async send(mail) {
      // The outbound gate: only the live install hands mail to Gmail.
      const blocked = outboundBlockReason()
      if (blocked) { holdOutbound('email', mail.to, mail.subject, mail.text, `${blocked} (Gmail)`); return { id: HELD_EMAIL_ID } }
      const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: rawMessage(v.email, mail) } })
      return { id: data.id || '' }
    },
  }
}
