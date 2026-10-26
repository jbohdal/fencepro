/**
 * Final walkthrough on a job: the checklist from Jonathan's template for the
 * job's fence category, the required photos (each side, each gate, one wide
 * shot), a punch list from anything marked Needs fixing, and two signatures
 * (homeowner and our representative). Once everything is in, a Certificate of
 * Completion is made (lib/walkthroughCertificate.ts), saved to the job and to
 * the customer portal.
 *
 * For automations: isWalkthroughSigned and startWalkthrough, and the events
 * walkthrough_signed, walkthrough_completed and punch_list_cleared (each
 * recorded once per real happening through lib/automationEvents.ts).
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { recordEvent } from './automationEvents.js'
import {
  templatesFrom, categoryForStyle, itemsFromTemplate, photoSlots, missingToFinish, repairGateCount, workChecklist,
  type WalkItem, type PhotoSlot, type Signature, type PunchLike, type LayoutSides,
} from './walkthroughRules.js'
import { makeCertificate } from './walkthroughCertificate.js'
import { closeOutIfDone } from './jobTruth.js'
import { serializeMedia } from './media.js'

export type WalkthroughRow = NonNullable<Awaited<ReturnType<typeof prisma.walkthrough.findUnique>>>
export type PunchRow = Awaited<ReturnType<typeof prisma.walkthroughPunchItem.findMany>>[number]

export const LINK_DAYS_DEFAULT = 30

/** The saved checklist templates for a company (Settings), with the starter list where none is saved. */
export async function templatesFor(accountId: string) {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  return templatesFrom((b?.config as any)?.walkthroughTemplates)
}

/** The required photos for a job: from its quote's yard layout, or counts from the job (the crew can change them). */
export async function slotsForJob(job: { quoteId: string | null; walkGates: number; dblGates: number }): Promise<PhotoSlot[]> {
  const q = job.quoteId ? await prisma.savedQuote.findUnique({ where: { id: job.quoteId }, select: { layout: true, runs: true, work: true } }).catch(() => null) : null
  const yard = (q?.layout as any)?.yard as LayoutSides | null | undefined
  // A repair's rehung or replaced gates count as gates to photograph.
  const repairGates = repairGateCount(q?.work as any)
  if (yard?.sides?.some(s => s.on)) return photoSlots({ layout: yard, repairGates })
  const runs = Array.isArray(q?.runs) ? (q!.runs as unknown[]).length : 0
  return photoSlots({ sideCount: Math.max(1, runs), gateCount: (job.walkGates || 0) + (job.dblGates || 0), repairGates })
}

export interface StartInput { id?: string; category?: string; items?: WalkItem[]; photos?: PhotoSlot[] }

/**
 * Start the job's final walkthrough. Idempotent: a job has one walkthrough,
 * so starting it again (or the same start sent 3 times) returns that one.
 */
export async function startWalkthrough(accountId: string, jobId: string, by: string, input: StartInput = {}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.walkthrough.findUnique({ where: { jobId } })
  if (existing) {
    if (existing.accountId !== accountId) throw Object.assign(new Error('Job not found'), { status: 404 })
    return { id: existing.id, created: false }
  }
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null, archivedAt: null } })
  if (!job) throw Object.assign(new Error('Job not found'), { status: 404 })
  // A phone's id that is already used by another company's record is not taken.
  let id = input.id
  if (id) {
    const taken = await prisma.walkthrough.findUnique({ where: { id }, select: { accountId: true, jobId: true } })
    if (taken && (taken.accountId !== accountId || taken.jobId !== jobId)) id = undefined
  }
  const category = input.category && ['vinyl', 'chain_link', 'aluminum'].includes(input.category) ? input.category : categoryForStyle(job.fenceStyle)
  // A repair's checklist from its repair items; a move's, the style's plus the old line (walkthroughRules.workChecklist).
  const q = job.quoteId ? await prisma.savedQuote.findUnique({ where: { id: job.quoteId }, select: { work: true } }).catch(() => null) : null
  const items = input.items?.length ? input.items : itemsFromTemplate(workChecklist(q?.work as any, (await templatesFor(accountId))[category as 'vinyl']))
  const photos = input.photos?.length ? input.photos : await slotsForJob(job)
  try {
    const row = await prisma.walkthrough.create({
      data: { ...(id ? { id } : {}), accountId, jobId, category, items: items as any, photos: photos as any, startedBy: by || null },
    })
    return { id: row.id, created: true }
  } catch (err) {
    // Started at the same moment on two phones (or the same start twice at once): the first one is the walkthrough.
    if ((err as any)?.code === 'P2002') {
      const row = await prisma.walkthrough.findUnique({ where: { jobId } })
      if (row && row.accountId === accountId) return { id: row.id, created: false }
    }
    throw err
  }
}

