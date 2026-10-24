/**
 * Settings > Messages: the words of the appointment confirmation (one per kind
 * of appointment), the email subject, the "On my way" text and the calendar
 * invite's description, with a live preview on a sample appointment and a
 * Reset to default for each. Saved in the company settings on the server
 * (config.appointmentMessages, versioned and in the Change log); the rules
 * and the defaults are in appointmentMessages.ts.
 */

import { useMemo, useState } from 'react'
import { getConfig, saveConfig } from './configStore'
import { currentUser } from './crmAuth'
import { formatPhone } from './phoneFormat'
import { floridaTime, addDays, floridaDate, weekdayOf } from './appointmentLogic'
import {
  CONFIRM_KINDS, CONFIRM_KIND_LABELS, DEFAULT_MESSAGE_TEMPLATES, PLACEHOLDERS, messageTemplates, toSaved, unknownPlaceholders,
  confirmationSms, confirmationSubject, onMyWaySms, icsDescription, repWarning,
  type AppointmentMessageTemplates, type ConfirmKind, type MessageContext,
} from './appointmentMessages'
import { toast } from './toast'
import { useSettingsPageSave } from './settingsPageSave'

type Field = { kind: 'confirm'; key: ConfirmKind } | { kind: 'emailSubject' | 'onMyWay' | 'icsDescription' }
const fieldId = (f: Field) => (f.kind === 'confirm' ? `confirm-${f.key}` : f.kind)
const SAMPLE_TYPE: Record<ConfirmKind, 'estimate' | 'install' | 'service' | 'other'> = { estimate: 'estimate', install: 'install', service: 'service', other: 'other' }

/** Next Tuesday at 10 AM (Florida), for the sample appointment. */
function sampleStart(): string {
  let d = addDays(floridaDate(new Date()), 1)
  while (weekdayOf(d) !== 2) d = addDays(d, 1)
  return floridaTime(d, '10:00').toISOString()
}

