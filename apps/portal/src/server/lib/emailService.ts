/**
 * Email Service
 *
 * Sends the app's email through one of two backends, read from the server's
 * settings file (apps/portal/.env) at send time:
 *
 *   1. SendGrid, when SENDGRID_API_KEY is set (HTTP API, needs a verified sender).
 *   2. A mail server over SMTP (nodemailer, one pooled connection set), when
 *      SMTP_HOST, SMTP_USER and SMTP_PASS are set. Google Workspace:
 *      smtp.gmail.com, port 465 (TLS from the start) or 587 (STARTTLS, required),
 *      the mailbox as SMTP_USER and an App Password as SMTP_PASS (GO_LIVE.md).
 *
 * With neither, nothing is sent and sendEmail says so:
 * { success: false, notConfigured: true, error: EMAIL_NOT_SET_UP }. It never
 * reports a message as sent that was not handed to a mail server.
 *
 * Settings:
 *   SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS; default 587), SMTP_USER,
 *   SMTP_PASS, SMTP_SECURE (optional: true = TLS from the start, false = STARTTLS;
 *   normally worked out from the port), SMTP_FROM (the name people see),
 *   SMTP_FROM_EMAIL (the address; SMTP_USER when empty), SMTP_REPLY_TO.
 *
 * Supports merge tags: {{customer_name}}, {{job_address}}, {{scheduled_date}},
 * {{rep_name}}, {{job_stage}}, {{company_name}}
 */

import crypto from 'crypto'
import nodemailer from 'nodemailer'

/** What every screen shows when there is no email backend. */
export const EMAIL_NOT_SET_UP = 'Email is not set up yet (Settings)'

const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000 }

function env(name: string): string {
  return (process.env[name] || '').trim()
}

function companyName(): string {
  return env('COMPANY_NAME') || 'Getter Done Fence'
}

/** The name people see. SMTP_FROM once held an address; an address there is not used as a name. */
function fromName(): string {
  const v = env('SMTP_FROM')
  return v && !v.includes('@') ? v : companyName()
}

/** The address mail comes from: SMTP_FROM_EMAIL, else the mailbox signed in to (SMTP_USER). */
function fromEmail(provider: 'smtp' | 'sendgrid'): string {
  if (env('SMTP_FROM_EMAIL')) return env('SMTP_FROM_EMAIL')
  if (provider === 'sendgrid' && env('SENDGRID_FROM_EMAIL')) return env('SENDGRID_FROM_EMAIL')
  return env('SMTP_USER')
}

export interface SmtpMode { port: number; secure: boolean; requireTLS: boolean }

/** 465: TLS from the start. 587 (and anything else): plain hello, then STARTTLS, which must succeed. */
export function smtpMode(portText = env('SMTP_PORT'), secureText = env('SMTP_SECURE')): SmtpMode {
  const port = Number(portText) || 587
  const s = secureText.toLowerCase()
  const secure = s === 'true' || s === '1' ? true : s === 'false' || s === '0' ? false : port === 465
  return { port, secure, requireTLS: !secure }
}

function emailProvider(): 'sendgrid' | 'smtp' | null {
  if (env('SENDGRID_API_KEY')) return 'sendgrid'
  if (env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS')) return 'smtp'
  return null
}

/** True if any email backend is wired up. */
export function isEmailServiceConfigured(): boolean {
  return emailProvider() !== null
}

/** What Settings shows: never the password or the key. */
export interface EmailSetup {
  configured: boolean
  provider: 'sendgrid' | 'smtp' | null
  fromName: string
  fromEmail: string
  replyTo: string
  host?: string
  port?: number
  mode?: 'tls' | 'starttls'
  user?: string
}

export function emailSetup(): EmailSetup {
  const provider = emailProvider()
  const base = { configured: provider !== null, provider, fromName: fromName(), fromEmail: provider ? fromEmail(provider) : '', replyTo: env('SMTP_REPLY_TO') }
  if (provider !== 'smtp') return base
  const m = smtpMode()
  return { ...base, host: env('SMTP_HOST'), port: m.port, mode: m.secure ? 'tls' : 'starttls', user: env('SMTP_USER') }
}

export interface EmailAttachment {
  filename: string
  content: Buffer | string
  /** e.g. application/pdf; worked out from the file name when left out. */
  contentType?: string
}

export interface EmailOptions {
  to: string
  subject: string
  body: string       // HTML or plain text
  /** The plain text part. Made from `body` when left out. */
  text?: string
  replyTo?: string
  attachments?: EmailAttachment[]
  /**
   * Set true for security-critical / transactional emails that contain action
   * links (invite, activation, password reset, magic-link login). When true the
   * SendGrid click-tracking rewrite is suppressed so the recipient gets the
   * original https://yourdomain.com URL instead of the SendGrid
   * `urlNNNN.www.yourdomain.com` wrapper, which can break with SSL errors when
   * SendGrid's link-branding subdomain isn't fully provisioned.
   *
   * Default: true (safe default — prevents the outage).
   */
  disableClickTracking?: boolean
}

export interface EmailResult {
  success: boolean
  error?: string
  /** No email backend in the settings file: nothing was sent. */
  notConfigured?: boolean
  provider?: 'sendgrid' | 'smtp'
  messageId?: string
}

export interface MergeData {
  customer_name?: string
  job_address?: string
  scheduled_date?: string
  rep_name?: string
  job_stage?: string
  company_name?: string
  job_id?: string
  quote_price?: string
  [key: string]: string | undefined
}

/** Replace {{merge_tag}} placeholders in text */
export function applyMergeTags(text: string, data: MergeData): string {
  let result = text
  // Always include company name
  data.company_name = data.company_name || companyName()
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
  }
  // Clean up any remaining unresolved tags
  result = result.replace(/\{\{[a-z_]+\}\}/g, '')
  return result
}

