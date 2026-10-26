/**
 * Twilio SMS Integration
 *
 * Sends SMS via Twilio REST API (no SDK needed — keeps deps light).
 * Falls back to console logging when Twilio is not configured.
 *
 * A text to a customer goes through sendCustomerSms: it is sent only when the
 * customer said yes to texts (lib/textConsent.ts); otherwise it is not sent
 * and the result says why (blocked). sendSms itself is for texts to the team.
 *
 * The outbound gate (lib/outboundGate.ts) sits in sendSms: outside the live
 * install no text goes to Twilio; it is written to the dev outbox and the
 * result says { success: false, held: true }.
 */

import { customerText } from './customerText.js'
import { textAllowedTo } from './textConsent.js'
import { HELD_TEXT, holdOutbound, outboundBlockReason } from './outboundGate.js'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || ''
const COMPANY_NAME = process.env.COMPANY_NAME || 'Getter Done Fence'

/** True if Twilio is fully configured. */
export function isSmsServiceConfigured(): boolean {
  return !!TWILIO_ACCOUNT_SID && !!TWILIO_AUTH_TOKEN && !!TWILIO_FROM_NUMBER
}

interface SmsResult {
  success: boolean
  sid?: string
  error?: string
  /** Not sent because the customer has not said yes to texts (error says why). */
  blocked?: boolean
  /** Kept back by the outbound gate (not the live install): in the dev outbox, not sent. */
  held?: boolean
}

/** Send an SMS via Twilio REST API */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const gate = outboundBlockReason()
  if (gate) {
    holdOutbound('text', to, body.slice(0, 80), body, gate)
    return { success: false, held: true, error: HELD_TEXT }
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.log(`[SMS Fallback] To: ${to} | Body: ${body}`)
    return { success: true, sid: 'fallback-no-twilio' }
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body }).toString(),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[SMS Error]', res.status, err)
      return { success: false, error: `Twilio ${res.status}: ${err}` }
    }

    const data = await res.json() as { sid: string }
    console.log(`[SMS Sent] SID: ${data.sid} → ${to}`)
    return { success: true, sid: data.sid }
  } catch (err) {
    console.error('[SMS Error]', err)
    return { success: false, error: String(err) }
  }
}

/** Text a customer, only if they said yes to texts; otherwise not sent, with the reason. */
export async function sendCustomerSms(to: string, body: string): Promise<SmsResult> {
  const ok = await textAllowedTo(to)
  if (!ok.allowed) return { success: false, blocked: true, error: ok.reason ?? 'Not sent: no text consent.' }
  // "Company: ... Reply STOP to opt out.", once each (lib/customerText.ts).
  return sendSms(to, customerText(body, COMPANY_NAME))
}

/** Send the initial "thanks for reaching out" SMS to a new lead */
export async function sendLeadConfirmation(phone: string, firstName?: string): Promise<SmsResult> {
  const name = firstName ? ` ${firstName}` : ''
  const body = `Thanks for reaching out${name}! We received your info and we'll confirm your estimate shortly.`
  return sendCustomerSms(phone, body)
}

/** Send appointment confirmation */
export async function sendAppointmentConfirmation(phone: string, dateStr: string, firstName?: string): Promise<SmsResult> {
  const name = firstName ? ` ${firstName}` : ''
  const body = `Hi${name}! Your fence estimate with ${COMPANY_NAME} is confirmed for ${dateStr}. We'll see you then!`
  return sendCustomerSms(phone, body)
}

/** Send follow-up message */
export async function sendFollowUp(phone: string, message: string): Promise<SmsResult> {
  return sendCustomerSms(phone, message)
}

export { COMPANY_NAME }