export default function AppointmentMessagesSettings() {
  const [t, setT] = useState<AppointmentMessageTemplates>(() => messageTemplates(getConfig().appointmentMessages))
  const [savedAs, setSavedAs] = useState(() => JSON.stringify(toSaved(messageTemplates(getConfig().appointmentMessages))))
  const company = getConfig().company
  const me = currentUser()

  // The sample: a customer named Kristi, booked with whoever is signed in (their Direct phone, as saved).
  const start = useMemo(sampleStart, [])
  const sample = (kind: ConfirmKind) => ({
    customerName: 'Kristi Sample', startAt: start, allDay: kind === 'install', address: '1234 SE 3rd Ave, Ocala, FL 34471',
    type: SAMPLE_TYPE[kind], assignedTo: me ? `${me.firstName} ${me.lastName}`.trim() : '',
    rep: me ? { userId: me.id, firstName: me.firstName, lastName: me.lastName, phone: me.phone ?? null } : null,
  })
  const ctx: MessageContext = { company, templates: toSaved(t) }

  const valueOf = (f: Field) => (f.kind === 'confirm' ? t.confirm[f.key] : t[f.kind])
  const defaultOf = (f: Field) => (f.kind === 'confirm' ? DEFAULT_MESSAGE_TEMPLATES.confirm[f.key] : DEFAULT_MESSAGE_TEMPLATES[f.kind])
  const setValue = (f: Field, v: string) => setT(cur => (f.kind === 'confirm' ? { ...cur, confirm: { ...cur.confirm, [f.key]: v } } : { ...cur, [f.kind]: v }))
  const previewOf = (f: Field) => {
    if (f.kind === 'confirm') return confirmationSms(sample(f.key), ctx)
    if (f.kind === 'emailSubject') return confirmationSubject(sample('estimate'), ctx)
    if (f.kind === 'onMyWay') return onMyWaySms(sample('estimate'), 15, ctx)
    return icsDescription(sample('estimate'), ctx)
  }
  const dirty = JSON.stringify(toSaved(t)) !== savedAs

  useSettingsPageSave(dirty, () => save(), () => setT(messageTemplates(JSON.parse(savedAs))))

  function save() {
    const saved = toSaved(t)
    saveConfig({ ...getConfig(), appointmentMessages: saved })
    setSavedAs(JSON.stringify(saved))
    setT(messageTemplates(saved))
    toast.success('Messages saved', 'Every phone and computer uses them from now on.')
  }

  const fields: Array<{ f: Field; title: string; note?: string; rows: number }> = [
    ...CONFIRM_KINDS.map(k => ({ f: { kind: 'confirm', key: k } as Field, title: `Booking confirmation: ${CONFIRM_KIND_LABELS[k]}`, rows: 5,
      note: k === 'service' ? 'Service and warranty visits.' : k === 'other' ? 'Follow up visits, contract signings, call backs and other appointments.' : undefined })),
    { f: { kind: 'emailSubject' }, title: 'Email subject', note: 'The email body is the booking confirmation above, without the text-only parts.', rows: 1 },
    { f: { kind: 'onMyWay' }, title: 'On my way text', note: 'From the Today screen. {minutes} is the minutes away (15 in the preview).', rows: 3 },
    { f: { kind: 'icsDescription' }, title: 'Calendar invite (.ics) description', rows: 2 },
  ]
  const warn = repWarning(sample('estimate'), company)

  return (
    <div className="space-y-6 max-w-3xl" data-message-settings>
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-gray-900">Appointment messages</h3>
        <p className="text-xs text-gray-500">
          The texts and emails offered after booking (you send them yourself from your phone or computer; nothing goes out by itself), the
          On my way text, and the calendar invite. Every text starts with <b>{company.name || 'the company name'}:</b> and ends with
          <b> Reply STOP to opt out.</b> (the wording registered for texting); those are added for you and do not need typing.
          Phone numbers are written like {formatPhone(company.phone) || '(352) 789 4314'}.
        </p>
        <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3" data-placeholder-list>
          <p className="font-semibold text-gray-700 mb-1">Placeholders</p>
          <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
            {PLACEHOLDERS.map(p => <li key={p.key}><code className="text-orange-700">{`{${p.key}}`}</code> {p.means}</li>)}
          </ul>
        </div>
        <p className="text-xs text-gray-500">
          Preview: Kristi Sample, an appointment next Tuesday at 10:00 AM, with {me ? `${me.firstName} ${me.lastName}` : 'you'}
          {me?.phone ? `, whose Direct phone is ${formatPhone(me.phone)}` : ''}.
        </p>
        {warn && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Preview: {warn.replace('the text gives', 'the preview gives')} Set yours under My profile (bottom of the menu).</p>}
      </section>

      {fields.map(({ f, title, note, rows }) => {
        const id = fieldId(f)
        const v = valueOf(f)
        const isDefault = v.trim() === defaultOf(f)
        const unknown = unknownPlaceholders(v, f.kind === 'onMyWay')
        return (
          <section key={id} className="rounded-xl border border-gray-200 p-3 space-y-2" data-message={id}>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDefault ? 'bg-gray-100 text-gray-500' : 'bg-orange-100 text-orange-800'}`} data-message-state>{isDefault ? 'Default' : 'Changed'}</span>
            </div>
            {note && <p className="text-xs text-gray-500">{note}</p>}
            {rows === 1
              ? <input value={v} onChange={e => setValue(f, e.target.value)} maxLength={200} data-message-input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900" />
              : <textarea value={v} onChange={e => setValue(f, e.target.value)} rows={rows} maxLength={1000} data-message-input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900" />}
            {!v.trim() && <p className="text-xs text-amber-800">Empty: the default is used.</p>}
            {unknown.length > 0 && <p className="text-xs text-red-700" data-message-unknown>Not a placeholder: {unknown.join(', ')}. It will be sent as typed.</p>}
            <div className="text-xs text-gray-500">Preview</div>
            <p className="text-sm bg-gray-50 rounded-lg p-3 text-gray-800 whitespace-pre-wrap" data-message-preview>{previewOf(f)}</p>
            <button type="button" onClick={() => setValue(f, defaultOf(f))} disabled={isDefault} data-message-reset
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">Reset to default</button>
          </section>
        )
      })}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!dirty} data-save-messages className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50">Save messages</button>
        {dirty && <span className="text-xs text-orange-600">Unsaved changes</span>}
      </div>
    </div>
  )
}
