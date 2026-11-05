/**
 * A customer's properties (Jonathan, Nov 5 2026): customers move, or own a
 * rental or an Airbnb, so a customer has one or more properties, each with an
 * address (the county suggestions), a label (Home, Rental, Airbnb...) and
 * notes (gate code, tenant or property manager and phone, access notes). One
 * is Primary. One marked "No longer theirs" (moved, sold) stays with its
 * history, greyed out.
 *
 * Every quote, job, appointment (estimate visits too) and photo belongs to one
 * property (propertyId); permits and locates go by their job. The record keeps
 * its own copy of the address (customerAddress / address), set from its
 * property, and every reader (proposal, contract, pull sheet, the installer's
 * job, Dispatch, the map) reads that copy, never the billing address.
 *
 * The customer's own serviceAddress, city, state and ZIP are the Primary
 * property's, kept in step both ways (an older screen editing the customer's
 * address edits the Primary property), so everything that reads the customer's
 * address (search, the customer list, the Salesman's phone) reads the Primary.
 * Billing and mailing address stay on the customer.
 *
 * A record saved with a customer and an address but no property (an older
 * screen, the website, an import) is attached to the customer's property with
 * that address, or a new one is made for it; with no address, to the Primary.
 */

import prisma from './prisma.js'
import { addressParts, addressWords, countyPoint } from './addressIndex.js'

type Db = any

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

/** Street types in the county's words (addressIndex WORDS): the street part of an address ends with one. */
const STREET_TYPES = new Set(['ST', 'RD', 'AVE', 'CT', 'CIR', 'PL', 'TER', 'TRL', 'DR', 'LN', 'BLVD', 'TRCE', 'PKWY', 'PT', 'RUN', 'LOOP', 'LP', 'WAY', 'PASS', 'CV', 'XING', 'SQ', 'EXT', 'COURSE', 'RADIAL', 'MANOR', 'TRAK', 'TRACK', 'ROW', 'PATH', 'BND', 'GLN', 'HTS', 'XRD'])
/** The same street type written another way ("Str", "Crse", "Radl"). */
const SAME_TYPE: Record<string, string> = { LP: 'LOOP', STR: 'ST', CRSE: 'COURSE', CRS: 'COURSE', RADL: 'RADIAL', MNR: 'MANOR', CRT: 'CT', TRK: 'TRACK', BEND: 'BND', GLEN: 'GLN', WY: 'WAY' }
const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

/**
 * The street part of an address in the county's words, for "is this the same
 * property": "10116 Southwest 78th Court, Ocala FL", "10116 SW 78 Ct Ocala,
 * FL 34476" and "10116 SW 78th Ct" are one. The street part ends at its
 * street type (St, Ave, Ter...), a direction after it kept ("Hwy 40 E"), or
 * at the first comma when there is none. '' for a blank address.
 */
export function addressKey(address: string | null | undefined): string {
  const a = String(address ?? '').trim()
  if (!a) return ''
  const words = addressWords(a.split(',')[0] ?? '').map(w => SAME_TYPE[w] ?? w)
  let end = words.length
  for (let i = 2; i < words.length; i++) {
    if (STREET_TYPES.has(words[i])) { end = i + 1 + (DIRECTIONS.has(words[i + 1] ?? '') ? 1 : 0); break }
    // A highway: its number, and a direction after it.
    if (words[i - 1] === 'HWY' && /^\d+[A-Z]?$/.test(words[i])) { end = i + 1 + (DIRECTIONS.has(words[i + 1] ?? '') ? 1 : 0); break }
  }
  // No house number ("TBD", a PO Box line): not a property address to match on.
  if (!/\d/.test(words[0] ?? '')) return ''
  return words.slice(0, end).join(' ')
}

/** Two addresses are the same property. Blank never matches. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = addressKey(a)
  return !!x && x === addressKey(b)
}

/** Fill city, state, ZIP and the map point from the address when not sent. */
function filled(input: PropertyInput): PropertyInput {
  const out = { ...input }
  if (out.address !== undefined) {
    out.address = out.address.trim()
    const parts = addressParts(out.address)
    if (!out.city && parts.city) out.city = parts.city
    if (!out.state && parts.state) out.state = parts.state
    if (!out.zip && parts.zip) out.zip = parts.zip
    if ((out.lat == null || out.lng == null) && out.address) {
      const p = countyPoint(out.address)
      if (p) { out.lat = p.lat; out.lng = p.lng }
    }
  }
  return out
}

