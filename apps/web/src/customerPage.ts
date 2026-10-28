/**
 * The customer page's tabs and summary numbers, kept apart from the screen so
 * they can be tested (apps/portal/tests/customerPage.test.ts).
 *
 * Tabs, most used first (Jonathan, Oct 26 2026): Activity, Quotes, Jobs,
 * Appointments, Billing, Job costing (costs only), Photos, Files, Pull sheets,
 * Notes, Portal; and Details on a screen too narrow for the details column.
 * The open tab is in the address (?tab=quotes), so a link, a reload or Back
 * opens the same tab.
 */

export type CustomerTab =
  | 'activity' | 'quotes' | 'jobs' | 'appointments' | 'billing' | 'costing'
  | 'photos' | 'files' | 'pullsheets' | 'notes' | 'portal' | 'overview'

export const CUSTOMER_TABS: readonly CustomerTab[] = [
  'activity', 'quotes', 'jobs', 'appointments', 'billing', 'costing',
  'photos', 'files', 'pullsheets', 'notes', 'portal', 'overview',
]

export const CUSTOMER_TAB_LABEL: Record<CustomerTab, string> = {
  activity: 'Activity', quotes: 'Quotes', jobs: 'Jobs', appointments: 'Appointments', billing: 'Billing',
  costing: 'Job costing', photos: 'Photos', files: 'Files', pullsheets: 'Pull sheets', notes: 'Notes',
  portal: 'Portal', overview: 'Details',
}

/** A tab named in a link or remembered from before. "messages" (the portal messages) is the Portal tab now. */
export function asCustomerTab(t: string | null | undefined): CustomerTab | null {
  if (!t) return null
  if (t === 'messages') return 'portal'
  return (CUSTOMER_TABS as readonly string[]).includes(t) ? (t as CustomerTab) : null
}

/**
 * The tabs this login sees on this screen. Job costing only for a login that
 * sees costs. Details only when the screen is too narrow for the details column
 * (on a wide screen the details are always on the left).
 */
export function customerTabsFor(opts: { costs: boolean; detailsColumn: boolean }): CustomerTab[] {
  return CUSTOMER_TABS.filter(t => (t !== 'costing' || opts.costs) && (t !== 'overview' || !opts.detailsColumn))
}

/** The tab to show: the one asked for when this login and screen have it, else Activity. */
export function shownCustomerTab(asked: CustomerTab | null, tabs: readonly CustomerTab[]): CustomerTab {
  return asked && tabs.includes(asked) ? asked : 'activity'
}

/** The address with ?tab= set to this tab (none for Activity, the first one), every other part kept (?filter=, ?qv=, ...). */
export function withTab(pathAndQuery: string, tab: CustomerTab): string {
  const [path, query = ''] = pathAndQuery.split('?')
  const params = new URLSearchParams(query)
  if (tab === 'activity') params.delete('tab'); else params.set('tab', tab)
  const q = params.toString()
  return q ? `${path}?${q}` : path
}

/** Open quotes: drafts and sent ones (not sold, not lost), with what they add up to in cents. */
export function openQuotesOf(quotes: ReadonlyArray<{ status: string; price: number }>): { count: number; cents: number } {
  const open = quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT')
  return { count: open.length, cents: open.reduce((s, q) => s + Math.round((q.price || 0) * 100), 0) }
}

/**
 * What the customer still owes, in cents: each sold job's payment schedule
 * balance, plus invoices typed in Billing before payment schedules that are not
 * void and not already on a job's schedule (those are counted in its balance).
 */
export function balanceDueCents(
  scheduleBalances: ReadonlyArray<number>,
  oldInvoices: ReadonlyArray<{ balanceDueCents: number; status: string; adoptedJobId?: string | null }>,
): number {
  const schedules = scheduleBalances.reduce((s, b) => s + Math.max(0, Math.round(b || 0)), 0)
  const typed = oldInvoices.filter(i => i.status !== 'void' && !i.adoptedJobId).reduce((s, i) => s + Math.max(0, Math.round(i.balanceDueCents || 0)), 0)
  return schedules + typed
}

/**
 * What the Balance due tile says. "Nothing owed" only when that is known: the
 * payment schedules loaded and every signed job has one. A signed job with no
 * schedule yet (signed before payment schedules) is never "Nothing owed": what
 * it owes is not known until its schedule is made on the Billing tab.
 * `loaded`: null while the schedules load, false when they could not (no signal).
 */
