/**
 * Possible matches on a customer a website or phone lead made, on the
 * customer page and the pipeline card's window (server: lib/customerMerge.ts,
 * /api/customer-matches).
 *
 *   "Possible match: <name>, <phone>. Use <name>?"   Merge (one tap) or Not
 *        the same person (kept, never offered again). Merge moves everything
 *        of the new customer to the one on file, whose own record is not
 *        changed; the new customer is kept, archived, with its history.
 *   "Merged into <name>"   on the merged customer's page, with Open.
 *   Merge history          on the kept customer's page: the merged customer's
 *        details as they were, what moved, and Undo merge.
 *
 * Everything is read from and saved on the server; after a merge or an undo
 * every list is read again (recordArchive.refreshAll).
 */

import { useCallback, useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { refreshAll } from './recordArchive'
import { refreshBusinessState } from './businessStateStore'
import { CUSTOMER_UPDATED_EVENT } from './customerStore'
import { formatPhone } from './phoneFormat'
import { can } from './permissions'
import { toast } from './toast'

interface MatchView {
  textConsent: string
  matches: Array<{ id: string; reason: string; customer: { id: string; name: string; phone: string; email: string; address: string; textConsent: string } }>
  mergedInto: { id: string; name: string; mergeId: string | null } | null
  merges: Array<{
    id: string; mergedId: string; mergedLabel: string
    details: { name: string; phone: string; email: string; address: string; leadSource: string; createdAt: string }
    textConsent: { kept: string; merged: string } | null
    mergedAt: string; mergedBy: string | null; undoneAt: string | null; undoneBy: string | null; moved: string[]
  }>
}

/** A texting answer in words. */
const said = (c: string) => (c === 'yes' ? 'yes to texts' : c === 'no' ? 'no to texts' : 'not asked about texts')

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function useMatchView(customerId: string | null | undefined) {
  const [view, setView] = useState<MatchView | null>(null)
  const load = useCallback(async () => {
    if (!customerId) { setView(null); return }
    const r = await sendJson('GET', `/api/customer-matches/customer/${encodeURIComponent(customerId)}`)
    setView(r.result.ok ? (r.json?.data as MatchView) : null)
  }, [customerId])
  useEffect(() => {
    void load()
    // Another screen merged or undid: the customer lists are read again, and so is this.
    const again = () => { void load() }
    window.addEventListener(CUSTOMER_UPDATED_EVENT, again)
    window.addEventListener('focus', again)
    return () => { window.removeEventListener(CUSTOMER_UPDATED_EVENT, again); window.removeEventListener('focus', again) }
  }, [load])
  return { view, load }
}

async function readEverythingAgain() {
  await Promise.allSettled([refreshAll(), refreshBusinessState()])
}

/**
 * The notice and its buttons. `onMerged` gets the kept customer's id (the
 * customer page opens them; the card stays, now theirs).
 */
export default function PossibleMatch({ customerId, onMerged, onOpenCustomer, history = false }: {
  customerId: string | null | undefined
  onMerged?: (keptId: string) => void
  onOpenCustomer?: (id: string) => void
  /** Also show this customer's merge history with Undo merge (the customer page). */
  history?: boolean
}) {
  const { view, load } = useMatchView(customerId)
  const [busy, setBusy] = useState<string | null>(null)
  const allowed = can('records.archive')
  if (!customerId || !view) return null

  async function merge(m: MatchView['matches'][number]) {
    setBusy(m.id)
    const r = await sendJson('POST', `/api/customer-matches/${encodeURIComponent(m.id)}/merge`)
    setBusy(null)
    if (!r.result.ok) { toast.error('Not merged', r.json?.error || 'Check the connection and try again.'); return }
    const d = r.json.data as { keptId: string; mergedName: string; keptName: string; moved: string[] }
    toast.success(`Merged into ${d.keptName}`, d.moved.length ? `Moved: ${d.moved.join(', ')}. Undo merge is on ${d.keptName}'s page.` : `Nothing to move. Undo merge is on ${d.keptName}'s page.`)
    await readEverythingAgain()
    await load()
    onMerged?.(d.keptId)
  }

  async function dismiss(m: MatchView['matches'][number]) {
    setBusy(m.id)
    const r = await sendJson('POST', `/api/customer-matches/${encodeURIComponent(m.id)}/dismiss`)
    setBusy(null)
    if (!r.result.ok) { toast.error('Not saved', r.json?.error || 'Check the connection and try again.'); return }
    toast.info('Not the same person', `${m.customer.name} will not be offered again for this customer.`)
    await load()
  }

  async function undo(id: string, label: string) {
    setBusy(id)
    const r = await sendJson('POST', `/api/customer-matches/merges/${encodeURIComponent(id)}/undo`)
    setBusy(null)
    if (!r.result.ok) { toast.error('Merge not undone', r.json?.error || 'Check the connection and try again.'); return }
    const d = r.json.data as { moved: string[]; gone: number }
    toast.success(`${label} is back as their own customer`, `${d.moved.length ? `Moved back: ${d.moved.join(', ')}.` : 'Nothing to move back.'}${d.gone ? ` ${d.gone} removed since the merge stayed removed.` : ''}`)
    await readEverythingAgain()
    await load()
  }

  const merges = history ? view.merges : []
  if (!view.matches.length && !view.mergedInto && !merges.length) return null
  return (
    <div className="space-y-2" data-possible-match-panel>
      {view.matches.map(m => (
        <div key={m.id} className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2" data-possible-match-notice={m.id} data-match-customer={m.customer.id}>
          <p className="text-sm text-blue-950">
            <b>Possible match:</b> {m.customer.name}{m.customer.phone ? `, ${formatPhone(m.customer.phone)}` : ''}{m.customer.email ? `, ${m.customer.email}` : ''}. Use {m.customer.name}?
            <span className="block text-xs text-blue-900/80 mt-0.5">Same {m.reason}. This customer was made by a website or phone lead; merging moves everything of theirs to {m.customer.name} and leaves {m.customer.name}'s details as they are.</span>
          </p>
          {view.textConsent !== m.customer.textConsent && (
            <p className="text-xs text-blue-950 rounded-lg bg-white/70 px-2 py-1" data-match-text-consent={`${view.textConsent}|${m.customer.textConsent}`}>
              Texts: this customer said {said(view.textConsent)}; {m.customer.name} said {said(m.customer.textConsent)}. Merging keeps {m.customer.name}'s answer as it is{[view.textConsent, m.customer.textConsent].includes('no') ? '; the "no" keeps texts to them blocked until someone records a yes' : ''}.
            </p>
          )}
          {allowed ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={!!busy} onClick={() => merge(m)} data-merge-match={m.id}>{busy === m.id ? 'Merging…' : `Merge into ${m.customer.name}`}</button>
              <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={!!busy} onClick={() => dismiss(m)} data-dismiss-match={m.id}>Not the same person</button>
              {onOpenCustomer && <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => onOpenCustomer(m.customer.id)} data-open-match={m.customer.id}>Open {m.customer.name}</button>}
            </div>
          ) : <p className="text-xs text-blue-900/80">Ask the office to merge or dismiss it.</p>}
        </div>
      ))}

      {view.mergedInto && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex flex-wrap items-center gap-3" data-merged-into={view.mergedInto.id}>
          <p className="flex-1 min-w-[12rem] text-sm text-gray-800">Merged into <b>{view.mergedInto.name}</b>: everything of this customer is on {view.mergedInto.name}'s page, where the merge can be undone.</p>
          {onOpenCustomer && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => onOpenCustomer(view.mergedInto!.id)} data-open-merged-into>Open {view.mergedInto.name}</button>}
        </div>
      )}

      {merges.length > 0 && (
        <details className="rounded-xl border border-gray-200 bg-white p-3" open={merges.some(m => !m.undoneAt)} data-merge-history>
          <summary className="text-sm font-semibold text-gray-900 cursor-pointer">Merged customers ({merges.length})</summary>
          <ul className="mt-2 divide-y divide-gray-100">
            {merges.map(m => (
              <li key={m.id} className="py-2 flex flex-wrap items-start gap-3" data-merge-row={m.id} data-merge-undone={m.undoneAt ? 'yes' : 'no'}>
                <div className="flex-1 min-w-[14rem] text-sm text-gray-800">
                  <p><b>{m.details.name || m.mergedLabel}</b>{m.details.phone ? `, ${formatPhone(m.details.phone)}` : ''}{m.details.email ? `, ${m.details.email}` : ''}</p>
                  {(m.details.address || m.details.leadSource) && <p className="text-xs text-gray-600">{[m.details.address, m.details.leadSource ? `via ${m.details.leadSource}` : ''].filter(Boolean).join(' · ')}</p>}
                  <p className="text-xs text-gray-600">Merged {when(m.mergedAt)}{m.mergedBy ? ` by ${m.mergedBy}` : ''}{m.moved.length ? `. Moved: ${m.moved.join(', ')}` : '. Nothing moved'}.</p>
                  {m.textConsent && m.textConsent.kept !== m.textConsent.merged && <p className="text-xs text-gray-600" data-merge-text-consent={`${m.textConsent.kept}|${m.textConsent.merged}`}>Texts at the merge: {m.details.name || m.mergedLabel} said {said(m.textConsent.merged)}; this customer said {said(m.textConsent.kept)} (kept as it was{m.textConsent.merged === 'no' ? '; texts stay blocked until a yes is recorded here' : ''}).</p>}
                  {m.undoneAt && <p className="text-xs text-gray-600">Undone {when(m.undoneAt)}{m.undoneBy ? ` by ${m.undoneBy}` : ''}.</p>}
                </div>
                {!m.undoneAt && allowed && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={!!busy} onClick={() => undo(m.id, m.details.name || m.mergedLabel)} data-undo-merge={m.id}>{busy === m.id ? 'Undoing…' : 'Undo merge'}</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