/** The customer's properties, Primary first, then the ones still theirs, newest first. */
export async function listProperties(db: Db, accountId: string, contactId: string) {
  const rows = await db.customerProperty.findMany({ where: { accountId, crmContactId: contactId }, orderBy: { createdAt: 'asc' } })
  return rows.sort((a: any, b: any) => (Number(b.isPrimary) - Number(a.isPrimary)) || (Number(!!a.noLongerTheirsAt) - Number(!!b.noLongerTheirsAt)) || (+new Date(b.createdAt) - +new Date(a.createdAt)))
}

/** The customer's address fields as the Primary property's. */
function mirrorOf(p: { address: string; city?: string | null; state?: string | null; zip?: string | null }) {
  return { serviceAddress: p.address || null, city: p.city ?? null, state: p.state ?? null, zip: p.zip ?? null }
}

/**
 * The customer's Primary property, made from the customer's address when they
 * have none yet (a customer saved before properties, or by a screen that does
 * not send one).
 */
export async function ensurePrimary(db: Db, accountId: string, contactId: string): Promise<any> {
  const primary = await db.customerProperty.findFirst({ where: { accountId, crmContactId: contactId, isPrimary: true } })
  if (primary) return primary
  const any = await db.customerProperty.findFirst({ where: { accountId, crmContactId: contactId, noLongerTheirsAt: null }, orderBy: { createdAt: 'asc' } })
  if (any) return db.customerProperty.update({ where: { id: any.id }, data: { isPrimary: true } })
  const c = await db.crmContact.findFirst({ where: { id: contactId, accountId }, select: { serviceAddress: true, city: true, state: true, zip: true } })
  if (!c) return null
  return db.customerProperty.create({ data: { accountId, crmContactId: contactId, label: 'Home', isPrimary: true, ...filled({ address: c.serviceAddress ?? '', city: c.city, state: c.state, zip: c.zip }) } })
}

/** Add a property. The first one is Primary; `primary` makes it so. */
export async function addProperty(db: Db, accountId: string, contactId: string, input: PropertyInput & { primary?: boolean }) {
  await ensurePrimary(db, accountId, contactId)
  const data = filled(input)
  const made = await db.customerProperty.create({
    data: {
      accountId, crmContactId: contactId, label: (data.label ?? '').trim() || 'Home', address: data.address ?? '',
      city: data.city ?? null, state: data.state ?? null, zip: data.zip ?? null, lat: data.lat ?? null, lng: data.lng ?? null,
      gateCode: data.gateCode ?? null, tenantName: data.tenantName ?? null, tenantPhone: data.tenantPhone ?? null, accessNotes: data.accessNotes ?? null,
    },
  })
  if (input.primary) return makePrimary(db, accountId, contactId, made.id)
  return made
}

/** Make this property the Primary: the customer's address becomes its address. */
export async function makePrimary(db: Db, accountId: string, contactId: string, propertyId: string) {
  const p = await db.customerProperty.findFirst({ where: { id: propertyId, accountId, crmContactId: contactId } })
  if (!p) return null
  await db.customerProperty.updateMany({ where: { accountId, crmContactId: contactId, isPrimary: true, NOT: { id: p.id } }, data: { isPrimary: false } })
  const now = await db.customerProperty.update({ where: { id: p.id }, data: { isPrimary: true, noLongerTheirsAt: null } })
  await db.crmContact.update({ where: { id: contactId }, data: mirrorOf(now) })
  return now
}

/**
 * Change a property. Its address changed: the address copy on its records
 * that are not yet final follows (draft and unsent quotes, jobs not yet
 * installed, appointments still ahead); a sent or signed quote, a finished job
 * and a past visit keep the address they were made with. On the Primary, the
 * customer's address follows.
 */
export async function updateProperty(db: Db, accountId: string, contactId: string, propertyId: string, input: PropertyInput, opts: { draftsOnly?: boolean } = {}) {
  const was = await db.customerProperty.findFirst({ where: { id: propertyId, accountId, crmContactId: contactId } })
  if (!was) return null
  const data = filled(input)
  const addressChanged = data.address !== undefined && data.address !== was.address
  if (addressChanged && data.lat === undefined) { data.lat = data.lat ?? null; data.lng = data.lng ?? null; const f = filled({ address: data.address }); data.lat = f.lat ?? null; data.lng = f.lng ?? null }
  const clean = (v: string | null | undefined) => (v === undefined ? undefined : (v ?? '').trim() || null)
  const now = await db.customerProperty.update({
    where: { id: was.id },
    data: {
      label: data.label === undefined ? undefined : data.label.trim() || was.label,
      address: data.address,
      city: addressChanged ? data.city ?? null : clean(data.city),
      state: addressChanged ? data.state ?? null : clean(data.state),
      zip: addressChanged ? data.zip ?? null : clean(data.zip),
      lat: addressChanged ? data.lat ?? null : data.lat,
      lng: addressChanged ? data.lng ?? null : data.lng,
      gateCode: clean(data.gateCode), tenantName: clean(data.tenantName), tenantPhone: clean(data.tenantPhone), accessNotes: clean(data.accessNotes),
    },
  })
  if (addressChanged) await followAddress(db, accountId, now, opts)
  if (now.isPrimary && (addressChanged || data.city !== undefined || data.state !== undefined || data.zip !== undefined)) {
    await db.crmContact.update({ where: { id: contactId }, data: mirrorOf(now) })
  }
  return now
}

