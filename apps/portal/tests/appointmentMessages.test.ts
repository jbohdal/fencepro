/**
 * The appointment messages (apps/web/src/appointmentMessages.ts): the template
 * filler, phone formatting, the person's Direct phone with the company phone
 * standing in (and why), the text's company name and STOP line, and saving
 * only what differs from the default. The server's Direct phone check
 * (lib/appointmentRep.ts) and the exact name match are here too.
 */
import { describe, test, expect } from 'vitest'
import {
  fillTemplate, messageTemplates, toSaved, unknownPlaceholders, confirmKindOf, repContact, repWarning, bookingUsesRepPhone, messageValues,
  confirmationSms, confirmationBody, confirmationSubject, onMyWaySms, icsDescription, asText, DEFAULT_MESSAGE_TEMPLATES,
  type RepInfo,
} from '../../web/src/appointmentMessages'
import { floridaTime, type Appointment } from '../../web/src/appointmentLogic'
import { formatPhone } from '../../web/src/phoneFormat'
import { normalizeDirectPhone, loginByName, repOf, type StaffLogin } from '../src/server/lib/appointmentRep'

const company = { name: 'Getter Done Fence', phone: '3527894314' }
const rep = (over: Partial<RepInfo> = {}): RepInfo => ({ userId: 'u1', firstName: 'Testrep', lastName: 'Alpha', phone: '3525550142', ...over })
type A = Pick<Appointment, 'customerName' | 'startAt' | 'allDay' | 'address' | 'type' | 'assignedTo'> & { rep?: RepInfo | null }
const appt = (over: Partial<A> = {}): A => ({
  customerName: 'Kristi Lane', startAt: floridaTime('2026-10-20', '10:00').toISOString(), allDay: false,
  address: '1 Main St, Belleview, FL', type: 'estimate', assignedTo: 'Testrep Alpha', rep: rep(), ...over,
})

describe('phone numbers', () => {
  test('written (352) 789 4314 however they were typed', () => {
    expect(formatPhone('3527894314')).toBe('(352) 789 4314')
    expect(formatPhone('352-789-4314')).toBe('(352) 789 4314')
    expect(formatPhone('+1 (352) 789.4314')).toBe('(352) 789 4314')
  })
  test('a Direct phone is kept as 10 digits; empty clears it; anything else is refused', () => {
    expect(normalizeDirectPhone('(352) 555 0142')).toEqual({ ok: true, value: '3525550142' })
    expect(normalizeDirectPhone('+1 352-555-0142')).toEqual({ ok: true, value: '3525550142' })
    expect(normalizeDirectPhone('  ')).toEqual({ ok: true, value: null })
    expect(normalizeDirectPhone('555-0142').ok).toBe(false)
    expect(normalizeDirectPhone('352 555 0142 ext 4').ok).toBe(false)
  })
})

describe('the template filler', () => {
  test('fills every placeholder', () => {
    expect(fillTemplate('{a} and {b}', { a: 'one', b: 'two' })).toBe('one and two')
  })
  test('leaves an unknown placeholder as typed, and Settings names it', () => {
    expect(fillTemplate('Hi {custmer_first_name}', { customer_first_name: 'Kristi' })).toBe('Hi {custmer_first_name}')
    expect(unknownPlaceholders('Hi {custmer_first_name}, {rep_phone} {minutes}')).toEqual(['{custmer_first_name}', '{minutes}'])
    expect(unknownPlaceholders('{minutes}', true)).toEqual([])
  })
  test('an empty value drops its "at" or "on" (no "at ." in a text)', () => {
    expect(fillTemplate('See you on {date_time} at {address}. Thanks', { date_time: 'Tuesday', address: '' })).toBe('See you on Tuesday. Thanks')
    expect(fillTemplate('Set for {date_time} at {address}.', { date_time: '', address: '' })).toBe('Set.')
  })
})

