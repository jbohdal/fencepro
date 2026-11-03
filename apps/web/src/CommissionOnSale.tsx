/**
 * Who gets a signed job's commission, and how much: the owner edits it by hand
 * (Jonathan, Nov 2 2026: "COMMISSION STAYS with whoever sold it when a signed
 * job is moved. Owner can edit it by hand.").
 *
 * Shown to a super_admin only, on a signed quote; the server refuses everyone
 * else (portal lib/soldBy.ts). Only saved internal figures change: the
 * commission and the margin after it. The price, the contract and the payment
 * schedule stay as they are. Commission is pay only (Jonathan, Nov 3 2026):
 * handing it to someone else leaves the sale, its revenue and close rate in
 * Reports, with the seller of record.
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { signedInRole } from './permissions'
import { useSalesmen } from './salesmanChoice'
import { refreshQuotes } from './quoteStore'
import { refreshJobs } from './jobStore'
import { typedCents } from './salesmanCommission'

interface Commission { signed: boolean; soldBy: string; commissionTo: string; rep: string; commissionCents: number; priceCents: number; beforeCents: number; byHand: boolean }

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

export default function CommissionOnSale({ quoteId, salesRep }: { quoteId: string; salesRep?: string }) {
  const owner = signedInRole() === 'super_admin'
  const { list } = useSalesmen()
  const [c, setC] = useState<Commission | null>(null)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const path = `/api/saved-quotes/${encodeURIComponent(quoteId)}/commission`

  useEffect(() => {
    if (!owner) return
    let on = true
    void sendJson('GET', path).then(r => { if (on) setC(r.result.ok ? r.json?.data ?? null : null) })
    return () => { on = false }
  }, [owner, path, salesRep])

  if (!owner || !c?.signed) return null
  // Who may get it: the owner or a Salesman, as the server allows.
  const choices = (list?.choices ?? []).filter(p => p.role === 'super_admin' || p.role === 'sales_rep')
  const paidTo = c.commissionTo ?? c.soldBy
  const current = choices.find(p => norm(p.name) === norm(paidTo))?.id ?? ''
  const handedOn = !!paidTo && norm(paidTo) !== norm(c.soldBy)
  const cents = typedCents(typed)

  const start = () => { setOpen(true); setError(''); setDone(''); setWho(current); setTyped((c.commissionCents / 100).toFixed(2)) }
  const picked = who && who !== current ? who : ''
  const save = async () => {
    if (busy || cents === null) return
    // Nothing changed: nothing is saved, and it is not marked as set by hand.
    if (cents === c.commissionCents && !picked) { setOpen(false); setError(''); setDone('Nothing changed.'); return }
    setBusy(true); setError('')
    const r = await sendJson('POST', path, { commissionCents: cents, ...(picked ? { to: picked } : {}) })
    setBusy(false)
    if (r.result.ok) {
      setC(r.json?.data ?? null)
      setOpen(false)
      setDone('Saved. The price, the contract and the payment schedule did not change.')
      void refreshQuotes(); void refreshJobs()
      return
    }
    setError(r.status === 0 ? 'No signal right now. Nothing was changed; try again.' : `${r.json?.error || 'Could not change the commission.'}`)
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2" data-commission-on-sale>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-gray-500 block">Commission (only you see this)</span>
          <span className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]" data-commission-who>
            {c.commissionCents > 0 ? `${fmt(c.commissionCents)} to ${paidTo || 'no one (sold with no Salesman)'}` : `None. Sold by ${c.soldBy || 'no one on file'}`}
          </span>
          {handedOn && <span className="text-xs text-gray-500 block [overflow-wrap:anywhere]" data-commission-seller>{c.soldBy ? `Sold by ${c.soldBy}. The sale stays theirs in Reports.` : 'Sold with no Salesman. The sale stays Unassigned in Reports.'}</span>}
          {c.byHand && <span className="text-xs text-gray-500 block" data-commission-by-hand>Set by hand</span>}
        </div>
        {!open && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={start} data-commission-change>Change</button>}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="text-xs text-gray-500 block mb-1">Who gets it</span>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white" value={who} onChange={e => setWho(e.target.value)} data-commission-select>
              {!current && <option value="">{paidTo || 'Pick who gets it…'}</option>}
              {choices.map(p => <option key={p.id} value={p.id}>{p.me ? `${p.name} (me)` : p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 block mb-1">Amount</span>
            <input type="text" inputMode="decimal" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]" value={typed} onChange={e => setTyped(e.target.value)} data-commission-amount />
          </label>
          {cents === null && <p className="text-xs text-red-700">Type an amount, like 1200 or 1200.50.</p>}
          {cents !== null && cents > c.beforeCents && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-2" role="alert" data-commission-over>
              This is more than the job makes before commission ({fmt(Math.max(0, c.beforeCents))}), so its margin goes below zero. You can still save it.
            </p>
          )}
          <p className="text-xs text-gray-500">Comes out of the price, so only your margin changes. The customer's price, the contract and the payment schedule stay as they are. The sale, its revenue and close rate stay with {c.soldBy || 'Unassigned'} in Reports.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={busy || cents === null} onClick={() => void save()} data-commission-save>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700 mt-1" role="alert" data-commission-error>{error}</p>}
      {done && <p className="text-xs text-green-800 mt-1" role="status" data-commission-done>{done}</p>}
    </div>
  )
}
