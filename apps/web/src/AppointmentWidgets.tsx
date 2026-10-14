/**
 * Small appointment pieces used around the app: the customer's Appointments
 * tab and next-appointment badge, the dashboard's Today and Needs outcome
 * cards, and the Appointments tab in Settings.
 */

import { useState } from 'react'
import { getConfig, saveConfig, getAppointmentSettings } from './configStore'
import {
  APPOINTMENT_TYPES, TYPE_LABELS, TYPE_SHORT, TYPE_COLORS, STATUS_LABELS, OUTCOME_LABELS, floridaDate, isOpen, needsOutcome, nextFor,
  shortWhen, directionsUrl, withDefaults, type Appointment, type AppointmentSettings,
} from './appointmentLogic'
import { openBooking } from './BookingDialog'
import { useAppointmentList, OutcomeForm } from './TodayScreen'
import { toast } from './toast'

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

/* ── Customer page ───────────────────────────────────────────────────────── */

export function NextAppointmentBadge({ customerId }: { customerId: string }) {
  const list = useAppointmentList()
  const next = nextFor(customerId, list)
  if (!next) return null
  return (
    <button onClick={() => openBooking({ appointmentId: next.id })} data-next-badge
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: TYPE_COLORS[next.type] }}>
      📅 {TYPE_SHORT[next.type]} {shortWhen(next)}
    </button>
  )
}

export function CustomerAppointmentsTab({ customerId }: { customerId: string }) {
  const list = useAppointmentList().filter(a => a.crmContactId === customerId)
  const [closing, setClosing] = useState<Appointment | null>(null)
  const now = Date.now()
  const upcoming = list.filter(a => isOpen(a) && (!a.startAt || new Date(a.endAt || a.startAt).getTime() >= now)).sort((x, y) => (x.startAt || '9').localeCompare(y.startAt || '9'))
  const past = list.filter(a => !upcoming.includes(a)).sort((x, y) => (y.startAt || '').localeCompare(x.startAt || ''))
  const Row = ({ a }: { a: Appointment }) => (
    <div className="px-4 py-3 flex items-start gap-3" data-customer-appointment={a.id}>
      <span className="w-1.5 self-stretch rounded" style={{ background: TYPE_COLORS[a.type] }} />
      <button onClick={() => openBooking({ appointmentId: a.id })} className="flex-1 min-w-0 text-left">
        <span className="block text-sm font-semibold text-gray-900">{TYPE_SHORT[a.type]} · {a.startAt ? `${fmtDay(a.startAt)}${a.allDay ? '' : ` ${fmtTime(a.startAt)}`}` : 'No date yet'}</span>
        <span className="block text-xs text-gray-500">{a.address || 'No address'}{a.assignedTo ? ` · ${a.assignedTo}` : ''}</span>
        {(a.outcomeNotes || a.notes) && <span className="block text-xs text-gray-600 mt-0.5 line-clamp-2">{a.outcomeNotes || a.notes}</span>}
      </button>
      <span className="text-right shrink-0">
        <span className="block text-[11px] font-semibold text-gray-600">{STATUS_LABELS[a.status]}</span>
        {a.outcome && <span className="block text-[11px] text-gray-500">{OUTCOME_LABELS[a.outcome]}</span>}
        {needsOutcome(a) && <button onClick={() => setClosing(a)} className="mt-1 text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700">Needs outcome</button>}
      </span>
    </div>
  )
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">Appointments</h3>
        <button onClick={() => openBooking({ customerId })} className="text-sm px-3 py-1.5 rounded-lg bg-orange-500 text-white font-semibold">Book appointment</button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
        <p className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-50">Upcoming</p>
        {upcoming.length ? upcoming.map(a => <Row key={a.id} a={a} />) : <p className="px-4 py-3 text-sm text-gray-400">Nothing booked.</p>}
      </div>
      {past.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          <p className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-50">Past</p>
          {past.map(a => <Row key={a.id} a={a} />)}
        </div>
      )}
      {closing && <OutcomeForm a={closing} onClose={() => setClosing(null)} />}
    </div>
  )
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */

