/**
 * The Salesman on one quote, or on one job (Jonathan, Oct 29 2026: "lets me
 * (owner only) change the salesman from the customer page AND from a single
 * quote, including a signed one, to fix a wrong pick. Changing a signed job's
 * salesman asks first and moves its commission too, with a History note.
 * Christa can't change it.").
 *
 * Everyone sees who it is; only the owner has Change (the server refuses
 * everyone else: portal lib/salesmanMove.ts). An unsold quote moves at once.
 * A signed, sold or accepted quote, or a job, asks first, with the commission
 * it carries (the owner's eyes only), and moves on Yes. Only the Salesman
 * (and the commission credited to them) changes: the price, the costs, the
 * status, the signed papers and the payment schedule stay as they are, and
 * the customer's own Salesman stays (that is the customer page's Change).
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { useOwnerChangesSalesman, useSalesmen } from './salesmanChoice'
import { OWNER_ONLY_WORDS } from './SalesmanOnCustomer'
import { refreshQuotes } from './quoteStore'
import { refreshJobs } from './jobStore'

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
/** The same person as a rep is written: full name, or one side the other's first name alone. */
const samePerson = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  return x === y || (!x.includes(' ') && x === y.split(' ')[0]) || (!y.includes(' ') && y === x.split(' ')[0])
}

interface Ask { question: string; to: string; toName: string }

export default function SalesmanOnQuote({ quoteId, jobId, salesRep, label = 'Salesman' }: { quoteId?: string; jobId?: string; salesRep: string; label?: string }) {
  const owner = useOwnerChangesSalesman()
  const { list } = useSalesmen()
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  // What the server said after a move, until the screen's own copy reads again.
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => { setShown(null) }, [salesRep])
  const current = (shown ?? salesRep ?? '').trim()
  const choices = list?.choices ?? []
  const path = quoteId ? `/api/saved-quotes/${encodeURIComponent(quoteId)}/salesman` : `/api/saved-jobs/${encodeURIComponent(jobId ?? '')}/salesman`

  const start = () => {
    setOpen(true); setError(''); setDone(''); setAsk(null)
    setPick(choices.find(c => samePerson(c.name, current))?.id ?? '')
  }
  const send = async (to: string, confirm: boolean) => {
    if (busy) return
    setBusy(true); setError('')
    const r = await sendJson('POST', path, { to, ...(confirm ? { confirm: true } : {}) })
    setBusy(false)
    if (r.result.ok) {
      const d = r.json?.data ?? {}
      setOpen(false); setAsk(null); setShown(String(d.to ?? ''))
      setDone(d.already ? `It is already ${d.to}'s. Nothing was changed.` : `${d.to} is the Salesman on this ${jobId && !quoteId ? 'job' : 'quote'} now${d.signed ? ', with its job and commission' : ', with its commission'}. The History says so; the customer's own Salesman is unchanged.`)
      // The quote list, Sales by rep, the board and Operations read the new Salesman.
      void refreshQuotes(); void refreshJobs()
      return
    }
    if (r.status === 409 && r.json?.code === 'CONFIRM_SIGNED') {
      const toName = choices.find(c => c.id === to)?.name ?? r.json.confirm?.to ?? ''
      setAsk({ question: String(r.json.confirm?.question || r.json.error), to, toName })
      return
    }
    setError(r.status === 0 ? 'No signal right now. Nothing was changed; try again.' : `${r.json?.error || 'Could not change the Salesman.'}`)
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2" data-quote-salesman>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-gray-500 block">{label}</span>
          <span className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]" data-quote-salesman-name>{current || 'None yet'}</span>
        </div>
        {owner && !open && !ask && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={start} data-quote-salesman-change>Change</button>}
      </div>
      {!owner && <p className="text-xs text-gray-500 mt-1" data-quote-salesman-locked>{OWNER_ONLY_WORDS}</p>}
      {open && !ask && (
        <div className="mt-2 space-y-2">
          {!list && <p className="text-xs text-gray-500">Loading the Salesmen…</p>}
          {list && (
            <>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white" value={pick} onChange={e => setPick(e.target.value)} data-quote-salesman-select aria-label="Salesman on this quote">
                {!pick && <option value="">Pick the Salesman…</option>}
                {choices.map(c => <option key={c.id} value={c.id}>{c.me ? `${c.name} (me)` : c.name}</option>)}
              </select>
              <p className="text-xs text-gray-500">Moves this {jobId && !quoteId ? 'job' : 'quote'} only, with its commission (and its job, once signed). The price stays as it is.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={!pick || busy || samePerson(choices.find(c => c.id === pick)?.name, current)} onClick={() => void send(pick, false)} data-quote-salesman-save>{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
      {ask && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-950" role="alertdialog" aria-label="Move this signed job?" data-quote-salesman-ask>
          <p className="font-semibold">{ask.question}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={busy} onClick={() => void send(ask.to, true)} data-quote-salesman-yes>{busy ? 'Moving…' : `Yes, move it to ${ask.toName}`}</button>
            <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy} onClick={() => { setAsk(null); setOpen(false) }} data-quote-salesman-no>No, leave it with {current || 'nobody'}</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700 mt-1" role="alert" data-quote-salesman-error>{error}</p>}
      {done && <p className="text-xs text-green-800 mt-1" role="status" data-quote-salesman-done>{done}</p>}
    </div>
  )
}
