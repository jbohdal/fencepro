/**
 * Integration Registry
 *
 * Central registry of all available integrations.
 * Adapters self-register here. The API routes query this to build the UI.
 */

import type { IntegrationAdapter } from './types.js'

// Import adapters
import twilioAdapter from './adapters/twilio/index.js'
import weatherAdapter from './adapters/openweathermap/index.js'
import zapierAdapter from './adapters/zapier/index.js'

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
  { slug: 'quickbooks', name: 'QuickBooks Online', category: 'Accounting', description: 'Sync invoices, payments, and expenses with QuickBooks.', capabilities: ['push_invoice', 'sync_payments', 'pull_expenses'] },
  { slug: 'stripe', name: 'Stripe', category: 'Payments', description: 'Accept payments and send payment links from jobs.', capabilities: ['create_payment_link', 'receive_payment', 'refund'] },
  { slug: 'google_calendar', name: 'Google Calendar', category: 'Scheduling', description: 'Two-way sync between CRM schedule and Google Calendar.', capabilities: ['sync_calendar', 'push_events', 'pull_blocks'] },
  { slug: 'companycam', name: 'CompanyCam', category: 'Field Operations', description: 'Link job photos from CompanyCam projects.', capabilities: ['sync_photos', 'create_project', 'pull_photos'] },
  { slug: 'connecteam', name: 'Connecteam', category: 'Workforce Management', description: 'Sync crew schedules, time tracking, and tasks.', capabilities: ['sync_employees', 'push_shifts', 'pull_timeclock'] },
  { slug: 'google_maps', name: 'Google Maps', category: 'Field Operations', description: 'Geocode addresses, route optimization, and map views.', capabilities: ['geocode', 'route_optimize', 'distance_calc'] },
  { slug: 'sendgrid', name: 'SendGrid', category: 'Communication', description: 'Transactional email delivery for customer notifications.', capabilities: ['send_email'] },
]

export { COMING_SOON }
