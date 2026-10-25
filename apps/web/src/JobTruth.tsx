/**
 * The parts of the job page (OperationsPage DetailPanel) that read the job's
 * one record for each thing (walkthrough round 1, Oct 25 2026):
 *
 *   CustomerContact   the phone, "(352) 671 8083", tap to call or text
 *   LocatePanel       the 811 locate: ticket, called in, good to dig, expires,
 *                     the status worked out from the dates, warnings against
 *                     the install days; the crew packet edits the same record
 *   JobMilestones     the Milestone Checklist from the records; a hand tick
 *                     shows "ticked by hand"
 *   JobFinancial      contract, paid, balance and the payment status from the
 *                     payment schedule (the same as Payments and Billing)
 *   OpenCustomerProfile  the customer's page, as on the Sales Pipeline card
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { ExternalLink, MessageSquare, Phone } from 'lucide-react'
import { formatPhone, telHref } from './phoneFormat'
import { smsLink } from './appointmentLogic'
import { navigate } from './nav'
import { can } from './permissions'
import { toast } from './toast'
import { businessDate } from './businessDate'
import { saveJobLocate, type Job } from './jobStore'
import { useJobMilestones, tickMilestone, milestonesChanged } from './jobTruthApi'
import { scheduleOf, subscribe, paymentsVersion, loadJob, money } from './paymentsStore'
import { locateOf, locateWords, locateWarnings, LOCATE_STATUS_WORDS } from '../../portal/src/server/lib/locates'
import { billingStatusOf } from '../../portal/src/server/lib/jobReadiness'
import { startTouch } from './followUpStore'
import { getPipeline } from './pipelineStore'
import { getCustomerById } from './customerStore'

/* ── The customer's phone ───────────────────────────────────────────────── */

/** "(352) 671 8083" with Call and Text; a call starts the "How'd it go?" follow up when the customer has a card. */
export function CustomerContact({ job }: { job: Job }) {
  const phone = job.customerPhone
  if (!phone) return null
  const touch = (channel: 'call' | 'text') => {
    const lead = (getPipeline().leads || []).find((l: any) => (job.customerId && l.customerId === job.customerId) || (job.quoteId && l.quoteId === job.quoteId))
    if (lead) startTouch({ cardId: lead.id, customerId: lead.customerId ?? job.customerId ?? null, name: job.customerName, firstName: lead.firstName, phone, stage: lead.stage, channel })
  }
  return (
    <div className="flex items-center justify-between gap-2 text-sm" data-job-phone>
      <span className="text-gray-500">Phone</span>
      <span className="flex items-center gap-1">
        <a href={telHref(phone)} onClick={() => touch('call')} className="inline-flex items-center gap-1 min-h-[44px] px-2 font-semibold text-blue-700 hover:underline whitespace-nowrap" aria-label={`Call ${formatPhone(phone)}`} data-job-call>
          <Phone size={16} aria-hidden="true" />{formatPhone(phone)}
        </a>
        <a href={smsLink(phone, '')} onClick={() => touch('text')} className="inline-flex items-center gap-1 min-h-[44px] px-2 rounded-lg border border-gray-200 text-gray-800 hover:bg-gray-50" aria-label={`Text ${formatPhone(phone)}`} data-job-text>
          <MessageSquare size={16} aria-hidden="true" />Text
        </a>
      </span>
    </div>
  )
}

/* ── The 811 locate ─────────────────────────────────────────────────────── */

const TONE: Record<string, string> = {
  clear: 'bg-green-50 text-green-800 border-green-200',
  called: 'bg-amber-50 text-amber-900 border-amber-200',
  not_called: 'bg-gray-100 text-gray-700 border-gray-200',
  expired: 'bg-red-50 text-red-800 border-red-200',
}

/** The install's first and last crew day, from the job (the Schedule install window keeps both). */
function installSpan(job: Job): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.scheduledDate || '')) return null
  return { start: job.scheduledDate, end: /^\d{4}-\d{2}-\d{2}$/.test(job.scheduledEndDate || '') ? job.scheduledEndDate! : job.scheduledDate }
}

/** The 811 warnings for a job's install days ([] when it is not scheduled, or nothing is wrong). */
export function jobLocateWarnings(job: Job): string[] {
  const span = installSpan(job)
  return span ? locateWarnings(locateOf(job), span.start, span.end).map(w => w.text) : []
}

