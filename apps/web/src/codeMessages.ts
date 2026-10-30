/**
 * Messages from Code (the owner's alone; server: routes/code-messages.ts,
 * lib/codeMessages.ts). Code (the assistant that builds and deploys EZ Biz)
 * leaves a message here and pushes its one line to the owner's phone: a deploy
 * went live, something needs his answer or OK, or a deploy or live data change
 * failed. Everything is read from the server each time; nothing is kept in
 * browser storage.
 *
 * The menu line and its unread badge show only when the server says this
 * login is the owner (/status). The count is asked for when the app opens,
 * when it comes back to the front, every few minutes, and after a message is
 * opened.
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'

export type CodeMessageKind = 'live' | 'needs_answer' | 'failed' | 'info'
export interface CodeMessage {
  id: string; kind: CodeMessageKind; title: string; body: string
  createdAt: string; readAt: string | null; answeredAt: string | null
}

export const CODE_MESSAGE_KIND_LABEL: Record<CodeMessageKind, string> = {
  live: 'Live',
  needs_answer: 'Needs your answer',
  failed: 'Failed',
  info: 'Note',
}

/** Where the push opens, and the menu line's address. */
export const CODE_MESSAGES_PAGE = 'Messages from Code'

// ── Owner and unread count, shared by the menu and the screen ───────────────

let state: { owner: boolean; unread: number } = { owner: false, unread: 0 }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(f => f())

/** Ask the server again whether this login is the owner and how many are unread. */
export async function refreshCodeMessageStatus(): Promise<void> {
  try {
    const r = await sendJson('GET', '/api/code-messages/status')
    if (!r.result.ok) return
    const d = r.json?.data ?? {}
    const next = { owner: d.owner === true, unread: Number(d.unread) || 0 }
    if (next.owner !== state.owner || next.unread !== state.unread) { state = next; emit() }
  } catch { /* no signal: keep what is shown */ }
}

/** The owner flag and unread count, kept fresh while the app is open. */
export function useCodeMessageStatus(): { owner: boolean; unread: number } {
  const [s, setS] = useState(state)
  useEffect(() => {
    const f = () => setS(state)
    listeners.add(f)
    f()
    return () => { listeners.delete(f) }
  }, [])
  return s
}

let polling = false
/** Start asking: now, when the app comes back to the front, and every 5 minutes. Once per app load. */
export function startCodeMessageStatus() {
  if (polling) return
  polling = true
  void refreshCodeMessageStatus()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshCodeMessageStatus() })
  setInterval(() => { if (document.visibilityState === 'visible') void refreshCodeMessageStatus() }, 5 * 60_000)
}

// ── The list and one message ────────────────────────────────────────────────

type Loaded<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

async function load<T>(method: string, path: string, body?: unknown): Promise<Loaded<T>> {
  try {
    const r = await sendJson(method, path, body)
    if (r.result.ok) return { ok: true, data: r.json?.data as T }
    return { ok: false, status: r.status, error: r.json?.error || (r.status === 0 ? 'No signal right now. Try again.' : `Could not load Messages from Code (${r.status}).`) }
  } catch { return { ok: false, status: 0, error: 'No signal right now. Try again.' } }
}

export const loadCodeMessages = () => load<CodeMessage[]>('GET', '/api/code-messages')
export const loadCodeMessage = (id: string) => load<CodeMessage>('GET', `/api/code-messages/${encodeURIComponent(id)}`)

/** Mark it read (opening it does), then ask for the new unread count. */
export async function markCodeMessageRead(id: string): Promise<Loaded<CodeMessage>> {
  const r = await load<CodeMessage>('POST', `/api/code-messages/${encodeURIComponent(id)}/read`)
  void refreshCodeMessageStatus()
  return r
}

export const markCodeMessageAnswered = (id: string, answered: boolean) =>
  load<CodeMessage>('POST', `/api/code-messages/${encodeURIComponent(id)}/answered`, { answered })
