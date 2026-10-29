/**
 * The Appointments page: day, week, month, agenda and map views, coloured by
 * type and filtered by person and type. On the day and week views an
 * appointment can be dragged to a new time; it asks why and keeps the old
 * time in the history. Above the calendar: what needs a date and what needs
 * an outcome.
 */

import { memberKey, visitsStartPerson, withSomeoneElse } from './bookingTeamModel'
import { signedInRole } from './permissions'
import { currentUser } from './crmAuth'
import { myDayKey } from './TodayScreen'
import { stageHasRole } from './pipelineStagesStore'
import { useMemo, useState } from 'react'
import { updateAppointment } from './appointmentsStore'
import { getAppointmentSettings } from './configStore'
import { getPipeline } from './pipelineStore'
import {
  APPOINTMENT_TYPES, TYPE_SHORT, TYPE_COLORS, STATUS_LABELS, OUTCOME_LABELS, floridaDate, floridaHM, floridaTime, minutesOf, hmOf,
  addDays, weekdayOf, isOpen, needsOutcome, routeUrl, visitWords, type Appointment, type AppointmentType,
} from './appointmentLogic'
import { getQuotesForCustomer } from './quoteStore'
import { openBooking } from './BookingDialog'
import { useAppointmentList, OutcomeForm } from './TodayScreen'
import MapView from './MapView'
import { useBookingTeam } from './bookingTeamStore'
import { formerNamesOf, matchesPerson } from './bookingTeamModel'
import PersonFilter from './PersonFilter'

type View = 'day' | 'week' | 'month' | 'agenda' | 'map'
const HOUR_PX = 48
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const dayTitle = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })
const weekStart = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7))      // Monday