/** Both signatures are in (for the stage rule "Job Complete needs the walkthrough signed"). */
export async function isWalkthroughSigned(accountId: string, jobId: string): Promise<boolean> {
  const w = await prisma.walkthrough.findUnique({ where: { jobId }, select: { accountId: true, homeownerSig: true, repSig: true } })
  return !!w && w.accountId === accountId && !!w.homeownerSig && !!w.repSig
}

// ── Changes ──────────────────────────────────────────────────────────────────

/**
 * Change one walkthrough under a row lock, so two phones saving at once never
 * lose each other's change to the checklist or photos.
 */
export async function mutate<T>(accountId: string, id: string, fn: (w: WalkthroughRow, tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Walkthrough" WHERE id = ${id} FOR UPDATE`
    const w = await tx.walkthrough.findUnique({ where: { id } })
    if (!w || w.accountId !== accountId) throw Object.assign(new Error('Walkthrough not found'), { status: 404 })
    return fn(w, tx)
  }, { timeout: 15_000 })
}

export const items = (w: { items: unknown }) => (Array.isArray(w.items) ? w.items : []) as WalkItem[]
export const slots = (w: { photos: unknown }) => (Array.isArray(w.photos) ? w.photos : []) as PhotoSlot[]
export const sig = (v: unknown) => (v && typeof v === 'object' ? v : null) as Signature | null

/** After a signature: once both are in, the walkthrough is signed (an event, once). */
export async function afterSignature(w: WalkthroughRow): Promise<void> {
  if (!sig(w.homeownerSig) || !sig(w.repSig)) return
  if (!w.signedAt) await prisma.walkthrough.updateMany({ where: { id: w.id, signedAt: null }, data: { signedAt: new Date() } })
  await recordEvent({
    accountId: w.accountId, type: 'walkthrough_signed', board: 'ops', entityKind: 'job', entityId: w.jobId,
    data: { walkthroughId: w.id, homeowner: sig(w.homeownerSig)!.name, rep: sig(w.repSig)!.name, repRole: sig(w.repSig)!.role },
    dedupeKey: `walkthrough:${w.id}:signed`,
  })
  // Signed and paid in full: the job moves to Complete by itself (lib/jobTruth.ts).
  await closeOutIfDone(w.accountId, w.jobId, 'final walkthrough signed')
}

/** After a punch item is fixed: the last one fixed clears the punch list (an event, once). */
export async function afterPunchFixed(w: WalkthroughRow, fixedId: string): Promise<void> {
  const open = await prisma.walkthroughPunchItem.count({ where: { walkthroughId: w.id, status: 'open' } })
  if (open > 0) return
  await recordEvent({
    accountId: w.accountId, type: 'punch_list_cleared', board: 'ops', entityKind: 'job', entityId: w.jobId,
    data: { walkthroughId: w.id }, dedupeKey: `walkthrough:${w.id}:punch_cleared:${fixedId}`,
  })
}

// ── Finishing ────────────────────────────────────────────────────────────────

/** Which of these photos are on the server (uploaded, not removed). */
export async function uploadedSet(clientIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(clientIds.filter(Boolean))]
  if (!ids.length) return new Set()
  const rows = await prisma.mediaItem.findMany({ where: { clientId: { in: ids }, deletedAt: null }, select: { clientId: true } })
  return new Set(rows.map(r => r.clientId))
}

function photoIds(w: WalkthroughRow, punch: PunchRow[]): string[] {
  return [
    ...slots(w).map(s => s.clientId), ...items(w).map(i => i.photoClientId),
    ...punch.flatMap(p => [p.photoClientId, p.fixPhotoClientId]),
  ].filter((x): x is string => !!x)
}

const punchLike = (p: PunchRow): PunchLike => ({ id: p.id, label: p.label, status: p.status === 'fixed' ? 'fixed' : 'open', fixPhotoClientId: p.fixPhotoClientId })

/** What is still needed before it can be finished (empty: ready). */
export async function missingFor(w: WalkthroughRow, punch?: PunchRow[]): Promise<string[]> {
  const p = punch ?? await prisma.walkthroughPunchItem.findMany({ where: { walkthroughId: w.id } })
  const up = await uploadedSet(photoIds(w, p))
  return missingToFinish({ items: items(w), photos: slots(w), homeownerSig: sig(w.homeownerSig), repSig: sig(w.repSig) }, p.map(punchLike), id => up.has(id))
}

export type FinishResult = { done: true; walkthrough: WalkthroughRow } | { done: false; missing: string[] }

/**
 * Finish when everything is in: required photos uploaded, both signatures,
 * every item marked, the punch list fixed and re-photographed. Makes the
 * certificate, saves it to the job and the customer portal. Only one finish
 * runs at a time for a walkthrough; finishing again returns the finished one.
 */
