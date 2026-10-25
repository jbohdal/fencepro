/**
 * The window a pipeline card opens: everything to act on the deal without
 * leaving the board. Same layout on a phone (full screen) and a computer (a
 * window over the board):
 *
 *   A website or phone lead's possible match (PossibleMatch.tsx)
 *   New quote (filled in with this customer)
 *   Call · Text · Navigate · Book appointment
 *   The customer's quotes (status, price, date; tap to open)
 *   Next appointment
 *   Follow up: the next one (one tap to change it), Log a call, text templates
 *   The last few notes, and Add note
 *   History: calls with answers, texts, emails, quotes sent, proposal opens,
 *   appointments and notes, newest first
 *   Stage picker to move the card
 *
 * Call, Text and the phone number also start "How'd it go?" for when the
 * salesman comes back to the app (FollowUpPrompt).
 *
 * Its address is ?card=<lead id>, so Back closes it and a reload reopens it.
 */

import { stageName } from './pipelineStagesStore'
import { styleLabel } from './fenceCatalog'
import { formatPhone, telHref } from './phoneFormat'
import { useCallback, useEffect, useState } from 'react'
import { Phone, MessageSquare, Navigation, CalendarPlus, FilePlus2, ChevronRight, X, ExternalLink } from 'lucide-react'
import type { PipelineLead } from './JobsPage'
import type { SavedQuote } from './QuotesPage'
import type { Appointment } from './appointmentLogic'
import { shortWhen, smsLink } from './appointmentLogic'
import { getCustomerById } from './customerStore'
import { listContactNotes, createContactNote, noteChangeFor, type CrmContactNoteRecord, noteAuthor } from './crmContactsApi'
import { subscribe, pendingFor } from './outbox'
import { useBackLayer, navigate } from './nav'
import PossibleMatch from './PossibleMatch'
import { SaveStatus, cardChange } from './SaveStatus'
import AutomationRunLog from './AutomationRunLog'
import { sendJson } from './syncHttp'
import { useFollowUpBoard, followUpOf, changeNext, startTouch, openLogCall, pendingCalls, CHANGED_EVENT, badgeOf, openedOf } from './followUpStore'
import { openedBadgeText } from './proposalOpened'
import { OUTCOME_LABEL, LOST_REASON_LABEL } from './followUpRules'
import { DateChips, TextTemplatesSheet, dayLabel, kindWord } from './FollowUpPrompt'
import PaymentsPanel from './Payments'
import { ChangeOrderButton, isSignedForChange } from './ChangeOrders'
import { PastCustomerBadge, ServiceRequestButton, ServiceTicketList } from './ServiceRequests'
import { getJobByQuoteId, type Job } from './jobStore'
import { ScheduleInstallButton, bookedWords } from './ScheduleInstall'
import { loadSchedule } from './scheduleStore'
import { can } from './permissions'

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

  // The jobs of this customer's sold quotes (made when a quote is marked Sold), kept current.
  const [, setJobTick] = useState(0)
  useEffect(() => {
    const on = () => setJobTick(t => t + 1)
    window.addEventListener('fencepro:jobs:updated', on)
    return () => window.removeEventListener('fencepro:jobs:updated', on)
  }, [])
  const soldJobs = quotes.filter(q => q.status === 'SOLD').map(q => getJobByQuoteId(q.id)).filter((j): j is Job => !!j)

  // Follow up: as the server has it, with this phone's answers on top.
  useFollowUpBoard()
  const follow = followUpOf(lead.id)
  const badge = badgeOf(lead)
  const opened = openedBadgeText(openedOf(lead.id))
  const [texting, setTexting] = useState(false)
  const touch = { cardId: lead.id, customerId: lead.customerId ?? null, name, firstName: lead.firstName, phone, stage: lead.stage }
  const startCall = () => { if (phone) startTouch({ ...touch, channel: 'call' }) }
  const startText = () => { if (phone) startTouch({ ...touch, channel: 'text' }) }

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
            <p className="text-sm text-gray-600 truncate">{[stageName(lead.stage), address].filter(Boolean).join(' · ')}</p>
            {phone && <a href={telHref(phone)} onClick={startCall} className="flex w-fit items-center text-sm font-medium text-blue-600 hover:underline" data-card-window-phone>{formatPhone(phone)}</a>}
            <div className="mt-1 empty:hidden"><PastCustomerBadge customerId={lead.customerId} /></div>
            <SaveStatus keys={lead.customerId ? [`customer:${lead.customerId}`] : []} also={op => cardChange(lead.id)(op) || (!!lead.customerId && noteChangeFor(lead.customerId)(op))} className="mt-1" />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-quiet btn-icon shrink-0"><X size={22} aria-hidden="true" /></button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {/* A website or phone lead's possible match: Merge (the card goes with it) or Not the same person. */}
          <div className="empty:hidden"><PossibleMatch customerId={lead.customerId} onOpenCustomer={id => navigate(`/customers/${encodeURIComponent(id)}`)} /></div>
          <button type="button" onClick={startQuote} className="btn btn-primary w-full h-14 text-lg" data-card-new-quote>
            <FilePlus2 size={22} aria-hidden="true" /> New quote
          </button>
          {lead.customerId && <div className="space-y-2 empty:hidden" data-card-service><ServiceRequestButton customerId={lead.customerId} /><ServiceTicketList customerId={lead.customerId} /></div>}
          <div className="grid grid-cols-4 gap-2">
            <a href={phone ? telHref(phone) : undefined} onClick={startCall} className={`${action} ${phone ? '' : off}`} data-card-call><Phone size={20} aria-hidden="true" />Call</a>
            <a href={phone ? smsLink(phone, '') : undefined} onClick={startText} className={`${action} ${phone ? '' : off}`} data-card-text><MessageSquare size={20} aria-hidden="true" />Text</a>
            <a href={address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : undefined} target="_blank" rel="noreferrer" className={`${action} ${address ? '' : off}`} data-card-navigate><Navigation size={20} aria-hidden="true" />Navigate</a>
            <button type="button" onClick={onBook} className={`${action} text-center leading-tight`} data-card-book-appt><CalendarPlus size={20} aria-hidden="true" />Book appointment</button>
          </div>

          <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3 space-y-2" data-card-follow-up-section>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Follow up</h3>
              {badge && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.tone === 'red' ? 'bg-red-100 text-red-700' : badge.tone === 'orange' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'}`} data-card-window-badge>{badge.text}</span>}
            </div>
            {follow?.state?.stoppedReason ? (
              <p className="text-sm text-gray-700">Stopped: {follow.state.stoppedReason === 'signed' ? 'signed' : 'lost'}.</p>
            ) : (
              <>
                <p className="text-sm text-gray-800" data-card-next-follow-up={follow?.dueOn ?? ''}>
                  Next: <b>{dayLabel(follow?.dueOn)}</b>{follow?.dueOn ? ` · ${kindWord(follow.dueKind)}` : ''}
                  {follow?.dueOn && follow.stepCount > 0 && follow.dueKind !== 'decide' && follow.state?.setBy === 'steps' ? <span className="text-gray-500"> (step {Math.min(follow.stepIndex + 1, follow.stepCount)} of {follow.stepCount})</span> : null}
                </p>
                {follow?.lastOutcome && <p className="text-xs text-gray-600">Last: {OUTCOME_LABEL[follow.lastOutcome]}{follow.lastContactAt ? `, ${fmtDate(follow.lastContactAt)}` : ''}</p>}
                {follow?.dueKind === 'decide' && (
                  <div className="flex gap-2" data-going-cold>
                    <button type="button" className="btn btn-secondary flex-1" onClick={() => changeNext(lead.id, name, { keep: true })} data-keep>Keep: start the steps again</button>
                    <button type="button" className="btn btn-quiet flex-1 text-red-700" onClick={() => openLogCall({ ...touch, channel: 'call' })} data-close-lost>Close it</button>
                  </div>
                )}
                <DateChips value={follow?.dueOn ?? null} onPick={d => changeNext(lead.id, name, { dueOn: d })} />
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => openLogCall({ ...touch, channel: 'call' })} data-card-log-call>Log a call</button>
              <button type="button" className="btn btn-secondary" disabled={!phone} onClick={() => setTexting(true)} data-card-text-templates><MessageSquare size={16} aria-hidden="true" /> Text templates</button>
            </div>
          </section>
          {texting && <TextTemplatesSheet card={{ cardId: lead.id, customerId: lead.customerId ?? null, name, firstName: lead.firstName, phone }} onClose={() => setTexting(false)} />}

          <AutomationRunLog entityId={lead.id} />

          <section className="bg-white rounded-2xl border border-gray-200" data-card-quotes>
            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Quotes</h3>
              {opened && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${opened === 'Not opened yet' ? 'bg-gray-100 text-gray-600' : 'bg-purple-100 text-purple-800'}`} data-card-window-opened={opened}>{opened}</span>}
            </div>
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
                        <span className="block text-xs text-gray-600 truncate">{[styleLabel(q.fenceStyle), q.date ? fmtDate(q.date) : ''].filter(Boolean).join(' · ')}</span>
                      </span>
                      <SaveStatus keys={[`quote:${q.id}`]} quietWhenSaved />
                      <ChevronRight size={18} className="text-gray-400 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {/* A change order on a signed quote: the yard drawing or typed lines (ChangeOrders.tsx). */}
            {quotes.filter(isSignedForChange).map(q => (
              <div key={`co-${q.id}`} className="px-4 pb-3" data-card-change-order>
                <ChangeOrderButton quoteId={q.id} customerName={name} className="btn btn-secondary w-full" label={quotes.filter(isSignedForChange).length > 1 ? `Change order (${fmtUSD(q.finalPrice || 0)} quote)` : 'Change order'} />
              </div>
            ))}
          </section>

          {/* The install of a sold deal: its date, or Schedule install (ScheduleInstall.tsx). */}
          {soldJobs.length > 0 && (
            <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3 space-y-2" data-card-install>
              <h3 className="text-sm font-semibold text-gray-900">Install</h3>
              {soldJobs.map(j => (
                <div key={j.id} className="space-y-2" data-card-install-job={j.id}>
                  <p className="text-sm text-gray-800">
                    {j.scheduledDate ? <>Scheduled: <span className="font-semibold">{bookedWords(j.scheduledDate, j.scheduledEndDate, loadSchedule().settings.workDays)}</span>{j.crewAssigned ? `, ${j.crewAssigned}` : ''}</> : 'Not scheduled yet.'}
                    {soldJobs.length > 1 && <span className="block text-xs text-gray-600">{styleLabel(j.fenceStyle)}</span>}
                  </p>
                  {can('schedule.change') && <ScheduleInstallButton jobId={j.id} scheduledDate={j.scheduledDate} />}
                </div>
              ))}
            </section>
          )}

          {/* Payments on a sold deal: the schedule and "Payment received" (Payments.tsx). */}
          {lead.customerId && quotes.some(q => q.status === 'SOLD') && (
            <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-card-payments>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Payments</h3>
              <PaymentsPanel customerId={lead.customerId} compact />
            </section>
          )}

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

          <CardHistory cardId={lead.id} customerId={lead.customerId ?? null} notesShown={notes?.length ?? 0} />

          <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3">
            <label className="block">
              <span className="text-sm font-semibold text-gray-900">Stage</span>
              <select value={lead.stage} onChange={e => onMoveStage(e.target.value)} data-card-stage
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 h-12 text-base bg-white focus:outline-none focus:ring-2 focus:ring-orange-400">
                {(stages.includes(lead.stage) ? stages : [lead.stage, ...stages]).map(s => <option key={s} value={s}>{stageName(s)}</option>)}
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

interface HistoryItem { at: string; kind: string; title: string; detail: string; by: string; saving?: boolean }
const KIND_DOT: Record<string, string> = { call: 'bg-green-500', text: 'bg-blue-500', email: 'bg-indigo-500', quote: 'bg-purple-500', proposal_opened: 'bg-amber-500', proposal_staff: 'bg-gray-300', appointment: 'bg-cyan-600', note: 'bg-gray-400' }

/** One history for the customer, newest first: calls with answers, texts, emails, quotes sent, proposal opens, appointments, notes. */
function CardHistory({ cardId, customerId, notesShown }: { cardId: string; customerId: string | null; notesShown: number }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [all, setAll] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    const q = new URLSearchParams({ cardId, ...(customerId ? { customerId } : {}) })
    sendJson('GET', `/api/follow-ups/history?${q}`).then(r => { if (live && r.result.ok) setItems(r.json.data ?? []) ; else if (live && items === null) setItems([]) })
    return () => { live = false }
  }, [cardId, customerId, n, notesShown])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => setN(x => x + 1)
    window.addEventListener(CHANGED_EVENT, h)
    return () => window.removeEventListener(CHANGED_EVENT, h)
  }, [])
  // Answers still on their way (no signal): on top, "Saving…".
  useFollowUpBoard()
  const waiting: HistoryItem[] = pendingCalls(cardId, customerId).map(c => ({
    at: c.at, kind: c.channel === 'text' ? 'text' : 'call', saving: true, by: '',
    title: `${c.channel === 'text' ? 'Text' : 'Call'}: ${OUTCOME_LABEL[c.outcome]}${c.outcome === 'lost' && c.lostReason ? ` (${LOST_REASON_LABEL[c.lostReason].toLowerCase()})` : ''}`,
    detail: c.note,
  }))
  const list = [...waiting, ...(items ?? [])].sort((a, b) => b.at.localeCompare(a.at))
  const shown = all ? list : list.slice(0, 8)
  return (
    <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-card-history>
      <h3 className="text-sm font-semibold text-gray-900">History</h3>
      {items === null && !waiting.length ? <p className="text-sm text-gray-500 mt-1">Loading…</p>
        : list.length === 0 ? <p className="text-sm text-gray-600 mt-1">Nothing yet.</p>
        : (
          <ol className="mt-2 space-y-2">
            {shown.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex gap-2" data-history-item={h.kind}>
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${KIND_DOT[h.kind] ?? 'bg-gray-400'}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900">{h.title}</span>
                  {h.detail && <span className="block text-sm text-gray-700 whitespace-pre-wrap">{h.detail}</span>}
                  <span className="block text-xs text-gray-500">{new Date(h.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.by ? ` · ${h.by}` : ''}{h.saving ? ' · Saving…' : ''}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      {list.length > 8 && <button type="button" className="btn btn-quiet btn-sm mt-2" onClick={() => setAll(a => !a)}>{all ? 'Show less' : `Show all ${list.length}`}</button>}
    </section>
  )
}
