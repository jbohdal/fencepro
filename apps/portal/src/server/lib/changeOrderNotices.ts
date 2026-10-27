/**
 * The bell for change orders (round 2 review, Oct 26 2026):
 *
 *   to OK      a Salesman's change order (or one she changed after the OK)
 *              tells the owner and the office; the notice opens the job
 *              scrolled to the change order, its OK button in view.
 *   OK'd       the owner's or office's OK clears their "to OK" notices and
 *              tells the Salesman who made it ("Change order OK'd: CO-1,
 *              <customer>. Send it to the customer."), opening her card
 *              window at the change order; once signed it says "Change order
 *              OK'd and signed: CO-1, <customer>".
 *   signed     the customer signed (in person, on the link or in the portal):
 *              whoever made it and the owner and office are told.
 *
 * Notices are by login email (the maker) or by role (owner: admin; the
 * office: office_staff), as the bell reads them (routes/automations.ts).
 * Nothing here texts or emails anyone.
 */

import prisma from './prisma.js'

type Co = { id: string; accountId: string; quoteId: string; number: number; totalCents: number; createdBy: string | null }

export const OK_ROLES = ['admin', 'office_staff'] as const
export const TO_OK_TITLE = 'Change order to OK'

const usd = (cents: number) => `${cents < 0 ? '-' : '+'}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`

/** The quote's customer and its job, for the words and the links. */
async function whereIs(co: Co) {
  const q = await prisma.savedQuote.findFirst({ where: { id: co.quoteId, accountId: co.accountId }, select: { customerName: true, crmContactId: true } })
  const job = await prisma.savedJob.findFirst({ where: { accountId: co.accountId, quoteId: co.quoteId, deletedAt: null }, select: { id: true, contractValue: true } })
  return { customer: q?.customerName || 'a customer', contactId: q?.crmContactId ?? null, job }
}

/** The job page scrolled to the change order (owner and office). */
export function jobLink(jobId: string | null | undefined, coId: string, contactId: string | null): string | null {
  if (jobId) return `/operations?job=${encodeURIComponent(jobId)}&co=${encodeURIComponent(coId)}`
  return contactId ? `/?customer=${contactId}` : null
}

/** The Salesman's way in: her pipeline card window at the change order (she has no Operations page). */
async function cardLink(accountId: string, quoteId: string, contactId: string | null, coId: string): Promise<string | null> {
  const state = await prisma.pipelineState.findUnique({ where: { accountId }, select: { leads: true } }).catch(() => null)
  const leads = Array.isArray(state?.leads) ? (state!.leads as any[]) : []
  const card = leads.find(l => l?.quoteId === quoteId) ?? (contactId ? leads.find(l => l?.customerId === contactId) : null)
  if (card?.id) return `/pipeline?card=${encodeURIComponent(String(card.id))}&co=${encodeURIComponent(coId)}`
  return contactId ? `/?customer=${contactId}` : null
}

/** The login that made the change order: createdBy is the name the server wrote (or the email when there was no name). */
export async function makerOf(accountId: string, createdBy: string | null): Promise<{ email: string; role: string } | null> {
  const who = (createdBy ?? '').trim()
  if (!who || who === 'imported') return null
  const users = await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { email: true, firstName: true, lastName: true, role: true } })
  const u = users.find(x => x.email === who) ?? users.find(x => `${x.firstName ?? ''} ${x.lastName ?? ''}`.trim().toLowerCase() === who.toLowerCase())
  return u ? { email: u.email, role: String(u.role) } : null
}

/** A Salesman's change order waits for the OK: the owner and the office are told, with the job to open at it. */
export async function askForOk(co: Co, by: string, changed = false): Promise<void> {
  try {
    const { customer, contactId, job } = await whereIs(co)
    const link = jobLink(job?.id, co.id, contactId)
    const body = changed
      ? `${by} changed change order CO-${co.number} (now ${usd(co.totalCents)}) after it was OK'd. OK it again to send it to the customer.`
      : `${by} made change order CO-${co.number} (${usd(co.totalCents)}). OK it to send it to the customer.`
    for (const recipientRole of OK_ROLES) {
      await prisma.notification.create({ data: { recipientRole, title: `${TO_OK_TITLE}: ${customer}`, body, type: 'info', link, jobId: job?.id ?? null } })
    }
  } catch (e) { console.error('[change-orders] ask for OK:', e) }
}

/**
 * The "to OK" notices of this change order: matched by its job and number
 * (they were written before it had a link of its own). Read ones too (round 3
 * recheck): the owner taps the notice to open the job, which marks it read,
 * then OKs it there; his notice kept saying "Change order to OK".
 */
async function toOkNotices(co: Co, jobId: string | null) {
  const rows = await prisma.notification.findMany({ where: { title: { startsWith: TO_OK_TITLE }, ...(jobId ? { jobId } : { jobId: null }) } })
  return rows.filter(n => n.link?.includes(`co=${encodeURIComponent(co.id)}`) || new RegExp(`\\bCO-${co.number}\\b`).test(n.body))
}

