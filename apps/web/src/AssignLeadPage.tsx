/**
 * Assign a website or phone lead: one tap per person (the owner, and each
 * Salesman by name). At /assign-lead?customer=<id>, where the owner's push
 * opens (portal lib/leadAssign.ts); /assign-lead alone lists every lead still
 * waiting, each with the same buttons. The owner, admin, manager and office
 * only (the server refuses everyone else).
 *
 * Assigning writes the rep on the customer and the lead's card, so the
 * Salesman has it on the next screen load, and a "Lead assigned" line on the
 * customer's History says who assigned it, to whom and when. A lead someone
 * else already has is never changed without asking first.
 */

import { useEffect, useState } from 'react'
import { navigate, useNav } from './nav'
import { tapDecision } from './leadAssignTap'
import { assignLead, loadLead, arrivedWords, useWaitingLeads, type AssignChoice, type LeadRep, type WaitingLead } from './leadAssign'

const whoWords = (c: AssignChoice) => (c.me ? `${c.name} (me)` : c.name)

function LeadFacts({ lead }: { lead: WaitingLead }) {
  return (
    <div className="min-w-0">
      <div className="text-lg font-bold text-gray-900 truncate">{lead.name}</div>
      <div className="text-sm text-gray-600">{[lead.sourceWords, lead.town, arrivedWords(lead.at)].filter(Boolean).join(' · ')}</div>
      {lead.what && <div className="text-sm text-gray-800 mt-0.5">{lead.what}</div>}
      {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="text-sm text-orange-600 underline inline-block mt-1 min-h-[32px]">{lead.phone}</a>}
    </div>
  )
}

/** The buttons for one lead, and what happened. */
function AssignButtons({ lead, choices, rep: startRep, onDone }: { lead: WaitingLead; choices: AssignChoice[]; rep?: LeadRep | null; onDone?: (name: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [taken, setTaken] = useState<{ rep: LeadRep; want: AssignChoice } | null>(null)
  // Someone already has the lead and another person was tapped: asked before anything is sent.
  const [asking, setAsking] = useState<{ rep: LeadRep; want: AssignChoice } | null>(null)
  const [theirs, setTheirs] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [rep, setRep] = useState<LeadRep | null>(startRep ?? null)
  useEffect(() => { setRep(startRep ?? null) }, [startRep])

  const go = async (c: AssignChoice, replace = false) => {
    if (busy) return
    setBusy(c.id); setError(''); setTaken(null); setAsking(null); setTheirs(null)
    const r = await assignLead(lead.customerId, c.id, replace)
    setBusy(null)
    if (r.ok) { setDone(r.assignedTo); setRep(null); onDone?.(r.assignedTo); return }
    if (r.taken) { setTaken({ rep: r.taken, want: c }); return }
    setError(r.error)
  }

  if (done) {
    return (
      <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3" role="status" data-lead-assigned>
        <div className="font-semibold text-green-900">Assigned to {done}.</div>
        <div className="text-sm text-green-800">It is on {done}'s list now, and the customer's History says so.</div>
        <div className="flex flex-wrap gap-2 mt-2">
          {lead.cardId && <button className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => navigate(`/pipeline?card=${encodeURIComponent(lead.cardId!)}`)}>Open the card</button>}
          <button className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => navigate(`/customers/${encodeURIComponent(lead.customerId)}`)}>Open the customer</button>
        </div>
      </div>
    )
  }
  const already = rep && !taken
  const tap = (c: AssignChoice) => {
    if (busy) return
    setError(''); setTaken(null)
    const d = tapDecision(c, rep)
    if (d === 'assign') { void go(c); return }
    setAsking(null)
    if (d === 'theirs') { setTheirs(c.name); return }
    setTheirs(null)
    setAsking({ rep: rep!, want: c })
  }
  return (
    <div className="mt-3">
      {already && (
        <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900" data-lead-has-rep>
          Already assigned to <b>{rep!.name}</b>{rep!.by ? <> by {rep!.by}</> : null}{rep!.at ? <>, {arrivedWords(rep!.at)}</> : null}. Tap someone else to give it to them instead.
        </div>
      )}
      {asking && (
        <div className="mb-2 rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-900" role="alertdialog" aria-label="Move this lead?" data-lead-move-ask>
          <div className="font-semibold">Take this lead from {asking.rep.name} and give it to {asking.want.name}?</div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button className="btn btn-primary btn-sm min-h-[44px]" onClick={() => void go(asking.want, true)} disabled={!!busy} data-lead-move-yes>Yes, give it to {asking.want.name}</button>
            <button className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setAsking(null)} disabled={!!busy} data-lead-move-no>No, leave it with {asking.rep.name}</button>
          </div>
        </div>
      )}
      {theirs && !asking && (
        <div className="mb-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-800" role="status" data-lead-already-theirs>
          It is already {theirs}'s. Nothing was changed.
        </div>
      )}
      {taken && (
        <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900" role="alert" data-lead-taken>
          <div>Already assigned to <b>{taken.rep.name}</b>{taken.rep.by ? <> by {taken.rep.by}</> : null}{taken.rep.at ? <>, {arrivedWords(taken.rep.at)}</> : null}. Nothing was changed.</div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button className="btn btn-primary btn-sm min-h-[44px]" onClick={() => void go(taken.want, true)} disabled={!!busy}>Give it to {taken.want.name} instead</button>
            <button className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setTaken(null)}>Leave it with {taken.rep.name}</button>
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map(c => (
          <button key={c.id} className={`btn ${c.me ? 'btn-secondary' : 'btn-primary'} w-full min-h-[48px] justify-center`} disabled={!!busy}
            onClick={() => tap(c)} data-assign-to={c.id}>
            {busy === c.id ? 'Assigning…' : `Assign to ${whoWords(c)}`}
          </button>
        ))}
        {!choices.length && <div className="text-sm text-gray-600">No owner or Salesman login is active. Add one in Team.</div>}
      </div>
      {error && <div className="mt-2 text-sm text-red-700" role="alert">{error}</div>}
    </div>
  )
}

