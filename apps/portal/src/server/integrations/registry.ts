/**
 * Integration Registry
 *
 * Central registry of all available integrations.
 * Adapters self-register here. The API routes query this to build the UI.
 */

import type { IntegrationAdapter } from './types.js'

// Import adapters that are actively registered (i.e. usable today)
import twilioAdapter from './adapters/twilio/index.js'
import weatherAdapter from './adapters/openweathermap/index.js'
import zapierAdapter from './adapters/zapier/index.js'

// NOTE: Stripe, QuickBooks and CompanyCam adapters exist on disk (under
// ./adapters/{stripe,quickbooks,companycam}/index.ts) but are intentionally NOT
// registered here yet. They are listed in COMING_SOON below so they appear in the
// integrations UI as "Coming Soon". To enable any of them, import the adapter and
// call registerAdapter() with it, and remove its entry from COMING_SOON.
//
// Google Calendar and SendGrid are built in (BUILT_IN below): they are set up
// elsewhere, and the list shows whether they are working.

const adapters = new Map<string, IntegrationAdapter>()

/** Register an adapter */
export function registerAdapter(adapter: IntegrationAdapter): void {
  adapters.set(adapter.slug, adapter)
}

/** Get a specific adapter by slug */
export function getAdapter(slug: string): IntegrationAdapter | undefined {
  return adapters.get(slug)
}

/** Get all registered adapters */
export function getAllAdapters(): IntegrationAdapter[] {
  return Array.from(adapters.values())
}

/** Get adapters by category */
export function getAdaptersByCategory(category: string): IntegrationAdapter[] {
  return Array.from(adapters.values()).filter(a => a.category === category)
}

// ── Register all adapters ──
registerAdapter(twilioAdapter)
registerAdapter(weatherAdapter)
registerAdapter(zapierAdapter)

// Stub entries for future adapters (shown in UI as "Coming Soon")
const COMING_SOON: Partial<IntegrationAdapter>[] = [
  { slug: 'stripe', name: 'Stripe', category: 'Payments', description: 'Generate payment links from invoices and auto-mark invoices paid via webhook.', capabilities: ['payment_links', 'webhook_status_updates'] },
  { slug: 'quickbooks', name: 'QuickBooks Online', category: 'Accounting', description: 'Push new invoices to QBO and pull expenses for P&L reporting.', capabilities: ['push_invoices', 'pull_expenses'] },
  { slug: 'companycam', name: 'CompanyCam', category: 'Field Operations', description: 'Surface job-site photos from CompanyCam in the customer portal.', capabilities: ['pull_photos', 'webhook_photo_updates'] },
  { slug: 'connecteam', name: 'Connecteam', category: 'Workforce Management', description: 'Sync crew schedules, time tracking, and tasks.', capabilities: ['sync_employees', 'push_shifts', 'pull_timeclock'] },
  { slug: 'google_maps', name: 'Google Maps', category: 'Field Operations', description: 'Geocode addresses, route optimization, and map views.', capabilities: ['geocode', 'route_optimize', 'distance_calc'] },
]

/**
 * Built in: working parts of the app that are set up somewhere else, not with
 * a Connect form. The list route works out whether each is connected.
 *   google_calendar: Settings > Google Calendar (lib/calendarSync)
 *   sendgrid: email, sent with SENDGRID_API_KEY in the server's settings file (lib/emailService.ts)
 */
const BUILT_IN: Partial<IntegrationAdapter>[] = [
  { slug: 'google_calendar', name: 'Google Calendar', category: 'Scheduling', description: 'Installs and appointments go to the company calendar on Google.', capabilities: ['push_events'] },
  { slug: 'sendgrid', name: 'SendGrid', category: 'Communication', description: 'Sends the app\u2019s email: sign-in invites, password resets and notices.', capabilities: ['send_email'] },
]

export { COMING_SOON, BUILT_IN }
