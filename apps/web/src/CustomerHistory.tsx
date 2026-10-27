/**
 * One history for a customer, newest first: calls with answers, texts,
 * emails, quotes sent, proposal opens, appointments, notes, warranty updates,
 * change orders, and their jobs: payments, scheduling, install Start and
 * Finish, the final walkthrough (lib/jobActivity.ts) (GET
 * /api/follow-ups/history, lib/followUps.ts
 * customerHistory). Answers still waiting for signal show on top, "Saving…".
 *
 * Used by the pipeline card window (History, the last 8 with Show all) and the
 * customer page (Activity, a page at a time with Show more, and "Last contact"
 * in its summary row).
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { useFollowUpBoard, pendingCalls, CHANGED_EVENT } from './followUpStore'
import { OUTCOME_LABEL, LOST_REASON_LABEL } from './followUpRules'
import { historyWhen } from './customerPage'
import { CUSTOMER_SAVED_EVENT } from './customerStore'

export interface HistoryItem { at: string; kind: string; title: string; detail: string; by: string; saving?: boolean }

const KIND_DOT: Record<string, string> = { visit: 'bg-teal-600', call: 'bg-green-500', text: 'bg-blue-500', email: 'bg-indigo-500', quote: 'bg-purple-500', proposal_opened: 'bg-amber-500', proposal_staff: 'bg-gray-300', appointment: 'bg-cyan-600', note: 'bg-gray-400', payment: 'bg-emerald-600', schedule: 'bg-sky-600', install: 'bg-orange-500', walkthrough: 'bg-lime-600', job: 'bg-gray-500' }

/** Kinds that are a contact with the customer (the customer page's "Last contact"); a visit is a walk-in at the counter. */
export const CONTACT_KINDS = new Set(['call', 'text', 'email', 'visit'])

/**
 * The history (null while it loads), with this phone's waiting answers on top.
 * `refreshKey` loads it again when it changes (a note added on the screen).
 */
export function useCustomerHistory(cardId: string | null, customerId: string | null, refreshKey: unknown = 0): HistoryItem[] | null {
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    if (!cardId && !customerId) { setItems([]); return }
    const q = new URLSearchParams({ ...(cardId ? { cardId } : {}), ...(customerId ? { customerId } : {}) })
    sendJson('GET', `/api/follow-ups/history?${q}`).then(r => {
      if (!live) return
      if (r.result.ok) setItems(r.json.data ?? [])
      else setItems(prev => prev ?? [])
    })
    return () => { live = false }
  }, [cardId, customerId, n, refreshKey])
  useEffect(() => {
    const h = () => setN(x => x + 1)
    window.addEventListener(CHANGED_EVENT, h)
    return () => window.removeEventListener(CHANGED_EVENT, h)
  }, [])
  // A customer just saved on this phone: the history was asked for before the server had them (a walk-in
  // showed "Last contact: None" until a reload, round 3 recheck). Read again once the save reaches it.
  useEffect(() => {
    if (!customerId) return
    const h = (e: Event) => { if ((e as CustomEvent<{ id: string }>).detail?.id === customerId) setN(x => x + 1) }
    window.addEventListener(CUSTOMER_SAVED_EVENT, h)
    return () => window.removeEventListener(CUSTOMER_SAVED_EVENT, h)
  }, [customerId])
  // Answers still on their way (no signal): on top, "Saving…".
  useFollowUpBoard()
  const waiting: HistoryItem[] = pendingCalls(cardId, customerId).map(c => ({
    at: c.at, kind: c.channel === 'text' ? 'text' : 'call', saving: true, by: '',
    title: `${c.channel === 'text' ? 'Text' : 'Call'}: ${OUTCOME_LABEL[c.outcome]}${c.outcome === 'lost' && c.lostReason ? ` (${LOST_REASON_LABEL[c.lostReason].toLowerCase()})` : ''}`,
    detail: c.note,
  }))
  if (items === null && !waiting.length) return null
  return [...waiting, ...(items ?? [])].sort((a, b) => b.at.localeCompare(a.at))
}

/** The newest call, text or email in a history (null when there is none). */
export function lastContactOf(list: HistoryItem[] | null): HistoryItem | null {
  return list?.find(h => CONTACT_KINDS.has(h.kind)) ?? null
}

/** Florida time, with the year when it is not this year (an import from 2024 says so). */
const when = (iso: string) => historyWhen(iso)

/**
 * The list. `step` set: that many at first and "Show N more" for the next
 * ones (the customer page). Not set: the first `first` with Show all / Show
 * less (the card window).
 */
export function HistoryList({ list, first = 8, step, title = 'History', className }: {
  list: HistoryItem[] | null
  first?: number
  step?: number
  title?: string | null
  className?: string
}) {
  const [limit, setLimit] = useState(first)
  const [all, setAll] = useState(false)
  const total = list?.length ?? 0
  const shown = !list ? [] : step ? list.slice(0, limit) : all ? list : list.slice(0, first)
  return (
    <section className={className ?? 'bg-white rounded-2xl border border-gray-200 px-4 py-3'} data-card-history data-history-count={total}>
      {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
      {list === null ? <p className="text-sm text-gray-500 mt-1">Loading…</p>
        : total === 0 ? <p className="text-sm text-gray-600 mt-1">Nothing yet.</p>
        : (
          <ol className="mt-2 space-y-2">
            {shown.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex gap-2" data-history-item={h.kind}>
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${KIND_DOT[h.kind] ?? 'bg-gray-400'}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900">{h.title}</span>
                  {h.detail && <span className="block text-sm text-gray-700 whitespace-pre-wrap [overflow-wrap:anywhere]">{h.detail}</span>}
                  <span className="block text-xs text-gray-500">{when(h.at)}{h.by ? ` · ${h.by}` : ''}{h.saving ? ' · Saving…' : ''}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      {step && total > shown.length && (
        <button type="button" className="btn btn-quiet btn-sm mt-2" data-show-more="history" onClick={() => setLimit(l => l + step)}>
          Show {Math.min(step, total - shown.length)} more <span className="font-normal text-gray-500">({shown.length} of {total})</span>
        </button>
      )}
      {!step && total > first && <button type="button" className="btn btn-quiet btn-sm mt-2" onClick={() => setAll(a => !a)}>{all ? 'Show less' : `Show all ${total}`}</button>}
    </section>
  )
}
