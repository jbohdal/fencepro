/**
 * The appointment messages Jonathan (or the person the appointment is with)
 * sends from their own phone or email: the booking confirmation for each kind
 * of appointment, the email subject, the "On my way" text and the calendar
 * invite's description. Edited in Settings > Messages; kept on the server in
 * the company settings (config.appointmentMessages), so every phone and
 * computer uses the same words. A template left as it came is not saved, so
 * it follows the default.
 *
 * Placeholders, filled from the appointment:
 *   {customer_first_name} {rep_first_name} {rep_phone} {company_name}
 *   {company_phone} {appointment_type} {date_time} {address}
 *   and {minutes} in the "On my way" text.
 *
 * {rep_phone} is the Direct phone of the login the appointment is with
 * (Settings > Team; the server matches the appointment's person to a login,
 * portal lib/appointmentRep.ts). No login, or no phone saved: the company
 * phone, and the Booked window says so (repContact().fallback).
 *
 * The booking confirmations and the calendar invite give the office line
 * ({company_phone}), never the person's own number (Jonathan, Oct 29 2026,
 * #30: "Booking and install texts use the office line (352) 789 4314, never
 * Christa's cell."). Only the On my way text, sent by the person on the way,
 * keeps {rep_phone}. A template edited in Settings > Messages is used as typed.
 *
 * Every phone number is written (352) 789 4314 (phoneFormat.ts).
 *
 * A text starts with the company name and ends "Reply STOP to opt out.", the
 * wording the Twilio registration uses (twilio plan, Oct 21 2026, part 6) and
 * the service request text already uses: "Getter Done Fence: Hi Kristi, ...
 * Reply STOP to opt out." Those two parts are added to every text and cannot
 * be edited away; the email and the calendar invite do not get them.
 */

import { customerText } from '../../portal/src/server/lib/customerText'
import { formatPhone } from './phoneFormat'
import { longWhen, type Appointment, type AppointmentType } from './appointmentLogic'

/* ── Templates ───────────────────────────────────────────────────────────── */

/** The confirmations, one per kind of appointment. */
export const CONFIRM_KINDS = ['estimate', 'install', 'service', 'other'] as const
export type ConfirmKind = typeof CONFIRM_KINDS[number]
export const CONFIRM_KIND_LABELS: Record<ConfirmKind, string> = {
  estimate: 'Estimate', install: 'Install', service: 'Service call', other: 'Other appointments',
}

export interface AppointmentMessageTemplates {
  confirm: Record<ConfirmKind, string>
  emailSubject: string
  onMyWay: string
  icsDescription: string
}
/** As saved: only what was changed from the default. */
export type SavedMessageTemplates = Partial<Omit<AppointmentMessageTemplates, 'confirm'>> & { confirm?: Partial<Record<ConfirmKind, string>> }

const SIGN_OFF = 'If anything changes, call or text our office at {company_phone}.'
export const DEFAULT_MESSAGE_TEMPLATES: AppointmentMessageTemplates = {
  confirm: {
    estimate: `Hi {customer_first_name}, this is {rep_first_name} with {company_name}. You're all set for your fence estimate on {date_time} at {address}. ${SIGN_OFF}`,
    install: `Hi {customer_first_name}, this is {rep_first_name} with {company_name}. Your fence install is set for {date_time} at {address}. ${SIGN_OFF}`,
    service: `Hi {customer_first_name}, this is {rep_first_name} with {company_name}. You're all set for your {appointment_type} on {date_time} at {address}. ${SIGN_OFF}`,
    other: `Hi {customer_first_name}, this is {rep_first_name} with {company_name}. You're all set for your {appointment_type} on {date_time} at {address}. ${SIGN_OFF}`,
  },
  emailSubject: 'Your {appointment_type} with {company_name}',
  onMyWay: "Hi {customer_first_name}, this is {rep_first_name} with {company_name}. I'm on my way and should be there in about {minutes} minutes. If you need me, call or text {rep_phone}.",
  icsDescription: 'Your {appointment_type} with {company_name} at {address}. Questions or changes: call or text our office at {company_phone}.',
}

/** Which confirmation an appointment type uses. */
export function confirmKindOf(type: AppointmentType | string): ConfirmKind {
  if (type === 'estimate') return 'estimate'
  if (type === 'install') return 'install'
  if (type === 'service' || type === 'warranty') return 'service'
  return 'other'
}

/** {appointment_type} in words. */
export const APPOINTMENT_TYPE_WORDS: Record<AppointmentType, string> = {
  estimate: 'fence estimate', follow_up: 'follow up visit', contract_signing: 'contract signing', install: 'fence install',
  service: 'service visit', warranty: 'warranty visit', call_back: 'phone call', other: 'appointment',
}

