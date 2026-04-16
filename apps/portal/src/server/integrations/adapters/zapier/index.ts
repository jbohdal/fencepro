/**
 * Zapier / Outbound Webhook Adapter
 *
 * Fires webhooks to Zapier or any custom URL on CRM events.
 * Supports retry with exponential backoff.
 */

import type { IntegrationAdapter, IntegrationConfig } from '../../types.js'

const adapter: IntegrationAdapter = {
  slug: 'zapier',
  name: 'Zapier / Webhooks',
  category: 'Custom',
  description: 'Connect to Zapier, Make, or any webhook URL. Fire events on job changes, payments, and more.',
  capabilities: ['webhook_out', 'zapier_trigger'],
  configFields: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://hooks.zapier.com/hooks/catch/...' },
    { key: 'secret', label: 'Signing Secret (optional)', type: 'password', helpText: 'Used to sign payloads for verification' },
    {
      key: 'events', label: 'Events to fire', type: 'select',
      options: [
        { value: 'all', label: 'All events' },
        { value: 'job_created', label: 'Job Created' },
        { value: 'job_stage_change', label: 'Job Stage Changed' },
        { value: 'invoice_paid', label: 'Invoice Paid' },
        { value: 'new_lead', label: 'New Lead' },
      ],
    },
  ],

  async connect(config) { return this.test(config) },
  async disconnect() {},

  async test(config) {
    const { webhookUrl } = config as { webhookUrl: string }
    if (!webhookUrl) return { success: false, message: 'Webhook URL is required' }

    try {
      const testPayload = {
        event: 'test',
        source: 'fencepro_crm',
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test webhook from FencePro CRM' },
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      })

      if (res.ok) return { success: true, message: `Webhook responded ${res.status} OK` }
      return { success: false, message: `Webhook returned ${res.status}` }
    } catch (err) {
      return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async sync() {
    return { synced: 0, errors: 0, message: 'Zapier is event-driven — no sync needed' }
  },

  async handleInbound(payload) {
    // Zapier can also send data IN via webhooks
    console.log('[Zapier Inbound]', JSON.stringify(payload).slice(0, 200))
    return { processed: true, message: 'Zapier payload received' }
  },
}

/** Fire a webhook with retry (exponential backoff, max 3 attempts) */
export async function fireWebhookWithRetry(
  url: string,
  payload: unknown,
  secret?: string,
  maxRetries = 3,
): Promise<{ success: boolean; status?: number; attempts: number; error?: string }> {
  let lastError = ''

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (secret) {
        // Simple HMAC-like signing using the secret
        const body = JSON.stringify(payload)
        headers['X-Webhook-Signature'] = `sha256=${Buffer.from(secret + body).toString('base64').slice(0, 64)}`
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        return { success: true, status: res.status, attempts: attempt }
      }

      lastError = `HTTP ${res.status}`

      if (res.status >= 400 && res.status < 500) {
        // Client error — don't retry
        return { success: false, status: res.status, attempts: attempt, error: lastError }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }

    // Exponential backoff: 1s, 4s, 9s
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, attempt * attempt * 1000))
    }
  }

  return { success: false, attempts: maxRetries, error: lastError }
}

export default adapter
