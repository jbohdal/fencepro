/**
 * The booking dialog, opened from anywhere with openBooking(): the customer
 * page, a pipeline card, the global "+ Appointment" button, a new lead.
 *
 * Pick the customer (searched by name, phone or address), type, person, day
 * and time. Beside the picker: that person's day as a timeline (appointments
 * at their real times, the drives between them) and a map, the best open
 * times each explained in one line, other days this week he is already near
 * the address, and warnings (never a block). The time box is our own 15
 * minute grid inside work hours; times that do not fit are greyed with the
 * reason. The booking math is in bookingPlanner.ts.
 * After saving it offers the confirmation text, email and calendar invite,
 * which Jonathan sends himself.
 */

import { formatPhone } from './phoneFormat'
import { styleLabel } from './fenceCatalog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCustomers, getCustomerById } from './customerStore'
import { getJobs, updateJob } from './jobStore'
import { getConfig, getAppointmentSettings } from './configStore'
import {
  getAppointments, getAppointment, createAppointment, updateAppointment, lookupPosition, pinPosition, suggestAddresses, APPOINTMENTS_UPDATED,
} from './appointmentsStore'
import {
  APPOINTMENT_TYPES, TYPE_LABELS, TYPE_COLORS, TYPE_SHORT, floridaDate, floridaHM, floridaTime, minutesOf,
  overlapWarnings, isOpen, addDays, smsLink, mailtoLink, buildIcs, longWhen, weekdayOf,
  type Appointment, type AppointmentType,
} from './appointmentLogic'
import {
  dayInput, bestTimes, timeGrid, warningsFor, timeline, otherDays, parseTypedTime, clock, clockAmPm, differentStreets,
} from './bookingPlanner'
import AddressAutocomplete from './AddressAutocomplete'
import { confirmationSms, confirmationBody, confirmationSubject, icsDescription, repWarning, type MessageContext } from './appointmentMessages'
import { applyBooking } from './appointmentPipeline'
import MapView, { type MapPoint } from './MapView'
import { useBackLayer } from './nav'
import { SaveStatus } from './SaveStatus'
import { useBookingTeam } from './bookingTeamStore'
import { defaultMemberOf, memberOf, isWith, homeOf } from './bookingTeamModel'

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
  useBackLayer(onClose, { key: 'booking-dialog' })
  const settings = getAppointmentSettings()
  const config = getConfig()
  const company = config.company
  // The words: Settings > Messages (saved templates over the defaults).
  const msg: MessageContext = { company, templates: config.appointmentMessages }
  const existing = req.appointmentId ? getAppointment(req.appointmentId) : null
  const all = useAppointments()

  const [customerId, setCustomerId] = useState(existing?.crmContactId || req.customerId || '')
  const customer = customerId ? getCustomerById(customerId) : null
  const [type, setType] = useState<AppointmentType>(existing?.type || req.type || 'estimate')
  // With: a login from the team (Settings > Team, bookingTeamStore.ts), the owner for a new booking.
  // An appointment whose person has left the team keeps that name until another person is picked.
  const team = useBookingTeam()
  const [personId, setPersonId] = useState(() => (existing ? memberOf(team, existing) : defaultMemberOf(team))?.userId ?? '')
  const member = team.find(m => m.userId === personId) ?? null
  const formerName = existing && !memberOf(team, existing) ? existing.assignedTo : ''
  const person = member?.name ?? (personId ? '' : formerName)
  const isTheirs = (a: Pick<Appointment, 'assignedTo'> & { assignedToUserId?: string | null }) => (member ? isWith(team, a, member) : !!person && a.assignedTo === person)
  const home = homeOf(settings.homes, member)
  const startIso = existing?.startAt || (req.date && req.date.length > 10 ? req.date : null)
  const [date, setDate] = useState(startIso ? floridaDate(startIso) : req.date || addDays(floridaDate(new Date()), 1))
  // Empty until a time is picked (never the clock time).
  const [time, setTime] = useState(startIso ? floridaHM(startIso) : '')
  const [gridOpen, setGridOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [typedBad, setTypedBad] = useState(false)
  // The business clock, a minute at a time: options never start in the past.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  const defaultMinutes = (t: AppointmentType) => settings.durations[t] ?? 60
  const [minutes, setMinutes] = useState(() => existing?.startAt && existing.endAt && !existing.allDay
    ? Math.round((new Date(existing.endAt).getTime() - new Date(existing.startAt).getTime()) / 60000) : defaultMinutes(existing?.type || req.type || 'estimate'))
  const allDay = minutes === 0
  const [days, setDays] = useState(() => existing?.allDay && existing.startAt && existing.endAt
    ? Math.max(1, Math.round((new Date(existing.endAt).getTime() - new Date(existing.startAt).getTime()) / 86_400_000)) : 1)
  const [address, setAddress] = useState(existing?.address ?? '')
  // The address Jonathan settled on when two differ (the pin waits until then).
  const [chosenAddress, setChosenAddress] = useState(existing?.address ?? '')
  // What the address lookup matched, when it is a different street from what was typed.
  const [lookupMatch, setLookupMatch] = useState<string | null>(null)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(existing?.lat != null ? { lat: existing.lat, lng: existing.lng! } : null)
  const [notes, setNotes] = useState(existing?.notes || '')
  const [jobId, setJobId] = useState(existing?.jobId || req.jobId || '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  // One id per booking made in this dialog: tapped twice, or Book again after an error, it is one appointment.
  const [newBookingId] = useState(() => crypto.randomUUID())
  const [booked, setBooked] = useState<(Appointment & { pending?: boolean }) | null>(null)
  const [search, setSearch] = useState('')

  // The customer's address until another property is typed in.
  useEffect(() => { if (!existing && customer && !address) setAddress(customer.serviceAddress || '') }, [customerId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Other addresses this customer has used (earlier appointments, the customer record).
  const otherAddresses = useMemo(() => [...new Set([
    ...all.filter(a => a.crmContactId === customerId && a.address).map(a => a.address),
    ...(customer?.serviceAddress ? [customer.serviceAddress] : []),
  ])].filter(a => a.trim() && a.trim().toLowerCase() !== address.trim().toLowerCase()).slice(0, 4), [all, customerId, address, customer?.serviceAddress])

  // Same house number, another street: one of them is wrong. The pin waits for a choice.
  const mismatch = useMemo(() => {
    if (!address.trim() || address === chosenAddress) return null
    const alt = otherAddresses.find(a => differentStreets(address, a)) ?? (lookupMatch && differentStreets(address, lookupMatch) ? lookupMatch : null)
    return alt ?? null
  }, [address, chosenAddress, otherAddresses, lookupMatch])

  // What the address list finds for a typed address: a different street there is a mismatch too.
  useEffect(() => {
    setLookupMatch(null)
    if (!address.trim() || address === chosenAddress) return
    let stale = false
    const t = setTimeout(async () => {
      const found = await suggestAddresses(address)
      if (stale || !found.length || found.some(f => !differentStreets(address, f.formatted))) return
      const other = found.find(f => differentStreets(address, f.formatted))
      if (other) setLookupMatch(other.formatted)
    }, 600)
    return () => { stale = true; clearTimeout(t) }
  }, [address, chosenAddress])

  // Where the property is: looked up when the address settles (kept on the server).
  useEffect(() => {
    if (!address.trim() || mismatch) { setPos(null); return }
    if (existing && address === existing.address && existing.lat != null) { setPos({ lat: existing.lat, lng: existing.lng! }); return }
    let stale = false
    const t = setTimeout(async () => { const p = await lookupPosition(address); if (!stale) setPos(p ? { lat: p.lat, lng: p.lng } : null) }, 600)
    return () => { stale = true; clearTimeout(t) }
  }, [address, mismatch])  // eslint-disable-line react-hooks/exhaustive-deps

  const customerMatches = useMemo(() => {
    const q = search.trim().toLowerCase(), qd = q.replace(/\D/g, '')
    if (q.length < 2) return []
    return getCustomers().filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (qd.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(qd)) ||
      (c.serviceAddress || '').toLowerCase().includes(q),
    ).slice(0, 8)
  }, [search])

  const allJobs = useMemo(() => getJobs(), [])
  const jobs = useMemo(() => allJobs.filter(j => j.customerId === customerId), [allJobs, customerId])

  const dayList = useMemo(() => all
    .filter(a => isTheirs(a) && isOpen(a) && a.startAt && floridaDate(a.startAt) === date && a.id !== existing?.id)
    .sort((x, y) => x.startAt!.localeCompare(y.startAt!)), [all, person, team, date, existing?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // The day as the planner sees it: home base, appointments, work hours, drive times.
  const day = useMemo(() => dayInput({ date, minutes, target: pos, person, home, isTheirs, appointments: all, settings, now, ignoreId: existing?.id }),
    [date, minutes, pos, person, team, all, now, existing?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const bookingDay = settings.slotDays.includes(weekdayOf(date))
  const options = useMemo(() => (allDay || !bookingDay ? [] : bestTimes(day)), [day, allDay, bookingDay])
  const grid = useMemo(() => (allDay ? [] : timeGrid(day)), [day, allDay])
  const nearby = useMemo(() => (allDay ? [] : otherDays({
    date, minutes, target: pos, person, home, isTheirs, appointments: all, jobs: allJobs, settings, now, ignoreId: existing?.id,
  })), [date, minutes, pos, person, team, all, allJobs, now, allDay])  // eslint-disable-line react-hooks/exhaustive-deps
  const segments = useMemo(() => timeline(day, allDay ? null : time || null), [day, time, allDay])
  const timeWarnings = !allDay && time ? warningsFor(day, time) : []

  const startAt = allDay ? floridaTime(date, '00:00') : time ? floridaTime(date, time) : null
  const endAt = startAt ? (allDay ? floridaTime(addDays(date, days), '00:00') : new Date(startAt.getTime() + Math.max(5, minutes) * 60_000)) : null
  // This person's own clashes are in the time warnings (with drive time); here: the customer's other appointments, and all day ones.
  const warnings = startAt && endAt ? overlapWarnings({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), person, customerId, ignoreId: existing?.id },
    all.filter(a => allDay || a.allDay || !isTheirs(a))) : []

  function typeTime(text: string) {
    if (!text.trim()) { setTypedBad(false); return }
    const hm = parseTypedTime(text)
    if (!hm) { setTypedBad(true); return }
    setTypedBad(false); setTime(hm); setTyped(''); setGridOpen(false)
  }
  const timeChanged = !!existing && (existing.startAt || null) !== (startAt?.toISOString() ?? null)

  async function save() {
    if (!customerId) return
    // Book tapped twice before the button greys out: the second tap does nothing.
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    const body = {
      type, address,
      // The login and its name; an appointment kept with a former team member sends what it had (no change).
      ...(member ? { assignedTo: member.name, assignedToUserId: member.userId } : { assignedTo: formerName, assignedToUserId: existing?.assignedToUserId ?? null }), lat: pos?.lat ?? null, lng: pos?.lng ?? null, notes,
      startAt: startAt?.toISOString() ?? null, endAt: endAt?.toISOString() ?? null, allDay,
      // An install, or a service or warranty visit opened from a job (a service request): on that job.
      jobId: (type === 'install' || ((type === 'service' || type === 'warranty') && !!req.jobId)) && jobId ? jobId : null, quoteId: existing?.quoteId ?? req.quoteId ?? null,
    }
    const saved = existing
      ? await updateAppointment(existing.id, body, timeChanged ? reason || 'Rescheduled' : undefined)
      : await createAppointment({ id: newBookingId, crmContactId: customerId, ...body })
    inFlight.current = false
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
    const blob = new Blob([buildIcs(a, company, icsDescription(a, msg))], { type: 'text/calendar;charset=utf-8' })
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
  const dayStart = Math.floor(Math.min(day.workStart, ...segments.map(g => g.start)) / 60) * 60
  const dayEnd = Math.ceil(Math.max(day.workEnd, ...segments.map(g => g.end)) / 60) * 60
  const pct = (m: number) => `${((m - dayStart) / Math.max(60, dayEnd - dayStart)) * 100}%`
  const span = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` })
  const hourTicks = Array.from({ length: Math.floor((dayEnd - dayStart) / 120) + 1 }, (_, i) => dayStart + i * 120)
  const typeOf = new Map(dayList.map(a => [a.id, a.type]))

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={close}>
      <div onClick={e => e.stopPropagation()} data-booking-dialog className="bg-white w-full sm:max-w-4xl max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="sticky top-0 bg-white z-10 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{booked ? (booked.pending ? 'Kept on this phone' : existing ? 'Changed' : 'Booked') : existing ? 'Change appointment' : 'Book appointment'}</h2>
          <button onClick={close} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-700 text-xl px-2">✕</button>
        </div>

        {booked ? (
          <div className="p-5 space-y-4" data-booked={booked.pending ? 'pending' : 'saved'}>
            <SaveStatus keys={[`appointment:${booked.id}`]} />
            {booked.pending && (
              <p className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2" data-booked-pending>
                No signal right now. This appointment is kept on this phone and will be booked by itself as soon as there is signal. The badge at the top shows it until then.
              </p>
            )}
            <p className="text-sm text-gray-700">
              <b>{TYPE_SHORT[booked.type]}</b> with <b>{booked.customerName}</b> on <b>{longWhen(booked)}</b>
              {booked.address ? <> at {booked.address}</> : null}, with {booked.assignedTo || 'nobody assigned'}.
            </p>
            {booked.startAt && (
              <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">Send confirmation</p>
                <p className="text-xs text-gray-500">Nothing is sent automatically. These open on your phone or computer, ready to send.</p>
                {repWarning(booked, company) && (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2" data-rep-phone-warning>⚠ {repWarning(booked, company)}</p>
                )}
                <p className="text-sm bg-gray-50 rounded-lg p-3 text-gray-700 whitespace-pre-wrap" data-confirmation-text>{confirmationSms(booked, msg)}</p>
                <div className="flex flex-wrap gap-2">
                  {booked.customerPhone && <a href={smsLink(booked.customerPhone, confirmationSms(booked, msg))} data-text-it className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold">Text it</a>}
                  {booked.customerEmail && <a href={mailtoLink(booked.customerEmail, confirmationSubject(booked, msg), confirmationBody(booked, msg))} data-email-it className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">Email it</a>}
                  <button onClick={() => downloadIcs(booked)} data-ics-invite className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">Calendar invite (.ics)</button>
                </div>
              </div>
            )}
            <div className="flex justify-end"><button onClick={onClose} data-booked-done className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold">Done</button></div>
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
                        <span className="block text-xs text-gray-500">{[formatPhone(c.phone), c.serviceAddress].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900" data-booking-customer>{customer.firstName} {customer.lastName}</p>
                    <p className="text-xs text-gray-500">{formatPhone(customer.phone)}</p>
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
                  <select value={personId} data-field="person" onChange={e => setPersonId(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    {team.map(m => <option key={m.userId} value={m.userId} data-user-id={m.userId}>{m.name}</option>)}
                    {formerName && <option value="" data-former>{formerName} (former team member)</option>}
                    {!team.length && !formerName && <option value="">Nobody on the team yet (Settings, Team)</option>}
                  </select>
                  <span className="block mt-0.5 text-[11px] font-normal text-gray-500" data-person-phone={member?.phone || ''}>
                    {member ? (member.phone ? `Direct ${formatPhone(member.phone)}` : 'No Direct phone: texts give the company phone') : formerName ? 'No longer on the team' : ''}
                  </span>
                </label>
                <label className="text-xs font-semibold text-gray-500">Day
                  <input type="date" value={date} data-field="date" onChange={e => setDate(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900" />
                </label>
                {allDay ? (
                  <label className="text-xs font-semibold text-gray-500">Days
                    <input type="number" min={1} max={30} value={days} onChange={e => setDays(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900" />
                  </label>
                ) : (
                  <div className="text-xs font-semibold text-gray-500">Time
                    <button type="button" data-field="time" aria-expanded={gridOpen} onClick={() => setGridOpen(o => !o)}
                      className={`mt-1 w-full border rounded-lg px-2 py-2 text-sm text-left ${time ? 'text-gray-900 border-gray-200' : 'text-gray-400 border-gray-200'} ${gridOpen ? 'ring-2 ring-orange-300' : ''}`}>
                      {time ? clockAmPm(minutesOf(time)) : 'Pick a time'}
                    </button>
                  </div>
                )}
                {!allDay && gridOpen && (
                  <div className="col-span-2 rounded-xl border border-gray-200 p-2 space-y-2" data-time-grid>
                    <p className="text-[11px] text-gray-500">Work hours {clockAmPm(day.workStart)} to {clockAmPm(day.workEnd)}. Grey times don't fit (drive time included); tap one anyway to see why.</p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                      {grid.map(c => (
                        <button key={c.time} type="button" onClick={() => { setTime(c.time); setGridOpen(false) }} title={c.reason || 'Fits'}
                          data-grid-time={c.time} data-ok={c.ok ? '1' : '0'}
                          className={`min-h-[48px] rounded-lg border px-1 py-1 text-center leading-tight ${time === c.time ? 'border-orange-500 bg-orange-50 text-gray-900'
                            : c.ok ? 'border-gray-200 bg-white text-gray-900 hover:border-orange-300' : 'border-gray-100 bg-gray-100 text-gray-400'}`}>
                          <span className="block text-sm font-semibold">{clock(c.start)}<span className="text-[10px] font-normal ml-0.5">{c.start < 720 ? 'am' : 'pm'}</span></span>
                          {!c.ok && <span className="block text-[9px] font-normal truncate" data-grid-reason>{c.short}</span>}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-normal text-gray-500">Or type a time
                      <input value={typed} onChange={e => { setTyped(e.target.value); setTypedBad(false) }} data-typed-time inputMode="text" placeholder="e.g. 2:30 pm"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); typeTime(typed) } }} onBlur={() => typeTime(typed)}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900" />
                    </label>
                    {typedBad && <p className="text-[11px] text-red-600">Not a time. Try 2:30 pm or 14:30.</p>}
                  </div>
                )}
                <label className="text-xs font-semibold text-gray-500 col-span-2">Length
                  <select value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    {[...new Set([15, 30, 45, 60, 90, 120, 180, 240, minutes])].filter(m => m > 0).sort((a, b) => a - b).map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
                    <option value={0}>All day</option>
                  </select>
                </label>
              </div>

              <div className="text-xs font-semibold text-gray-500">Property address
                <AddressAutocomplete value={address} onChange={setAddress} inputAttrs={{ 'data-field': 'address' }}
                  onSelect={p => { setAddress(p.formatted); setChosenAddress(p.formatted); if (p.lat != null && p.lng != null) setPos({ lat: p.lat, lng: p.lng }) }}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-normal text-gray-900" />
              </div>
              {mismatch ? (
                <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 space-y-2" data-address-mismatch>
                  <p className="text-sm font-bold text-red-800">These are different streets, check the address</p>
                  <p className="text-xs text-red-800">Same house number, another street. The pin and drive times wait until you pick one.</p>
                  <div className="grid gap-1.5">
                    <button type="button" onClick={() => setChosenAddress(address)} data-use-address="typed"
                      className="text-left text-sm px-3 py-2 min-h-[44px] rounded-lg bg-white border border-red-200 text-gray-900">Use <b>{address}</b></button>
                    <button type="button" onClick={() => { setAddress(mismatch); setChosenAddress(mismatch) }} data-use-address="other"
                      className="text-left text-sm px-3 py-2 min-h-[44px] rounded-lg bg-white border border-red-200 text-gray-900">Use <b>{mismatch}</b></button>
                  </div>
                </div>
              ) : otherAddresses.length > 0 && (
                <div className="flex flex-wrap gap-1">{otherAddresses.map(a => <button key={a} onClick={() => { setAddress(a); setChosenAddress(a) }} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{a}</button>)}</div>
              )}
              {address && !pos && !mismatch && <p className="text-xs text-amber-700">Not found on the map yet. It still saves; you can place it by hand later.</p>}

              {type === 'install' && (
                <label className="block text-xs font-semibold text-gray-500">Job
                  <select value={jobId} onChange={e => setJobId(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900">
                    <option value="">Not linked to a job</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{styleLabel(j.fenceStyle) || 'Job'} · ${Math.round(j.contractValue || 0).toLocaleString()} · {j.status}</option>)}
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
                <div className="relative h-14 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden" data-timeline>
                  {hourTicks.map(m => <div key={m} className="absolute top-0 bottom-0 border-l border-gray-200" style={{ left: pct(m) }} />)}
                  {segments.map((g, i) => g.kind === 'drive' ? (
                    <div key={i} title={`Drive: ${g.label}`} data-timeline-drive className="absolute top-3 bottom-3 rounded-sm text-[9px] leading-[1.1] text-gray-600 px-0.5 overflow-hidden whitespace-nowrap"
                      style={{ ...span(g.start, g.end), background: 'repeating-linear-gradient(45deg,#e5e7eb 0 4px,#f3f4f6 4px 8px)' }}>{g.label.replace(' drive', '').replace(' from home', '')}</div>
                  ) : g.kind === 'new' ? (
                    <div key={i} data-timeline-new title={g.label} className="absolute top-0 bottom-0 border-2 border-gray-900 rounded bg-gray-900/10 text-[10px] leading-tight text-gray-900 font-semibold px-0.5 overflow-hidden whitespace-nowrap"
                      style={span(g.start, g.end)}>{clock(g.start)}</div>
                  ) : (
                    <div key={i} data-timeline-appt title={g.label} className="absolute top-1 bottom-1 rounded text-[10px] leading-tight text-white px-1 overflow-hidden whitespace-nowrap"
                      style={{ ...span(g.start, g.end), background: TYPE_COLORS[typeOf.get(g.id || '') ?? 'other'] }}>
                      <span className="block font-semibold">{clock(g.start)}</span><span className="block truncate">{g.label.replace(/^\S+ /, '')}</span>
                    </div>
                  ))}
                </div>
                <div className="relative h-3 text-[10px] text-gray-400 mt-0.5">
                  {hourTicks.map(m => <span key={m} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(m) }}>{clock(m).replace(':00', '')}</span>)}
                </div>
                <ul className="mt-1 space-y-0.5" data-day-list>
                  {dayList.map(a => (
                    <li key={a.id} className="text-[11px] text-gray-600" data-day-item>
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: TYPE_COLORS[a.type] }} />
                      {a.allDay ? 'All day' : `${clock(minutesOf(floridaHM(a.startAt!)))} to ${clockAmPm(minutesOf(floridaHM(a.endAt || a.startAt!)))}`} · {a.customerName}{a.address ? ` · ${a.address.split(',').slice(0, 2).join(',')}` : ''}
                    </li>
                  ))}
                  {!dayList.length && <li className="text-[11px] text-gray-400">Nothing booked{day.home ? '; the day starts from home base' : ''}.</li>}
                </ul>
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
                  {!day.home && <p className="text-[11px] text-gray-400 mb-1">No home base set for {person || 'this person'} in Settings, Appointments: the first appointment of a day is figured from the start of work hours.</p>}
                  {mismatch && <p className="text-[11px] text-red-700 mb-1">Pick the address above first; drive times wait for it.</p>}
                  {options.length === 0 ? (
                    <p className="text-xs text-gray-400" data-no-options>{bookingDay ? 'No time left that day that fits the drive and work hours.' : 'Not a booking day in Settings.'}</p>
                  ) : (
                    <div className="grid gap-1.5" data-suggestions>
                      {options.map(o => (
                        <button key={o.startAt} onClick={() => { setTime(o.time); setGridOpen(false) }} data-option={o.time}
                          className={`text-left px-3 py-2 rounded-lg border text-sm ${time === o.time ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-orange-300'}`}>
                          <span className="flex items-center gap-2">
                            <b>{clockAmPm(o.start)}</b>
                            {o.best && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-100 text-green-800" data-best>Best</span>}
                          </span>
                          <span className="block text-xs text-gray-500 mt-0.5" data-option-line>{o.line}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {nearby.length > 0 && (
                    <div className="mt-2" data-other-days>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Other days you're already nearby</p>
                      <div className="flex flex-wrap gap-1.5">
                        {nearby.map(n => (
                          <button key={n.startAt} onClick={() => { setDate(n.date); setTime(n.time); setGridOpen(false) }} data-other-day={n.date}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-orange-300 text-gray-700">{n.line}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {timeWarnings.length > 0 && (
                <div className="text-xs bg-amber-50 text-amber-900 border-2 border-amber-300 rounded-lg px-3 py-2" data-time-warning>
                  <p className="font-bold">Check this time: {clockAmPm(minutesOf(time))}</p>
                  <ul className="list-disc ml-4 mt-1">{timeWarnings.map(w => <li key={w}>{w}</li>)}</ul>
                  <p className="mt-1">You can still book it.</p>
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
