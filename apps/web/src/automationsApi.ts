/**
 * The Automations screen's calls to the server (/api/automations). Rules,
 * runs, tasks and permits all live on the server; nothing here is kept in the
 * browser.
 */

import { stageName } from './pipelineStagesStore'
import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'
import { plainText } from './plainError'

export type Board = 'sales' | 'ops'

export interface Trigger { type: 'card_entered' | 'card_left' | 'in_stage_days' | 'date_offset' | 'event'; stage?: string; settleMinutes?: number; onlyWhileInStage?: boolean; days?: number; dateField?: 'install' | 'appointment' | 'proposal_sent'; when?: 'before' | 'after'; event?: string }
export interface Condition { field: 'stage' | 'style' | 'price' | 'city' | 'county' | 'salesman' | 'tag' | 'permit_required'; op: string; value: any }
export interface Step { type: string; [k: string]: any }
export interface Rule { id: string; name: string; board: Board; enabled: boolean; trigger: Trigger; conditions: Condition[]; steps: Step[]; starter?: string | null; runs30d?: Record<string, number>; updatedAt?: string }
export interface StageRule { id: string; board: Board; stage: string; requirements: Array<{ type: string }>; enabled: boolean }
export interface LogEntry { at: string; step: number | null; result: string; detail: string; link?: string; until?: string }
export interface Run { id: string; ruleId: string; ruleName: string; board: Board | null; entityKind: string; entityId: string; status: string; stepIndex: number; nextRunAt: string; attempts: number; lastError: string | null; log: LogEntry[]; createdAt: string; updatedAt: string; /** A job's run log: this run was on its pipeline card. */ onCard?: boolean }
export interface Meta {
  salesStages: Array<{ key: string; label: string }>; opsStages: Array<{ key: string; label: string }>; people: Array<{ id: string; name: string; email: string; role: string }>
  templateFields: string[]; events: string[]; requirements: Array<{ type: string; label: string }>
  gmail: { configured: boolean; connected: boolean; email: string | null }; push: { mySubscriptions: number }
  walkthroughInstalled: boolean; isAdmin: boolean; permitPortals: Record<string, { name: string; url: string; info: string; note: string }>
}
export interface DryRun { entity: { board: Board; id: string; name: string; stage: string }; trigger: string; conditions: Array<{ field: string; ok: boolean; actual: string }>; wouldRun: boolean; steps: Array<{ index: number; type: string; would: string; warning?: string }> }
export interface Permit { id: string; jobId: string; status: string; permitNumber: string; county: string; parcelId: string; appliedAt: string; approvedAt: string; inspectionAt: string; passedAt: string; notes: string; updatedAt: string; updatedBy?: string | null }
export interface Task { id: string; title: string; description: string | null; assignedTo: string | null; jobId: string | null; jobName: string | null; status: string; dueDate: string | null; completedAt?: string | null; createdBy: string | null }

/** Call the API; resolves the data or throws a plain sentence. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await sendJson(method, `/api/automations${path}`, body)
  if (!r.result.ok) throw new Error(plainText(r.json?.error || (r.status === 0 ? 'Failed to fetch' : 'Something went wrong'), 'This'))
  return (r.json?.data ?? r.json) as T
}

/** Open a PDF the server makes (needs the sign in, so it is fetched, then shown). */
export async function openPdf(path: string): Promise<void> {
  const w = window.open('', '_blank')
  try {
    const res = await fetchWithAuth(`${API_ORIGIN}${path}`)
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || 'Could not make the PDF') }
    const url = URL.createObjectURL(await res.blob())
    if (w) w.location.href = url; else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 120_000)
  } catch (err) {
    w?.close()
    throw new Error(plainText(err, 'The PDF'))
  }
}

export const STEP_LABEL: Record<string, string> = {
  create_task: 'Make a task / reminder', notify: 'Notify me (and push to my phone)', email_customer: 'Email the customer',
  prepare_text: 'Prepare a text (I tap to send)', move_card: 'Move the card', add_checklist: 'Add a checklist',
  request_signature: 'Request a signature', start_walkthrough: 'Start the final walkthrough', final_invoice: 'Final invoice (draft)',
  permit_packet: 'Permit packet + task to file it', wait: 'Wait', webhook: 'Webhook (POST JSON)',
}
export const EVENT_LABEL: Record<string, string> = {
  proposal_accepted: 'Proposal accepted', walkthrough_signed: 'Walkthrough signed', punch_list_cleared: 'Punch list cleared',
  payment_received: 'Payment received', photo_uploaded: 'Photo uploaded',
}
export const FIELD_LABEL: Record<string, string> = {
  stage: 'Stage', style: 'Style / category', price: 'Price', city: 'City', county: 'County', salesman: 'Salesman', tag: 'Tag', permit_required: 'Permit required',
}
export const STATUS_STYLE: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800', failed: 'bg-red-100 text-red-800', queued: 'bg-blue-100 text-blue-800', waiting: 'bg-amber-100 text-amber-800',
  running: 'bg-blue-100 text-blue-800', skipped: 'bg-gray-100 text-gray-700',
}
export const STATUS_WORD: Record<string, string> = { succeeded: 'Done', failed: 'Failed', queued: 'Queued', waiting: 'Waiting', running: 'Running', skipped: 'Skipped' }

export function minutesText(m: number): string {
  if (m % (24 * 60) === 0) { const d = m / (24 * 60); return `${d} day${d === 1 ? '' : 's'}` }
  if (m % 60 === 0) { const h = m / 60; return `${h} hour${h === 1 ? '' : 's'}` }
  return `${m} min`
}

export function triggerText(t: Trigger, board: Board, opsLabel: (k: string) => string): string {
  const st = (s?: string) => board === 'ops' ? opsLabel(s || '') : stageName(s || '')
  switch (t.type) {
    case 'card_entered': return `Moved into ${st(t.stage)}`
    case 'card_left': return `Moved out of ${st(t.stage)}`
    case 'in_stage_days': return `In ${st(t.stage)} for ${t.days} days`
    case 'date_offset': return `${t.days} day${t.days === 1 ? '' : 's'} ${t.when} the ${t.dateField === 'install' ? 'install date' : t.dateField === 'appointment' ? 'appointment' : 'proposal was sent'}`
    case 'event': return EVENT_LABEL[t.event || ''] ?? String(t.event)
  }
}
