/**
 * Shared intake logic: turn something that arrived from outside the CRM (a
 * website quote, a phone call) into a customer contact, a note on that
 * contact, a notification, and a queued lead for the sales pipeline.
 *
 * The sales pipeline is one document that the browser saves as a whole, so
 * the server never edits it. It queues an IntakeLead instead and the CRM adds
 * the pipeline card the next time it checks (see apps/web/src/intakeStore.ts).
 */

import prisma from './prisma.js'

export type IntakeSource = 'ez_quote' | 'retell'

export interface IntakeInput {
  source: IntakeSource
  /** Unique per source: the website quote id or the Retell call id. */
  sourceRef: string
  name: string
  phone?: string
  email?: string
  address?: string
  fenceType?: string
  /** Plain text shown on the contact's Notes tab and in the notification. */
  summary: string
  estimate?: number | null
  callbackAt?: string | null
  leadSource: string
  payload: unknown
}

export function digits(phone: string | undefined | null): string {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: 'Unknown', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/** The one company this install serves (or INTAKE_ACCOUNT_ID if several exist). */
export async function resolveIntakeAccountId(): Promise<string | null> {
  if (process.env.INTAKE_ACCOUNT_ID) {
    const a = await prisma.crmAccount.findUnique({ where: { id: process.env.INTAKE_ACCOUNT_ID }, select: { id: true } })
    if (a) return a.id
  }
  const first = await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  return first?.id ?? null
}

/** Find the contact with the same phone or email, or create one. Never duplicates on a repeat caller. */
async function findOrCreateContact(accountId: string, input: IntakeInput): Promise<{ id: string; created: boolean; name: string }> {
  const phone10 = digits(input.phone)
  const email = (input.email || '').trim().toLowerCase()

  if (email) {
    const byEmail = await prisma.crmContact.findFirst({
      where: { accountId, archivedAt: null, email: { equals: email, mode: 'insensitive' } },
      select: { id: true, firstName: true, lastName: true },
    })
    if (byEmail) return { id: byEmail.id, created: false, name: `${byEmail.firstName} ${byEmail.lastName}`.trim() }
  }
  if (phone10.length >= 7) {
    // Phones are stored as typed ("(352) 555-0100"), so compare on digits.
    const candidates = await prisma.crmContact.findMany({
      where: { accountId, archivedAt: null, phone: { not: null } },
      select: { id: true, phone: true, firstName: true, lastName: true },
    })
    const hit = candidates.find(c => digits(c.phone) === phone10)
    if (hit) return { id: hit.id, created: false, name: `${hit.firstName} ${hit.lastName}`.trim() }
  }

  const { firstName, lastName } = splitName(input.name)
  const created = await prisma.crmContact.create({
    data: {
      accountId,
      firstName,
      lastName,
      email: email || null,
      phone: input.phone || null,
      serviceAddress: input.address || null,
      leadSource: input.leadSource,
      jobStatus: 'First Contact',
    },
    select: { id: true },
  })
  return { id: created.id, created: true, name: input.name }
}

export interface IntakeResult {
  intakeId: string
  contactId: string | null
  /** True when this sourceRef was already recorded (a retry or duplicate delivery). */
  duplicate: boolean
  /** The contact's name on file (an existing customer keeps their own name). */
  contactName: string
}

/**
 * Record one intake. Safe to call twice with the same source + sourceRef:
 * the second call changes nothing and reports duplicate.
 */
export async function recordIntake(accountId: string, input: IntakeInput): Promise<IntakeResult> {
  const existing = await prisma.intakeLead.findUnique({
    where: { source_sourceRef: { source: input.source, sourceRef: input.sourceRef } },
  })
  if (existing) return { intakeId: existing.id, contactId: existing.crmContactId, duplicate: true, contactName: existing.name }

  const contact = await findOrCreateContact(accountId, input)
  // A caller we already know is filed under the name we have for them.
  const displayName = contact.created ? input.name : (contact.name || input.name)

  let row
  try {
    row = await prisma.intakeLead.create({
      data: {
        accountId,
        source: input.source,
        sourceRef: input.sourceRef,
        crmContactId: contact.id,
        name: displayName.slice(0, 200),
        phone: (input.phone || '').slice(0, 40),
        email: (input.email || '').slice(0, 200),
        address: (input.address || '').slice(0, 500),
        fenceType: (input.fenceType || '').slice(0, 120),
        summary: input.summary.slice(0, 8000),
        estimate: typeof input.estimate === 'number' && Number.isFinite(input.estimate) ? input.estimate : null,
        callbackAt: input.callbackAt ? String(input.callbackAt).slice(0, 120) : null,
        payload: JSON.parse(JSON.stringify(input.payload ?? {})),
      },
    })
  } catch (err: any) {
    // Two deliveries of the same event raced; the other one won.
    if (err?.code === 'P2002') {
      const again = await prisma.intakeLead.findUnique({
        where: { source_sourceRef: { source: input.source, sourceRef: input.sourceRef } },
      })
      if (again) return { intakeId: again.id, contactId: again.crmContactId, duplicate: true, contactName: again.name }
    }
    throw err
  }

  const label = input.source === 'ez_quote' ? 'Website quote' : 'Phone call'
  await prisma.crmContactNote.create({
    data: {
      crmContactId: contact.id,
      accountId,
      body: input.summary.slice(0, 19000),
      isPinned: false,
      createdBy: input.source === 'ez_quote' ? 'EZ Quote (website)' : 'Phone agent (Retell)',
    },
  }).catch(err => console.error('[intake] note failed:', err))

  await prisma.notification.create({
    data: {
      title: `${label}: ${displayName || input.phone || 'new lead'}`,
      body: input.summary.split('\n').slice(0, 3).join(' · ').slice(0, 400),
      type: 'info',
    },
  }).catch(err => console.error('[intake] notification failed:', err))

  return { intakeId: row.id, contactId: contact.id, duplicate: false, contactName: displayName }
}