export default function AppointmentsPage() {
  const list = useAppointmentList()
  const settings = getAppointmentSettings()
  const team = useBookingTeam()
  const [view, setView] = useState<View>(() => (window.matchMedia('(max-width: 767px)').matches ? 'agenda' : 'week'))
  const [date, setDate] = useState(floridaDate(new Date()))
  // A Salesman or the crew sees their own appointments first (Everyone is one tap away); the office and the owner, everyone.
  const role = signedInRole()
  const [picked, setPerson] = useState<string | null>(null)
  // The Salesman starts on everyone: every appointment the server sends is in the Salesman's scope, and those
  // booked with someone else are marked with who they are with. The crew starts on their own.
  const meKey = role === 'sales_rep' || role === 'field_crew' ? myDayKey(team, currentUser()?.id ?? null, role) : ''
  const person = picked ?? visitsStartPerson(role, meKey)
  const [type, setType] = useState<AppointmentType | ''>('')
  const [closing, setClosing] = useState<Appointment | null>(null)

  // Person: '' everyone, a team member (u:<login id>), or a former team member's name (n:<name>), bookingTeamModel.ts.
  const former = useMemo(() => formerNamesOf(team, list), [team, list])
  const shown = useMemo(() => list.filter(a => a.status !== 'cancelled' && matchesPerson(team, a, person) && (!type || a.type === type)), [list, team, person, type])
  const dated = shown.filter(a => a.startAt)

  // Needs a date: call backs with no time, and cards in the Appointment stage with nothing booked.
  const undated = list.filter(a => !a.startAt && isOpen(a) && matchesPerson(team, a, person))
  const booked = new Set(list.filter(a => isOpen(a) && a.startAt).map(a => a.crmContactId))
  // The cards follow the person picker too (by the card's rep): a Salesman sees her own waiting cards, not everyone's.
  const personName = person.startsWith('u:') ? team.find(m => memberKey(m) === person)?.name ?? '' : person.startsWith('n:') ? person.slice(2) : ''
  const norm = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const waitingCards = (getPipeline().leads || []).filter((l: any) => stageHasRole(l?.stage, 'appointment') && !(l.customerId && booked.has(l.customerId)) && (!person || (!!personName && norm(l.assignedRep) === norm(personName))))
  const overdue = list.filter(a => needsOutcome(a) && matchesPerson(team, a, person)).sort((x, y) => y.startAt!.localeCompare(x.startAt!))

  const step = view === 'day' || view === 'map' ? 1 : view === 'week' ? 7 : view === 'month' ? 30 : 14
  const move = (n: number) => setDate(view === 'month' ? shiftMonth(date, n) : addDays(date, n * step))

  async function reschedule(a: Appointment, day: string, startMinutes: number | null) {
    const len = a.startAt && a.endAt ? new Date(a.endAt).getTime() - new Date(a.startAt).getTime() : 3_600_000
    const start = a.allDay || startMinutes == null ? floridaTime(day, '00:00') : floridaTime(day, hmOf(startMinutes))
    if (a.startAt && start.toISOString() === a.startAt) return
    const reason = window.prompt(`Move ${a.customerName} to ${dayTitle(day, { weekday: 'short', month: 'short', day: 'numeric' })}${a.allDay ? '' : ` ${fmtTime(start.toISOString())}`}? Why is it moving?`, 'Customer asked')
    if (reason === null) return
    await updateAppointment(a.id, { startAt: start.toISOString(), endAt: new Date(start.getTime() + len).toISOString() }, reason || 'Rescheduled')
  }

  return (
    <div className="space-y-4" data-appointments-page>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-gray-900">Appointments</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['day', 'week', 'month', 'agenda', 'map'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} data-view={v} className={`px-3 py-1 rounded-md text-xs font-semibold capitalize ${view === v ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>{v}</button>
            ))}
          </div>
          <PersonFilter team={team} former={former} value={person} onChange={setPerson} everyoneFirst className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
          <select value={type} onChange={e => setType(e.target.value as AppointmentType | '')} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
            <option value="">All types</option>
            {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_SHORT[t]}</option>)}
          </select>
          <button onClick={() => openBooking({ date })} className="btn btn-primary">+ Appointment</button>
        </div>
      </div>

      {(undated.length > 0 || waitingCards.length > 0 || overdue.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {(undated.length > 0 || waitingCards.length > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4" data-needs-date>
              <p className="text-sm font-bold text-amber-800">Needs a date ({undated.length + waitingCards.length})</p>
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {undated.map(a => (
                  <button key={a.id} onClick={() => openBooking({ appointmentId: a.id })} className="w-full text-left text-sm text-amber-900 hover:underline">
                    {TYPE_SHORT[a.type]}: {a.customerName}{a.notes ? ` · ${a.notes.split('\n')[0]}` : ''}
                  </button>
                ))}
                {waitingCards.map((l: any) => (
                  <button key={l.id} disabled={!l.customerId} onClick={() => openBooking({ customerId: l.customerId, type: 'estimate' })} className="w-full text-left text-sm text-amber-900 hover:underline disabled:no-underline disabled:opacity-60">
                    Card in Appointment: {`${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Unnamed'}{l.customerId ? '' : ' (no customer record)'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {overdue.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4" data-needs-outcome>
              <p className="text-sm font-bold text-red-700">Needs outcome ({overdue.length})</p>
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {overdue.map(a => (
                  <button key={a.id} onClick={() => setClosing(a)} className="w-full text-left text-sm text-red-800 hover:underline">
                    {dayTitle(floridaDate(a.startAt!), { month: 'short', day: 'numeric' })} · {TYPE_SHORT[a.type]}: {a.customerName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={() => move(-1)} className="px-2 py-1 rounded-lg border border-gray-200 text-sm">‹</button>
        <button onClick={() => setDate(floridaDate(new Date()))} className="px-3 py-1 rounded-lg border border-gray-200 text-sm">Today</button>
        <button onClick={() => move(1)} className="px-2 py-1 rounded-lg border border-gray-200 text-sm">›</button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
        <span className="text-sm font-semibold text-gray-700">
          {view === 'month' ? dayTitle(date, { month: 'long', year: 'numeric' }) : view === 'week' ? `Week of ${dayTitle(weekStart(date), { month: 'short', day: 'numeric' })}` : dayTitle(date, { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      </div>

      {(view === 'day' || view === 'week') && (
        <TimeGrid days={view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))}
          list={dated} start={minutesOf(settings.slotStart) - 60} end={minutesOf(settings.slotEnd) + 60} onDrop={reschedule} />
      )}
      {view === 'month' && <MonthGrid date={date} list={dated} onPickDay={d => { setDate(d); setView('day') }} />}
      {view === 'agenda' && <Agenda from={date} list={dated} onClose={setClosing} meKey={role === 'sales_rep' ? meKey : ''} />}
      {view === 'map' && <DayMap date={date} list={dated} />}

      {closing && <OutcomeForm a={closing} onClose={() => setClosing(null)} />}
    </div>
  )
}

function shiftMonth(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10)
}

function Chip({ a, compact = false }: { a: Appointment; compact?: boolean }) {
  return (
    <button onClick={e => { e.stopPropagation(); openBooking({ appointmentId: a.id }) }} data-appointment={a.id}
      className={`w-full text-left rounded px-1.5 text-white truncate ${compact ? 'text-[10px] py-0' : 'text-[11px] py-0.5'} ${a.status === 'completed' || a.status === 'no_show' ? 'opacity-60' : ''}`}
      style={{ background: TYPE_COLORS[a.type] }} title={`${a.allDay ? 'All day' : fmtTime(a.startAt!)} ${TYPE_SHORT[a.type]}: ${a.customerName} (${STATUS_LABELS[a.status]})`}>
      {a.allDay ? '' : `${fmtTime(a.startAt!).replace(':00', '')} `}{a.customerName}
    </button>
  )
}

function TimeGrid({ days, list, start, end, onDrop }: {
  days: string[]; list: Appointment[]; start: number; end: number
  onDrop: (a: Appointment, day: string, startMinutes: number | null) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const hours = Array.from({ length: Math.ceil((end - start) / 60) }, (_, i) => start + i * 60)
  const height = ((end - start) / 60) * HOUR_PX
  const byId = (id: string | null) => list.find(a => a.id === id)
  const today = floridaDate(new Date())

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto" data-time-grid>
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map(d => (
          <div key={d} className={`text-center text-xs font-semibold py-2 border-l border-gray-100 ${d === today ? 'text-orange-600' : 'text-gray-600'}`}>
            {dayTitle(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}
            <div className="px-1 mt-1 space-y-0.5" onDragOver={e => e.preventDefault()} onDrop={() => { const a = byId(dragId); if (a) onDrop(a, d, null); setDragId(null) }}>
              {list.filter(a => a.allDay && floridaDate(a.startAt!) <= d && floridaDate(new Date(new Date(a.endAt || a.startAt!).getTime() - 1)) >= d)
                .map(a => <div key={a.id} draggable onDragStart={() => setDragId(a.id)}><Chip a={a} compact /></div>)}
            </div>
          </div>
        ))}
        <div className="relative" style={{ height }}>
          {hours.map(h => <div key={h} className="absolute right-1 text-[10px] text-gray-400" style={{ top: ((h - start) / 60) * HOUR_PX - 6 }}>{new Date(floridaTime('2026-01-05', hmOf(h))).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric' })}</div>)}
        </div>
        {days.map(d => (
          <div key={d} className="relative border-l border-gray-100" style={{ height }} data-day={d}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              const a = byId(dragId); setDragId(null)
              if (!a) return
              const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top
              const at = Math.round((start + (y / HOUR_PX) * 60) / 15) * 15
              onDrop(a, d, Math.max(start, Math.min(end - 15, at)))
            }}>
            {hours.map(h => <div key={h} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: ((h - start) / 60) * HOUR_PX }} />)}
            {list.filter(a => !a.allDay && floridaDate(a.startAt!) === d).map(a => {
              const s = minutesOf(floridaHM(a.startAt!)), e2 = a.endAt ? minutesOf(floridaHM(a.endAt)) : s + 60
              return (
                <div key={a.id} draggable onDragStart={() => setDragId(a.id)} className="absolute left-0.5 right-0.5 cursor-grab"
                  style={{ top: ((s - start) / 60) * HOUR_PX, height: Math.max(18, ((e2 - s) / 60) * HOUR_PX - 2) }}>
                  <div className="h-full rounded overflow-hidden" style={{ background: TYPE_COLORS[a.type] }}>
                    <Chip a={a} />
                    {e2 - s >= 45 && <p className="px-1.5 text-[10px] text-white/90 truncate">{TYPE_SHORT[a.type]}{a.assignedTo ? ` · ${a.assignedTo.split(' ')[0]}` : ''}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthGrid({ date, list, onPickDay }: { date: string; list: Appointment[]; onPickDay: (d: string) => void }) {
  const first = date.slice(0, 8) + '01'
  const startDay = weekStart(first)
  const days = Array.from({ length: 42 }, (_, i) => addDays(startDay, i))
  const month = date.slice(0, 7), today = floridaDate(new Date())
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" data-month>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-500 border-b border-gray-100">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map(d => {
          const items = list.filter(a => floridaDate(a.startAt!) === d)
          return (
            <div key={d} onClick={() => onPickDay(d)} className={`min-h-[84px] border-b border-r border-gray-100 p-1 cursor-pointer hover:bg-orange-50/40 ${d.slice(0, 7) !== month ? 'bg-gray-50/60' : ''}`}>
              <p className={`text-[11px] font-semibold ${d === today ? 'text-orange-600' : 'text-gray-500'}`}>{Number(d.slice(8))}</p>
              <div className="space-y-0.5">
                {items.slice(0, 3).map(a => <Chip key={a.id} a={a} compact />)}
                {items.length > 3 && <p className="text-[10px] text-gray-500">+{items.length - 3} more</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Agenda({ from, list, onClose, meKey = '' }: { from: string; list: Appointment[]; onClose: (a: Appointment) => void; meKey?: string }) {
  const team = useBookingTeam()
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i))
  const any = days.some(d => list.some(a => floridaDate(a.startAt!) === d))
  return (
    <div className="space-y-3" data-agenda>
      {!any && <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-200 p-6 text-center">Nothing booked in the two weeks from this day.</p>}
      {days.map(d => {
        const items = list.filter(a => floridaDate(a.startAt!) === d).sort((x, y) => x.startAt!.localeCompare(y.startAt!))
        if (!items.length) return null
        return (
          <div key={d} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <p className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-50">{dayTitle(d, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            {items.map(a => (
              <div key={a.id} className="px-4 py-3 border-t border-gray-100 flex items-center gap-3">
                <span className="w-1.5 self-stretch rounded" style={{ background: TYPE_COLORS[a.type] }} />
                <button onClick={() => openBooking({ appointmentId: a.id })} className="flex-1 min-w-0 text-left">
                  <span className="block text-sm font-semibold text-gray-900">{a.allDay ? 'All day' : fmtTime(a.startAt!)} · {a.customerName}</span>
                  {/* The Salesman's customer booked with someone else: said plainly (review Oct 28 2026). */}
                  {withSomeoneElse(team, a, meKey) && <span className="inline-block mt-0.5 text-[11px] font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded px-1.5" data-appointment-with-other>{withSomeoneElse(team, a, meKey)}</span>}
                  <span className="block text-xs text-gray-500 truncate">{TYPE_SHORT[a.type]} · {a.address || 'no address'} · {a.assignedTo || 'nobody'}</span>
                </button>
                <span className="text-[11px] text-gray-500 text-right">{visitWords(a, getQuotesForCustomer(a.crmContactId))}</span>
                {isOpen(a) && <button onClick={() => onClose(a)} className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600">Close out</button>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function DayMap({ date, list }: { date: string; list: Appointment[] }) {
  const day = list.filter(a => floridaDate(a.startAt!) === date && a.status !== 'no_show').sort((x, y) => x.startAt!.localeCompare(y.startAt!))
  const located = day.filter(a => a.lat != null)
  return (
    <div className="grid gap-3 lg:grid-cols-3" data-day-map>
      <div className="lg:col-span-2">
        <MapView height={460} points={located.map(a => ({ id: a.id, lat: a.lat!, lng: a.lng!, label: String(day.indexOf(a) + 1), color: TYPE_COLORS[a.type], title: `${day.indexOf(a) + 1}. ${a.allDay ? 'All day' : fmtTime(a.startAt!)} ${a.customerName}` }))} />
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
        <p className="text-sm font-bold text-gray-900">{day.length} stop{day.length === 1 ? '' : 's'}, in time order</p>
        {day.map((a, i) => (
          <button key={a.id} onClick={() => openBooking({ appointmentId: a.id })} className="w-full text-left text-sm">
            <b>{i + 1}.</b> {a.allDay ? 'All day' : fmtTime(a.startAt!)} {a.customerName}
            <span className="block text-xs text-gray-500">{a.address || 'no address'}{a.lat == null ? ' (not on the map)' : ''}</span>
          </button>
        ))}
        {day.length > 0 && (
          <a href={routeUrl(day.filter(a => a.address || a.lat != null))} target="_blank" rel="noreferrer" data-route
            className="block text-center mt-2 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Open route in Google Maps</a>
        )}
      </div>
    </div>
  )
}
