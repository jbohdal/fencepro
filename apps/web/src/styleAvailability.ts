/**
 * Which fence styles can be quoted. A style is offered for a new quote when it
 * is turned on (Active) and Available for quoting (Settings → Fence Styles).
 * Commercial and industrial pricing is on hold (Oct 2026): those styles are
 * not quotable until Jonathan sets their pricing and turns them back on.
 *
 * Pure (no browser code): the server runs it inside the estimate bundle.
 */

/** What a customer is told when they ask for a style that is not quotable. */
export const NOT_QUOTABLE_MESSAGE = 'Call us for commercial and industrial fencing'

interface StyleFlags { isActive?: boolean; quotable?: boolean; held?: string }

/** Turned on and available for quoting (its own switch, and nothing above it in the choice tree holding it back). */
export function isQuotable(s: StyleFlags | null | undefined): boolean {
  return !!s && s.isActive !== false && s.quotable !== false && !s.held
}

/** Turned on but not available for quoting (on hold). */
export function isOnHold(s: StyleFlags | null | undefined): boolean {
  return !!s && s.isActive !== false && s.quotable === false
}
