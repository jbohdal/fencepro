/**
 * Email Service
 *
 * Sends emails via SMTP (Nodemailer-free — uses fetch against a mail API).
 * Falls back to console logging when not configured.
 *
 * Supports merge tags: {{customer_name}}, {{job_address}}, {{scheduled_date}},
 * {{rep_name}}, {{job_stage}}, {{company_name}}
 */

const SMTP_HOST = process.env.SMTP_HOST || ''
const SMTP_PORT = process.env.SMTP_PORT || '587'
const SMTP_USER = process.env.SMTP_USER || ''
const SMTP_PASS = process.env.SMTP_PASS || ''
const SMTP_FROM = process.env.SMTP_FROM || process.env.COMPANY_NAME || 'FencePro'
const SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL || 'noreply@fencepro.com'
const COMPANY_NAME = process.env.COMPANY_NAME || 'GD Fence Pro'

// Sendgrid API as primary (simpler than raw SMTP via fetch)
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ''

/** True if any email backend is wired up. */
export function isEmailServiceConfigured(): boolean {
  return !!SENDGRID_API_KEY || (!!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS)
}

export interface EmailOptions {
  to: string
  subject: string
  body: string       // HTML or plain text
  replyTo?: string
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
  data.company_name = data.company_name || COMPANY_NAME
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
  }
  // Clean up any remaining unresolved tags
  result = result.replace(/\{\{[a-z_]+\}\}/g, '')
  return result
}

/** Send an email */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const { to, subject, body, replyTo } = options

  // Try SendGrid first
  if (SENDGRID_API_KEY) {
    return sendViaSendGrid(to, subject, body, replyTo)
  }

  // Try SMTP
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return sendViaSmtp(to, subject, body, replyTo)
  }

  // Fallback: log to console
  console.log(`[Email Fallback] To: ${to} | Subject: ${subject}`)
  console.log(`[Email Fallback] Body: ${body.slice(0, 200)}...`)
  return { success: true }
}

async function sendViaSendGrid(to: string, subject: string, body: string, replyTo?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: any = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SMTP_FROM_EMAIL, name: SMTP_FROM },
      subject,
      content: [{ type: body.includes('<') ? 'text/html' : 'text/plain', value: body }],
    }
    if (replyTo) payload.reply_to = { email: replyTo }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[Email SendGrid Error]', res.status, err)
      return { success: false, error: `SendGrid ${res.status}: ${err}` }
    }

    console.log(`[Email] Sent via SendGrid to ${to}: "${subject}"`)
    return { success: true }
  } catch (err) {
    console.error('[Email SendGrid Error]', err)
    return { success: false, error: String(err) }
  }
}

async function sendViaSmtp(to: string, subject: string, body: string, _replyTo?: string): Promise<{ success: boolean; error?: string }> {
  console.warn(`[Email] SMTP not implemented — email to ${to} NOT sent. Subject: "${subject}". Configure SENDGRID_API_KEY for email delivery.`)
  return { success: false, error: 'SMTP not configured — install nodemailer or use SendGrid' }
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
  <div class="footer">${COMPANY_NAME}</div>
</div>
</body>
</html>`
}
