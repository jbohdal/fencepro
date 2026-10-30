/**
 * Messages from Code (Jonathan, Oct 30 2026): "Send me an EZ Biz push
 * notification on my phone (owner only, never Christa or anyone else)
 * whenever: a deploy goes live (one line saying what's live); something needs
 * my answer or my OK: one line saying what, with the details in a new
 * "Messages from Code" note I can open in the app; a deploy or a live data
 * change fails. Send it from the live server after the deploy is confirmed
 * up, not from dev."
 *
 *   - A message is a CodeMessage row: its kind (live, needs_answer, failed,
 *     info), a one line title (what the push says) and the details (plain
 *     text or simple markdown, as long as it needs). Written by
 *     scripts/code-message.ts, run from ~/ezbiz/apps/portal on the live Mac.
 *   - The push goes to the owner's phones only: the owner as
 *     lib/salesmanChoice.ts isOwnerLogin finds him (every active super_admin
 *     login; with none, the oldest active admin). Never the other admins, the
 *     office, a Salesman or an Installer. Tapping it opens the message in the
 *     app (/messages-from-code?msg=<id>).
 *   - The phone push goes through lib/automations/push.ts sendPush, so the
 *     outbound gate (lib/outboundGate.ts) decides: only the live install
 *     reaches the phone; anywhere else it is written to the dev outbox.
 *   - Reading them is the owner's alone (routes/code-messages.ts answers 403
 *     to anyone else). Opening one marks it read; a needs_answer one can be
 *     marked answered.
 */

import prisma from './prisma.js'
import { sendPush, type PushResult } from './automations/push.js'
import { assignees } from './leadAssign.js'

export const CODE_MESSAGE_KINDS = ['live', 'needs_answer', 'failed', 'info'] as const
export type CodeMessageKind = typeof CODE_MESSAGE_KINDS[number]

/** The push's heading for each kind (the one line title is the push's text). */
export const CODE_MESSAGE_PUSH_TITLE: Record<CodeMessageKind, string> = {
  live: 'Live now',
  needs_answer: 'Needs your answer',
  failed: 'Failed',
  info: 'From Code',
}

/** The longest title kept: one line on a phone's push. */
export const CODE_MESSAGE_TITLE_MAX = 200
/** The longest details kept (a long report is fine; a runaway log is not). */
export const CODE_MESSAGE_BODY_MAX = 100_000

/** The app's address for one message (where the push opens). */
export const codeMessagePath = (id: string) => `/messages-from-code?msg=${encodeURIComponent(id)}`

export function isCodeMessageKind(k: unknown): k is CodeMessageKind {
  return typeof k === 'string' && (CODE_MESSAGE_KINDS as readonly string[]).includes(k)
}

/**
 * The owner's login ids, by role as isOwnerLogin finds him: every active super_admin; with none, the oldest
 * active admin. Empty when the company has neither.
 */
export async function ownerLoginIds(accountId: string): Promise<string[]> {
  const people = await assignees(accountId)
  const supers = people.filter(p => p.role === 'super_admin').map(p => p.id)
  if (supers.length) return supers
  const admin = people.find(p => p.role === 'admin')
  return admin ? [admin.id] : []
}

export interface NewCodeMessage { kind: CodeMessageKind; title: string; body?: string }
export interface CodeMessageSaved {
  id: string
  /** null: no push was asked for (--no-push). */
  push: PushResult | null
  /** Whose phones the push was for (the owner's logins). */
  ownerIds: string[]
}

/** Title to one clean line (a pasted line break or tab is a space), at most CODE_MESSAGE_TITLE_MAX. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, CODE_MESSAGE_TITLE_MAX)
}

/** Save a message and (unless push is false) push its title to the owner's phones only. */
export async function createCodeMessage(accountId: string, msg: NewCodeMessage, opts: { push?: boolean } = {}): Promise<CodeMessageSaved> {
  if (!isCodeMessageKind(msg.kind)) throw new Error(`Unknown kind "${msg.kind}". Use one of: ${CODE_MESSAGE_KINDS.join(', ')}.`)
  const title = oneLine(msg.title ?? '')
  if (!title) throw new Error('A message needs a one line title.')
  const body = String(msg.body ?? '').replace(/\r\n/g, '\n').slice(0, CODE_MESSAGE_BODY_MAX)
  const row = await prisma.codeMessage.create({ data: { accountId, kind: msg.kind, title, body } })
  const ownerIds = await ownerLoginIds(accountId)
  if (opts.push === false) return { id: row.id, push: null, ownerIds }
  // No owner login: no push at all (sendPush with an empty list reaches nobody; never the admins' default).
  const push = ownerIds.length
    ? await sendPush(accountId, { title: CODE_MESSAGE_PUSH_TITLE[msg.kind], body: title, url: codeMessagePath(row.id), tag: `code-${row.id}` }, { userIds: ownerIds })
    : { sent: 0, failed: 0, removed: 0, held: 0, subscribers: 0, errors: ['No owner login (no active super_admin or admin) to push to.'] }
  return { id: row.id, push, ownerIds }
}

/** What the list and the open message send to the app. */
export interface CodeMessageView {
  id: string; kind: CodeMessageKind; title: string; createdAt: string
  readAt: string | null; answeredAt: string | null
  /** The details: the whole text when one message is opened, the first lines in the list. */
  body: string
}

export function codeMessageView(m: { id: string; kind: string; title: string; body: string; createdAt: Date; readAt: Date | null; answeredAt: Date | null }, full: boolean): CodeMessageView {
  return {
    id: m.id, kind: (isCodeMessageKind(m.kind) ? m.kind : 'info'), title: m.title,
    createdAt: m.createdAt.toISOString(), readAt: m.readAt?.toISOString() ?? null, answeredAt: m.answeredAt?.toISOString() ?? null,
    body: full ? m.body : m.body.slice(0, 200),
  }
}
