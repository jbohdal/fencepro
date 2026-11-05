/**
 * A customer's properties (portal lib/properties.ts and routes/crm-contacts.ts
 * /:id/properties; Jonathan, Nov 5 2026): Home, a rental, an Airbnb; one
 * Primary; one sold or moved from kept, greyed out, with its history. Read
 * from and saved to the server each time (no copy kept on the phone); a save
 * reads the customer list again so search finds the new address.
 */

import { sendJson } from './syncHttp'
import { refreshCustomers } from './customerStore'

export interface Property {
  id: string
  crmContactId: string
  label: string
  address: string
  city: string | null
  state: string | null
  zip: string | null
  lat: number | null
  lng: number | null
  gateCode: string | null
  tenantName: string | null
  tenantPhone: string | null
  accessNotes: string | null
  isPrimary: boolean
  noLongerTheirsAt: string | null
  createdAt: string
}

export interface PropertyInput {
  label?: string
  address?: string
  city?: string | null
  state?: string | null
  zip?: string | null
  lat?: number | null
  lng?: number | null
  gateCode?: string | null
  tenantName?: string | null
  tenantPhone?: string | null
  accessNotes?: string | null
}

/** Labels offered (any word may be typed). */
export const PROPERTY_LABELS = ['Home', 'Rental', 'Airbnb', 'Vacation home', 'Business', 'Other']

export type PropertiesAnswer = { ok: true; properties: Property[]; made?: Property } | { ok: false; error: string; code?: string }

const failed = (r: Awaited<ReturnType<typeof sendJson>>, what: string): PropertiesAnswer =>
  ({ ok: false, error: r.result.ok ? what : r.status === 0 ? 'No signal. Try again when the phone has signal.' : (r.result.error || what), ...(typeof r.json?.code === 'string' ? { code: r.json.code } : {}) })

export async function loadProperties(customerId: string): Promise<PropertiesAnswer> {
  const r = await sendJson('GET', `/api/crm-contacts/${encodeURIComponent(customerId)}/properties`)
  return r.result.ok ? { ok: true, properties: (r.json?.data ?? []) as Property[] } : failed(r, 'The properties did not load.')
}

export async function addProperty(customerId: string, input: PropertyInput & { primary?: boolean }): Promise<PropertiesAnswer> {
  const r = await sendJson('POST', `/api/crm-contacts/${encodeURIComponent(customerId)}/properties`, input)
  if (!r.result.ok) return failed(r, 'The property was not saved.')
  void refreshCustomers()
  return { ok: true, properties: (r.json?.properties ?? []) as Property[], made: r.json?.data as Property }
}

export async function changeProperty(customerId: string, propertyId: string, input: PropertyInput & { primary?: boolean; noLongerTheirs?: boolean; confirmMove?: boolean }): Promise<PropertiesAnswer> {
  const r = await sendJson('PATCH', `/api/crm-contacts/${encodeURIComponent(customerId)}/properties/${encodeURIComponent(propertyId)}`, input)
  if (!r.result.ok) return failed(r, 'The property was not saved.')
  void refreshCustomers()
  return { ok: true, properties: (r.json?.properties ?? []) as Property[], made: r.json?.data as Property }
}

/** "Rental, 123 Main St" for a choice list; "No longer theirs" ones say so. */
export function propertyLine(p: Pick<Property, 'label' | 'address' | 'isPrimary' | 'noLongerTheirsAt'>): string {
  return `${p.label || 'Property'}${p.isPrimary ? ' (Primary)' : ''}: ${p.address || 'no address yet'}${p.noLongerTheirsAt ? ' (no longer theirs)' : ''}`
}
