/**
 * Today, made for the phone: the next appointment as one big card with Call,
 * Navigate, Text "On my way", Start and Complete, then the rest of the day.
 *
 * Complete opens the outcome form. "Ready to quote" opens the quote builder
 * with the customer and property filled in; "Needs follow up" books the
 * follow up right there. Texts go from Jonathan's own phone (sms: links), so
 * no paid service is involved.
 */

import { useEffect, useMemo, useState } from 'react'
import { Phone, Navigation } from 'lucide-react'
import { getAppointments, updateAppointment, APPOINTMENTS_UPDATED } from './appointmentsStore'
import { getAppointmentSettings, getConfig } from './configStore'
import { getQuotesForCustomer } from './quoteStore'
import { uploadStaffPhotoForCustomer } from './portalApiClient'
import {
  TYPE_SHORT, TYPE_COLORS, STATUS_LABELS, OUTCOME_LABELS, floridaDate, isOpen, needsOutcome, statusForOutcome, defaultPerson,
  directionsUrl, onMyWayText, smsLink, driveMinutes, type Appointment, type AppointmentOutcome,
} from './appointmentLogic'
import { applyOutcome } from './appointmentPipeline'
import { openBooking } from './BookingDialog'
import { toast } from './toast'
import { useBackLayer } from './nav'
import TasksList from './TasksList'

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function useAppointmentList(): Appointment[] {
  const [list, setList] = useState(getAppointments())
  useEffect(() => {
    const h = () => setList(getAppointments())
    window.addEventListener(APPOINTMENTS_UPDATED, h)
    return () => window.removeEventListener(APPOINTMENTS_UPDATED, h)
  }, [])
  return list
}

/** Open the quote builder for a customer, with the property and what was measured. */
export function startQuote(a: Appointment) {
  window.dispatchEvent(new CustomEvent('ezbiz:new-quote', {
    detail: {
      customerId: a.crmContactId, address: a.address,
      notes: [a.measuredFeet ? `Measured on site: about ${a.measuredFeet} ft.` : '', a.outcomeNotes].filter(Boolean).join(' '),
    },
  }))
}

