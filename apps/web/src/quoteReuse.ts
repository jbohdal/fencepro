/**
 * "Ready to quote" (an estimate closed out on the phone) and a pipeline
 * card's quote button open the customer's draft quote when there is one,
 * instead of a blank quote: the website quote the customer drew (its yard on
 * the aerial photo, sides and gates, lib/widgetDrawQuote.ts on the server)
 * or a draft someone already started. The site visit's footage and notes go
 * into that draft's notes. No second draft is made (Oct 24, 2026
 * walkthrough: Christa redrew a website lead from a blank quote and two
 * identical $7,762 drafts resulted).
 */

import type { SavedQuote } from './QuotesPage'

type Draftish = Pick<SavedQuote, 'id' | 'customerId' | 'status' | 'date' | 'notes' | 'customerAddress'> & {
  work?: { type?: string } | null
  layout?: { widgetDrawing?: unknown } | null
  acceptedAt?: string
  soldAt?: string | null
}

/** A draft for a new fence (not a repair or a move), never sent, signed or sold. */
const isOpenFenceDraft = (q: Draftish) =>
  q.status === 'DRAFT' && !q.acceptedAt && !q.soldAt && !(q.work && (q.work.type === 'repair' || q.work.type === 'move'))

/**
 * The customer's draft to open instead of a new quote: the website quote
 * first (it has the customer's drawing), else the newest draft. null when
 * the customer has none.
 */
export function draftToReuse<Q extends Draftish>(quotes: Q[], customerId: string | null | undefined): Q | null {
  if (!customerId) return null
  const mine = quotes.filter(q => q.id && q.customerId === customerId && isOpenFenceDraft(q))
  if (!mine.length) return null
  const newest = (a: Q, b: Q) => (b.date || '').localeCompare(a.date || '')
  const website = mine.filter(q => !!q.layout?.widgetDrawing).sort(newest)
  return website[0] ?? [...mine].sort(newest)[0]
}

/** The customer's last site visit that was closed out (its footage, notes and day), or null. */
export function lastVisit<A extends { crmContactId: string; status: string; outcome?: string | null; startAt?: string | null; completedAt?: string | null; measuredFeet?: number | null; outcomeNotes?: string }>(appointments: A[], customerId: string | null | undefined): A | null {
  if (!customerId) return null
  const done = appointments.filter(a => a.crmContactId === customerId && a.status === 'completed' && (a.outcome || a.measuredFeet || (a.outcomeNotes || '').trim()))
  const when = (a: A) => a.completedAt || a.startAt || ''
  return done.sort((x, y) => when(y).localeCompare(when(x)))[0] ?? null
}

/**
 * The photos from that visit: the ones the phone's "How did it go?" form
 * uploaded (captioned "… visit"), else the office's photos taken that day
 * (Florida time). Newest first.
 */
export function visitPhotos<P extends { source: string; caption?: string | null; uploadedAt: string }>(photos: P[], visitDay: string | null, dayOf: (iso: string) => string): P[] {
  const staff = photos.filter(p => p.source === 'crm_staff')
  const tagged = staff.filter(p => /\bvisit$/i.test((p.caption || '').trim()))
  const list = tagged.length ? tagged : visitDay ? staff.filter(p => dayOf(p.uploadedAt) === visitDay) : []
  return [...list].sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''))
}

/**
 * The draft with the site visit added: the visit's notes (measured footage,
 * what was seen) after the draft's own notes, once (opening it again does
 * not add them twice); the visit's address when the draft has none.
 */
export function withVisit<Q extends Draftish>(q: Q, visit: { notes?: string; address?: string }): Q {
  const add = (visit.notes || '').trim()
  const notes = (q.notes || '').trim()
  const nextNotes = !add || notes.includes(add) ? q.notes : [notes, `Site visit: ${add}`].filter(Boolean).join('\n')
  const address = (q.customerAddress || '').trim() ? q.customerAddress : (visit.address || q.customerAddress)
  return nextNotes === q.notes && address === q.customerAddress ? q : { ...q, notes: nextNotes, customerAddress: address }
}
