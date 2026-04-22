/**
 * Email Templates — user-configurable email bodies the system uses for
 * customer-facing messages. Stored locally; each template has a subject,
 * body, and a list of supported merge tags.
 */

const KEY = 'fencepro_email_templates'
const EVT = 'fencepro:email_templates:updated'

export interface EmailTemplate {
  key: TemplateKey
  name: string              // human label
  subject: string
  body: string              // HTML
  updatedAt?: string
}

export type TemplateKey =
  | 'quote_sent'
  | 'quote_accepted'
  | 'invoice_sent'
  | 'payment_received'
  | 'job_scheduled'
  | 'rain_day'
  | 'welcome_customer'
  | 'overdue_invoice'

export const ALL_MERGE_TAGS = [
  '{{customer_name}}', '{{customer_first_name}}',
  '{{quote_number}}', '{{quote_total}}', '{{quote_link}}',
  '{{fence_style}}', '{{scheduled_date}}',
  '{{company_name}}', '{{company_phone}}',
  '{{rep_name}}',
  '{{invoice_number}}', '{{invoice_total}}',
  '{{payment_amount}}', '{{due_date}}',
] as const

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    key: 'quote_sent',
    name: 'Quote Sent to Customer',
    subject: 'Your fence quote from {{company_name}}',
    body: `<p>Hi {{customer_first_name}},</p>
<p>Thanks for considering {{company_name}} for your fence project. Your personalized quote is ready:</p>
<ul>
  <li><strong>Fence style:</strong> {{fence_style}}</li>
  <li><strong>Total:</strong> {{quote_total}}</li>
</ul>
<p><a href="{{quote_link}}" style="background:#f97316;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">View Your Quote</a></p>
<p>Have questions or want to lock in a start date? Just reply to this email — {{rep_name}} is standing by.</p>
<p>— The {{company_name}} team<br/>{{company_phone}}</p>`,
  },
  {
    key: 'quote_accepted',
    name: 'Quote Accepted by Customer',
    subject: 'Thanks for accepting your quote, {{customer_first_name}}!',
    body: `<p>Hi {{customer_first_name}},</p>
<p>We received your acceptance for quote #{{quote_number}} at {{quote_total}}. Welcome aboard!</p>
<p>{{rep_name}} will be in touch to confirm your schedule and next steps.</p>
<p>— {{company_name}}<br/>{{company_phone}}</p>`,
  },
  {
    key: 'invoice_sent',
    name: 'Invoice Sent to Customer',
    subject: 'Invoice #{{invoice_number}} from {{company_name}}',
    body: `<p>Hi {{customer_first_name}},</p>
<p>Your invoice is attached / linked below:</p>
<ul>
  <li><strong>Invoice:</strong> #{{invoice_number}}</li>
  <li><strong>Total:</strong> {{invoice_total}}</li>
  <li><strong>Due:</strong> {{due_date}}</li>
</ul>
<p>Thanks,<br/>{{company_name}} — {{company_phone}}</p>`,
  },
  {
    key: 'payment_received',
    name: 'Payment Received Confirmation',
    subject: 'Payment received — thank you!',
    body: `<p>Hi {{customer_first_name}},</p>
<p>We received your payment of {{payment_amount}} for invoice #{{invoice_number}}. Your receipt is on file.</p>
<p>— {{company_name}}</p>`,
  },
  {
    key: 'job_scheduled',
    name: 'Job Scheduled Notification',
    subject: 'Your fence install is scheduled',
    body: `<p>Hi {{customer_first_name}},</p>
<p>Your install is scheduled for <strong>{{scheduled_date}}</strong>. Our crew will arrive in the morning and get to work on your {{fence_style}}.</p>
<p>If anything changes on your end please reach out.</p>
<p>— {{company_name}}<br/>{{company_phone}}</p>`,
  },
  {
    key: 'rain_day',
    name: 'Rain Day Reschedule Notification',
    subject: 'Weather update on your fence install',
    body: `<p>Hi {{customer_first_name}},</p>
<p>The forecast isn't cooperating for your install scheduled on {{scheduled_date}}. We'll reach out shortly to get you rescheduled.</p>
<p>— {{company_name}}</p>`,
  },
  {
    key: 'welcome_customer',
    name: 'Welcome New Customer',
    subject: 'Welcome to {{company_name}}',
    body: `<p>Hi {{customer_first_name}},</p>
<p>Welcome to {{company_name}}! We're excited to work with you. You'll hear from {{rep_name}} soon with next steps.</p>
<p>— The {{company_name}} team</p>`,
  },
  {
    key: 'overdue_invoice',
    name: 'Overdue Invoice Reminder',
    subject: 'Friendly reminder: Invoice #{{invoice_number}} is past due',
    body: `<p>Hi {{customer_first_name}},</p>
<p>Just a quick note — invoice #{{invoice_number}} for {{invoice_total}} is past its due date of {{due_date}}. If you've already sent payment thank you, please ignore.</p>
<p>— {{company_name}} · {{company_phone}}</p>`,
  },
]

export function getEmailTemplates(): EmailTemplate[] {
  try {
    const r = localStorage.getItem(KEY)
    if (!r) return DEFAULT_TEMPLATES
    const saved: EmailTemplate[] = JSON.parse(r)
    // Merge: ensure every default key exists; saved overrides take precedence
    const byKey = new Map(saved.map(t => [t.key, t]))
    return DEFAULT_TEMPLATES.map(d => byKey.get(d.key) || d)
  } catch { return DEFAULT_TEMPLATES }
}

export function getEmailTemplate(key: TemplateKey): EmailTemplate {
  return getEmailTemplates().find(t => t.key === key) || DEFAULT_TEMPLATES.find(d => d.key === key)!
}

export function saveEmailTemplate(tpl: EmailTemplate): void {
  const all = getEmailTemplates()
  const next = all.map(t => t.key === tpl.key ? { ...tpl, updatedAt: new Date().toISOString() } : t)
  localStorage.setItem(KEY, JSON.stringify(next))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export function resetEmailTemplate(key: TemplateKey): EmailTemplate {
  const all = getEmailTemplates()
  const def = DEFAULT_TEMPLATES.find(d => d.key === key)!
  const next = all.map(t => t.key === key ? def : t)
  localStorage.setItem(KEY, JSON.stringify(next))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
  return def
}

/** Apply merge data to a template. Returns { subject, body } ready to send. */
export function renderTemplate(tpl: EmailTemplate, data: Record<string, string | undefined>): { subject: string; body: string } {
  function apply(s: string) {
    let r = s
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) r = r.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
    }
    return r.replace(/\{\{[a-z_]+\}\}/g, '')
  }
  return { subject: apply(tpl.subject), body: apply(tpl.body) }
}

export const EMAIL_TEMPLATES_UPDATED_EVENT = EVT