const isHtml = (body: string) => /<[a-z][\s\S]*>/i.test(body)

/** A readable plain text copy of an HTML body (links keep their address). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, '').trim()
      return l && l !== href ? `${l} (${href})` : href
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

let warnedNotSetUp = false

/** Send an email. Never reports success unless a mail server or SendGrid accepted it. */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  // Default to disabling click tracking — see EmailOptions.disableClickTracking comment.
  const disableClickTracking = options.disableClickTracking !== false
  const provider = emailProvider()

  if (provider === 'sendgrid') return sendViaSendGrid(options, disableClickTracking)
  if (provider === 'smtp') return sendViaSmtp(options)

  if (!warnedNotSetUp) {
    warnedNotSetUp = true
    console.warn('[Email] Not set up: no SENDGRID_API_KEY and no SMTP_HOST/SMTP_USER/SMTP_PASS in the server settings file. Nothing is sent; each screen says "not sent". See GO_LIVE.md, Email.')
  }
  return { success: false, notConfigured: true, error: EMAIL_NOT_SET_UP }
}

async function sendViaSendGrid(options: EmailOptions, disableClickTracking: boolean): Promise<EmailResult> {
  const from = fromEmail('sendgrid')
  if (!from) return { success: false, provider: 'sendgrid', error: 'SendGrid needs a sender address: set SMTP_FROM_EMAIL to a verified sender.' }
  const { to, subject, body } = options
  try {
    const content: { type: string; value: string }[] = []
    if (isHtml(body)) {
      content.push({ type: 'text/plain', value: options.text ?? htmlToText(body) }, { type: 'text/html', value: body })
    } else {
      content.push({ type: 'text/plain', value: options.text ?? body })
    }
    const payload: any = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: fromName() },
      subject,
      content,
    }
    const effectiveReplyTo = options.replyTo || env('SMTP_REPLY_TO')
    if (effectiveReplyTo) payload.reply_to = { email: effectiveReplyTo }
    if (options.attachments?.length) {
      payload.attachments = options.attachments.map(a => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64'),
        ...(a.contentType ? { type: a.contentType } : {}),
        disposition: 'attachment',
      }))
    }

    // Disable click tracking + open tracking for transactional links so the
    // recipient gets our real URL instead of SendGrid's rewritten
    // `urlNNNN.www.<domain>/...`, which can break with SSL errors when
    // link-branding DNS isn't fully provisioned.
    if (disableClickTracking) {
      payload.tracking_settings = {
        click_tracking: { enable: false, enable_text: false },
        open_tracking:  { enable: false },
        subscription_tracking: { enable: false },
      }
    }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env('SENDGRID_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const err = (await res.text()).slice(0, 500)
      console.error('[Email SendGrid Error]', res.status, err)
      const why = res.status === 401 || res.status === 403 ? 'SendGrid refused the key or the sender (check SENDGRID_API_KEY and that the from address is a verified sender)' : `SendGrid answered ${res.status}`
      return { success: false, provider: 'sendgrid', error: `${why}: ${err}` }
    }

    console.log(`[Email] Sent via SendGrid to ${to}: "${subject}"`)
    return { success: true, provider: 'sendgrid' }
  } catch (err) {
    console.error('[Email SendGrid Error]', (err as Error).message)
    return { success: false, provider: 'sendgrid', error: `Could not reach SendGrid: ${(err as Error).message}` }
  }
}

// ── SMTP (nodemailer) ──

type Transport = ReturnType<typeof nodemailer.createTransport>
let pooled: { key: string; transport: Transport } | null = null
let testTls: Record<string, unknown> | null = null

/** Tests only (a local fake mail server with a self-signed certificate). Ignored outside Vitest. */
export function setEmailTestTlsOptions(tls: Record<string, unknown> | null): void {
  if (process.env.VITEST) testTls = tls
}

/** Close the pooled connections (tests, and when the settings change). */
export function closeEmailTransport(): void {
  pooled?.transport.close()
  pooled = null
}

/** One pooled transport for the current settings; a new one when they change. */
function smtpTransport(): Transport {
  const host = env('SMTP_HOST'), user = env('SMTP_USER'), pass = env('SMTP_PASS')
  const m = smtpMode()
  const key = crypto.createHash('sha256').update([host, m.port, m.secure, user, pass].join('\n')).digest('hex')
  if (pooled?.key === key) return pooled.transport
  closeEmailTransport()
  const transport = nodemailer.createTransport({
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    host,
    port: m.port,
    secure: m.secure,
    requireTLS: m.requireTLS,
    auth: { user, pass },
    ...SMTP_TIMEOUTS,
    ...(testTls && process.env.VITEST ? { tls: testTls } : { tls: { servername: host } }),
  })
  pooled = { key, transport }
  return transport
}