/** The bell's role for a login's role (routes/automations.ts portalRole): the owner's is admin. */
export const noticeRoleOf = (role: string | null | undefined) => (role === 'super_admin' || role === 'admin' ? 'admin' : role ?? '')

/**
 * The OK was given (or the change order was voided before it): the owner's
 * and office's "to OK" notices say so, at the time of the OK (round 3
 * recheck: they kept the time the change order was made). The one for the
 * login that gave the OK is read; the others stay unread, so the office hears
 * that the owner OK'd it. The maker is told it can go to the customer now.
 */
export async function okGiven(co: Co, by: string, voided = false, byRole: string | null = null): Promise<void> {
  try {
    const { customer, contactId, job } = await whereIs(co)
    const now = new Date()
    const mine = noticeRoleOf(byRole)
    for (const n of await toOkNotices(co, job?.id ?? null)) {
      const read = !byRole || n.recipientRole === mine
      await prisma.notification.update({
        where: { id: n.id },
        data: { read, readAt: read ? now : null, createdAt: now, title: `${voided ? 'Change order voided' : "Change order OK'd"}: ${customer}`, body: `CO-${co.number} (${usd(co.totalCents)}) was ${voided ? 'voided' : "OK'd"} by ${by}.` },
      })
    }
    if (voided) return
    const maker = await makerOf(co.accountId, co.createdBy)
    if (!maker) return
    const link = maker.role === 'sales_rep' ? await cardLink(co.accountId, co.quoteId, contactId, co.id) : jobLink(job?.id, co.id, contactId)
    await prisma.notification.create({
      data: { recipientId: maker.email, title: sendItTitle(co.number, customer), body: `${by} OK'd change order CO-${co.number} (${usd(co.totalCents)}). Send it to ${customer} to sign, or have them sign on your phone.`, type: 'success', link, jobId: job?.id ?? null },
    })
  } catch (e) { console.error("[change-orders] OK'd notice:", e) }
}

/**
 * The maker's notice when the office OKs her change order. It became "Sent and signed: …" once
 * signed while its words still said to send it, so it read as if something had been sent and
 * signed that she had not sent yet (recheck Oct 27 2026). It names the step she is at.
 */
export const SEND_IT_TITLE = "Change order OK'd: CO-"
export const sendItTitle = (number: number, customer: string) => `${SEND_IT_TITLE}${number}, ${customer}. Send it to the customer.`
/** The title before Oct 27 2026, still on older notices. */
const OLD_SEND_IT_TITLE = "OK'd: send it to"

/** The maker's "Change order OK'd: CO-1, <customer>. Send it…" notices of this change order, once it is signed: read, and they say it is signed. */
async function sendItDone(co: Co, email: string, jobId: string | null, customer: string): Promise<void> {
  const rows = await prisma.notification.findMany({ where: { recipientId: email, OR: [{ title: { startsWith: SEND_IT_TITLE } }, { title: { startsWith: OLD_SEND_IT_TITLE } }], ...(jobId ? { jobId } : { jobId: null }) } })
  const now = new Date()
  for (const n of rows.filter(n => n.link?.includes(`co=${encodeURIComponent(co.id)}`) || new RegExp(`\\bCO-${co.number}\\b`).test(n.body))) {
    const body = n.body.replace(/ Send it to .*$/, ` ${customer} signed it.`)
    await prisma.notification.update({ where: { id: n.id }, data: { read: true, readAt: n.readAt ?? now, title: `Change order OK'd and signed: CO-${co.number}, ${customer}`, body } })
  }
}

/** The customer signed: whoever made it, and the owner and the office, are told (once). */
export async function signedNotice(co: Co & { signedBy?: string | null; signedVia?: string | null }): Promise<void> {
  try {
    const { customer, contactId, job } = await whereIs(co)
    const where = co.signedVia === 'portal' ? ' in the customer portal' : co.signedVia === 'link' ? ' on their link' : co.signedVia === 'in_person' ? ' in person' : ''
    const title = `Signed: CO-${co.number}, ${customer}`
    const body = `${co.signedBy || customer} signed change order CO-${co.number} (${usd(co.totalCents)})${where}.${job?.contractValue ? ` The contract is now ${dollars(Math.round(job.contractValue * 100))}.` : ''}`
    const office = jobLink(job?.id, co.id, contactId)
    for (const recipientRole of OK_ROLES) await prisma.notification.create({ data: { recipientRole, title, body, type: 'success', link: office, jobId: job?.id ?? null } })
    const maker = await makerOf(co.accountId, co.createdBy)
    // Her "OK'd: send it to <customer>" is done now: read, and it says it was signed (round 3 recheck: it stayed unread).
    if (maker) await sendItDone(co, maker.email, job?.id ?? null, customer)
    // The owner or office who made it already hears through their role.
    if (maker && maker.role === 'sales_rep') {
      await prisma.notification.create({ data: { recipientId: maker.email, title, body, type: 'success', link: await cardLink(co.accountId, co.quoteId, contactId, co.id), jobId: job?.id ?? null } })
    }
  } catch (e) { console.error('[change-orders] signed notice:', e) }
}
