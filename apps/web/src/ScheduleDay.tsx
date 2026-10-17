/**
 * The top of the Schedule screen: one day at a time, the installs on the
 * schedule and that day's appointments (estimates, call backs, contract
 * signings), so the phone's Schedule tab answers "what is on today".
 */

import { useEffect, useState } from 'react'
import { getAppointments, initAppointments, APPOINTMENTS_UPDATED } from './appointmentsStore'
import { TYPE_LABELS } from './appointmentLogic'
import { getCustomerById } from './customerStore'
import { businessDate } from './businessDate'
import { navigate, pagePath } from './nav'
import type { ScheduledJob, Crew } from './SchedulePage'

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
const shift = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export default function ScheduleDay({ jobs, crews }: { jobs: ScheduledJob[]; crews: Crew[] }) {
  const today = businessDate(new Date())
  const [day, setDay] = useState(today)
  const [, setTick] = useState(0)
  useEffect(() => {
    initAppointments().then(() => setTick(t => t + 1)).catch(() => {})
    const on = () => setTick(t => t + 1)
    window.addEventListener(APPOINTMENTS_UPDATED, on)
    return () => window.removeEventListener(APPOINTMENTS_UPDATED, on)
  }, [])

  const installs = jobs.filter(j => j.date === day && j.status !== 'Rolled Over')
  const appts = getAppointments()
    .filter(a => a.startAt && businessDate(a.startAt) === day && a.status !== 'cancelled')
    .sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1))
  const crewOf = (id: string) => crews.find(c => c.id === id)

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3" data-schedule-day={day}>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-secondary btn-icon" aria-label="Day before" onClick={() => setDay(d => shift(d, -1))}>&larr;</button>
        <div className="flex-1 text-center">
          <p className="text-base font-bold text-gray-900">{day === today ? 'Today' : dayLabel(day)}</p>
          {day === today && <p className="text-xs text-gray-500">{dayLabel(day)}</p>}
        </div>
        <button type="button" className="btn btn-secondary btn-icon" aria-label="Next day" onClick={() => setDay(d => shift(d, 1))}>&rarr;</button>
      </div>
      {day !== today && <button type="button" className="btn btn-quiet btn-sm w-full" onClick={() => setDay(today)}>Back to today</button>}

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">Installs</p>
        {installs.length === 0 ? <p className="text-sm text-gray-500" data-day-installs="0">No installs scheduled.</p> : (
          <ul className="divide-y divide-gray-100" data-day-installs={installs.length}>
            {installs.map(j => (
              <li key={j.id} className="py-2 flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full shrink-0 ${crewOf(j.crewId)?.color ?? 'bg-gray-300'}`} aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{j.clientName}</span>
                  <span className="block text-xs text-gray-600 truncate">{[j.fenceType, j.sections ? `${j.sections} sections` : '', j.area, crewOf(j.crewId)?.name].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-xs text-gray-500">{j.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">Appointments</p>
        {appts.length === 0 ? <p className="text-sm text-gray-500" data-day-appts="0">No appointments.</p> : (
          <ul className="divide-y divide-gray-100" data-day-appts={appts.length}>
            {appts.map(a => {
              const c = getCustomerById(a.crmContactId)
              return (
                <li key={a.id}>
                  <button type="button" className="w-full py-2 flex items-center gap-3 text-left" onClick={() => navigate(`${pagePath('Appointments')}?appt=${a.id}`)}>
                    <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-gray-900">{a.allDay ? 'All day' : time(a.startAt!)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-900 truncate">{c ? `${c.firstName} ${c.lastName}`.trim() : 'Customer'}</span>
                      <span className="block text-xs text-gray-600 truncate">{TYPE_LABELS[a.type] ?? a.type}{a.address ? ` · ${a.address}` : ''}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