export function balanceTile(o: { loaded: boolean | null; balanceCents: number; withoutSchedule: number }): {
  /** 'money': show balanceCents; 'none': no number to show (yet). */
  value: 'money' | 'none'
  words: string
  sub: string
  /** Orange: something is owed, or a signed job still needs its schedule. */
  attention: boolean
} {
  if (o.loaded === null && o.balanceCents <= 0) return { value: 'none', words: '…', sub: 'Loading', attention: false }
  if (o.loaded === false && o.balanceCents <= 0) return { value: 'none', words: 'Not loaded', sub: 'Needs signal', attention: false }
  if (o.withoutSchedule > 0) {
    const jobs = o.withoutSchedule === 1 ? 'a signed job' : `${o.withoutSchedule} signed jobs`
    return o.balanceCents > 0
      ? { value: 'money', words: '', sub: `Plus ${jobs} with no payment schedule yet`, attention: true }
      : { value: 'none', words: 'Not set up', sub: 'No payment schedule yet', attention: true }
  }
  return o.balanceCents > 0
    ? { value: 'money', words: '', sub: 'Open Billing', attention: true }
    : { value: 'money', words: '', sub: 'Nothing owed', attention: false }
}

/** "Signed before payment schedules…", with the job's fence style in front when it has one; always a proper sentence. */
export function withoutScheduleWords(style: string): string {
  const s = (style || '').trim()
  return `${s ? `${s}: signed` : 'Signed'} before payment schedules. Make its schedule from the contract (deposit and final).`
}

/**
 * When a history row happened, Florida time: "Oct 14, 1:09 AM" this year,
 * "Oct 14, 2025, 1:09 AM" in another year.
 */
export function historyWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const yearOf = (x: Date) => x.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric' })
  const sameYear = yearOf(d) === yearOf(now)
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })
}

/**
 * Who wrote a portal message, as the staff screen shows it: "You" for the one
 * signed in, else the staff member's name; the customer's name for theirs. Old
 * messages saved as "user" or "staff" (or a login email) show the company name.
 */
export function portalSenderLabel(m: { senderType: string; senderUser?: string | null }, o: { me: string | null; customerName: string; company: string }): string {
  if (m.senderType !== 'staff') return o.customerName.trim() || 'Customer'
  const who = (m.senderUser || '').trim()
  const real = !!who && !['user', 'staff', 'system'].includes(who.toLowerCase()) && !who.includes('@')
  if (real && o.me && who.toLowerCase() === o.me.trim().toLowerCase()) return 'You'
  return real ? who : (o.company.trim() || 'Staff')
}

/**
 * The pinned header goes compact (one line: name and stage) once the page is
 * scrolled down, and back to full at the top. Two different points so it never
 * flickers (the header getting shorter moves the page a little).
 */
export const COMPACT_AT = 96
export const FULL_AT = 8
export function nextCompact(compact: boolean, scrollTop: number): boolean {
  return compact ? scrollTop > FULL_AT : scrollTop > COMPACT_AT
}

/** Newest first (the customer's photos), by when taken; ties keep the order given; a date that is not text never breaks it. */
export function newestFirst<T extends { takenAt?: unknown }>(items: readonly T[]): T[] {
  return items.map((it, i) => ({ it, i }))
    .sort((a, b) => String(b.it.takenAt ?? '').localeCompare(String(a.it.takenAt ?? '')) || a.i - b.i)
    .map(x => x.it)
}

/**
 * What a tap on a Jobs tab row opens (round 3 recheck, Oct 26 2026; audit
 * #49, Oct 28 2026). A login that can open Operations gets the job's window
 * there. The Salesman cannot open Operations: the Salesman gets the job page,
 * read only and without costs (JobPage.tsx), never a bounce home.
 */
export type JobRowTarget =
  | { kind: 'operations'; path: string }
  | { kind: 'job'; path: string }
export function jobRowTarget(o: { jobId: string; canOpenOperations: boolean }): JobRowTarget {
  if (o.canOpenOperations) return { kind: 'operations', path: `/operations?job=${encodeURIComponent(o.jobId)}` }
  return { kind: 'job', path: `/job?id=${encodeURIComponent(o.jobId)}` }
}
