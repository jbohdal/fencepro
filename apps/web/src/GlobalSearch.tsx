/**
 * Search everything from the header or with Cmd K / Ctrl K: customers by
 * name, phone, address or email; quotes and jobs by customer, style or
 * address; and pages. Results are grouped, the arrow keys move through them,
 * Enter opens the highlighted one. A customer result also offers "Book" and
 * "Quote" straight from the list.
 */

import { formatPhone } from './phoneFormat'
import { styleLabel } from './fenceCatalog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, User, ClipboardList, Wrench, LayoutGrid, CalendarPlus, FilePlus2, UserPlus, type LucideIcon } from 'lucide-react'
import { getCustomers, getArchivedCustomers, type Customer } from './customerStore'
import { openBooking } from './BookingDialog'
import { useBadges, badgeFor, badgeWords } from './serviceStore'
import { matchesQuoteNumber, quoteNumber } from './quoteNumber'

interface QuoteLike { id: string; customerId?: string; customerName: string; customerAddress?: string; fenceStyle: string; finalPrice: number; status: string; date: string }
interface JobLike { id: string; customerId?: string; customerName: string; customerAddress?: string; fenceStyle?: string; status: string; contractValue: number; scheduledDate?: string; completedDate?: string }

type Hit = { group: string; icon: LucideIcon; label: string; sub: string; run: () => void; customer?: Customer; badge?: string }

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const digits = (s: string) => (s || '').replace(/\D/g, '')

export default function GlobalSearch({ onClose, quotes, jobs, pages, openCustomer, openQuote, newQuoteFor, newCustomer, goTo }: {
  onClose: () => void
  quotes: QuoteLike[]
  jobs: JobLike[]
  pages: string[]
  openCustomer: (id: string, tab?: string) => void
  openQuote: (q: QuoteLike) => void
  newQuoteFor: (c: Customer | null) => void
  newCustomer: () => void
  goTo: (page: string) => void
}) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  // Past customers: "Past customer · <warranty> · installed <date>" on their result.
  const badgesVersion = useBadges()
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => { input.current?.focus() }, [])

  const hits = useMemo<Hit[]>(() => {
    const text = q.trim().toLowerCase(), num = digits(q)
    const done = (f: () => void) => () => { f(); onClose() }
    const actions: Hit[] = [
      { group: 'Do', icon: CalendarPlus, label: 'Book appointment', sub: 'Pick a customer, day and time', run: done(() => openBooking()) },
      { group: 'Do', icon: FilePlus2, label: 'New quote', sub: 'Open the quote builder', run: done(() => newQuoteFor(null)) },
      { group: 'Do', icon: UserPlus, label: 'New customer', sub: 'Add a customer', run: done(newCustomer) },
    ]
    if (text.length < 2) return actions
    const out: Hit[] = []
    // Archived customers are found too (marked so); deleted ones never.
    const archivedIds = new Set(getArchivedCustomers().map(c => c.id))
    const customers = [...getCustomers(), ...getArchivedCustomers()].filter(c => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase()
      return name.includes(text) || (c.serviceAddress || '').toLowerCase().includes(text) || (c.email || '').toLowerCase().includes(text) ||
        (num.length >= 3 && digits(c.phone).includes(num))
    }).slice(0, 8)
    for (const c of customers) out.push({ group: 'Customers', icon: User, label: `${c.firstName} ${c.lastName}`.trim(), sub: [archivedIds.has(c.id) ? 'Archived' : '', formatPhone(c.phone), c.serviceAddress].filter(Boolean).join(' · '), badge: badgeFor(c.id) ? badgeWords(badgeFor(c.id)!) : undefined, run: done(() => openCustomer(c.id)), ...(archivedIds.has(c.id) ? {} : { customer: c }) })
    for (const x of quotes.filter(x => matchesQuoteNumber(x.id, q) || x.customerName.toLowerCase().includes(text) || (x.customerAddress || '').toLowerCase().includes(text) || (x.fenceStyle.toLowerCase().includes(text) || styleLabel(x.fenceStyle).toLowerCase().includes(text))).slice(0, 5))
      out.push({ group: 'Quotes', icon: ClipboardList, label: x.customerName, sub: [`#${quoteNumber(x.id)}`, styleLabel(x.fenceStyle), money(x.finalPrice), x.status.charAt(0) + x.status.slice(1).toLowerCase(), x.date].filter(Boolean).join(' · '), run: done(() => openQuote(x)) })
    for (const j of jobs.filter(j => j.customerName.toLowerCase().includes(text) || (j.customerAddress || '').toLowerCase().includes(text)).slice(0, 5))
      out.push({ group: 'Jobs', icon: Wrench, label: j.customerName, sub: [money(j.contractValue), j.status.replace(/_/g, ' '), j.completedDate || j.scheduledDate || 'not scheduled'].join(' · '), run: done(() => (j.customerId ? openCustomer(j.customerId, 'jobs') : goTo('Operations'))) })
    for (const p of pages.filter(p => p.toLowerCase().includes(text)).slice(0, 4))
      out.push({ group: 'Pages', icon: LayoutGrid, label: p, sub: 'Go to page', run: done(() => goTo(p)) })
    return out.length ? out : []
  }, [q, quotes, jobs, pages, badgesVersion])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setAt(0) }, [q])

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); hits[at].run() }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-[max(4vh,12px)] sm:pt-24" onClick={onClose}>
      <div className="panel w-full max-w-[600px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-label="Search" data-global-search>
        <div className="flex items-center gap-3 px-4 h-14 border-b border-gray-200">
          <Search size={20} className="text-gray-500 shrink-0" aria-hidden="true" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} inputMode="search" enterKeyHint="go"
            placeholder="Customer name, phone or address; quote; job" className="flex-1 min-w-0 text-base outline-none bg-transparent placeholder:text-gray-500" />
          <button onClick={onClose} className="btn btn-quiet btn-sm" aria-label="Close search">Esc</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto py-1" role="listbox">
          {q.trim().length >= 2 && hits.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-gray-600">
              Nothing matches "{q}". Try part of a name, the last four digits of a phone number, or a street.
            </div>
          )}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup ? (lastGroup = h.group, <p key={`g-${h.group}`} className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500">{h.group}</p>) : null
            return [head,
              <div key={i} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)}
                className={`flex items-center gap-3 px-4 min-h-[52px] ${i === at ? 'bg-orange-50' : ''}`}>
                <button onClick={h.run} className="flex flex-1 min-w-0 items-center gap-3 text-left py-2">
                  <span className="w-9 h-9 rounded-lg bg-gray-100 grid place-items-center text-gray-600 shrink-0"><h.icon size={18} aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-gray-900 truncate">{h.label}</span>
                    <span className="block text-sm text-gray-600 truncate">{h.sub}</span>
                    {h.badge && <span className="block text-xs font-semibold text-purple-800 truncate" data-search-past-customer>{h.badge}</span>}
                  </span>
                </button>
                {h.customer && (
                  <span className="flex gap-1 shrink-0">
                    <button className="btn btn-secondary btn-sm" onClick={() => { openBooking({ customerId: h.customer!.id }); onClose() }}>Book</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { newQuoteFor(h.customer!); onClose() }}>Quote</button>
                  </span>
                )}
              </div>]
          })}
        </div>
        <div className="hidden sm:flex gap-4 px-4 py-2 border-t border-gray-200 text-xs text-gray-500">
          <span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span>
        </div>
      </div>
    </div>
  )
}
