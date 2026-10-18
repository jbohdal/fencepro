/** One request from the outbox to the server, with the answer sorted for it. */

import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import type { SendResult } from './outbox'

export const API_ORIGIN = typeof window !== 'undefined' && window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''

export interface SentJson { result: SendResult; json: any; status: number }

/** Send JSON. `ok` only when the server answered 2xx and did not say it failed. */
export async function sendJson(method: string, path: string, body?: unknown, timeoutMs = 25_000): Promise<SentJson> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    const res = await fetchWithAuth(`${API_ORIGIN}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl?.signal,
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json?.success !== false) return { result: { ok: true, data: json?.data }, json, status: res.status }
    return { result: { ok: false, status: res.status, error: json?.error, ...(typeof json?.code === 'string' ? { code: json.code } : {}) }, json, status: res.status }
  } catch (err) {
    return { result: { ok: false, status: 0, error: (err as Error)?.message || 'network' }, json: null, status: 0 }
  } finally {
    if (t) clearTimeout(t)
  }
}
