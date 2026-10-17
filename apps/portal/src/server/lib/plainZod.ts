/**
 * A refused form, in plain words. Zod's own text ("String must contain at
 * least 8 character(s)", "Expected number, received string") never goes back
 * to the screen; a sentence naming the field does.
 */
import type { ZodError, ZodIssue } from 'zod'

const LABELS: Record<string, string> = {
  id: 'the record\'s id', firstName: 'First name', lastName: 'Last name', email: 'Email address', phone: 'Phone number',
  serviceAddress: 'Address', billingAddress: 'Billing address', zip: 'ZIP code', startAt: 'Start time', endAt: 'End time',
  crmContactId: 'Customer', customerName: 'Customer name', fenceStyle: 'Fence style', body: 'Note', password: 'Password',
}

function label(path: (string | number)[]): string {
  const key = [...path].reverse().find(p => typeof p === 'string') as string | undefined
  if (!key) return 'Something in the form'
  return LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
}

/** Zod's default messages; anything else was written for people already. */
const DEFAULT = /^(String must|Number must|Array must|Expected |Required$|Invalid( input| type| enum| literal| date| string)?|Unrecognized key)/

export function plainIssue(i: ZodIssue): string {
  if (!DEFAULT.test(i.message)) return /[.!?]$/.test(i.message) ? i.message : `${i.message}.`
  const f = label(i.path)
  if (i.path[i.path.length - 1] === 'id') return 'The app sent a record id the server does not accept. Update the app (close and reopen it), then try again.'
  switch (i.code) {
    case 'invalid_type': return i.received === 'undefined' ? `${f} is missing.` : `${f} is not in the right form.`
    case 'too_small': return i.type === 'string' && i.minimum === 1 ? `${f} is missing.` : `${f} is too short.`
    case 'too_big': return `${f} is too long.`
    case 'invalid_string': return i.validation === 'email' ? 'The email address does not look right. Check it, or leave it empty.' : `${f} does not look right.`
    case 'invalid_enum_value': return `${f} is not one of the choices.`
    default: return `${f} does not look right.`
  }
}

export function plainZod(err: ZodError): string {
  return plainIssue(err.errors[0])
}
