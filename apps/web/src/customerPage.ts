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
