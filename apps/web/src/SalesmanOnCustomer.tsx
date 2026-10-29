/**
 * A customer's Salesman on the customer page (Jonathan, Oct 28 2026: "I can
 * change a customer's salesman anytime from the customer page"). The owner,
 * admin, manager and office change it here: the same save as a lead's Assign
 * (portal lib/leadAssign.ts), so the customer, their open cards and their
 * open quotes (with their commission; portal lib/quotesFollowCustomer.ts) move,
 * the History says who changed it, and the new Salesman has the customer on
 * the next screen load while the old one no longer does. The Salesman sees
 * who it is and that only the owner or the office change it.
 */

import { useState } from 'react'
import { assignLead, canAssignLeads, loadLead, type AssignChoice } from './leadAssign'

export const canChangeSalesman = (): boolean => canAssignLeads()

export default function SalesmanOnCustomer({ customerId, salesRep }: { customerId: string; salesRep: string }) {
  const [open, setOpen] = useState(false)
  const [choices, setChoices] = useState<AssignChoice[] | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const canChange = canChangeSalesman()
  const current = salesRep.trim()

  const start = async () => {
    setOpen(true); setError(''); setDone('')
    const r = await loadLead(customerId)
    if (!r.ok) { setError(r.error); return }
    setChoices(r.choices)
    const now = r.choices.find(c => sameName(c.name, current) || sameName(c.name.split(' ')[0], current))
    setPick(now?.id ?? '')
  }
  const save = async () => {
    const to = choices?.find(c => c.id === pick)
    if (!to || busy) return
    setBusy(true); setError('')
    const r = await assignLead(customerId, to.id, true)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setOpen(false)
    const was = current && !sameName(current, r.assignedTo) ? current : ''
    const n = r.quotesMoved
    // Open quotes (and their commission) go with the customer; sold ones stay with whoever sold them (portal lib/quotesFollowCustomer.ts).
    const quotes = n ? ` ${n === 1 ? 'Their open quote is' : `Their ${n} open quotes are`} ${r.assignedTo}'s now too; sold jobs stay with whoever sold them.` : ''
    setDone(was
      ? `${r.assignedTo} is the Salesman now and sees this customer.${quotes} ${was} no longer does, unless ${was} made one of their quotes or has a visit booked with them.`
      : `${r.assignedTo} is the Salesman.${quotes}`)
  }

  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2" data-customer-salesman>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-gray-500 block">Salesman</span>
          <span className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]" data-customer-salesman-name>{current || 'None yet'}</span>
        </div>
        {canChange && !open && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => void start()} data-customer-salesman-change>Change</button>}
      </div>
      {!canChange && <p className="text-xs text-gray-500 mt-1" data-customer-salesman-locked>Only the owner or the office can change the Salesman.</p>}
      {open && (
        <div className="mt-2 space-y-2">
          {!choices && !error && <p className="text-xs text-gray-500">Loading the Salesmen…</p>}
          {choices && (
            <>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white" value={pick} onChange={e => setPick(e.target.value)} data-customer-salesman-select aria-label="Salesman">
                {!pick && <option value="">Pick the Salesman…</option>}
                {choices.map(c => <option key={c.id} value={c.id}>{c.me ? `${c.name} (me)` : c.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={!pick || busy || sameName(choices.find(c => c.id === pick)?.name, current)} onClick={() => void save()} data-customer-salesman-save>{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-700 mt-1" role="alert" data-customer-salesman-error>{error} Nothing was changed.</p>}
      {done && <p className="text-xs text-green-800 mt-1" role="status" data-customer-salesman-done>{done}</p>}
    </div>
  )
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return !!n(a) && n(a) === n(b)
}