/**
 * What a change of this property's address would move: its jobs not yet
 * installed and its visits ahead (signed work: the crew goes to the new
 * address, the signed contract keeps the old one), and its draft quotes.
 */
export async function wouldFollow(db: Db, accountId: string, propertyId: string): Promise<{ quotes: number; jobs: number; appointments: number }> {
  const [quotes, jobs, appointments] = await Promise.all([
    db.savedQuote.count({ where: { accountId, propertyId, deletedAt: null, status: 'DRAFT', acceptedAt: null, soldAt: null } }),
    db.savedJob.count({ where: { accountId, propertyId, deletedAt: null, status: { in: ['staging', 'scheduled', 'on_hold'] } } }),
    db.appointment.count({ where: { accountId, propertyId, deletedAt: null, OR: [{ startAt: null }, { startAt: { gte: new Date() } }] } }),
  ])
  return { quotes, jobs, appointments }
}

/** The records of a property not yet final take its new address. */
async function followAddress(db: Db, accountId: string, p: any, opts: { draftsOnly?: boolean } = {}): Promise<{ quotes: number; jobs: number; appointments: number }> {
  const quotes = await db.savedQuote.updateMany({
    where: { accountId, propertyId: p.id, deletedAt: null, status: 'DRAFT', acceptedAt: null, soldAt: null },
    data: { customerAddress: p.address },
  }).catch(() => ({ count: 0 }))
  if (opts.draftsOnly) return { quotes: quotes.count, jobs: 0, appointments: 0 }
  const jobs = await db.savedJob.updateMany({
    where: { accountId, propertyId: p.id, deletedAt: null, status: { in: ['staging', 'scheduled', 'on_hold'] } },
    data: { customerAddress: p.address, lat: p.lat, lng: p.lng },
  }).catch(() => ({ count: 0 }))
  const appointments = await db.appointment.updateMany({
    where: { accountId, propertyId: p.id, deletedAt: null, OR: [{ startAt: null }, { startAt: { gte: new Date() } }] },
    data: { address: p.address, lat: p.lat, lng: p.lng },
  }).catch(() => ({ count: 0 }))
  return { quotes: quotes.count, jobs: jobs.count, appointments: appointments.count }
}

/**
 * Mark a property "No longer theirs" (moved, sold) or theirs again. It keeps
 * its records. The Primary cannot be: make another one Primary first (the
 * screen offers it).
 */
export async function setNoLongerTheirs(db: Db, accountId: string, contactId: string, propertyId: string, gone: boolean) {
  const p = await db.customerProperty.findFirst({ where: { id: propertyId, accountId, crmContactId: contactId } })
  if (!p) return null
  if (gone && p.isPrimary) throw new PropertyError(409, 'This is the Primary property. Make another property Primary first, then mark this one No longer theirs.')
  return db.customerProperty.update({ where: { id: p.id }, data: { noLongerTheirsAt: gone ? (p.noLongerTheirsAt ?? new Date()) : null } })
}

export class PropertyError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/**
 * Which property a record belongs to. A property id sent is kept when it is
 * this customer's. Otherwise: the customer's property with this address, the
 * Primary when there is no address (or it is the customer's own address), or
 * a new property for an address the customer has none for (labeled Other).
 */
export async function propertyFor(db: Db, accountId: string, contactId: string | null | undefined, input: { propertyId?: string | null; address?: string | null }): Promise<any | null> {
  if (!contactId) return null
  if (input.propertyId) {
    const p = await db.customerProperty.findFirst({ where: { id: input.propertyId, accountId, crmContactId: contactId } })
    if (p) return p
  }
  const primary = await ensurePrimary(db, accountId, contactId)
  if (!primary) return null
  const address = String(input.address ?? '').trim()
  if (!address || sameAddress(address, primary.address) || !addressKey(address)) return primary
  const all = await db.customerProperty.findMany({ where: { accountId, crmContactId: contactId } })
  const found = all.find((p: any) => sameAddress(p.address, address))
  if (found) return found
  return db.customerProperty.create({ data: { accountId, crmContactId: contactId, label: 'Other', ...filled({ address }) } })
}