/** A plain reason for a failed SMTP send, without the password. */
export function smtpErrorText(err: any): string {
  const code: string = err?.code || ''
  const cause: string = err?.cause?.code || err?.errno || ''
  const response = String(err?.response || '').replace(/\s+/g, ' ').trim()
  const host = env('SMTP_HOST'), port = smtpMode().port
  let text: string
  if (code === 'EAUTH') text = `The mail server refused the login for ${env('SMTP_USER') || 'SMTP_USER'} (check SMTP_USER and SMTP_PASS; Google needs an App Password)`
  else if (code === 'EDNS' || cause === 'ENOTFOUND' || /ENOTFOUND|EAI_AGAIN/.test(String(err?.message))) text = `Mail server ${host} was not found (check SMTP_HOST)`
  else if (cause === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(err?.message))) text = `Mail server ${host} refused the connection on port ${port} (check SMTP_HOST and SMTP_PORT)`
  else if (code === 'ETIMEDOUT' || cause === 'ETIMEDOUT' || /timeout/i.test(String(err?.message))) text = `Mail server ${host} did not answer in time on port ${port} (check SMTP_PORT: 465 or 587)`
  else if (code === 'ETLS' || /STARTTLS|TLS|SSL|wrong version number|certificate/i.test(String(err?.message))) text = `Could not start a secure connection to ${host}:${port} (465 uses TLS from the start, 587 uses STARTTLS)`
  else if (code === 'EENVELOPE') text = 'The mail server would not take the sender or the recipient address'
  else if (code === 'EMESSAGE') text = 'The mail server would not take the message'
  else text = `Sending failed${code ? ` (${code})` : ''}: ${String(err?.message || err)}`
  if (response && !text.includes(response)) text += `. Server said: ${response}`
  // The server's answer never carries the password, but make sure.
  const pass = env('SMTP_PASS')
  if (pass) {
    for (const secret of [pass, Buffer.from(pass).toString('base64'), Buffer.from(`\u0000${env('SMTP_USER')}\u0000${pass}`).toString('base64')]) {
      text = text.split(secret).join('***')
    }
  }
  return text.slice(0, 600)
}

async function sendViaSmtp(options: EmailOptions): Promise<EmailResult> {
  const { to, subject, body } = options
  const html = isHtml(body)
  try {
    const info = await smtpTransport().sendMail({
      from: { name: fromName(), address: fromEmail('smtp') },
      to,
      subject,
      ...(html ? { html: body, text: options.text ?? htmlToText(body) } : { text: options.text ?? body }),
      ...(options.replyTo || env('SMTP_REPLY_TO') ? { replyTo: options.replyTo || env('SMTP_REPLY_TO') } : {}),
      ...(options.attachments?.length ? { attachments: options.attachments.map(a => ({ filename: a.filename, content: a.content, ...(a.contentType ? { contentType: a.contentType } : {}) })) } : {}),
    })
    const rejected = (info.rejected || []).map(String)
    if (rejected.length) {
      return { success: false, provider: 'smtp', error: `The mail server would not take ${rejected.join(', ')}` }
    }
    console.log(`[Email] Sent via SMTP to ${to}: "${subject}"`)
    return { success: true, provider: 'smtp', messageId: info.messageId }
  } catch (err) {
    const error = smtpErrorText(err)
    console.error(`[Email SMTP Error] to ${to}: ${error}`)
    // A broken pooled connection is not kept for the next message.
    if ((err as any)?.code !== 'EENVELOPE') closeEmailTransport()
    return { success: false, provider: 'smtp', error }
  }
}

/** Settings > Integrations "Send a test email to me". */
export async function sendTestEmail(to: string): Promise<EmailResult> {
  const s = emailSetup()
  return sendEmail({
    to,
    subject: `${companyName()}: test email from EZ Biz`,
    body: buildEmailHtml(`<p>This is a test email from EZ Biz.</p><p>If you can read it, email from the app works.</p><p>Sent through ${s.provider === 'sendgrid' ? 'SendGrid' : `${s.host}:${s.port}`} from ${s.fromName} &lt;${s.fromEmail}&gt; at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}.</p>`),
    disableClickTracking: true,
  })
}

/** Build a simple branded HTML email */
export function buildEmailHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f8fafc; }
.container { max-width: 600px; margin: 0 auto; padding: 24px; }
.card { background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0; }
.header { font-size: 20px; font-weight: 700; color: #1e293b; margin-bottom: 16px; }
.body { font-size: 15px; color: #475569; line-height: 1.6; }
.footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px; }
</style></head>
<body>
<div class="container">
  <div class="card">
    <div class="body">${bodyContent}</div>
  </div>
  <div class="footer">${companyName()}</div>
</div>
</body>
</html>`
}