describe('the booking confirmation', () => {
  test('the default estimate text: the person\'s name, and the office line, never their own phone (#30, Oct 29 2026)', () => {
    expect(confirmationBody(appt(), { company })).toBe(
      "Hi Kristi, this is Testrep with Getter Done Fence. You're all set for your fence estimate on Tuesday, October 20 at 10:00 AM at 1 Main St, Belleview, FL. If anything changes, call or text our office at (352) 789 4314.")
    expect(confirmationBody(appt(), { company })).not.toContain('555 0142')
  })
  test('the Booked window warns about a missing Direct phone only when what it offers gives the person\'s own number', () => {
    expect(bookingUsesRepPhone(appt(), {})).toBe(false)
    expect(bookingUsesRepPhone(appt(), { templates: { confirm: { estimate: 'Text {rep_phone}' } } })).toBe(true)
    expect(bookingUsesRepPhone(appt({ type: 'install' }), { templates: { confirm: { estimate: 'Text {rep_phone}' } } })).toBe(false)
    expect(bookingUsesRepPhone(appt(), { templates: { icsDescription: 'Call {rep_phone}' } })).toBe(true)
  })
  test('the text starts with the company name and ends with the STOP line (the registered wording)', () => {
    const t = confirmationSms(appt(), { company })
    expect(t.startsWith('Getter Done Fence: Hi Kristi, this is Testrep with Getter Done Fence.')).toBe(true)
    expect(t.endsWith('call or text our office at (352) 789 4314. Reply STOP to opt out.')).toBe(true)
    expect(asText(t, company)).toBe(t)   // never twice
  })
  test('a person with no Direct phone: the company number, and why', () => {
    const a = appt({ assignedTo: 'Testrep Nophone', rep: rep({ firstName: 'Testrep', lastName: 'Nophone', phone: null }) })
    expect(repContact(a, company)).toEqual({ firstName: 'Testrep', phone: '(352) 789 4314', fallback: 'no_phone' })
    expect(confirmationBody(a, { company })).toContain('call or text our office at (352) 789 4314.')
    expect(repWarning(a, company)).toMatch(/Testrep Nophone has no Direct phone saved in Settings > Team, so the text gives the company number, \(352\) 789 4314/)
  })
  test('a name no login has, nobody, and not yet checked: the company number, each with its reason', () => {
    expect(repContact(appt({ assignedTo: 'Someone Else', rep: null }), company).fallback).toBe('no_login')
    expect(repWarning(appt({ assignedTo: 'Someone Else', rep: null }), company)).toMatch(/not matched to a login/)
    expect(repContact(appt({ assignedTo: '', rep: null }), company)).toEqual({ firstName: 'the team', phone: '(352) 789 4314', fallback: 'nobody' })
    expect(repContact(appt({ rep: undefined }), company).fallback).toBe('not_checked')
    expect(repWarning(appt(), company)).toBeNull()
  })
  test('each kind of appointment has its own text', () => {
    expect(confirmKindOf('estimate')).toBe('estimate')
    expect(confirmKindOf('install')).toBe('install')
    expect(confirmKindOf('warranty')).toBe('service')
    expect(confirmKindOf('call_back')).toBe('other')
    const install = confirmationBody(appt({ type: 'install', allDay: true }), { company })
    expect(install).toBe('Hi Kristi, this is Testrep with Getter Done Fence. Your fence install is set for Tuesday, October 20 at 1 Main St, Belleview, FL. If anything changes, call or text our office at (352) 789 4314.')
    expect(confirmationBody(appt({ type: 'service' }), { company })).toContain('your service visit on Tuesday')
    expect(confirmationBody(appt({ type: 'follow_up' }), { company })).toContain('your follow up visit on Tuesday')
  })
  test('an edited template is used; an empty one is the default', () => {
    const templates = { confirm: { estimate: 'Hey {customer_first_name}! {rep_first_name} here, {date_time}. Text {rep_phone} or {company_phone}.' } }
    expect(confirmationSms(appt(), { company, templates })).toBe('Getter Done Fence: Hey Kristi! Testrep here, Tuesday, October 20 at 10:00 AM. Text (352) 555 0142 or (352) 789 4314. Reply STOP to opt out.')
    expect(confirmationBody(appt(), { company, templates: { confirm: { estimate: '   ' } } })).toBe(confirmationBody(appt(), { company }))
  })
  test('the email subject', () => {
    expect(confirmationSubject(appt(), { company })).toBe('Your fence estimate with Getter Done Fence')
    expect(confirmationSubject(appt({ type: 'install' }), { company, templates: { emailSubject: '{company_name}: {appointment_type}, {date_time}' } })).toBe('Getter Done Fence: fence install, Tuesday, October 20 at 10:00 AM')
  })
})

