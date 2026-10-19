/**
 * Customers list filters, reachable by address (/customers?filter=<key>).
 * Pure, so the tests check them.
 *
 *   missing-contact           no phone and no email (archived customers are
 *                             never in the list)
 *   missing-contact-schedule  the same, made from the GD Schedule (the Finish
 *                             setup card counts these on the server, notes
 *                             containing "Created from the GD Schedule")
 */

interface ContactLike { phone?: string | null; email?: string | null; notes?: string | null }

export type CustomerFilter = '' | 'missing-contact' | 'missing-contact-schedule'

const noContact = (c: ContactLike) => !(c.phone ?? '').trim() && !(c.email ?? '').trim()

export const CUSTOMER_FILTERS: Record<Exclude<CustomerFilter, ''>, { label: string; test: (c: ContactLike) => boolean }> = {
  'missing-contact': { label: 'Missing contact info', test: noContact },
  'missing-contact-schedule': { label: 'Missing contact info, from the GD Schedule', test: c => noContact(c) && (c.notes ?? '').includes('Created from the GD Schedule') },
}

export function asCustomerFilter(v: unknown): CustomerFilter {
  return typeof v === 'string' && v in CUSTOMER_FILTERS ? v as CustomerFilter : ''
}
