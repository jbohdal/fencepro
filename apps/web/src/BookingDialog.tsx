/**
 * The booking dialog, opened from anywhere with openBooking(): the customer
 * page, a pipeline card, the global "+ Appointment" button, a new lead.
 *
 * Pick the customer (searched by name, phone or address), type, person, day
 * and time. Beside the picker: that person's day as a timeline and a map,
 * the three best open slots, and warnings for overlaps (never a block).
 * After saving it offers the confirmation text, email and calendar invite,
 * which Jonathan sends himself.
 */

import { useEffect, useMemo, useState } from 'react'
import { getCustomers, getCustomerById } from './customerStore'
import { getJobs, updateJob } from './jobStore'
import { getConfig, getAppointmentSettings } from './configStore'
import {
  getAppointments, getAppointment, createAppointment, updateAppointment, lookupPosition, pinPosition, APPOINTMENTS_UPDATED,
} from './appointmentsStore'
import {
  APPOINTMENT_TYPES, TYPE_LABELS, TYPE_COLORS, TYPE_SHORT, defaultPerson, floridaDate, floridaHM, floridaTime, minutesOf, hmOf,
  suggestSlots, overlapWarnings, isOpen, addDays, confirmationText, smsLink, mailtoLink, buildIcs, longWhen,
  type Appointment, type AppointmentType,
} from './appointmentLogic'
import { applyBooking } from './appointmentPipeline'
import MapView, { type MapPoint } from './MapView'

export interface BookingRequest {
  customerId?: string
  type?: AppointmentType
  jobId?: string
  quoteId?: string
  /** Open an existing appointment to change or reschedule it. */
  appointmentId?: string
  /** Prefill a day (YYYY-MM-DD) or a moment (ISO). */
  date?: string
  onBooked?: (a: Appointment) => void
  onCancel?: () => void
}

const OPEN_EVENT = 'ezbiz:book-appointment'
export function openBooking(req: BookingRequest = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: req }))
}

