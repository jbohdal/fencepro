/**
 * The visits booked with a login, for the installer's My installs (audit Oct
 * 26 2026: a covered warranty visit booked with the installer for Tuesday
 * never showed on his phone; he has no appointments screen, and the $0 work
 * order was only on a crew packet he had no way to open).
 *
 * His visits: appointments booked with him (by login, or by his full name on
 * an older booking) from today through AHEAD_DAYS, not cancelled, not closed
 * out, not an install (installs come from the install schedule). Each with the
 * customer, the address and phone, the notes, and for a warranty or service
 * request its issue, whether it is covered ($0, no charge to the customer)
 * and the job's crew packet when one is open. Never a price: notes go through
 * forCrew (a dollar amount is left out).
 */

import prisma from './prisma.js'
import { floridaYmd } from './crewInstall.js'
import { forCrew } from './costRedact.js'
import { issueLabel } from './serviceTicketModel.js'
import { serializeMedia } from './media.js'

// The same as My installs "Coming up" (web crewDays.ts AHEAD_DAYS): 60 days (review, Oct 27 2026).
export const VISIT_AHEAD_DAYS = 60
const CLOSED = new Set(['cancelled', 'completed', 'no_show'])

export interface CrewVisit {
  id: string
  type: string
  startAt: string
  endAt: string | null
  allDay: boolean
  /** Florida day, YYYY-MM-DD. */
  day: string
  customerName: string
  customerPhone: string
  address: string
  notes: string
  ticket: { id: string; issue: string; notes: string; covered: boolean; warrantyName: string; photos: Array<{ id: string; kind: string; thumb: string | null; url: string }> } | null
  packetToken: string | null
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Is this appointment one of his visits to show from `today` (Florida) for `aheadDays`? */
export function isCrewVisit(a: { type: string; status: string; startAt: Date | null; assignedTo: string; assignedToUserId: string | null; archivedAt?: Date | null; deletedAt?: Date | null }, me: { id: string; name: string }, today: string, aheadDays = VISIT_AHEAD_DAYS): boolean {
  if (!a.startAt || a.archivedAt || a.deletedAt || CLOSED.has(a.status) || a.type === 'install') return false
  const mine = a.assignedToUserId ? a.assignedToUserId === me.id : !!me.name && norm(a.assignedTo) === norm(me.name)
  if (!mine) return false
  const day = floridaYmd(a.startAt)
  const last = new Date(`${today}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + aheadDays)
  return day >= today && day <= last.toISOString().slice(0, 10)
}

export async function crewVisitsFor(accountId: string, userId: string, now = new Date()): Promise<CrewVisit[]> {
  const u = await prisma.crmUser.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }).catch(() => null)
  const me = { id: userId, name: `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() }
  const today = floridaYmd(now)
  const rows = await prisma.appointment.findMany({
    where: {
      accountId, deletedAt: null, archivedAt: null,
      startAt: { gte: new Date(now.getTime() - 36 * 3_600_000), lt: new Date(now.getTime() + (VISIT_AHEAD_DAYS + 2) * 86_400_000) },
      OR: [{ assignedToUserId: userId }, ...(me.name ? [{ assignedToUserId: null, assignedTo: { equals: me.name, mode: 'insensitive' as const } }] : [])],
    },
    include: { contact: { select: { firstName: true, lastName: true, phone: true, serviceAddress: true } } },
    orderBy: { startAt: 'asc' },
  })
  const mine = rows.filter(a => isCrewVisit(a, me, today))
  if (!mine.length) return []
  const tickets = await prisma.serviceTicket.findMany({ where: { accountId, deletedAt: null, appointmentId: { in: mine.map(a => a.id) } } })
  const ticketOf = new Map(tickets.map(t => [t.appointmentId!, t]))
  const packets = tickets.length ? await prisma.installPacket.findMany({ where: { accountId, jobId: { in: tickets.map(t => t.jobId) }, disabledAt: null }, select: { jobId: true, token: true } }) : []
  const packetOf = new Map(packets.map(p => [p.jobId, p.token]))
  const out: CrewVisit[] = []
  for (const a of mine) {
    const t = ticketOf.get(a.id)
    const photos = t ? (await prisma.mediaItem.findMany({ where: { serviceTicketId: t.id, deletedAt: null }, orderBy: { takenAt: 'asc' }, take: 12 })).map(m => serializeMedia(m)) : []
    const c = a.contact
    out.push({
      id: a.id, type: a.type, startAt: a.startAt!.toISOString(), endAt: a.endAt ? a.endAt.toISOString() : null, allDay: a.allDay, day: floridaYmd(a.startAt!),
      customerName: c ? `${c.firstName ?? ''} ${c.lastName && c.lastName !== '-' ? c.lastName : ''}`.trim() : '',
      customerPhone: c?.phone ?? '',
      address: a.address || c?.serviceAddress || '',
      notes: forCrew(a.notes || ''),
      ticket: t ? {
        id: t.id, issue: issueLabel(t.issue), notes: forCrew(t.notes || ''), covered: t.decision === 'covered', warrantyName: t.warrantyName || '',
        photos: photos.map(p => ({ id: p.id, kind: p.kind, thumb: p.thumbUrl ?? null, url: p.url })),
      } : null,
      // The job's crew packet (its $0 work order with the customer's photos) while it is open.
      packetToken: t ? packetOf.get(t.jobId) ?? null : null,
    })
  }
  return out
}
