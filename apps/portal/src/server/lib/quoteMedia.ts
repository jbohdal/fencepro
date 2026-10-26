/**
 * The photos a quote has: the ones taken on the quote itself, and the
 * customer's own photos from the site visit (Oct 26, 2026, walkthrough round 2:
 * the visit's photos never reached the quote, so a repair proposal needed
 * "Send anyway").
 *
 * A customer's own photo is one taken on the customer (the visit's "How did
 * it go?" form, or the customer page's camera), not on another quote, a job
 * or a service request. It belongs to a quote made within 60 days after it
 * was taken (the same window as the same-job rule), so photos from a job
 * years ago never fill a new repair's photo count.
 *
 * Visibility is the photo's own: every photo shows to staff on the quote,
 * and only photos marked Customer go on the proposal the customer opens (any
 * kind: a new fence, a move or a repair) and count toward a move or repair
 * proposal's photo requirement (round 2 review, Oct 26 2026: the visit's
 * photos are saved Internal, so counting them sent a repair proposal out with
 * no photos at all). The customer never sees a photo's caption: captions are
 * staff words ("Ready to quote visit").
 *
 * Once sold, the job's photos and the crew's packet carry the quote's photos
 * and its visit photos too (jobQuoteMediaOr). The crew (the installer and the
 * crew packet) gets only those set to Crew or Customer, never Internal ones:
 * an Internal photo can be a supplier invoice with prices on it. The job's "Photos Uploaded" milestone still counts only
 * photos taken on the job itself (lib/jobTruth.ts).
 */

import prisma from './prisma.js'

export const VISIT_PHOTO_DAYS = 60
const DAY = 86_400_000

export interface QuoteCustomer { id: string; since: Date }

/** From when a customer's own photos count for a quote made at `madeAt`. */
export const visitPhotoSince = (madeAt: Date) => new Date(madeAt.getTime() - VISIT_PHOTO_DAYS * DAY)

/** Prisma OR clauses: the quote's own media, and its customer's own (visit) media. */
export function quoteMediaOr(quoteKey: string, customer: QuoteCustomer | null): any[] {
  const or: any[] = [{ quoteKey }]
  if (customer) or.push({ customerId: customer.id, quoteKey: null, jobId: null, serviceTicketId: null, createdAt: { gte: customer.since } })
  return or
}

/** The same rule for one item (the public proposal's photo link checks it). */
export function belongsToQuote(m: { quoteKey: string | null; jobId: string | null; customerId: string | null; serviceTicketId?: string | null; createdAt: Date }, quoteKey: string, customer: QuoteCustomer | null): boolean {
  if (m.quoteKey === quoteKey) return true
  return !!customer && m.customerId === customer.id && !m.quoteKey && !m.jobId && !m.serviceTicketId && m.createdAt.getTime() >= customer.since.getTime()
}

/**
 * Whose visit photos a quote shows: the saved quote's customer (window from
 * when it was made), else the customer the builder says it is being written
 * for (a draft not saved yet: window from now). Null when neither is known.
 */
export async function quoteCustomer(accountId: string, quoteKey: string, draftCustomerId?: string | null, now = new Date()): Promise<QuoteCustomer | null> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteKey, accountId }, select: { crmContactId: true, createdAt: true } }).catch(() => null)
  if (q?.crmContactId) return { id: q.crmContactId, since: visitPhotoSince(q.createdAt) }
  if (!draftCustomerId) return null
  const c = await prisma.crmContact.findFirst({ where: { id: draftCustomerId, accountId }, select: { id: true } }).catch(() => null)
  return c ? { id: c.id, since: visitPhotoSince(q?.createdAt ?? now) } : null
}

/** Photos marked Customer for a quote's proposal: its own and its customer's visit photos. Ids only: no staff caption reaches the customer. */
export async function proposalPhotos(q: { id: string; accountId: string }): Promise<Array<{ id: string }>> {
  const customer = await quoteCustomer(q.accountId, q.id)
  return prisma.mediaItem.findMany({
    where: { accountId: q.accountId, deletedAt: null, visibility: 'customer', kind: 'photo', OR: quoteMediaOr(q.id, customer) },
    orderBy: { takenAt: 'asc' }, take: 24, select: { id: true },
  }).catch(() => [] as Array<{ id: string }>)
}

/**
 * A job's quote's photos as Prisma OR clauses: the quote's own and its
 * customer's visit photos (the window from when the quote was made). Empty
 * for a job with no quote, or a quote in another account.
 */
export async function jobQuoteMediaOr(accountId: string, quoteId: string | null | undefined): Promise<any[]> {
  if (!quoteId) return []
  return quoteMediaOr(quoteId, await quoteCustomer(accountId, quoteId))
}
