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

// NOTE: Stripe, QuickBooks, Google Calendar, and CompanyCam adapters exist on disk
// (under ./adapters/{stripe,quickbooks,google_calendar,companycam}/index.ts) but are
// intentionally NOT registered here yet. They are listed in COMING_SOON below so they
// appear in the integrations UI as "Connect later" placeholders. To enable any of them,
// import the adapter and call registerAdapter() with it, and remove its entry from
// COMING_SOON.

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
  { slug: 'google_calendar', name: 'Google Calendar', category: 'Scheduling', description: 'Two-way sync between portal appointments and your reps\u2019 calendars.', capabilities: ['push_events', 'pull_events', 'two_way_sync'] },
  { slug: 'companycam', name: 'CompanyCam', category: 'Field Operations', description: 'Surface job-site photos from CompanyCam in the customer portal.', capabilities: ['pull_photos', 'webhook_photo_updates'] },
  { slug: 'connecteam', name: 'Connecteam', category: 'Workforce Management', description: 'Sync crew schedules, time tracking, and tasks.', capabilities: ['sync_employees', 'push_shifts', 'pull_timeclock'] },
  { slug: 'google_maps', name: 'Google Maps', category: 'Field Operations', description: 'Geocode addresses, route optimization, and map views.', capabilities: ['geocode', 'route_optimize', 'distance_calc'] },
  { slug: 'sendgrid', name: 'SendGrid', category: 'Communication', description: 'Transactional email delivery for customer notifications.', capabilities: ['send_email'] },
]

export { COMING_SOON }
