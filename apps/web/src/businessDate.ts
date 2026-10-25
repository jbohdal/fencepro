/**
 * Calendar dates as the business sees them. Timestamps are stored in UTC, so
 * a customer added at 9 pm in Florida is already "tomorrow" in UTC; cutting
 * the date off the UTC string shows the wrong day.
 */

export const BUSINESS_TIME_ZONE = 'America/New_York'

// en-CA formats a date as YYYY-MM-DD.
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** YYYY-MM-DD in Florida for a stored timestamp. A plain date is returned as
 *  it is; anything unreadable gives ''. */
export function businessDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : dayFormat.format(d)
}

/**
 * A day for people: "Fri, Oct 23" (this year) or "Fri, Oct 23, 2025". A
 * record's YYYY-MM-DD (or an ISO time, read as the Florida day) is shown this
 * way everywhere instead of "2026-10-23" (review, Oct 25, 2026). Anything else
 * comes back as it was.
 */
export function dayWords(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return ''
  const ymd = businessDate(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return typeof value === 'string' ? value : ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  const sameYear = Number(m[1]) === Number(businessDate(now).slice(0, 4))
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}
