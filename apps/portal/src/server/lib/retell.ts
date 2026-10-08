/**
 * Retell phone agent helpers: webhook signature check and turning a call into
 * the fields the CRM files. Pure functions, no database, so they can be unit
 * tested on their own.
 */

import crypto from 'crypto'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

const RETELL_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Retell signs each webhook: header X-Retell-Signature is "v=<ms timestamp>,d=<hex>",
 * where d = HMAC-SHA256(rawBody + timestamp) keyed with the Retell API key that
 * has the webhook badge. Requests older than five minutes are refused.
 * https://docs.retellai.com/features/secure-webhook
 */
export function verifyRetellSignature(rawBody: string, signature: unknown, apiKey: string, now = Date.now()): boolean {
  if (typeof signature !== 'string') return false
  const m = /^v=(\d+),d=([0-9a-fA-F]+)$/.exec(signature.trim())
  if (!m) return false
  const ts = Number(m[1])
  if (!Number.isFinite(ts) || Math.abs(now - ts) > RETELL_TOLERANCE_MS) return false
  const expected = crypto.createHmac('sha256', apiKey).update(rawBody + m[1]).digest('hex')
  return safeEqual(expected, m[2].toLowerCase())
}

/** First non empty value among the keys, matched loosely (case, spaces, underscores). */
function pick(obj: Record<string, unknown> | undefined, ...names: string[]): string {
  if (!obj) return ''
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = names.map(norm)
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue
    if (wanted.includes(norm(k))) return typeof v === 'string' ? v.trim() : String(v)
  }
  return ''
}

export function summarizeRetellCall(call: any): {
  name: string; phone: string; email: string; address: string; fenceType: string; callbackAt: string; summary: string
} {
  const analysis = (call?.call_analysis && typeof call.call_analysis === 'object') ? call.call_analysis : {}
  const custom: Record<string, unknown> = (analysis.custom_analysis_data && typeof analysis.custom_analysis_data === 'object') ? analysis.custom_analysis_data : {}
  const vars: Record<string, unknown> = (call?.retell_llm_dynamic_variables && typeof call.retell_llm_dynamic_variables === 'object') ? call.retell_llm_dynamic_variables : {}
  const both = { ...vars, ...custom }

  // On an inbound call the customer is the caller; on an outbound call, the number dialed.
  const phone = String((call?.direction === 'outbound' ? call?.to_number : call?.from_number) || '')
  const first = pick(both, 'first_name', 'firstname')
  const last = pick(both, 'last_name', 'lastname')
  const name = pick(both, 'name', 'caller_name', 'customer_name', 'full_name', 'contact_name')
    || [first, last].filter(Boolean).join(' ')
    || (phone ? `Caller ${phone}` : 'Unknown caller')
  const email = pick(both, 'email', 'email_address', 'customer_email')
  const address = pick(both, 'address', 'service_address', 'property_address', 'job_address', 'street_address')
    || [pick(both, 'city'), pick(both, 'zip', 'zip_code', 'zipcode')].filter(Boolean).join(' ')
  const fenceType = pick(both, 'fence_type', 'project_type', 'fence_material', 'material', 'service_type')
  const callbackAt = pick(both, 'callback_time', 'callback', 'callback_at', 'callback_date', 'appointment_time', 'appointment', 'preferred_callback_time', 'best_time_to_call')

  const seconds = (Number(call?.end_timestamp) - Number(call?.start_timestamp)) / 1000
  const lines = [
    `Phone call handled by the phone agent${Number.isFinite(seconds) && seconds > 0 ? ` (${Math.round(seconds / 60 * 10) / 10} min)` : ''}`,
    callbackAt ? `Callback booked: ${callbackAt}` : '',
    fenceType ? `Fence type: ${fenceType}` : '',
    address ? `Address: ${address}` : '',
    analysis.call_summary ? `Summary: ${analysis.call_summary}` : '',
    analysis.user_sentiment ? `Caller sentiment: ${analysis.user_sentiment}` : '',
    call?.disconnection_reason ? `Call ended: ${call.disconnection_reason}` : '',
    // Everything the agent collected, whatever the fields are named, so nothing is lost.
    ...Object.entries(custom).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    call?.recording_url ? `Recording: ${call.recording_url}` : '',
  ].filter(Boolean)

  return { name, phone, email, address, fenceType, callbackAt, summary: lines.join('\n') }
}