function OneLead({ customerId }: { customerId: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof loadLead>> | null>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setState(null)
    void loadLead(customerId).then(r => { if (live) setState(r) })
    return () => { live = false }
  }, [customerId, tries])
  if (!state) return <div className="text-gray-600 p-4">Loading the lead…</div>
  if (!state.ok) {
    return (
      <div className="card p-4">
        <div className="text-red-700">{state.error}</div>
        <button className="btn btn-secondary btn-sm mt-3 min-h-[44px]" onClick={() => setTries(n => n + 1)}>Try again</button>
      </div>
    )
  }
  return (
    <div className="card p-4" data-assign-lead={customerId}>
      <LeadFacts lead={state.lead} />
      <AssignButtons lead={state.lead} choices={state.choices} rep={state.lead.rep} />
    </div>
  )
}

function WaitingList({ exclude }: { exclude?: string }) {
  const data = useWaitingLeads(true)
  // Assigned on this screen: kept in view with its "Assigned to" until the screen is left.
  const [assigned, setAssigned] = useState<Record<string, WaitingLead>>({})
  if (!data) return <div className="text-gray-600 p-4">Loading the leads waiting…</div>
  const shown = [...data.leads, ...Object.values(assigned).filter(a => !data.leads.some(l => l.customerId === a.customerId))]
    .filter(l => l.customerId !== exclude)
    .sort((a, b) => b.at.localeCompare(a.at))
  if (!shown.length) return <div className="card p-4 text-gray-700" data-no-leads-waiting>{exclude ? 'No other leads are waiting to be assigned.' : 'No leads are waiting to be assigned.'}</div>
  return (
    <div className="space-y-3">
      {shown.map(l => (
        <div key={l.customerId} className="card p-4" data-waiting-lead={l.customerId}>
          <LeadFacts lead={l} />
          <AssignButtons lead={l} choices={data.choices} onDone={() => setAssigned(a => ({ ...a, [l.customerId]: l }))} />
        </div>
      ))}
    </div>
  )
}

export default function AssignLeadPage() {
  const nav = useNav()
  const customerId = nav.params.get('customer') ?? ''
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{customerId ? 'Assign this lead' : 'Leads waiting to be assigned'}</h1>
        <p className="text-sm text-gray-600">Website and phone leads go to nobody until assigned. One tap gives the lead to that person.</p>
      </div>
      {customerId && <OneLead customerId={customerId} />}
      {customerId && <h2 className="text-base font-semibold text-gray-900 pt-2">Other leads waiting</h2>}
      <WaitingList exclude={customerId || undefined} />
    </div>
  )
}