describe('the On my way text and the calendar invite', () => {
  test('On my way: the person\'s name and Direct phone, minutes rounded', () => {
    expect(onMyWaySms(appt(), 17.4, { company })).toBe(
      "Getter Done Fence: Hi Kristi, this is Testrep with Getter Done Fence. I'm on my way and should be there in about 17 minutes. If you need me, call or text (352) 555 0142. Reply STOP to opt out.")
  })
  test('the invite description gives the office line too (#30)', () => {
    expect(icsDescription(appt(), { company })).toBe('Your fence estimate with Getter Done Fence at 1 Main St, Belleview, FL. Questions or changes: call or text our office at (352) 789 4314.')
  })
  test('every placeholder has a value', () => {
    const v = messageValues(appt(), { company })
    expect(Object.keys(v).sort()).toEqual(['address', 'appointment_type', 'company_name', 'company_phone', 'customer_first_name', 'date_time', 'rep_first_name', 'rep_phone'])
  })
})

describe('saving templates', () => {
  test('only the changed ones are saved; reset to default saves nothing', () => {
    const t = messageTemplates(null)
    expect(t).toEqual(DEFAULT_MESSAGE_TEMPLATES)
    expect(toSaved(t)).toEqual({})
    const edited = { ...t, onMyWay: 'On the way, {customer_first_name}!', confirm: { ...t.confirm, install: 'Install day {date_time}.' } }
    expect(toSaved(edited)).toEqual({ onMyWay: 'On the way, {customer_first_name}!', confirm: { install: 'Install day {date_time}.' } })
    expect(messageTemplates(toSaved(edited)).confirm.estimate).toBe(DEFAULT_MESSAGE_TEMPLATES.confirm.estimate)
    expect(toSaved({ ...edited, onMyWay: DEFAULT_MESSAGE_TEMPLATES.onMyWay })).toEqual({ confirm: { install: 'Install day {date_time}.' } })
  })
  test('the default estimate text is Jonathan\'s wording', () => {
    expect(DEFAULT_MESSAGE_TEMPLATES.confirm.estimate).toBe("Hi {customer_first_name}, this is {rep_first_name} with {company_name}. You're all set for your fence estimate on {date_time} at {address}. If anything changes, call or text our office at {company_phone}.")
  })
})

describe('matching the person to a login (server)', () => {
  const staff: StaffLogin[] = [
    { id: 'a', firstName: 'Testrep', lastName: 'Alpha', phone: '3525550142', status: 'active' },
    { id: 'b', firstName: 'Testrep', lastName: 'Twin', phone: null, status: 'active' },
    { id: 'c', firstName: 'Testrep', lastName: 'Twin', phone: null, status: 'invited' },
    { id: 'd', firstName: 'Testrep', lastName: 'Gone', phone: '3525550199', status: 'deactivated' },
  ]
  test('the full name exactly, case and spaces aside', () => {
    expect(loginByName(staff, '  testrep   ALPHA ')?.id).toBe('a')
  })
  test('a first name alone, a near miss, two with the same name or a switched off login: nobody', () => {
    expect(loginByName(staff, 'Testrep')).toBeNull()
    expect(loginByName(staff, 'Testrep Alph')).toBeNull()
    expect(loginByName(staff, 'Testrep Twin')).toBeNull()
    expect(loginByName(staff, 'Testrep Gone')).toBeNull()
  })
  test('the login kept on the appointment, while it still has that name', () => {
    expect(repOf(staff, { assignedTo: 'Testrep Alpha', assignedToUserId: 'a' })).toEqual({ userId: 'a', firstName: 'Testrep', lastName: 'Alpha', phone: '3525550142' })
    expect(repOf(staff, { assignedTo: 'Testrep Twin', assignedToUserId: 'b' })?.userId).toBe('b')
    expect(repOf(staff, { assignedTo: 'Someone Else', assignedToUserId: 'a' })).toBeNull()
  })
})
