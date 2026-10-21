/**
 * Warranty updates (Oct 2026): "Send updated warranty" on a sold job or a sent
 * proposal makes a new customer link, /p/wu/<token> (routes/warrantyUpdatePublic.ts),
 * with the warranty Settings give the customer's option now. Nothing about
 * the quote changes: no price, no stored proposal, no signed contract. The
 * warranties go out as a snapshot on the WarrantyUpdate row.
 *
 *   signed    a sold or accepted quote: the accepted option's current warranty;
 *             the customer types their name to acknowledge it. From then on the
 *             job's warranty (lib/warranties.ts jobWarranty) and its Warranty
 *             Certificate use it, with "Warranty updated on <date>"; a
 *             certificate already made is made again.
 *   proposal  a sent, unsigned proposal: the same proposal (prices identical)
 *             with each option's current warranty, on its own link; the link
 *             that was sent keeps working as sent. Accepting on the new link
 *             signs the proposal as the old link would, and the accepted
 *             option's updated warranty is then the job's and the contract's.
 *             If the customer signs on the old link instead, the new link
 *             asks them to acknowledge the updated warranty, as for a sold job.
 *
 * Texts and emails go from the staff member's own phone (the web app opens the
 * phone's apps); nothing is sent from here.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { signedNow } from '../routes/saved-quotes.js'
import { linkClosed } from '../routes/proposal.js'
import type { OptionWarranty } from './warranties.js'

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface UpdateOption {
  /** The option's place on the proposal; null: signed in person for a style not on the proposal. */
  index: number | null
  label: string
  fenceStyle: string
  finalPrice: number
  /** The warranty Settings give it now. */
  warranty: OptionWarranty | null
  /** What the customer has now (the option's frozen warranty, the old single block, or an update already acknowledged). */
  before: OptionWarranty | null
  changed: boolean
}

export interface UpdatePreview {
  quoteId: string
  kind: 'signed' | 'proposal'
  /** Can it be sent? When not, why (in plain words). */
  available: boolean
  why: string
  options: UpdateOption[]
  /** The signed option (signed quotes). */
  chosen: number | null
  customer: { name: string; firstName: string; phone: string; email: string }
  latest: UpdateSummary | null
}

export interface UpdateSummary {
  id: string
  token: string
  kind: string
  warrantyName: string
  createdAt: string
  createdBy: string
  sentAt: string | null
  sentChannel: string | null
  openCount: number
  lastOpenedAt: string | null
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  acknowledgedHow: string | null
}

export const summaryOf = (u: any): UpdateSummary => ({
  id: u.id, token: u.token, kind: u.kind, warrantyName: u.warrantyName, createdAt: new Date(u.createdAt).toISOString(), createdBy: u.createdBy,
  sentAt: u.sentAt ? new Date(u.sentAt).toISOString() : null, sentChannel: u.sentChannel ?? null, openCount: u.openCount ?? 0,
  lastOpenedAt: u.lastOpenedAt ? new Date(u.lastOpenedAt).toISOString() : null,
  acknowledgedAt: u.acknowledgedAt ? new Date(u.acknowledgedAt).toISOString() : null, acknowledgedBy: u.acknowledgedBy ?? null, acknowledgedHow: u.acknowledgedHow ?? null,
})

type QuoteRow = {
  id: string; accountId: string; proposal: unknown; chosenOption: number | null; fenceStyle: string; status: string; finalPrice: number
  acceptedAt: Date | null; soldAt: Date | null; work: unknown; customerName: string; customerPhone: string; customerEmail: string
  crmContactId: string | null; archivedAt: Date | null; shareToken: string | null; shareDisabledAt: Date | null; shareExpiresAt: Date | null
}

export const QUOTE_SELECT = {
  id: true, accountId: true, proposal: true, chosenOption: true, fenceStyle: true, status: true, finalPrice: true, acceptedAt: true, soldAt: true,
  work: true, customerName: true, customerPhone: true, customerEmail: true, crmContactId: true, archivedAt: true, shareToken: true,
  shareDisabledAt: true, shareExpiresAt: true,
} as const

/** The option a signed quote was signed for: the accepted one, else the one of its style; null when none matches. */
export function signedIndex(q: { proposal: unknown; chosenOption: number | null; fenceStyle: string }): number | null {
  const opts = isObj(q.proposal) && Array.isArray(q.proposal.options) ? q.proposal.options : []
  if (typeof q.chosenOption === 'number' && opts[q.chosenOption]) return q.chosenOption
  const i = opts.findIndex((o: any) => o?.fenceStyle === q.fenceStyle)
  return i >= 0 ? i : null
}

const sameWarranty = (a: OptionWarranty | null, b: OptionWarranty | null) =>
  !!a && !!b && a.name === b.name && String(a.text ?? '').trim() === String(b.text ?? '').trim()

