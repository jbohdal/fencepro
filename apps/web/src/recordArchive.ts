/**
 * Archive, unarchive and delete a customer, job or pipeline card, straight on
 * the server (no waiting in the outbox: the answer decides what the screen
 * shows), then read the lists again so every board agrees.
 *
 *   Archive    everyday, reversible from the record: off the boards and
 *              active lists, still in search, reports and KPIs.
 *   Delete     owner and admin only: the record and everything with it go to
 *              Settings > Deleted Records, where Restore puts them back.
 */

import { sendJson } from './syncHttp'
import { refreshCustomers } from './customerStore'
import { refreshQuotes } from './quoteStore'
import { refreshJobs } from './jobStore'
import { refreshPipelineNow } from './pipelineStore'
import { refreshAppointments } from './appointmentsStore'

export type RecordKind = 'customer' | 'job' | 'card' | 'quote'

const BASE: Record<RecordKind, string> = {
  customer: '/api/crm-contacts',
  job: '/api/saved-jobs',
  quote: '/api/saved-quotes',
  card: '/api/pipeline/cards',
}

export interface RecordResult { ok: boolean; error?: string; data?: any }

/** Every list a delete, archive or restore can change, read again. */
export async function refreshAll(): Promise<void> {
  await Promise.allSettled([refreshCustomers(), refreshQuotes(), refreshJobs(), refreshPipelineNow(), refreshAppointments()])
}

async function act(method: string, path: string, body?: unknown): Promise<RecordResult> {
  const r = await sendJson(method, path, body)
  if (!r.result.ok) return { ok: false, error: r.json?.error || (r.status === 0 ? 'No connection. Try again when you have signal.' : 'Something went wrong. Try again.') }
  await refreshAll()
  return { ok: true, data: r.json?.data }
}

export const archiveRecord = (kind: Exclude<RecordKind, 'quote'>, id: string) => act('POST', `${BASE[kind]}/${encodeURIComponent(id)}/archive`)
export const unarchiveRecord = (kind: Exclude<RecordKind, 'quote'>, id: string) => act('POST', `${BASE[kind]}/${encodeURIComponent(id)}/unarchive`)
export const deleteRecord = (kind: RecordKind, id: string, reason?: string) => act('DELETE', `${BASE[kind]}/${encodeURIComponent(id)}`, reason ? { reason } : undefined)

/** After Settings > Deleted Records restored something. */
export function refreshAfterRestore(_entityType: string): void { void refreshAll() }