/** Mounted once by the app; shows the dialog whenever openBooking() is called. */
export function BookingHost() {
  const [req, setReq] = useState<BookingRequest | null>(null)
  useEffect(() => {
    const h = (e: Event) => setReq((e as CustomEvent<BookingRequest>).detail || {})
    window.addEventListener(OPEN_EVENT, h)
    return () => window.removeEventListener(OPEN_EVENT, h)
  }, [])
  if (!req) return null
  return <BookingDialog key={JSON.stringify([req.customerId, req.appointmentId, req.type, req.date])} req={req} onClose={() => setReq(null)} />
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

function useAppointments() {
  const [list, setList] = useState(getAppointments())
  useEffect(() => {
    const h = () => setList(getAppointments())
    window.addEventListener(APPOINTMENTS_UPDATED, h)
    return () => window.removeEventListener(APPOINTMENTS_UPDATED, h)
  }, [])
  return list
}

function BookingDialog({ req, onClose }: { req: BookingRequest; onClose: () => void }) {
  const settings = getAppointmentSettings()
  const company = getConfig().company
  const existing = req.appointmentId ? getAppointment(req.appointmentId) : null
  const all = useAppointments()

  const [customerId, setCustomerId] = useState(existing?.crmContactId || req.customerId || '')
  const customer = customerId ? getCustomerById(customerId) : null
  const [type, setType] = useState<AppointmentType>(existing?.type || req.type || 'estimate')
  const [person, setPerson] = useState(existing?.assignedTo || defaultPerson(settings))
  const startIso = existing?.startAt || (req.date && req.date.length > 10 ? req.date : null)
  const [date, setDate] = useState(startIso ? floridaDate(startIso) : req.date || addDays(floridaDate(new Date()), 1))
  const [time, setTime] = useState(startIso ? floridaHM(startIso) : '')
  const defaultMinutes = (t: AppointmentType) => settings.durations[t] ?? 60
  const [minutes, setMinutes] = useState(() => existing?.startAt && existing.endAt && !existing.allDay
    ? Math.round((new Date(existing.endAt).getTime() - new Date(existing.startAt).getTime()) / 60000) : defaultMinutes(existing?.type || req.type || 'estimate'))
  const allDay = minutes === 0
  const [days, setDays] = useState(() => existing?.allDay && existing.startAt && existing.endAt
    ? Math.max(1, Math.round((new Date(existing.endAt).getTime() - new Date(existing.startAt).getTime()) / 86_400_000)) : 1)
  const [address, setAddress] = useState(existing?.address ?? '')
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(existing?.lat != null ? { lat: existing.lat, lng: existing.lng! } : null)
  const [notes, setNotes] = useState(existing?.notes || '')
  const [jobId, setJobId] = useState(existing?.jobId || req.jobId || '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [booked, setBooked] = useState<Appointment | null>(null)
  const [search, setSearch] = useState('')

  // The customer's address until another property is typed in.
  useEffect(() => { if (!existing && customer && !address) setAddress(customer.serviceAddress || '') }, [customerId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Where the property is: looked up when the address settles (kept on the server).
  useEffect(() => {
    if (!address.trim()) { setPos(null); return }
    if (existing && address === existing.address && existing.lat != null) return
    let stale = false
    const t = setTimeout(async () => { const p = await lookupPosition(address); if (!stale) setPos(p ? { lat: p.lat, lng: p.lng } : null) }, 600)
    return () => { stale = true; clearTimeout(t) }
  }, [address])  // eslint-disable-line react-hooks/exhaustive-deps

  const customerMatches = useMemo(() => {
    const q = search.trim().toLowerCase(), qd = q.replace(/\D/g, '')
    if (q.length < 2) return []
    return getCustomers().filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (qd.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(qd)) ||
      (c.serviceAddress || '').toLowerCase().includes(q),
    ).slice(0, 8)
  }, [search])

  const otherAddresses = useMemo(() => [...new Set(all.filter(a => a.crmContactId === customerId && a.address).map(a => a.address))]
    .filter(a => a !== address).slice(0, 4), [all, customerId, address])
  const jobs = useMemo(() => getJobs().filter(j => j.customerId === customerId), [customerId])

  const dayList = useMemo(() => all
    .filter(a => a.assignedTo === person && isOpen(a) && a.startAt && floridaDate(a.startAt) === date && a.id !== existing?.id)
    .sort((x, y) => x.startAt!.localeCompare(y.startAt!)), [all, person, date, existing?.id])

  const suggestions = useMemo(() => allDay ? [] : suggestSlots({
    date, minutes, person, target: pos, appointments: all, settings, ignoreId: existing?.id,
  }), [date, minutes, person, pos, all, allDay])  // eslint-disable-line react-hooks/exhaustive-deps

  const startAt = allDay ? floridaTime(date, '00:00') : time ? floridaTime(date, time) : null
  const endAt = startAt ? (allDay ? floridaTime(addDays(date, days), '00:00') : new Date(startAt.getTime() + Math.max(5, minutes) * 60_000)) : null
  const warnings = startAt && endAt ? overlapWarnings({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), person, customerId, ignoreId: existing?.id }, all) : []
  const timeChanged = !!existing && (existing.startAt || null) !== (startAt?.toISOString() ?? null)

  async function save() {
    if (!customerId) return
    setSaving(true)
    const body = {
      type, assignedTo: person, address, lat: pos?.lat ?? null, lng: pos?.lng ?? null, notes,
      startAt: startAt?.toISOString() ?? null, endAt: endAt?.toISOString() ?? null, allDay,
      jobId: type === 'install' && jobId ? jobId : null, quoteId: existing?.quoteId ?? req.quoteId ?? null,
    }
    const saved = existing
      ? await updateAppointment(existing.id, body, timeChanged ? reason || 'Rescheduled' : undefined)
      : await createAppointment({ crmContactId: customerId, ...body })
    setSaving(false)
    if (!saved) return
    // An install linked to a job: the job carries the dates (one record of the install).
    if (saved.type === 'install' && saved.jobId && startAt && endAt) {
      updateJob(saved.jobId, { scheduledDate: floridaDate(startAt), scheduledEndDate: floridaDate(new Date(endAt.getTime() - 1)), status: 'scheduled' })
    }
    if (!existing) applyBooking(saved)
    req.onBooked?.(saved)
    setBooked(saved)
  }

  function downloadIcs(a: Appointment) {
    const blob = new Blob([buildIcs(a, company)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `${TYPE_SHORT[a.type]}-${floridaDate(a.startAt!)}.ics`; link.click()
    URL.revokeObjectURL(url)
  }

  const close = () => { if (!booked) req.onCancel?.(); onClose() }

  const points: MapPoint[] = [
    ...dayList.filter(a => a.lat != null).map((a, i) => ({ id: a.id, lat: a.lat!, lng: a.lng!, label: String(i + 1), color: TYPE_COLORS[a.type], title: `${fmtTime(a.startAt!)} ${a.customerName}` })),
    ...(pos ? [{ id: 'new', lat: pos.lat, lng: pos.lng, label: '★', color: '#111827', title: 'This appointment (drag to correct)', draggable: true }] : []),
  ]
  const dayStart = Math.min(minutesOf(settings.slotStart), ...dayList.filter(a => !a.allDay).map(a => minutesOf(floridaHM(a.startAt!))))
  const dayEnd = Math.max(minutesOf(settings.slotEnd), ...dayList.filter(a => !a.allDay && a.endAt).map(a => minutesOf(floridaHM(a.endAt!))))
  const pct = (m: number) => `${((m - dayStart) / Math.max(60, dayEnd - dayStart)) * 100}%`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={close}>
      <div onClick={e => e.stopPropagation()} data-booking-dialog className="bg-white w-full sm:max-w-4xl max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="sticky top-0 bg-white z-10 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{booked ? 'Booked' : existing ? 'Change appointment' : 'Book appointment'}</h2>
          <button onClick={close} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl px-2">✕</button>
        </div>

        {booked ? (
          <div className="p-5 space-y-4" data-booked>
            <p className="text-sm text-gray-700">
              <b>{TYPE_SHORT[booked.type]}</b> with <b>{booked.customerName}</b> on <b>{longWhen(booked)}</b>
              {booked.address ? <> at {booked.address}</> : null}, with {booked.assignedTo || 'nobody assigned'}.
            </p>
            {booked.startAt && (
              <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">Send confirmation</p>
                <p className="text-xs text-gray-500">Nothing is sent automatically. These open on your phone or computer, ready to send.</p>
                <p className="text-sm bg-gray-50 rounded-lg p-3 text-gray-700">{confirmationText(booked, company)}</p>
                <div className="flex flex-wrap gap-2">
                  {booked.customerPhone && <a href={smsLink(booked.customerPhone, confirmationText(booked, company))} className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold">Text it</a>}
                  {booked.customerEmail && <a href={mailtoLink(booked.customerEmail, `Your ${TYPE_SHORT[booked.type].toLowerCase()} with ${company.name || 'Getter Done Fence'}`, confirmationText(booked, company))} className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">Email it</a>}
                  <button onClick={() => downloadIcs(booked)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">Calendar invite (.ics)</button>
                </div>
              </div>
            )}
            <div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold">Done</button></div>
          </div>
        ) : (
          <div className="p-5 grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              {!customer ? (
                <div>
                  <label className="text-xs font-semibold text-gray-500">Customer</label>
                  <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone or address"
                    data-customer-search className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <div className="mt-1 divide-y divide-gray-100 border border-gray-100 rounded-lg empty:hidden">
                    {customerMatches.map(c => (
                      <button key={c.id} onClick={() => { setCustomerId(c.id); setAddress(c.serviceAddress || '') }} className="w-full text-left px-3 py-2 hover:bg-orange-50">
                        <span className="text-sm font-semibold text-gray-900">{c.firstName} {c.lastName}</span>
                        <span className="block text-xs text-gray-500">{[c.phone, c.serviceAddress].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900" data-booking-customer>{customer.firstName} {customer.lastName}</p>
                    <p className="text-xs text-gray-500">{customer.phone}</p>
                  </div>
                  {!existing && !req.customerId && <button onClick={() => { setCustomerId(''); setAddress('') }} className="text-xs text-orange-600">Change</button>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-gray-500">Type
                  <select value={type} data-field="type" onChange={e => { const t = e.target.value as AppointmentType; setType(t); setMinutes(defaultMinutes(t)) }}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-gray-500">With
                  <select value={person} data-field="person" onChange={e => setPerson(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    {settings.team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    {person && !settings.team.some(t => t.name === person) && <option value={person}>{person}</option>}
                  </select>
                </label>
                <label className="text-xs font-semibold text-gray-500">Day
                  <input type="date" value={date} data-field="date" onChange={e => setDate(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900" />
                </label>
                {allDay ? (
                  <label className="text-xs font-semibold text-gray-500">Days
                    <input type="number" min={1} max={30} value={days} onChange={e => setDays(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900" />
                  </label>
                ) : (
                  <label className="text-xs font-semibold text-gray-500">Time
                    <input type="time" step={900} value={time} data-field="time" onChange={e => setTime(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900" />
                  </label>
                )}
                <label className="text-xs font-semibold text-gray-500 col-span-2">Length
                  <select value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    {[...new Set([15, 30, 45, 60, 90, 120, 180, 240, minutes])].filter(m => m > 0).sort((a, b) => a - b).map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
                    <option value={0}>All day</option>
                  </select>
                </label>
              </div>

              <label className="block text-xs font-semibold text-gray-500">Property address
                <input value={address} data-field="address" onChange={e => setAddress(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900" />
              </label>
              {otherAddresses.length > 0 && (
                <div className="flex flex-wrap gap-1">{otherAddresses.map(a => <button key={a} onClick={() => setAddress(a)} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{a}</button>)}</div>
              )}
              {address && !pos && <p className="text-xs text-amber-700">Not found on the map yet. It still saves; you can place it by hand later.</p>}

              {type === 'install' && (
                <label className="block text-xs font-semibold text-gray-500">Job
                  <select value={jobId} onChange={e => setJobId(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    <option value="">Not linked to a job</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.fenceStyle || 'Job'} · ${Math.round(j.contractValue || 0).toLocaleString()} · {j.status}</option>)}
                  </select>
                  <span className="font-normal text-gray-400">A linked job takes these dates, so Operations and the calendar show it once.</span>
                </label>
              )}

              <label className="block text-xs font-semibold text-gray-500">Notes
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900" />
              </label>
              {timeChanged && (
                <label className="block text-xs font-semibold text-gray-500">Why is it moving?
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Customer asked, rain, ..." data-field="reason" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900" />
                </label>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">{person || 'Nobody'}'s day, {new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}</p>
                <div className="relative h-10 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden" data-timeline>
                  {dayList.filter(a => !a.allDay).map(a => (
                    <div key={a.id} title={`${fmtTime(a.startAt!)} ${a.customerName}`} className="absolute top-1 bottom-1 rounded text-[10px] text-white px-1 truncate"
                      style={{ left: pct(minutesOf(floridaHM(a.startAt!))), width: `calc(${pct(minutesOf(floridaHM(a.endAt || a.startAt!)))} - ${pct(minutesOf(floridaHM(a.startAt!)))})`, background: TYPE_COLORS[a.type] }}>
                      {a.customerName}
                    </div>
                  ))}
                  {startAt && endAt && !allDay && (
                    <div className="absolute top-0 bottom-0 border-2 border-gray-900 rounded bg-gray-900/10"
                      style={{ left: pct(minutesOf(floridaHM(startAt))), width: `calc(${pct(minutesOf(floridaHM(endAt)))} - ${pct(minutesOf(floridaHM(startAt)))})` }} />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5"><span>{hmOf(dayStart)}</span><span>{hmOf(dayEnd)}</span></div>
                {dayList.filter(a => a.allDay).map(a => <p key={a.id} className="text-[11px] text-gray-500">All day: {a.customerName}</p>)}
              </div>

              <MapView points={points} height={200} onMove={(id, lat, lng) => {
                if (id !== 'new') return
                setPos({ lat, lng })
                if (address.trim()) pinPosition(address, lat, lng)
              }} />
              {pos && <p className="text-[11px] text-gray-400">Pin in the wrong place? Drag the ★ to the property; it is remembered for this address.</p>}

              {!allDay && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Best open times</p>
                  {suggestions.length === 0 ? (
                    <p className="text-xs text-gray-400">{settings.slotDays.includes(new Date(date + 'T12:00:00Z').getUTCDay()) ? 'No open time left that day.' : 'Not a booking day in Settings.'}</p>
                  ) : (
                    <div className="grid gap-1.5" data-suggestions>
                      {suggestions.map(s => (
                        <button key={s.startAt} onClick={() => setTime(floridaHM(s.startAt))}
                          className={`text-left px-3 py-2 rounded-lg border text-sm ${time === floridaHM(s.startAt) ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-orange-300'}`}>
                          <b>{fmtTime(s.startAt)}</b> <span className="text-xs text-gray-500">· {s.reason}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {warnings.map(w => <p key={w} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2" data-warning>⚠ {w}</p>)}

              <button onClick={save} disabled={!customerId || saving || (!allDay && !time)} data-save
                className="btn btn-primary btn-lg w-full disabled:opacity-40">
                {saving ? 'Saving…' : existing ? 'Save changes' : 'Book'}
              </button>
              {!allDay && !time && <p className="text-[11px] text-gray-400 text-center">Pick a time, or one of the best open times.</p>}
              {existing && isOpen(existing) && (
                <button data-cancel-appointment onClick={async () => {
                  const why = window.prompt(`Cancel this ${TYPE_SHORT[existing.type].toLowerCase()} with ${existing.customerName}? Why?`, 'Customer cancelled')
                  if (why === null) return
                  if (await updateAppointment(existing.id, { status: 'cancelled' }, why || 'Cancelled')) onClose()
                }} className="w-full py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold">Cancel appointment</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