export const PLACEHOLDERS: Array<{ key: string; means: string; onlyIn?: 'onMyWay' }> = [
  { key: 'customer_first_name', means: "the customer's first name" },
  { key: 'rep_first_name', means: 'the first name of the person the appointment is with' },
  { key: 'rep_phone', means: "that person's Direct phone (Settings > Team); the company phone when none is saved" },
  { key: 'company_name', means: 'the company name (Settings > Company)' },
  { key: 'company_phone', means: 'the company phone (Settings > Company)' },
  { key: 'appointment_type', means: 'what it is, in words: fence estimate, fence install, service visit...' },
  { key: 'date_time', means: 'the day and time: Tuesday, October 20 at 10:00 AM' },
  { key: 'address', means: 'the property address' },
  { key: 'minutes', means: 'minutes away (the "On my way" text only)', onlyIn: 'onMyWay' },
]
const KNOWN = new Set(PLACEHOLDERS.map(p => p.key))

/** The templates in use: the saved ones over the defaults (an empty saved one is the default). */
export function messageTemplates(saved: SavedMessageTemplates | null | undefined): AppointmentMessageTemplates {
  const d = DEFAULT_MESSAGE_TEMPLATES
  const pick = (v: unknown, def: string) => (typeof v === 'string' && v.trim() ? v : def)
  return {
    confirm: Object.fromEntries(CONFIRM_KINDS.map(k => [k, pick(saved?.confirm?.[k], d.confirm[k])])) as Record<ConfirmKind, string>,
    emailSubject: pick(saved?.emailSubject, d.emailSubject),
    onMyWay: pick(saved?.onMyWay, d.onMyWay),
    icsDescription: pick(saved?.icsDescription, d.icsDescription),
  }
}

/** What to save: only the templates that differ from the default (so a later default reaches the rest). */
export function toSaved(t: AppointmentMessageTemplates): SavedMessageTemplates {
  const d = DEFAULT_MESSAGE_TEMPLATES
  const out: SavedMessageTemplates = {}
  const confirm: Partial<Record<ConfirmKind, string>> = {}
  for (const k of CONFIRM_KINDS) if (t.confirm[k].trim() && t.confirm[k].trim() !== d.confirm[k]) confirm[k] = t.confirm[k].trim()
  if (Object.keys(confirm).length) out.confirm = confirm
  for (const k of ['emailSubject', 'onMyWay', 'icsDescription'] as const) if (t[k].trim() && t[k].trim() !== d[k]) out[k] = t[k].trim()
  return out
}

/** Placeholders in a template that are not ones we fill (a typo shows in Settings). */
export function unknownPlaceholders(template: string, allowMinutes = false): string[] {
  const out: string[] = []
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    const k = m[1].trim()
    if ((!KNOWN.has(k) || (k === 'minutes' && !allowMinutes)) && !out.includes(m[0])) out.push(m[0])
  }
  return out
}

/* ── Filling ─────────────────────────────────────────────────────────────── */

const EMPTY = '\u0000'

/**
 * The template with each {placeholder} filled. One with nothing to say (no
 * address yet) is left out together with its "at" or "on", so "on Tuesday at ."
 * never goes out. An unknown placeholder is left as typed.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const filled = template.replace(/\{([a-z_]+)\}/g, (all, k: string) => {
    if (!(k in values)) return all
    const v = String(values[k] ?? '').trim()
    return v || EMPTY
  })
  return filled
    .replace(new RegExp(`\\s+(?:at|on|for|in)\\s+${EMPTY}`, 'g'), '')
    .replace(new RegExp(`\\s*${EMPTY}`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,!?])/g, '$1')
    .trim()
}

/* ── Who it is with ──────────────────────────────────────────────────────── */

/** The login the appointment is with, as the server matched it (portal lib/appointmentRep.ts). */
export interface RepInfo { userId: string; firstName: string; lastName: string; phone: string | null }

export interface MessageContext {
  company: { name: string; phone: string }
  /** Saved templates (config.appointmentMessages); missing ones are the defaults. */
  templates?: SavedMessageTemplates | null
}

/** Why the company phone stands in for the person's own. */
export type RepFallback = 'nobody' | 'no_login' | 'no_phone' | 'not_checked'

export interface RepContact { firstName: string; phone: string; fallback: RepFallback | null }

const firstWord = (s: string | null | undefined) => (s || '').trim().split(/\s+/)[0] || ''
const companyName = (c: MessageContext['company']) => c.name?.trim() || 'Getter Done Fence'