export function LocatePanel({ job }: { job: Job }) {
  const today = businessDate(new Date())
  const rec = locateOf(job)
  const words = locateWords(rec, today)
  const warnings = jobLocateWarnings(job)
  const canEdit = can('schedule.change')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ ticket: rec.ticket ?? '', calledDate: rec.calledDate ?? '', goodDate: rec.goodDate ?? '', expDate: rec.expDate ?? '' })
  const [saving, setSaving] = useState(false)
  // Saved elsewhere (the crew packet, another phone): the form starts from the record again.
  useEffect(() => { if (!editing) setForm({ ticket: rec.ticket ?? '', calledDate: rec.calledDate ?? '', goodDate: rec.goodDate ?? '', expDate: rec.expDate ?? '' }) }, [rec.ticket, rec.calledDate, rec.goodDate, rec.expDate, editing])
  async function save() {
    setSaving(true)
    const r = await saveJobLocate(job.id, form)
    setSaving(false)
    if (!r.ok) { toast.error('Locate not saved', r.error); return }
    setEditing(false)
    milestonesChanged()
    toast.success('811 locate saved', locateWords(locateOf(r.job), today).text)
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const field = 'mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[48px] bg-white'
  return (
    <div className="space-y-2" data-job-locate={words.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs font-semibold border rounded-full px-2 py-1 ${TONE[words.status]}`} data-locate-status={words.status}>{LOCATE_STATUS_WORDS[words.status]}</span>
        <span className="text-sm text-gray-800" data-locate-text>{words.text}</span>
      </div>
      {!editing && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-gray-500">Ticket</dt><dd className="font-medium text-gray-900" data-locate-ticket>{rec.ticket || '—'}</dd>
          <dt className="text-gray-500">Called in</dt><dd className="font-medium text-gray-900">{rec.calledDate ? usDay(rec.calledDate) : '—'}</dd>
          <dt className="text-gray-500">Good to dig</dt><dd className="font-medium text-gray-900" data-locate-good>{rec.goodDate ? usDay(rec.goodDate) : '—'}</dd>
          <dt className="text-gray-500">Expires</dt><dd className="font-medium text-gray-900" data-locate-exp>{rec.expDate ? usDay(rec.expDate) : '—'}</dd>
        </dl>
      )}
      {warnings.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 list-disc pl-6 space-y-0.5" data-locate-warnings>
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {job.locateUpdatedBy && !editing && <p className="text-[11px] text-gray-500">Last saved by {job.locateUpdatedBy}{job.locateUpdatedAt ? `, ${new Date(job.locateUpdatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}. The crew packet shows and edits the same locate.</p>}
      {editing ? (
        <div className="space-y-2 rounded-xl border border-gray-200 p-3" data-locate-form>
          <label className="block text-xs font-semibold text-gray-600">Ticket number
            <input className={field} inputMode="numeric" autoComplete="off" maxLength={40} value={form.ticket} onChange={set('ticket')} data-locate-input="ticket" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold text-gray-600">Called in<input type="date" className={field} value={form.calledDate} onChange={set('calledDate')} data-locate-input="called" /></label>
            <label className="block text-xs font-semibold text-gray-600">Good to dig<input type="date" className={field} value={form.goodDate} onChange={set('goodDate')} data-locate-input="good" /></label>
          </div>
          <label className="block text-xs font-semibold text-gray-600">Expires (the date on the ticket)
            <input type="date" className={field} value={form.expDate} onChange={set('expDate')} data-locate-input="exp" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1 min-h-[48px]" disabled={saving} onClick={save} data-locate-save>{saving ? 'Saving…' : 'Save locate'}</button>
            <button type="button" className="btn btn-secondary min-h-[48px]" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : canEdit ? (
        <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setEditing(true)} data-locate-edit>{rec.ticket || rec.goodDate ? 'Change the locate' : 'Add the 811 ticket'}</button>
      ) : null}
    </div>
  )
}

const usDay = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`

/* ── Milestones ─────────────────────────────────────────────────────────── */

export function JobMilestones({ job }: { job: Job }) {
  // Reloaded when the job changes (a locate, a stage, a schedule) or anything fires the milestones event.
  const { data, error, setData } = useJobMilestones(job.id, `${job.updatedAt}|${job.locateUpdatedAt ?? ''}`)
  const [busy, setBusy] = useState<string | null>(null)
  const canTick = can('schedule.change')
  if (!data) return <p className="text-xs text-gray-500" data-milestones-loading>{error || 'Loading milestones…'}</p>
  const pct = data.total ? (data.complete / data.total) * 100 : 0
  async function toggle(label: string, ticked: boolean) {
    setBusy(label)
    const r = await tickMilestone(job.id, label, ticked)
    setBusy(null)
    if (!r.ok) { toast.error('Not saved', r.error); return }
    setData(r.data)
  }
  return (
    <div className="space-y-1.5" data-milestones>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500" data-milestones-count={`${data.complete}/${data.total}`}>{data.complete} of {data.total} complete</span>
        <div className="flex-1 mx-3 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-1.5 bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
        <span className="text-gray-500">{Math.round(pct)}%</span>
      </div>
      {data.milestones.map(m => {
        const handOk = canTick && m.byHand && m.by !== 'data'
        return (
          <div key={m.label} className={`flex items-start gap-3 px-2 py-2 min-h-[48px] rounded-lg ${m.done ? 'bg-green-50' : ''}`} data-milestone={m.key ?? m.label} data-milestone-done={m.done ? 'yes' : 'no'} data-milestone-by={m.by}>
            {handOk ? (
              <input type="checkbox" className="w-6 h-6 mt-0.5 accent-orange-500 cursor-pointer shrink-0" checked={m.done} disabled={busy === m.label}
                onChange={() => toggle(m.label, !m.done)} aria-label={`${m.label}: tick by hand`} data-milestone-tick />
            ) : (
              <span className={`w-6 h-6 mt-0.5 rounded-full shrink-0 grid place-items-center text-xs font-bold ${m.done ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'}`} aria-hidden="true">{m.done ? '✓' : ''}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className={`block text-sm ${m.done ? 'text-gray-900 font-medium' : 'text-gray-700'}`}>{m.label}</span>
              <span className="block text-xs text-gray-500" data-milestone-detail>
                {m.by === 'hand'
                  ? `Ticked by hand${m.tickedBy ? ` by ${m.tickedBy}` : ''}${m.tickedAt ? `, ${new Date(m.tickedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}${m.key ? ` · the job says: ${m.detail}` : ''}`
                  : m.detail}
              </span>
              {!m.done && !m.byHand && m.key && <span className="block text-[11px] text-gray-400">{m.key === 'locate' ? 'Follows the 811 locate above.' : m.key === 'permit' ? 'Follows the Permit section.' : 'Follows Schedule install.'}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Money ──────────────────────────────────────────────────────────────── */

/** Contract, paid, balance and the payment status: from the payment schedule (Payments below shows the same). */
export function JobFinancial({ job }: { job: Job }) {
  useSyncExternalStore(subscribe, paymentsVersion, paymentsVersion)
  useEffect(() => { void loadJob(job.id) }, [job.id, job.updatedAt])
  const s = scheduleOf(job.id)
  const status = billingStatusOf(s ? { contractCents: s.contractCents, paidCents: s.paidCents, completedDate: s.completedDate, invoices: s.invoices } : null)
  const contractCents = s ? s.contractCents : Math.round((job.contractValue || 0) * 100)
  const paidCents = s ? s.paidCents : Math.round((job.amountPaid || 0) * 100)
  const row = (k: string, v: string, attr?: string) => (
    <div className="flex justify-between text-sm" {...(attr ? { [attr]: '' } : {})}><span className="text-gray-500">{k}</span><span className="font-medium text-gray-900">{v}</span></div>
  )
  return (
    <div className="space-y-1.5" data-job-financial={status.state}>
      {row('Contract Value', money(contractCents))}
      {row('Amount Paid', money(paidCents))}
      {row('Outstanding', money(contractCents - paidCents))}
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-gray-500">Payment Status</span>
        <span className={`font-semibold text-right ${status.state === 'paid' ? 'text-green-700' : status.state === 'deposit_due' || status.state === 'due' ? 'text-orange-700' : 'text-gray-900'}`} data-job-payment-status>
          {s ? status.text : 'No signed contract with a payment schedule yet'}
        </span>
      </div>
    </div>
  )
}

/* ── The customer's page ────────────────────────────────────────────────── */

export function OpenCustomerProfile({ job }: { job: Job }) {
  const id = job.customerId
  if (!id || !getCustomerById(id)) return null
  return (
    <button type="button" className="btn btn-secondary w-full min-h-[48px]" data-job-open-customer
      onClick={() => navigate(`/customers/${encodeURIComponent(id)}`, { from: 'Operations' })}>
      <ExternalLink size={16} aria-hidden="true" /> Open customer profile
    </button>
  )
}
