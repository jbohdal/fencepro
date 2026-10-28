/**
 * "2 new leads waiting to be assigned", at the top of the Dashboard, Today
 * and the Sales Pipeline for the owner and the office, until each one is
 * assigned (leadAssign.ts). It shows whether or not the owner's push reached
 * a phone, so a lead never sits unseen. A tap on a lead opens its Assign
 * screen; "Assign" alone opens the list of all of them.
 */

import { UserPlus } from 'lucide-react'
import { navigate } from './nav'
import { canAssignLeads, useWaitingLeads, arrivedWords } from './leadAssign'

export default function WaitingLeadsBanner() {
  const allowed = canAssignLeads()
  const data = useWaitingLeads(allowed)
  if (!allowed || !data || !data.leads.length) return null
  const n = data.leads.length
  const first = data.leads.slice(0, 3)
  return (
    <div className="mb-4 rounded-xl border border-orange-300 bg-orange-50 p-3 md:p-4" role="region" aria-label="Leads waiting to be assigned" data-waiting-leads={n}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <UserPlus size={20} className="text-orange-600 shrink-0" aria-hidden="true" />
          <div className="font-semibold text-gray-900">{n === 1 ? '1 new lead waiting to be assigned' : `${n} new leads waiting to be assigned`}</div>
        </div>
        <button className="btn btn-primary btn-sm min-h-[44px] shrink-0" onClick={() => navigate('/assign-lead')}>Assign</button>
      </div>
      <ul className="mt-2 divide-y divide-orange-200">
        {first.map(l => (
          <li key={l.customerId}>
            <button className="w-full text-left py-2 min-h-[44px]" onClick={() => navigate(`/assign-lead?customer=${encodeURIComponent(l.customerId)}`)}>
              <span className="font-medium text-gray-900">{l.name}</span>
              <span className="text-sm text-gray-600"> · {[l.sourceWords, l.town, arrivedWords(l.at)].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
      {n > first.length && <button className="text-sm text-orange-700 underline min-h-[32px]" onClick={() => navigate('/assign-lead')}>And {n - first.length} more</button>}
    </div>
  )
}
