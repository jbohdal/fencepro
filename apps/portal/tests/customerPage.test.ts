/**
 * The customer page's tabs and summary row (apps/web/src/customerPage.ts):
 * the tabs most used first, Job costing only for a login that sees costs,
 * Details only when there is no details column, the tab in the address, and
 * the open quotes and balance due in cents.
 */
import { describe, test, expect } from 'vitest'
import {
  CUSTOMER_TABS, CUSTOMER_TAB_LABEL, asCustomerTab, customerTabsFor, shownCustomerTab, withTab, openQuotesOf, balanceDueCents, backLinkWords,
} from '../../web/src/customerPage'

describe('back links (review Oct 28 2026: "Back to manuel cotrich", "Back to quote #aaa8eb")', () => {
  test('a screen in small letters; the pipeline by its short name', () => {
    expect(backLinkWords('Quotes')).toBe('Back to quotes')
    expect(backLinkWords('Follow ups')).toBe('Back to follow ups')
    expect(backLinkWords('Sales Pipeline')).toBe('Back to pipeline')
    expect(backLinkWords('Inventory')).toBe('Back to inventory')
    expect(backLinkWords(undefined)).toBe('Back')
  })
  test('a customer by name as stored, capitals added to a name stored in small letters; a quote as Quote #', () => {
    expect(backLinkWords('Manuel Cotrich')).toBe('Back to Manuel Cotrich')
    expect(backLinkWords('manuel cotrich')).toBe('Back to Manuel Cotrich')
    expect(backLinkWords("mary-jo o'neil")).toBe("Back to Mary-Jo O'Neil")
    expect(backLinkWords('DeShawn McRae')).toBe('Back to DeShawn McRae')
    expect(backLinkWords('Quote #aaa8eb')).toBe('Back to Quote #aaa8eb')
  })
})

describe('customer page tabs', () => {
  test('most used first: Activity, Quotes, Jobs, then the rest, Portal and Details last', () => {
    expect(CUSTOMER_TABS).toEqual(['activity', 'quotes', 'jobs', 'appointments', 'billing', 'costing', 'photos', 'files', 'pullsheets', 'notes', 'portal', 'overview'])
    expect(CUSTOMER_TABS.map(t => CUSTOMER_TAB_LABEL[t])).toEqual(['Activity', 'Quotes', 'Jobs', 'Appointments', 'Billing', 'Job costing', 'Photos', 'Files', 'Pull sheets', 'Notes', 'Portal', 'Details'])
  })

  test('Job costing only for a login that sees costs; Details only without the details column', () => {
    expect(customerTabsFor({ costs: true, detailsColumn: true })).not.toContain('overview')
    expect(customerTabsFor({ costs: true, detailsColumn: true })).toContain('costing')
    expect(customerTabsFor({ costs: false, detailsColumn: false })).not.toContain('costing')
    expect(customerTabsFor({ costs: false, detailsColumn: false })).toContain('overview')
    expect(customerTabsFor({ costs: true, detailsColumn: false })).toHaveLength(12)
  })

  test('a tab from a link or from before: known names, "messages" is the Portal tab now, anything else is none', () => {
    expect(asCustomerTab('quotes')).toBe('quotes')
    expect(asCustomerTab('messages')).toBe('portal')
    expect(asCustomerTab('overview')).toBe('overview')
    expect(asCustomerTab('nope')).toBeNull()
    expect(asCustomerTab(null)).toBeNull()
    expect(asCustomerTab('')).toBeNull()
  })

  test('the tab shown: the one asked for when this screen has it, else Activity', () => {
    const wide = customerTabsFor({ costs: true, detailsColumn: true })
    const narrowNoCosts = customerTabsFor({ costs: false, detailsColumn: false })
    expect(shownCustomerTab('photos', wide)).toBe('photos')
    expect(shownCustomerTab('overview', wide)).toBe('activity')     // the details are in the column already
    expect(shownCustomerTab('overview', narrowNoCosts)).toBe('overview')
    expect(shownCustomerTab('costing', narrowNoCosts)).toBe('activity') // no costs for this login
    expect(shownCustomerTab(null, wide)).toBe('activity')
  })

  test('the tab in the address keeps everything else there; Activity needs none', () => {
    expect(withTab('/customers/abc', 'quotes')).toBe('/customers/abc?tab=quotes')
    expect(withTab('/customers/abc?filter=missing-contact', 'photos')).toBe('/customers/abc?filter=missing-contact&tab=photos')
    expect(withTab('/customers/abc?tab=photos&qv=q1', 'notes')).toBe('/customers/abc?tab=notes&qv=q1')
    expect(withTab('/customers/abc?tab=photos', 'activity')).toBe('/customers/abc')
    expect(withTab('/customers/abc?filter=x&tab=photos', 'activity')).toBe('/customers/abc?filter=x')
  })
})

describe('customer page summary', () => {
  test('open quotes: drafts and sent ones, added up in cents (no float drift)', () => {
    expect(openQuotesOf([
      { status: 'DRAFT', price: 1234.56 }, { status: 'SENT', price: 0.1 }, { status: 'SENT', price: 0.2 },
      { status: 'SOLD', price: 9999 }, { status: 'LOST', price: 500 },
    ])).toEqual({ count: 3, cents: 123486 })
    expect(openQuotesOf([])).toEqual({ count: 0, cents: 0 })
  })

  test('balance due: each schedule\'s balance plus typed invoices not void and not already on a schedule', () => {
    expect(balanceDueCents([150000, 0, -500], [
      { balanceDueCents: 20000, status: 'sent' },
      { balanceDueCents: 7000, status: 'void' },                      // void: owes nothing
      { balanceDueCents: 30000, status: 'sent', adoptedJobId: 'j1' }, // counted in its job's schedule
      { balanceDueCents: 0, status: 'paid' },
    ])).toBe(170000)
    expect(balanceDueCents([], [])).toBe(0)
  })
})
