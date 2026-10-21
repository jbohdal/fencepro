/**
 * Texting consent on the customer (CrmContact.textConsent) and its history
 * (CrmTextConsent): who said yes or no, how, and when. Words and plain rules
 * in textConsentModel.ts.
 *
 * Recording an answer sets the customer's current answer and adds a history
 * row in one save, so the two never disagree. Nothing is ever edited in the
 * history: a yes then a no are two rows.
 *
 * Sending: every text the app would send to a customer asks textAllowedTo
 * first (lib/sms.ts, automations' prepared texts). Only a customer whose
 * answer is yes is texted; anything else is held back with the reason.
 */

import prisma from './prisma.js'
import { asTextConsent, textBlockedReason, TEXT_CONSENT_WORDING, type TextConsent, type TextConsentSource } from './textConsentModel.js'

type Db = Pick<typeof prisma, 'crmContact' | 'crmTextConsent'>

export interface ConsentAnswer {
  consent: 'yes' | 'no'
  source: TextConsentSource
  /** The team member's name, or "website" */
  byName: string
  byUserId?: string | null
  wording?: string | null
  ip?: string | null
  userAgent?: string | null
  at?: Date
}

/** Record a yes or no on a customer: the current answer and a history row, together. */
export async function recordTextConsent(contactId: string, a: ConsentAnswer, db?: Db) {
  const write = async (tx: Db) => {
    const contact = await tx.crmContact.findUnique({ where: { id: contactId }, select: { id: true, accountId: true } })
    if (!contact) throw new Error('That customer is not there any more')
    const at = a.at ?? new Date()
    const event = await tx.crmTextConsent.create({
      data: {
        accountId: contact.accountId ?? '', crmContactId: contactId, consent: a.consent, source: a.source,
        byName: a.byName.slice(0, 200), byUserId: a.byUserId ?? null, wording: a.wording ?? null,
        ip: a.ip?.slice(0, 100) ?? null, userAgent: a.userAgent?.slice(0, 500) ?? null, at,
      },
    })
    const updated = await tx.crmContact.update({
      where: { id: contactId },
      data: { textConsent: a.consent, textConsentAt: at, textConsentBy: a.byName.slice(0, 200), textConsentById: a.byUserId ?? null, textConsentSource: a.source },
    })
    return { contact: updated, event }
  }
  return db ? write(db) : prisma.$transaction(tx => write(tx))
}

/**
 * The website quote's checkbox on the customer the quote was filed under:
 * checked is a yes with the checkbox words, unchecked a no. The same answer
 * sent again (the customer picked another option) adds nothing.
 */
export async function recordWebsiteTextConsent(contactId: string, checked: boolean, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const consent = checked ? 'yes' : 'no'
  const cur = await prisma.crmContact.findUnique({ where: { id: contactId }, select: { textConsent: true, textConsentSource: true } })
  if (!cur) return null
  if (cur.textConsent === consent && cur.textConsentSource === 'website_checkbox') return null
  return recordTextConsent(contactId, { consent, source: 'website_checkbox', byName: 'website', wording: TEXT_CONSENT_WORDING, ip: meta.ip, userAgent: meta.userAgent })
}

/** Every answer the customer gave, newest first. */
export function textConsentHistory(contactId: string) {
  return prisma.crmTextConsent.findMany({ where: { crmContactId: contactId }, orderBy: { at: 'desc' } })
}

export interface TextPermission {
  allowed: boolean
  /** Plain words when not allowed ("Not sent: Dave Diamond said no to texts.") */
  reason: string | null
  consent: TextConsent
  contactId: string | null
}

/** May the app text this customer? Only a "yes" may be texted. */
export function textAllowedFor(contact: { firstName?: string | null; lastName?: string | null; textConsent?: string | null; id?: string } | null): TextPermission {
  const consent = asTextConsent(contact?.textConsent)
  const name = contact ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() : ''
  const reason = contact ? textBlockedReason(name, consent) : 'Not sent: this phone number is not on a customer who agreed to texts.'
  return { allowed: !reason, reason, consent, contactId: contact?.id ?? null }
}

/**
 * May the app text this phone number? The customers with it (last 10 digits,
 * not deleted, not merged away: a merged one's answer counts on the customer
 * it was merged into, mergedTextNo) decide: at least one said yes and none said no. A number on no
 * customer is never texted.
 */
export async function textAllowedTo(phone: string, accountId?: string | null): Promise<TextPermission> {
  const ten = phone.replace(/\D/g, '').slice(-10)
  if (ten.length < 10) return { allowed: false, reason: 'Not sent: no 10 digit phone number.', consent: 'unknown', contactId: null }
  const rows = await prisma.$queryRaw<Array<{ id: string; firstName: string; lastName: string; textConsent: string }>>`
    SELECT id, "firstName", "lastName", "textConsent" FROM "CrmContact"
    WHERE "deletedAt" IS NULL AND "mergedIntoId" IS NULL AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${ten}
      AND (${accountId ?? null}::text IS NULL OR "accountId" = ${accountId ?? null}::text)`
  const said = rows.find(r => r.textConsent === 'no') ?? rows.find(r => r.textConsent === 'yes') ?? rows[0] ?? null
  const ok = textAllowedFor(said)
  // A customer merged into one of them said no (lib/customerMerge.ts): blocked until a yes is recorded on that one.
  if (ok.allowed) for (const r of rows) {
    const no = await mergedTextNo(r.id)
    if (no) return { allowed: false, reason: no, consent: 'no', contactId: r.id }
  }
  return ok
}

/**
 * A customer merged into this one (lib/customerMerge.ts) whose answer was no:
 * the merge never changes the kept customer's own answer, and a "no" is never
 * lost, so texts stay blocked until someone records a yes on the kept customer
 * after the merge. The reason in plain words, or null.
 */
export async function mergedTextNo(contactId: string): Promise<string | null> {
  const said = await prisma.crmContact.findMany({ where: { mergedIntoId: contactId, deletedAt: null, textConsent: 'no' }, select: { id: true, firstName: true, lastName: true } })
  if (!said.length) return null
  const merge = await prisma.customerMerge.findFirst({ where: { keptId: contactId, mergedId: { in: said.map(c => c.id) }, undoneAt: null }, orderBy: { mergedAt: 'desc' }, select: { mergedAt: true } })
  const kept = await prisma.crmContact.findUnique({ where: { id: contactId }, select: { textConsent: true, textConsentAt: true } })
  if (kept?.textConsent === 'yes' && kept.textConsentAt && (!merge || kept.textConsentAt > merge.mergedAt)) return null
  const name = `${said[0].firstName ?? ''} ${said[0].lastName ?? ''}`.trim() || 'A customer merged into this one'
  return `Not sent: ${name} (merged into this customer) said no to texts. Record a yes on this customer to text them.`
}
