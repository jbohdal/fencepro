/**
 * Twilio SMS Integration
 *
 * Sends SMS via Twilio REST API (no SDK needed — keeps deps light).
 * Falls back to console logging when Twilio is not configured.
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || ''
const COMPANY_NAME = process.env.COMPANY_NAME || 'FencePro'

interface SmsResult {
  success: boolean
  sid?: string
  error?: string
}

/** Send an SMS via Twilio REST API */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
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

/** Send the initial "thanks for reaching out" SMS to a new lead */
export async function sendLeadConfirmation(phone: string, firstName?: string): Promise<SmsResult> {
  const name = firstName ? ` ${firstName}` : ''
  const body = `Thanks for reaching out${name}! ${COMPANY_NAME} received your info and we'll confirm your estimate shortly. Reply STOP to opt out.`
  return sendSms(phone, body)
}

/** Send appointment confirmation */
export async function sendAppointmentConfirmation(phone: string, dateStr: string, firstName?: string): Promise<SmsResult> {
  const name = firstName ? ` ${firstName}` : ''
  const body = `Hi${name}! Your fence estimate with ${COMPANY_NAME} is confirmed for ${dateStr}. We'll see you then! Reply STOP to opt out.`
  return sendSms(phone, body)
}

/** Send follow-up message */
export async function sendFollowUp(phone: string, message: string): Promise<SmsResult> {
  return sendSms(phone, message)
}

export { COMPANY_NAME }
