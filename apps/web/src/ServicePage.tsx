/**
 * Service: every warranty and service request, open ones by stage (New,
 * Photos requested, Photos received, Scheduled, Fixed), or all of them with
 * the closed ones. "New request" finds the customer (past customers first,
 * with their warranty) and opens the request form on their fence.
 */

import { useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { useTickets, useBadges, badgeFor, badgeWords } from './serviceStore'
import { TicketRow, jobsOfCustomer, openServiceRequest } from './ServiceRequests'
import { STAGES } from '../../portal/src/server/lib/serviceTicketModel'
import { getCustomers } from './customerStore'
import { formatPhone } from './phoneFormat'

const digits = (s: string) => (s || '').replace(/\D/g, '')

export default function ServicePage() {
  const [all, setAll] = useState(false)
  const { list, error, reload } = useTickets({ all })
  const [finding, setFinding] = useState(false)
  const groups = useMemo(() => STAGES.filter(s => all || s.key !== 'closed').map(s => ({ ...s, rows: (list ?? []).filter(t => t.stage === s.key) })), [list, all])
  return (
    <div className="space-y-4 pb-24 max-w-3xl" data-service-page>
      <div className="page-header !mb-0">
        <div className="min-w-0">
          <h1>Service</h1>
          <div className="facts"><span><b data-service-open-count>{(list ?? []).filter(t => t.open).length}</b> open</span>{error && <span className="text-amber-700">{error}</span>}</div>
        </div>
        <div className="actions">
          <select value={all ? 'all' : 'open'} onChange={e => setAll(e.target.value === 'all')} aria-label="Show" className="border border-gray-300 rounded-lg h-12 px-3 text-base bg-white" data-service-filter>
            <option value="open">Open</option>
            <option value="all">All, with closed</option>
          </select>
          <button type="button" className="btn btn-quiet btn-icon" onClick={reload} aria-label="Load again"><RefreshCw size={18} aria-hidden="true" /></button>
          <button type="button" className="btn btn-primary" onClick={() => setFinding(true)} data-service-new>New request</button>
        </div>
      </div>
      {finding && <FindCustomer onClose={() => setFinding(false)} />}
      {list === null && !error && <p className="text-sm text-gray-600">Loading…</p>}
      {list && list.length === 0 && <p className="panel p-6 text-center text-gray-600" data-service-empty>No {all ? '' : 'open '}service requests. Make one from a past customer's page, their card, or their job.</p>}
      {groups.filter(g => g.rows.length).map(g => (
        <section key={g.key} className="space-y-2" data-service-group={g.key}>
          <h2 className="text-sm font-bold text-gray-800">{g.label} <span className="font-semibold text-gray-500">({g.rows.length})</span></h2>
          {g.rows.map(t => <TicketRow key={t.id} t={t} showCustomer />)}
        </section>
      ))}
    </div>
  )
}

/** Find the customer for a new request: by name, phone or address; past customers (with a completed job) first. */
function FindCustomer({ onClose }: { onClose: () => void }) {
  useBadges()
  const [q, setQ] = useState('')
  const text = q.trim().toLowerCase(), num = digits(q)
  const hits = text.length < 2 ? [] : getCustomers().filter(c => {
    const name = `${c.firstName} ${c.lastName}`.toLowerCase()
    return name.includes(text) || (c.serviceAddress || '').toLowerCase().includes(text) || (num.length >= 3 && digits(c.phone).includes(num))
  }).filter(c => jobsOfCustomer(c.id).length > 0)
    .sort((a, b) => Number(!!badgeFor(b.id)) - Number(!!badgeFor(a.id))).slice(0, 12)
  return (
    <div className="panel p-3 space-y-2" data-service-find>
      <div className="flex items-center gap-2">
        <Search size={18} className="text-gray-500" aria-hidden="true" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} inputMode="search" placeholder="Customer name, phone or street" className="flex-1 min-w-0 h-12 text-base outline-none" data-service-find-input />
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>Cancel</button>
      </div>
      {text.length >= 2 && hits.length === 0 && <p className="text-sm text-gray-600">No customer with a job matches.</p>}
      {hits.map(c => {
        const b = badgeFor(c.id)
        return (
          <button key={c.id} type="button" className="w-full text-left rounded-xl border border-gray-200 px-3 py-2 min-h-[56px] hover:bg-gray-50" onClick={() => { onClose(); openServiceRequest({ customerId: c.id }) }} data-service-find-hit={c.id}>
            <span className="block text-sm font-semibold text-gray-900">{c.firstName} {c.lastName}</span>
            <span className="block text-xs text-gray-600 truncate">{[b ? badgeWords(b) : 'Job not completed', formatPhone(c.phone), c.serviceAddress].filter(Boolean).join(' · ')}</span>
          </button>
        )
      })}
    </div>
  )
}
