/**
 * The window a pipeline card opens: everything to act on the deal without
 * leaving the board. Same layout on a phone (full screen) and a computer (a
 * window over the board):
 *
 *   New quote (filled in with this customer)
 *   Call · Text · Navigate · Book appointment
 *   The customer's quotes (status, price, date; tap to open)
 *   Next appointment
 *   The last few notes, and Add note
 *   Stage picker to move the card
 *
 * Its address is ?card=<lead id>, so Back closes it and a reload reopens it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Phone, MessageSquare, Navigation, CalendarPlus, FilePlus2, ChevronRight, X, ExternalLink } from 'lucide-react'
import type { PipelineLead } from './JobsPage'
import type { SavedQuote } from './QuotesPage'
import type { Appointment } from './appointmentLogic'
import { shortWhen, smsLink } from './appointmentLogic'
import { getCustomerById } from './customerStore'
import { listContactNotes, createContactNote, noteChangeFor, type CrmContactNoteRecord, noteAuthor } from './crmContactsApi'
import { subscribe, pendingFor } from './outbox'
import { useBackLayer } from './nav'
import { SaveStatus, cardChange } from './SaveStatus'
import AutomationRunLog from './AutomationRunLog'

const fmtUSD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const STATUS: Record<string, string> = { DRAFT: 'bg-gray-100 text-gray-700', SENT: 'bg-blue-100 text-blue-800', SOLD: 'bg-green-100 text-green-800', LOST: 'bg-red-100 text-red-800' }
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()
const fmtDate = (d: string) => { const t = new Date(d.length === 10 ? `${d}T12:00:00` : d); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

export interface QuoteCustomer { id: string; firstName: string; lastName: string; phone?: string; email?: string; serviceAddress?: string; leadSource?: string; salesRep?: string }

export default function PipelineCardWindow({ lead, stages, quotes, next, onClose, onNewQuote, onOpenQuote, onBook, onMoveStage, onEditLead, onOpenCustomer }: {
  lead: PipelineLead
  stages: string[]
  /** This customer's quotes, newest first. */
  quotes: SavedQuote[]
  next: Appointment | null
  onClose: () => void
  onNewQuote: (c: QuoteCustomer) => void
  onOpenQuote: (q: SavedQuote) => void
  onBook: () => void
  onMoveStage: (stage: string) => void
  onEditLead: () => void
  onOpenCustomer: (() => void) | null
}) {
  useBackLayer(onClose, { key: 'card', params: { card: lead.id } })
  const customer = lead.customerId ? getCustomerById(lead.customerId) : null
  const name = `${lead.firstName} ${lead.lastName}`.trim() || 'Customer'
  const phone = lead.phone || customer?.phone || ''
  const address = lead.address || customer?.serviceAddress || ''

  // Notes live with the customer record on the server.
  const [notes, setNotes] = useState<CrmContactNoteRecord[] | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    if (!lead.customerId) { setNotes([]); return }
    const rows = await listContactNotes(lead.customerId)
    setNotes(rows ?? [])
  }, [lead.customerId])
  useEffect(() => { load() }, [load])
  // A note waiting for signal reaches the server: show the list as the server has it.
  useEffect(() => {
    if (!lead.customerId) return
    let waiting = pendingFor('note:').length
    return subscribe(() => { const now = pendingFor('note:').length; if (now < waiting) load(); waiting = now })
  }, [lead.customerId, load])
  async function addNote() {
    const body = draft.trim()
    if (!body || !lead.customerId || saving) return
    setSaving(true)
    const made = await createContactNote(lead.customerId, { body })
    setSaving(false)
    if (made) { setDraft(''); setAdding(false); load() }
  }
  const lastNotes = (notes ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)

  const startQuote = () => onNewQuote({
    id: lead.customerId || '', firstName: lead.firstName, lastName: lead.lastName,
    phone, email: lead.email || customer?.email || '', serviceAddress: address,
    leadSource: lead.leadSource || customer?.leadSource || '', salesRep: lead.assignedRep || customer?.salesRep || '',
  })

  const action = 'flex flex-col items-center justify-center gap-1 min-h-[72px] px-1 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-800 hover:bg-gray-50 active:bg-orange-50'
  const off = 'opacity-40 pointer-events-none'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/40 md:p-6" onClick={onClose} data-card-window={lead.id}>
      <div role="dialog" aria-modal="true" aria-label={name} onClick={e => e.stopPropagation()}
        className="bg-gray-50 w-full md:max-w-xl md:rounded-2xl shadow-2xl flex flex-col max-h-full md:max-h-[90vh] overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-4 pt-[calc(12px+env(safe-area-inset-top))] md:pt-4 pb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-gray-900 truncate">{name}</h2>
            <p className="text-sm text-gray-600 truncate">{[lead.stage, address].filter(Boolean).join(' · ')}</p>
            <SaveStatus keys={lead.customerId ? [`customer:${lead.customerId}`] : []} also={op => cardChange(lead.id)(op) || (!!lead.customerId && noteChangeFor(lead.customerId)(op))} className="mt-1" />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-quiet btn-icon shrink-0"><X size={22} aria-hidden="true" /></button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <button type="button" onClick={startQuote} className="btn btn-primary w-full h-14 text-lg" data-card-new-quote>
            <FilePlus2 size={22} aria-hidden="true" /> New quote
          </button>
          <div className="grid grid-cols-4 gap-2">
            <a href={phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined} className={`${action} ${phone ? '' : off}`} data-card-call><Phone size={20} aria-hidden="true" />Call</a>
            <a href={phone ? smsLink(phone, '') : undefined} className={`${action} ${phone ? '' : off}`} data-card-text><MessageSquare size={20} aria-hidden="true" />Text</a>
            <a href={address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : undefined} target="_blank" rel="noreferrer" className={`${action} ${address ? '' : off}`} data-card-navigate><Navigation size={20} aria-hidden="true" />Navigate</a>
            <button type="button" onClick={onBook} className={`${action} text-center leading-tight`} data-card-book-appt><CalendarPlus size={20} aria-hidden="true" />Book appointment</button>
          </div>

          <AutomationRunLog entityId={lead.id} />

          <section className="bg-white rounded-2xl border border-gray-200" data-card-quotes>
            <h3 className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-900">Quotes</h3>
            {quotes.length === 0 ? (
              <p className="px-4 pb-3 text-sm text-gray-600">No quotes yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {quotes.map(q => (
                  <li key={q.id}>
                    <button type="button" onClick={() => onOpenQuote(q)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 min-h-[56px]" data-card-quote={q.id}>
                      <span className={`chip ${STATUS[q.status] ?? STATUS.DRAFT}`}>{cap(q.status)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-gray-900 tabular-nums">{fmtUSD(q.finalPrice || 0)}</span>
                        <span className="block text-xs text-gray-600 truncate">{[q.fenceStyle, q.date ? fmtDate(q.date) : ''].filter(Boolean).join(' · ')}</span>
                      </span>
                      <SaveStatus keys={[`quote:${q.id}`]} quietWhenSaved />
                      <ChevronRight size={18} className="text-gray-400 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-card-next-appt>
            <h3 className="text-sm font-semibold text-gray-900">Next appointment</h3>
            {next ? (
              <p className="text-sm text-gray-800 mt-1">{shortWhen(next)}{next.type ? ` · ${String(next.type).replace(/_/g, ' ')}` : ''}{next.address ? <span className="block text-xs text-gray-600 truncate">{next.address}</span> : null}</p>
            ) : (
              <p className="text-sm text-gray-600 mt-1">None booked. <button type="button" className="text-orange-700 font-semibold underline" onClick={onBook}>Book one</button></p>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-card-notes>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
              {lead.customerId && !adding && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAdding(true)} data-card-add-note>Add note</button>}
            </div>
            {adding && (
              <div className="mt-2">
                <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder="Type a note"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-400" data-card-note-text />
                <div className="flex justify-end gap-2 mt-2">
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setAdding(false); setDraft('') }}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!draft.trim() || saving} onClick={addNote} data-card-note-save>{saving ? 'Saving…' : 'Save note'}</button>
                </div>
              </div>
            )}
            {!lead.customerId ? (
              <p className="text-sm text-gray-600 mt-1">{lead.notes || 'Notes are kept on the customer record. This lead has none yet.'}</p>
            ) : notes === null ? (
              <p className="text-sm text-gray-500 mt-1">Loading notes…</p>
            ) : lastNotes.length === 0 ? (
              <p className="text-sm text-gray-600 mt-1">No notes yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {lastNotes.map(n => (
                  <li key={n.id} className="text-sm text-gray-800" data-card-note>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="text-xs text-gray-500">{noteAuthor(n)} · {fmtDate(n.createdAt)}</p>
                    <SaveStatus keys={[`note:${n.id}`]} quietWhenSaved className="mt-1" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
            <label className="block">
              <span className="text-sm font-semibold text-gray-900">Stage</span>
              <select value={lead.stage} onChange={e => onMoveStage(e.target.value)} data-card-stage
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 h-12 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-400">
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </section>

          <div className="flex flex-wrap gap-2 justify-between">
            {onOpenCustomer && <button type="button" className="btn btn-quiet btn-sm" onClick={onOpenCustomer} data-card-open-customer><ExternalLink size={16} aria-hidden="true" /> Customer page</button>}
            <button type="button" className="btn btn-quiet btn-sm" onClick={onEditLead}>Edit lead details</button>
          </div>
        </div>
      </div>
    </div>
  )
}