export default function TodayScreen() {
  const list = useAppointmentList()
  const settings = getAppointmentSettings()
  const [person, setPerson] = useState(defaultPerson(settings))
  const [closing, setClosing] = useState<Appointment | null>(null)
  const today = floridaDate(new Date())
  const todays = useMemo(() => list
    .filter(a => a.startAt && floridaDate(a.startAt) === today && a.status !== 'cancelled' && (!person || a.assignedTo === person))
    .sort((x, y) => x.startAt!.localeCompare(y.startAt!)), [list, today, person])
  const next = todays.find(a => isOpen(a))
  const overdue = list.filter(a => needsOutcome(a) && floridaDate(a.startAt!) < today && (!person || a.assignedTo === person))

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-24" data-today>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Today</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <select value={person} onChange={e => setPerson(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm">
          {settings.team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          <option value="">Everyone</option>
        </select>
      </div>

      {next ? <NextCard a={next} onComplete={() => setClosing(next)} /> : (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
          <p className="text-gray-600 font-semibold">{todays.length ? 'All done for today.' : 'Nothing booked today.'}</p>
          <button onClick={() => openBooking({ date: today })} className="mt-3 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold">+ Appointment</button>
        </div>
      )}

      <TasksList />

      {todays.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {todays.map(a => (
            <div key={a.id} className="px-4 py-3 flex gap-3">
              <span className="w-1.5 self-stretch rounded shrink-0" style={{ background: TYPE_COLORS[a.type] }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 tabular-nums whitespace-nowrap">{a.allDay ? 'All day' : fmtTime(a.startAt!)}</span>
                  <span className="text-sm text-gray-600 truncate">{TYPE_SHORT[a.type]} · {a.outcome ? OUTCOME_LABELS[a.outcome] : STATUS_LABELS[a.status]}</span>
                  <span className="ml-auto flex gap-1.5 shrink-0">
                    {a.customerPhone && <a href={`tel:${a.customerPhone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${a.customerName}`} className="btn btn-secondary btn-icon"><Phone size={18} aria-hidden="true" /></a>}
                    <a href={directionsUrl(a)} target="_blank" rel="noreferrer" aria-label={`Navigate to ${a.customerName}`} className="btn btn-secondary btn-icon"><Navigation size={18} aria-hidden="true" /></a>
                  </span>
                </div>
                <button onClick={() => (isOpen(a) ? setClosing(a) : openBooking({ appointmentId: a.id }))} className="block w-full text-left mt-1">
                  <span className="block text-[15px] font-semibold text-gray-900">{a.customerName}</span>
                  <span className="block text-sm text-gray-600">{a.address || 'No address'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-red-700">Needs outcome ({overdue.length})</p>
          <div className="mt-2 space-y-1">
            {overdue.slice(0, 8).map(a => (
              <button key={a.id} onClick={() => setClosing(a)} className="w-full text-left text-sm text-red-800">
                {new Date(a.startAt!).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })} · {a.customerName} · {TYPE_SHORT[a.type]}
              </button>
            ))}
          </div>
        </div>
      )}

      {closing && <OutcomeForm a={closing} onClose={() => setClosing(null)} />}
    </div>
  )
}

function NextCard({ a, onComplete }: { a: Appointment; onComplete: () => void }) {
  const company = getConfig().company
  const settings = getAppointmentSettings()
  const [eta, setEta] = useState(20)
  const quote = getQuotesForCustomer(a.crmContactId).filter(q => q.status !== 'LOST').sort((x, y) => (y.date || '').localeCompare(x.date || ''))[0]

  // Minutes away, from where the phone is (asked once; editable before sending).
  useEffect(() => {
    if (a.lat == null || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(p => setEta(driveMinutes({ lat: p.coords.latitude, lng: p.coords.longitude }, { lat: a.lat!, lng: a.lng! }, settings)), () => {}, { maximumAge: 300_000, timeout: 8000 })
  }, [a.id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function onMyWay() {
    if (a.status !== 'on_my_way') await updateAppointment(a.id, { status: 'on_my_way' })
  }
  async function start() {
    if (await updateAppointment(a.id, { startedAt: new Date().toISOString() })) toast.success('Started', a.customerName)
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-orange-400 shadow-sm p-5 space-y-3" data-next-appointment>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: TYPE_COLORS[a.type] }}>{TYPE_SHORT[a.type]}</span>
        <span className="text-lg font-bold text-gray-900">{a.allDay ? 'All day' : fmtTime(a.startAt!)}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-tight" data-next-name>{a.customerName}</p>
        <p className="text-sm text-gray-600 mt-1">{a.address || 'No address'}</p>
        {quote && <p className="text-sm text-emerald-700 font-semibold mt-1">Quote {money(quote.finalPrice || 0)} ({quote.status.toLowerCase()})</p>}
        {a.notes && <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap">{a.notes}</p>}
        <p className="text-xs text-gray-400 mt-1">{STATUS_LABELS[a.status]}{a.startedAt ? ` · started ${fmtTime(a.startedAt)}` : ''}{a.assignedTo ? ` · ${a.assignedTo}` : ''}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a href={a.customerPhone ? `tel:${a.customerPhone.replace(/[^\d+]/g, '')}` : undefined} className={`py-3 rounded-xl text-center font-semibold ${a.customerPhone ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>📞 Call</a>
        <a href={directionsUrl(a)} target="_blank" rel="noreferrer" className="py-3 rounded-xl text-center font-semibold bg-blue-600 text-white">🧭 Navigate</a>
      </div>
      <div className="flex items-center gap-2">
        <a href={a.customerPhone ? smsLink(a.customerPhone, onMyWayText(a.customerName, eta, company, a.assignedTo)) : undefined} onClick={onMyWay}
          className={`flex-1 py-3 rounded-xl text-center font-semibold ${a.customerPhone ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-400'}`} data-on-my-way>💬 Text "On my way"</a>
        <label className="text-xs text-gray-500 flex items-center gap-1"><input type="number" min={1} max={180} value={eta} onChange={e => setEta(Number(e.target.value) || 1)} className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900" />min</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={start} className="py-3 rounded-xl font-semibold border border-gray-200 text-gray-700">▶ Start</button>
        <button onClick={onComplete} className="py-3 rounded-xl font-semibold bg-orange-500 text-white" data-complete>✓ Complete</button>
      </div>
    </div>
  )
}

const OUTCOME_CHOICES: AppointmentOutcome[] = ['ready_to_quote', 'needs_follow_up', 'not_interested', 'no_show']

/** What happened. Closes the appointment and moves the pipeline card when it should. */
export function OutcomeForm({ a, onClose }: { a: Appointment; onClose: () => void }) {
  useBackLayer(onClose, { key: 'outcome-form' })
  const [outcome, setOutcome] = useState<AppointmentOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [feet, setFeet] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!outcome) return
    setSaving(true)
    const saved = await updateAppointment(a.id, {
      status: statusForOutcome(outcome), outcome, outcomeNotes: notes, nextStep,
      measuredFeet: feet ? Math.round(Number(feet)) : null,
    })
    if (!saved) { setSaving(false); return }
    let up = 0
    for (const f of files) { const r = await uploadStaffPhotoForCustomer(a.crmContactId, f, `${OUTCOME_LABELS[outcome]} visit`, a.assignedTo); if (r.ok) up++ }
    if (files.length) toast.info('Photos', `${up} of ${files.length} uploaded to the customer's Photos.`)
    applyOutcome(saved, outcome)
    setSaving(false)
    onClose()
    if (outcome === 'ready_to_quote') startQuote(saved)
    if (outcome === 'needs_follow_up' && window.confirm('Book the follow up now?')) openBooking({ customerId: a.crmContactId, type: 'follow_up' })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto" data-outcome-form>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">How did it go? <span className="font-normal text-gray-500">{a.customerName}</span></h2>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 text-xl px-2">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {OUTCOME_CHOICES.map(o => (
            <button key={o} onClick={() => setOutcome(o)} data-outcome={o}
              className={`py-3 rounded-xl text-sm font-semibold border ${outcome === o ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-700'}`}>
              {OUTCOME_LABELS[o]}
            </button>
          ))}
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-gray-500">Measured footage
            <input inputMode="numeric" value={feet} onChange={e => setFeet(e.target.value.replace(/[^\d.]/g, ''))} placeholder="ft" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" data-feet />
          </label>
          <label className="text-xs font-semibold text-gray-500">Photos
            <input type="file" accept="image/*" multiple capture="environment" onChange={e => setFiles(Array.from(e.target.files || []))} className="mt-1 w-full text-xs" />
          </label>
        </div>
        <input value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="Next step" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={save} disabled={!outcome || saving} data-save-outcome className="w-full py-3 rounded-xl bg-orange-500 disabled:opacity-40 text-white font-bold">
          {saving ? 'Saving…' : outcome === 'ready_to_quote' ? 'Save and start the quote' : 'Save'}
        </button>
      </div>
    </div>
  )
}