/**
 * The name and number the customer is given. The person's Direct phone when
 * the server matched a login that has one; otherwise the company phone, with
 * the reason (shown on the Booked window).
 */
export function repContact(a: Pick<Appointment, 'assignedTo'> & { rep?: RepInfo | null }, company: MessageContext['company']): RepContact {
  const companyPhone = formatPhone(company.phone)
  const named = (a.assignedTo || '').trim()
  if (a.rep && formatPhone(a.rep.phone)) return { firstName: a.rep.firstName || firstWord(named), phone: formatPhone(a.rep.phone), fallback: null }
  const fallback: RepFallback = !named ? 'nobody' : a.rep ? 'no_phone' : a.rep === undefined ? 'not_checked' : 'no_login'
  return { firstName: a.rep?.firstName || firstWord(named) || 'the team', phone: companyPhone, fallback }
}

/** The warning the Booked window shows when the company phone stands in, or null. */
export function repWarning(a: Pick<Appointment, 'assignedTo'> & { rep?: RepInfo | null }, company: MessageContext['company']): string | null {
  const r = repContact(a, company)
  const num = r.phone || 'the company phone (none saved in Settings > Company)'
  switch (r.fallback) {
    case null: return null
    case 'nobody': return `Nobody is assigned, so the text gives the company number, ${num}.`
    case 'no_phone': return `${a.assignedTo} has no Direct phone saved in Settings > Team, so the text gives the company number, ${num}.`
    case 'no_login': return `${a.assignedTo} is not matched to a login in Settings > Team (the full name has to be the same), so the text gives the company number, ${num}.`
    case 'not_checked': return `Who this is with is checked once it reaches the server; until then the text gives the company number, ${num}.`
  }
}

/**
 * Does what the Booked window offers (this kind's confirmation, the invite)
 * give the person's own number? Only then does repWarning matter there: the
 * default booking texts give the office line (#30).
 */
export function bookingUsesRepPhone(a: Pick<Appointment, 'type'>, ctx: Pick<MessageContext, 'templates'>): boolean {
  const t = messageTemplates(ctx.templates)
  return [t.confirm[confirmKindOf(a.type)], t.icsDescription].some(x => /\{\s*rep_phone\s*\}/.test(x))
}

type MessageAppointment = Pick<Appointment, 'customerName' | 'startAt' | 'allDay' | 'address' | 'type' | 'assignedTo'> & { rep?: RepInfo | null }

/** Every placeholder's value for this appointment. */
export function messageValues(a: MessageAppointment, ctx: MessageContext, extra: Record<string, string> = {}): Record<string, string> {
  const rep = repContact(a, ctx.company)
  return {
    customer_first_name: firstWord(a.customerName) || 'there',
    rep_first_name: rep.firstName,
    rep_phone: rep.phone,
    company_name: companyName(ctx.company),
    company_phone: formatPhone(ctx.company.phone),
    appointment_type: APPOINTMENT_TYPE_WORDS[a.type as AppointmentType] || 'appointment',
    date_time: a.startAt ? longWhen(a) : '',
    address: (a.address || '').trim(),
    ...extra,
  }
}

/** A text as it goes out: "Company: ..." and "Reply STOP to opt out." (once each), the one function every customer text uses (portal lib/customerText.ts). */
export function asText(body: string, company: MessageContext['company']): string {
  return customerText(body, companyName(company))
}

/** The confirmation as written (the email body). */
export function confirmationBody(a: MessageAppointment, ctx: MessageContext): string {
  const t = messageTemplates(ctx.templates)
  return fillTemplate(t.confirm[confirmKindOf(a.type)], messageValues(a, ctx))
}

/** The confirmation text message. */
export function confirmationSms(a: MessageAppointment, ctx: MessageContext): string {
  return asText(confirmationBody(a, ctx), ctx.company)
}

export function confirmationSubject(a: MessageAppointment, ctx: MessageContext): string {
  return fillTemplate(messageTemplates(ctx.templates).emailSubject, messageValues(a, ctx))
}

/** The "On my way" text message. */
export function onMyWaySms(a: MessageAppointment, minutes: number, ctx: MessageContext): string {
  const m = String(Math.max(1, Math.round(minutes || 0)))
  return asText(fillTemplate(messageTemplates(ctx.templates).onMyWay, messageValues(a, ctx, { minutes: m })), ctx.company)
}

/** The calendar invite's description. */
export function icsDescription(a: MessageAppointment, ctx: MessageContext): string {
  return fillTemplate(messageTemplates(ctx.templates).icsDescription, messageValues(a, ctx))
}