export async function tryFinish(accountId: string, id: string, by: string): Promise<FinishResult> {
  const w = await prisma.walkthrough.findUnique({ where: { id } })
  if (!w || w.accountId !== accountId) throw Object.assign(new Error('Walkthrough not found'), { status: 404 })
  if (w.status === 'completed') return { done: true, walkthrough: w }
  const missing = await missingFor(w)
  if (missing.length) return { done: false, missing }
  // Claim it: a second finish at the same moment waits for this one's result.
  const claim = await prisma.walkthrough.updateMany({ where: { id, status: 'open' }, data: { status: 'finishing' } })
  if (claim.count === 0) {
    for (let i = 0; i < 60; i++) {
      const again = await prisma.walkthrough.findUnique({ where: { id } })
      if (again?.status === 'completed') return { done: true, walkthrough: again }
      if (again?.status === 'open') return tryFinish(accountId, id, by)
      await new Promise(r => setTimeout(r, 250))
    }
    return { done: false, missing: ['Still finishing; try again in a moment'] }
  }
  try {
    const fresh = (await prisma.walkthrough.findUnique({ where: { id } }))!
    const punch = await prisma.walkthroughPunchItem.findMany({ where: { walkthroughId: id }, orderBy: { createdAt: 'asc' } })
    const cert = await makeCertificate(fresh, punch)
    const done = await prisma.walkthrough.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date(), completedBy: by || null, certificatePath: cert.path, certificateFileId: cert.portalFileId },
    })
    await recordEvent({
      accountId, type: 'walkthrough_completed', board: 'ops', entityKind: 'job', entityId: done.jobId,
      data: { walkthroughId: id, certificateFileId: cert.portalFileId }, dedupeKey: `walkthrough:${id}:completed`,
    })
    return { done: true, walkthrough: done }
  } catch (err) {
    await prisma.walkthrough.updateMany({ where: { id, status: 'finishing' }, data: { status: 'open' } }).catch(() => {})
    throw err
  }
}

// ── The homeowner's link ─────────────────────────────────────────────────────

/** Why the homeowner's link does not open for signing, or null. */
export function linkState(w: { shareDisabledAt: Date | null; shareExpiresAt: Date | null }, now = Date.now()): 'off' | 'expired' | null {
  if (w.shareDisabledAt) return 'off'
  if (w.shareExpiresAt && w.shareExpiresAt.getTime() < now) return 'expired'
  return null
}

/** Make (or return the open) link. A link turned off or run out gets a new one. */
export async function issueLink(accountId: string, id: string, fresh = false): Promise<{ token: string; expiresAt: Date }> {
  const w = await prisma.walkthrough.findUnique({ where: { id } })
  if (!w || w.accountId !== accountId) throw Object.assign(new Error('Walkthrough not found'), { status: 404 })
  if (w.shareToken && !linkState(w) && !fresh) return { token: w.shareToken, expiresAt: w.shareExpiresAt! }
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  const days = Number((b?.config as any)?.proposal?.linkDays) > 0 ? Number((b?.config as any).proposal.linkDays) : LINK_DAYS_DEFAULT
  const token = crypto.randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + days * 86_400_000)
  await prisma.walkthrough.update({ where: { id }, data: { shareToken: token, shareExpiresAt: expiresAt, shareDisabledAt: null } })
  return { token, expiresAt }
}

// ── For the app ──────────────────────────────────────────────────────────────

/** The walkthrough as the app shows it: its punch list, its photos' links, and what is still missing. */
export async function viewOf(w: WalkthroughRow) {
  const punch = await prisma.walkthroughPunchItem.findMany({ where: { walkthroughId: w.id }, orderBy: { createdAt: 'asc' } })
  const ids = photoIds(w, punch)
  const media = ids.length ? await prisma.mediaItem.findMany({ where: { clientId: { in: ids }, deletedAt: null } }) : []
  const up = new Set(media.map(m => m.clientId))
  const missing = w.status === 'completed' ? [] : missingToFinish({ items: items(w), photos: slots(w), homeownerSig: sig(w.homeownerSig), repSig: sig(w.repSig) }, punch.map(punchLike), c => up.has(c))
  return {
    id: w.id, jobId: w.jobId, category: w.category, status: w.status === 'finishing' ? 'open' : w.status,
    items: items(w), photos: slots(w), homeownerSig: sig(w.homeownerSig), repSig: sig(w.repSig), signedAt: w.signedAt,
    link: w.shareToken ? { token: w.shareToken, expiresAt: w.shareExpiresAt, disabledAt: w.shareDisabledAt, state: linkState(w) } : null,
    completedAt: w.completedAt, completedBy: w.completedBy, hasCertificate: !!w.certificatePath, startedBy: w.startedBy, updatedAt: w.updatedAt,
    punch: punch.map(p => ({ id: p.id, itemId: p.itemId, label: p.label, note: p.note, photoClientId: p.photoClientId, status: p.status, fixPhotoClientId: p.fixPhotoClientId, fixNote: p.fixNote, fixedAt: p.fixedAt, fixedBy: p.fixedBy })),
    media: Object.fromEntries(media.map(m => { const s = serializeMedia(m); return [m.clientId, { id: s.id, url: s.url, thumbUrl: s.thumbUrl, markupUrl: s.markupUrl, visibility: s.visibility }] })),
    missing,
  }
}
