/**
 * Twilio SMS Adapter
 *
 * Wraps the existing sms.ts service into the integration framework.
 */

import type { IntegrationAdapter, IntegrationConfig, IntegrationTestResult } from '../../types.js'

const adapter: IntegrationAdapter = {
  slug: 'twilio',
  name: 'Twilio SMS',
  category: 'Communication',
  description: 'Send SMS messages to customers. Appointment confirmations, rain day alerts, follow-ups.',
  capabilities: ['send_sms', 'receive_sms', 'sms_templates'],
  configFields: [
    { key: 'accountSid', label: 'Account SID', type: 'text', required: true, placeholder: 'AC...' },
    { key: 'authToken', label: 'Auth Token', type: 'password', required: true },
    { key: 'fromNumber', label: 'From Number', type: 'text', required: true, placeholder: '+1234567890', helpText: 'Your Twilio phone number' },
  ],

  async connect(config) {
    const result = await this.test(config)
    return result
  },

  async disconnect() {
    // Clear env-level config (in production, clear from DB)
  },

  async test(config) {
    const { accountSid, authToken } = config as { accountSid: string; authToken: string }
    if (!accountSid || !authToken) {
      return { success: false, message: 'Account SID and Auth Token are required' }
    }

    try {
      // Verify credentials by hitting the Twilio account endpoint
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      const res = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}` },
      })

      if (res.ok) {
        const data = await res.json() as { friendly_name: string }
        return { success: true, message: `Connected to Twilio account: ${data.friendly_name}` }
      } else {
        return { success: false, message: `Twilio returned ${res.status}: Invalid credentials` }
      }
    } catch (err) {
      return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async sync() {
    return { synced: 0, errors: 0, message: 'Twilio is event-driven — no sync needed' }
  },

  async handleInbound(payload, _headers) {
    // Handle incoming SMS replies (Twilio webhook)
    const body = payload as Record<string, string>
    const from = body.From || ''
    const text = body.Body || ''
    console.log(`[Twilio Inbound] From: ${from} | Body: ${text}`)
    return { processed: true, message: `Received SMS from ${from}` }
  },
}

export default adapter