/**
 * A customer saved by an older screen with a new address: the Primary
 * property's address follows (it is the same address field). Run after the
 * customer's save.
 */
export async function primaryFollowsCustomer(db: Db, accountId: string, contact: { id: string; serviceAddress: string | null; city: string | null; state: string | null; zip: string | null }) {
  const primary = await ensurePrimary(db, accountId, contact.id)
  if (!primary) return
  const address = (contact.serviceAddress ?? '').trim()
  if (address === primary.address && (contact.city ?? null) === (primary.city ?? null) && (contact.zip ?? null) === (primary.zip ?? null)) return
  // As before properties: the customer form's address change moves no job or visit (it asks nothing); drafts follow.
  await updateProperty(db, accountId, contact.id, primary.id, { address, city: contact.city, state: contact.state, zip: contact.zip }, { draftsOnly: true })
}

/**
 * Customers with a property at this address (any of their properties, still
 * theirs or not), for search and the duplicate checks. The contact ids.
 */
export async function contactsAtAddress(db: Db, accountId: string, address: string | null | undefined, opts: { exceptContactId?: string } = {}): Promise<string[]> {
  const key = addressKey(address)
  if (!key) return []
  const number = key.split(' ')[0]
  // House number first (a cheap match in the database), then the whole street in the county's words.
  const rows = await db.customerProperty.findMany({ where: { accountId, address: { startsWith: number } }, select: { crmContactId: true, address: true } })
  // And the customer's own address (the Primary's): one saved by a path that made no property row yet is found too.
  const own = await db.crmContact.findMany({ where: { accountId, deletedAt: null, serviceAddress: { startsWith: number } }, select: { id: true, serviceAddress: true } })
  const ids = new Set<string>()
  for (const r of rows) if (addressKey(r.address) === key && r.crmContactId !== opts.exceptContactId) ids.add(r.crmContactId)
  for (const c of own) if (addressKey(c.serviceAddress) === key && c.id !== opts.exceptContactId) ids.add(c.id)
  return [...ids]
}

/** Every property address of these customers, for search, and how many are still theirs ({ contactId: { addresses, active } }). */
export async function addressesOf(db: Db, accountId: string, contactIds?: string[]): Promise<Map<string, { addresses: string[]; active: number }>> {
  const rows = await db.customerProperty.findMany({ where: { accountId, ...(contactIds ? { crmContactId: { in: contactIds } } : {}) }, select: { crmContactId: true, address: true, noLongerTheirsAt: true } })
  const out = new Map<string, { addresses: string[]; active: number }>()
  for (const r of rows) {
    const o = out.get(r.crmContactId) ?? { addresses: [], active: 0 }
    if (r.address) o.addresses.push(r.address)
    if (!r.noLongerTheirsAt) o.active++
    out.set(r.crmContactId, o)
  }
  return out
}

export const defaultDb = prisma

/**
 * Where a saved record goes: its property id, and the address its copy keeps.
 * A property picked on the screen (its id sent) gives its address; otherwise
 * the record's address finds (or makes) the property and stays as typed.
 */
export async function placeRecord(db: Db, accountId: string, contactId: string | null | undefined, input: { propertyId?: string | null; address?: string | null }): Promise<{ propertyId: string | null; address: string | undefined }> {
  const p = await propertyFor(db, accountId, contactId, input)
  if (!p) return { propertyId: null, address: undefined }
  const picked = !!input.propertyId && p.id === input.propertyId
  return { propertyId: p.id, address: picked && p.address ? p.address : undefined }
}

/** A job's property: its quote's (the job is that quote's work), else as any record, by the one picked or its address. */
export async function jobPropertyId(db: Db, accountId: string, contactId: string | null | undefined, input: { quoteId?: string | null; propertyId?: string | null; address?: string | null }): Promise<string | null> {
  if (!contactId) return null
  if (input.quoteId) {
    const q = await db.savedQuote.findFirst({ where: { id: input.quoteId, accountId }, select: { propertyId: true, crmContactId: true } })
    if (q?.propertyId && q.crmContactId === contactId) return q.propertyId
  }
  return (await placeRecord(db, accountId, contactId, input)).propertyId
}
