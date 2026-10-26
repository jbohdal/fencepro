/**
 * The one gate in front of everything that can reach a real person: phone
 * pushes, email (SMTP, SendGrid, Gmail), texts (Twilio), Google Calendar
 * writes and outgoing webhooks.
 *
 * Real delivery happens only in the live install, which is all of:
 *   - NODE_ENV is "production",
 *   - DATABASE_URL names exactly the live database (liveGuard LIVE_DATABASE_NAME),
 *   - this code runs from ~/ezbiz (the live install's folder),
 *   - not under tests (Vitest, NODE_ENV=test) and not switched off with
 *     OUTBOUND_GATE=closed.
 *
 * Anywhere else (the working folder, any worktree copy, the dev database, any
 * test) nothing is sent. The message is written to the dev outbox instead
 * (apps/portal/logs/dev-outbox.log, one JSON line each, plus a "[dev outbox]"
 * console line), so a reviewer can still see what would have gone out.
 *
 * Why (Oct 26, 2026): the dev copy holds live's data. Test runs on it pushed
 * "Automation failed" and permit reminders with test customer names to
 * Jonathan's real phone, because only some call sites checked. The check now
 * sits inside the lowest level senders, so no call site can skip it.
 * See GO_LIVE.md, "Live and dev are separate".
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { LIVE_DATABASE_NAME, databaseNameOf } from './liveGuard.js'

export type OutboundChannel = 'push' | 'email' | 'text' | 'calendar' | 'webhook'

/** Where this code file lives (the live install's is under ~/ezbiz). */
function codeFile(): string {
  return fileURLToPath(import.meta.url)
}

export interface GateInputs {
  env?: NodeJS.ProcessEnv
  /** The folder the running code is in. Default: this file's folder. */
  codeDir?: string
  home?: string
}

/** Why this process may not deliver to real people, or null when it is the live install. */
export function outboundBlockReason(inp: GateInputs = {}): string | null {
  const env = inp.env ?? process.env
  const home = inp.home ?? os.homedir()
  const codeDir = path.resolve(inp.codeDir ?? path.dirname(codeFile()))
  if ((env.OUTBOUND_GATE || '').toLowerCase() === 'closed') return 'outbound gate switched off (OUTBOUND_GATE=closed)'
  if (env.VITEST || env.VITEST_WORKER_ID || env.NODE_ENV === 'test') return 'running under tests'
  if (env.NODE_ENV !== 'production') return `not production (NODE_ENV=${env.NODE_ENV || 'unset'})`
  const db = databaseNameOf(env.DATABASE_URL)
  if (db !== LIVE_DATABASE_NAME) return `database "${db || 'none'}" is not the live database "${LIVE_DATABASE_NAME}"`
  const liveRoot = path.join(home, 'ezbiz')
  if (!(codeDir === liveRoot || codeDir.startsWith(liveRoot + path.sep))) return `this copy (${codeDir}) is not the live install (${liveRoot})`
  return null
}

/** True only in the live install: real pushes, emails, texts, calendar writes and webhooks may go out. */
export function realDeliveryAllowed(inp: GateInputs = {}): boolean {
  return outboundBlockReason(inp) === null
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Tests only: a fake server a test started on this machine (a fake mail
 * server, a fake webhook receiver) is not a person, so a test may talk to it.
 * Never true outside Vitest, and never for any other address.
 */
export function isTestLoopback(host: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!(env.VITEST || env.VITEST_WORKER_ID)) return false
  return LOOPBACK.has(String(host || '').trim().toLowerCase())
}

/** The dev outbox file: DEV_OUTBOX_FILE when set (tests), else apps/portal/logs/dev-outbox.log. */
export function devOutboxFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DEV_OUTBOX_FILE) return env.DEV_OUTBOX_FILE
  // src/server/lib or dist/server/lib → apps/portal
  return path.resolve(path.dirname(codeFile()), '../../..', 'logs', 'dev-outbox.log')
}

export interface HeldMessage { at: string; channel: OutboundChannel; to: string; title: string; body?: string; reason: string }

/**
 * Not sent: write what would have gone out to the dev outbox. Never throws.
 * Returns the line written.
 */
export function holdOutbound(channel: OutboundChannel, to: string, title: string, body?: string, reason: string | null = outboundBlockReason()): HeldMessage {
  const held: HeldMessage = { at: new Date().toISOString(), channel, to: String(to).slice(0, 300), title: String(title).slice(0, 300), ...(body ? { body: String(body).slice(0, 2000) } : {}), reason: reason || 'not the live install' }
  console.log(`[dev outbox] ${channel} to ${held.to}: ${held.title} (not sent: ${held.reason})`)
  try {
    const file = devOutboxFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(held) + '\n')
  } catch (err) {
    console.error('[dev outbox] could not write the outbox file:', String((err as Error)?.message || err).slice(0, 200))
  }
  return held
}

/** The plain sentence a screen shows for a held message. */
export const HELD_TEXT = 'Not sent: this copy of EZ Biz is not the live install, so nothing reaches a real person. It is in the dev outbox (apps/portal/logs/dev-outbox.log).'