/** The newest update the customer acknowledged (or accepted on), for the option they signed. */
export async function acknowledgedUpdate(q: { id: string; proposal: unknown; chosenOption: number | null; fenceStyle: string }): Promise<{ warranty: OptionWarranty; at: Date; by: string; how: string; previous: OptionWarranty | null } | null> {
  const idx = signedIndex(q)
  const rows = await prisma.warrantyUpdate.findMany({ where: { quoteId: q.id, acknowledgedAt: { not: null } }, orderBy: { acknowledgedAt: 'desc' }, take: 20 })
  for (const u of rows) {
    if ((u.acknowledgedOption ?? null) !== idx) continue
    const e = (Array.isArray(u.options) ? u.options as any[] : []).find(o => (o?.index ?? null) === idx)
    if (e && isObj(e.warranty) && typeof e.warranty.text === 'string') {
      return { warranty: e.warranty as OptionWarranty, at: u.acknowledgedAt!, by: u.acknowledgedBy || '', how: u.acknowledgedHow || 'acknowledged', previous: (e.before ?? null) as OptionWarranty | null }
    }
  }
  return null
}

/** The warranty a contract for this quote prints: the update's, when the customer signed the proposal on a warranty update link. */
export async function acceptedOnUpdate(q: { id: string; proposal: unknown; chosenOption: number | null; fenceStyle: string }): Promise<OptionWarranty | null> {
  const a = await acknowledgedUpdate(q)
  return a && a.how === 'accepted' ? a.warranty : null
}

async function configOf(accountId: string): Promise<unknown> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  return b?.config ?? null
}

/** Each option (signed: the signed one) with its warranty now and what the customer has. */
async function optionsNow(q: QuoteRow, signed: boolean): Promise<{ options: UpdateOption[]; chosen: number | null }> {
  const m = await pricingModule()
  const cfg = await configOf(q.accountId)
  const settings = m.warrantySettingsOf(cfg)
  const p = isObj(q.proposal) ? q.proposal : null
  const opts: any[] = p && Array.isArray(p.options) ? p.options : []
  const stamped = opts.length ? (m.stampWarranties(cfg as any, { ...p, options: opts.map(o => ({ ...o })) }, null, false) as any).options as any[] : []
  const oneBlock = p && typeof p.warranty === 'string' && p.warranty.trim() ? m.warrantyFromText(p.warranty, settings) as OptionWarranty | null : null
  const beforeOf = (o: any): OptionWarranty | null => (isObj(o?.warranty) && typeof o.warranty.text === 'string' ? o.warranty as OptionWarranty : oneBlock)
  const row = (o: any, i: number | null, now: OptionWarranty | null, before: OptionWarranty | null): UpdateOption => ({
    index: i, label: String(o?.label || o?.fenceStyle || q.fenceStyle), fenceStyle: String(o?.fenceStyle || q.fenceStyle),
    finalPrice: Number(o?.finalPrice ?? q.finalPrice) || 0, warranty: now, before, changed: !!now && !sameWarranty(now, before),
  })
  if (!signed) return { options: opts.map((o, i) => row(o, i, (stamped[i]?.warranty ?? null) as OptionWarranty | null, beforeOf(o))), chosen: null }
  const idx = signedIndex(q)
  const acked = await acknowledgedUpdate(q)
  if (idx !== null) {
    const o = opts[idx]
    // Signed in person (no acceptance on the link): the price is the quote's own.
    const shown = q.acceptedAt ? o : { ...o, finalPrice: q.finalPrice }
    return { options: [row(shown, idx, (stamped[idx]?.warranty ?? null) as OptionWarranty | null, acked?.warranty ?? beforeOf(o))], chosen: idx }
  }
  const kind = isObj(q.work) && (q.work.type === 'move' || q.work.type === 'repair') ? q.work.type as 'move' | 'repair' : null
  const now = m.styleWarranty(cfg as any, q.fenceStyle, kind) as OptionWarranty | null
  return { options: [row({ label: q.fenceStyle, fenceStyle: q.fenceStyle, finalPrice: q.finalPrice }, null, now, acked?.warranty ?? oneBlock)], chosen: null }
}

/** What "Send updated warranty" would send for this quote, and the last one sent. */
export async function previewUpdate(accountId: string, quoteId: string): Promise<UpdatePreview | null> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { ...QUOTE_SELECT, deletedAt: true } as any }) as unknown as (QuoteRow & { deletedAt?: Date | null }) | null
  if (!q || q.deletedAt) return null
  const signed = await signedNow(q)
  const kind: 'signed' | 'proposal' = signed ? 'signed' : 'proposal'
  const hasProposal = isObj(q.proposal) && Array.isArray(q.proposal.options) && q.proposal.options.length > 0
  const { options, chosen } = hasProposal || signed ? await optionsNow(q, signed) : { options: [], chosen: null }
  let why = ''
  if (q.archivedAt) why = 'This quote is archived.'
  else if (!signed && !hasProposal) why = 'This quote has no proposal yet.'
  else if (!signed && q.status !== 'SENT') why = q.status === 'DRAFT' ? 'Send the proposal first. A proposal sent from now on already has the current warranties.' : `This quote is ${q.status.toLowerCase()}.`
  else if (!signed && linkClosed(q)) why = 'The proposal link was turned off or ran out. Send the proposal again (it goes out with the current warranties).'
  else if (!options.some(o => o.warranty)) why = 'Settings → Warranties give no warranty for this fence style.'
  const latest = await prisma.warrantyUpdate.findFirst({ where: { quoteId: q.id }, orderBy: { createdAt: 'desc' } })
  const first = (q.customerName || '').trim().split(/\s+/)[0] || 'there'
  return {
    quoteId: q.id, kind, available: !why, why, options, chosen,
    customer: { name: q.customerName, firstName: first, phone: q.customerPhone || '', email: q.customerEmail || '' },
    latest: latest ? summaryOf(latest) : null,
  }
}