export function DashboardAppointments() {
  const list = useAppointmentList()
  const [closing, setClosing] = useState<Appointment | null>(null)
  const today = floridaDate(new Date())
  const todays = list.filter(a => a.startAt && floridaDate(a.startAt) === today && a.status !== 'cancelled').sort((x, y) => x.startAt!.localeCompare(y.startAt!))
  const overdue = list.filter(a => needsOutcome(a)).sort((x, y) => y.startAt!.localeCompare(x.startAt!))
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-dashboard-appointments>
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Today</h3>
          <button onClick={() => openBooking({ date: today })} className="text-xs text-orange-600 font-semibold">+ Appointment</button>
        </div>
        {todays.length === 0 ? <p className="text-sm text-gray-400">Nothing booked today.</p> : (
          <div className="divide-y divide-gray-100">
            {todays.map(a => (
              <div key={a.id} className="py-2 flex items-center gap-2">
                <span className="w-1.5 self-stretch rounded" style={{ background: TYPE_COLORS[a.type] }} />
                <span className="w-16 text-sm font-semibold text-gray-900">{a.allDay ? 'All day' : fmtTime(a.startAt!)}</span>
                <button onClick={() => openBooking({ appointmentId: a.id })} className="flex-1 min-w-0 text-left">
                  <span className="block text-sm text-gray-900 truncate">{a.customerName}</span>
                  <span className="block text-xs text-gray-500 truncate">{TYPE_SHORT[a.type]} · {a.address}</span>
                </button>
                {a.customerPhone && <a href={`tel:${a.customerPhone.replace(/[^\d+]/g, '')}`} className="text-xs px-2 py-1 rounded-lg border border-gray-200">Call</a>}
                <a href={directionsUrl(a)} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded-lg border border-gray-200">Navigate</a>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Needs outcome {overdue.length > 0 && <span className="ml-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{overdue.length}</span>}</h3>
        {overdue.length === 0 ? <p className="text-sm text-gray-400">Every past appointment is closed out.</p> : (
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {overdue.map(a => (
              <button key={a.id} onClick={() => setClosing(a)} className="w-full text-left py-2">
                <span className="text-sm text-gray-900">{a.customerName}</span>
                <span className="block text-xs text-gray-500">{TYPE_SHORT[a.type]} · {fmtDay(a.startAt!)}{a.allDay ? '' : ` ${fmtTime(a.startAt!)}`}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {closing && <OutcomeForm a={closing} onClose={() => setClosing(null)} />}
    </div>
  )
}

/* ── Settings ────────────────────────────────────────────────────────────── */

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function AppointmentSettingsTab() {
  const [s, setS] = useState<AppointmentSettings>(getAppointmentSettings())
  const [newName, setNewName] = useState('')
  const set = (patch: Partial<AppointmentSettings>) => setS(cur => ({ ...cur, ...patch }))
  function save() {
    const team = s.team.filter(t => t.name.trim())
    if (!team.length) { toast.error('Add at least one person'); return }
    if (!team.some(t => t.isDefault)) team[0] = { ...team[0], isDefault: true }
    const cfg = getConfig()
    saveConfig({ ...cfg, appointments: withDefaults({ ...s, team }) })
    toast.success('Appointment settings saved')
  }
  return (
    <div className="space-y-6 max-w-2xl" data-appointment-settings>
      <section>
        <h3 className="text-sm font-bold text-gray-900">Team</h3>
        <p className="text-xs text-gray-500 mb-2">Who appointments can be assigned to. The default person is picked for new appointments; anyone else is named in the Google Calendar title.</p>
        <div className="space-y-1.5">
          {s.team.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={t.name} onChange={e => set({ team: s.team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              <label className="text-xs text-gray-600 flex items-center gap-1"><input type="radio" checked={!!t.isDefault} onChange={() => set({ team: s.team.map((x, j) => ({ ...x, isDefault: j === i })) })} /> Default</label>
              <button onClick={() => set({ team: s.team.filter((_, j) => j !== i) })} className="text-xs text-red-600 px-2">Remove</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add a name" className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            <button onClick={() => { if (newName.trim()) { set({ team: [...s.team, { name: newName.trim() }] }); setNewName('') } }} className="text-sm px-3 rounded-lg border border-gray-200">Add</button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-900">Lengths</h3>
        <p className="text-xs text-gray-500 mb-2">How long each type takes by default, in minutes. 0 means all day.</p>
        <div className="grid grid-cols-2 gap-2">
          {APPOINTMENT_TYPES.map(t => (
            <label key={t} className="flex items-center justify-between gap-2 text-sm text-gray-700 border border-gray-100 rounded-lg px-3 py-1.5">
              <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: TYPE_COLORS[t] }} />{TYPE_LABELS[t]}</span>
              <input type="number" min={0} max={600} step={5} value={s.durations[t]} onChange={e => set({ durations: { ...s.durations, [t]: Math.max(0, Number(e.target.value) || 0) } })} className="w-20 border border-gray-200 rounded px-2 py-1 text-sm" />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-900">Suggested times</h3>
        <p className="text-xs text-gray-500 mb-2">The booking dialog suggests open times on these days, between these hours. You can still book any time by hand.</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {WEEKDAY_NAMES.map((n, d) => (
            <button key={d} onClick={() => set({ slotDays: s.slotDays.includes(d) ? s.slotDays.filter(x => x !== d) : [...s.slotDays, d].sort() })}
              className={`px-3 py-1 rounded-lg text-sm border ${s.slotDays.includes(d) ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-200 text-gray-600'}`}>{n}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
          <label>From <input type="time" step={900} value={s.slotStart} onChange={e => set({ slotStart: e.target.value })} className="border border-gray-200 rounded px-2 py-1" /></label>
          <label>to <input type="time" step={900} value={s.slotEnd} onChange={e => set({ slotEnd: e.target.value })} className="border border-gray-200 rounded px-2 py-1" /></label>
          <label>Average driving speed <input type="number" min={10} max={70} value={s.driveMph} onChange={e => set({ driveMph: Number(e.target.value) || 30 })} className="w-16 border border-gray-200 rounded px-2 py-1" /> mph</label>
          <label>Minimum gap <input type="number" min={0} max={120} step={5} value={s.bufferMinutes} onChange={e => set({ bufferMinutes: Number(e.target.value) || 0 })} className="w-16 border border-gray-200 rounded px-2 py-1" /> min</label>
        </div>
      </section>

      <section className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
        Maps use OpenStreetMap and addresses are found with the free US Census lookup. To use Google Maps instead, set
        <code className="mx-1">GEOCODER=google</code> and <code className="mx-1">GOOGLE_MAPS_API_KEY</code> in the server settings file and restart.
      </section>

      <button onClick={save} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold" data-save-appointment-settings>Save appointment settings</button>
    </div>
  )
}