const snapshotKey = (opts: UpdateOption[]) => JSON.stringify(opts.map(o => [o.index, o.warranty?.id ?? null, o.warranty?.name ?? '', o.warranty?.text ?? '']))

/**
 * Make the update (or give back the last one when it would be the same: same
 * kind, same warranties, not yet acknowledged), so tapping Text it and then
 * Copy link sends one link.
 */
export async function createUpdate(accountId: string, quoteId: string, by: { userId: string | null; name: string }): Promise<{ update: any; preview: UpdatePreview; reused: boolean } | { error: string; status: number }> {
  const preview = await previewUpdate(accountId, quoteId)
  if (!preview) return { error: 'Quote not found', status: 404 }
  if (!preview.available) return { error: preview.why, status: 409 }
  const q = (await prisma.savedQuote.findUnique({ where: { id: quoteId }, select: { crmContactId: true } }))!
  const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, archivedAt: null }, select: { id: true } })
  const last = await prisma.warrantyUpdate.findFirst({ where: { quoteId, acknowledgedAt: null }, orderBy: { createdAt: 'desc' } })
  if (last && last.kind === preview.kind && snapshotKey(last.options as any) === snapshotKey(preview.options)) {
    return { update: last, preview, reused: true }
  }
  const main = preview.kind === 'signed'
    ? preview.options[0]
    : preview.options.find(o => o.changed && o.warranty) ?? preview.options.find(o => o.warranty) ?? preview.options[0]
  const w = main?.warranty ?? null
  const update = await prisma.warrantyUpdate.create({
    data: {
      accountId, quoteId, jobId: job?.id ?? null, crmContactId: q.crmContactId, kind: preview.kind,
      optionIndex: preview.kind === 'signed' ? (preview.options[0]?.index ?? null) : null,
      warrantyId: w?.id ?? null, warrantyName: w?.name ?? '', warrantyText: w?.text ?? '', warrantyTerm: w?.term ?? '',
      warrantyYears: w?.term === 'years' ? (w.years ?? 1) : null,
      options: JSON.parse(JSON.stringify(preview.options)), token: crypto.randomBytes(24).toString('base64url'),
      createdByUserId: by.userId, createdBy: by.name,
    },
  })
  return { update, preview: { ...preview, latest: summaryOf(update) }, reused: false }
}

/** Staff texted, emailed or copied it. */
export async function markSent(accountId: string, id: string, channel: 'text' | 'email' | 'copy'): Promise<any | null> {
  const n = await prisma.warrantyUpdate.updateMany({ where: { id, accountId }, data: { sentChannel: channel, sentAt: new Date() } })
  return n.count ? prisma.warrantyUpdate.findUnique({ where: { id } }) : null
}

/** The names of the warranties that changed, for "We've updated the warranty on your fence: <names>". */
export function changedNames(options: UpdateOption[]): string {
  const changed = options.filter(o => o.changed && o.warranty)
  const names = [...new Set((changed.length ? changed : options.filter(o => o.warranty)).map(o => o.warranty!.name))]
  return names.join(' and ')
}

/** The customer acknowledged (typed name) or accepted the proposal on this link: once. */
export async function recordAcknowledged(id: string, name: string, how: 'acknowledged' | 'accepted', option: number | null): Promise<boolean> {
  const n = await prisma.warrantyUpdate.updateMany({ where: { id, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedBy: name, acknowledgedHow: how, acknowledgedOption: option } })
  return n.count > 0
}

/** The proposal as shown once accepted: when it was signed on a warranty update link, the accepted option carries that link's warranty. */
export async function overlayAcceptedUpdate<P extends { options: any[] }>(q: { id: string; proposal: unknown; chosenOption: number | null; fenceStyle: string }, p: P): Promise<P> {
  const w = await acceptedOnUpdate(q)
  const idx = signedIndex(q)
  if (!w || idx === null || !p.options[idx]) return p
  return { ...p, options: p.options.map((o, i) => (i === idx ? { ...o, warranty: w } : o)) }
}

/** The proposal with each option's warranty from an update's snapshot (the stored proposal is not changed). */
export function withUpdateWarranties<P extends { options: any[]; warranty?: string }>(p: P, options: UpdateOption[]): P {
  const byIndex = new Map(options.filter(o => o.index !== null).map(o => [o.index as number, o.warranty]))
  return { ...p, options: p.options.map((o, i) => (byIndex.get(i) ? { ...o, warranty: byIndex.get(i) } : o)) }
}
