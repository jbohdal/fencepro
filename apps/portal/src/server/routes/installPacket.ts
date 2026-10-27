/**
 * Install packet for the crew: a private link per sold job at /p/i/<link>
 * that opens well on any phone and prints to PDF. No login. It can be
 * turned off, and it stops working 30 days after the job is marked complete.
 *
 * Shows the customer and address (with a map link), install date, gate codes
 * and notes, the site plan with photo pins, every run with its post to post
 * spacing, section and post counts, gates, the pull sheet quantities, the
 * Crew and Customer photos and video of the job, its quote and its site
 * visit, with captions (marked up first; a price in one left out), and a
 * field for the 811 locate ticket. Never prices, margins or sub pay.
 *
 * The crew can add Progress and Completed photos from the link; they land on
 * the job as Internal until the office marks them Customer.
 *
 * Under /p, so the same public door as proposals serves it.
 */

import { locateOf, locateStatus, locateWords, hasLocate, locateDay, locateStartWarning } from '../lib/locates.js'
import { saveLocate, lastCrewDay, startedByCrew, closeOutIfDone, billingViewFor } from '../lib/jobTruth.js'
import { billingStatusOf } from '../lib/jobReadiness.js'
import { isDonePhase } from '../lib/opsStageModel.js'
import { floridaDay } from '../lib/automations/context.js'
import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { isUniqueViolation } from '../lib/once.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { esc, safeSvg, CSS } from './proposal.js'
import { mediaDir, serializeMedia, processMediaQueue } from '../lib/media.js'
import { serveSignedMedia } from './media.js'
import { plainZod } from '../lib/plainZod.js'
import { plainStyleName } from '../lib/estimates.js'
import { packetChange, packetWithChange, packetChangeHeading, sheetChanges } from '../lib/changeOrderWork.js'
import { coveredWorkOn } from '../lib/serviceTickets.js'
import { issueLabel } from '../lib/serviceTicketModel.js'
import { isYmd, usDate, shortDayWords } from '../lib/installDays.js'
import { finishScheduleRows } from '../lib/installScheduling.js'
import { can, refuse, requireCan, roleOf } from '../lib/permissions.js'
import { customerNotesForJob, installTimes, recordInstallTime, crewFinishedJob } from '../lib/crewInstall.js'
import { forCrew } from '../lib/costRedact.js'
import { crewVisitsFor } from '../lib/crewVisits.js'
import { partWithPair } from '../lib/partNames.js'
import { jobQuoteMediaOr } from '../lib/quoteMedia.js'
const todayFl = () => floridaDay(new Date())
/** The crew's name (Schedule > Settings), never its id ("crew1"). */
async function crewNameFor(accountId: string, v: string): Promise<string> {
  const s = await prisma.scheduleSettings.findUnique({ where: { accountId }, select: { crews: true } }).catch(() => null)
  const norm = (x: string) => String(x || '').toLowerCase().replace(/\s+/g, '')
  const c = ((Array.isArray(s?.crews) ? s!.crews : []) as Array<{ id: string; name: string }>).find(x => x.id === v.trim() || norm(x.name) === norm(v))
  return c?.name || v
}

/**
 * The crew days, each one: "3 crew days: Thu 12/3, Mon 12/7, Tue 12/8" (from the Schedule), else
 * "starts 11/02/2026, 3 crew days to 11/04/2026", or the start alone, or not scheduled yet.
 */
function installWhen(start: string | null | undefined, end: string | null | undefined, days: number | null | undefined, booked: string[] = []): string {
  if (!isYmd(start)) return 'not scheduled yet'
  if (booked.length) return `${booked.length} crew day${booked.length === 1 ? '' : 's'}: ${booked.map(shortDayWords).join(', ')}`
  const n = Math.max(1, days || 1)
  return isYmd(end) && end > start ? `starts ${usDate(start)}, ${n} crew day${n === 1 ? '' : 's'} to ${usDate(end)}` : usDate(start)
}

/** Each line once: packets sent before Oct 25, 2026 carry the job's and the quote's notes, which were the same. */
export function onceEach(text: string): string {
  const seen = new Set<string>()
  return text.split('\n').filter(l => { const k = l.trim().replace(/\s+/g, ' ').toLowerCase(); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true }).join('\n').trim()
}

/** A run's post to post spacing ("7' 11 1/2\"") in feet. */
function spacingFt(text: string): number {
  const m = /^(\d+)'(?:\s*(\d+)(?:\s+(\d+)\/(\d+))?")?/.exec(text.trim())
  if (!m) return NaN
  return Number(m[1]) + (Number(m[2] ?? 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0)) / 12
}

/**
 * The crew needs the panel size, not the price rule: a style sold as "6 or 8
 * ft panels (best price)" says the panels each run really has, from its post
 * spacing (review, Oct 25, 2026): "8 ft panels", or "6 and 8 ft panels (8 ft
 * on Back, Left; 6 ft on Right)".
 */
export function panelWords(style: string, runs: Array<{ label: string; spacing: string }> = []): string {
  if (!/6 or 8 ft panels \(best price\)/i.test(style)) return style
  const sized = runs.map(r => ({ label: r.label, ft: spacingFt(r.spacing) })).filter(r => r.ft > 0)
  if (!sized.length) return style.replace(/6 or 8 ft panels \(best price\)/i, '6 or 8 ft panels (see each run)')
  const panel = (ft: number) => (ft > 7 ? 8 : 6)
  const eights = sized.filter(r => panel(r.ft) === 8).map(r => r.label), sixes = sized.filter(r => panel(r.ft) === 6).map(r => r.label)
  const words = !sixes.length ? '8 ft panels' : !eights.length ? '6 ft panels' : `6 and 8 ft panels (8 ft on ${eights.join(', ')}; 6 ft on ${sixes.join(', ')})`
  return style.replace(/6 or 8 ft panels \(best price\)/i, words)
}

/** 3527894314 → (352) 789 4314; anything else as typed. */
function phone(p: string): string {
  const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p
}

/**
 * A packet's snapshot with the newest approved change order's work on it
 * (footage, sections, gates, runs, pull sheet; quantities only), unless the
 * snapshot already is that work (the office's phone builds it with the change
 * order). Oct 25 2026: the installer's packet for WT Robert Hayes came out
 * 150 ft / 17 sections from the original quote instead of 170 ft / 19.
 */
export async function withSignedWork<S extends Record<string, any>>(accountId: string, quoteId: string | null | undefined, s: S): Promise<S> {
  const co = await packetChange(accountId, quoteId, new Date(0)).catch(() => null)
  if (!co) return s
  const w = co.work
  const same = Number(s.sections) === Number(w.sections) && Math.round(Number(s.footageFt) || 0) === Math.round(Number(w.footage) || 0)
    && sheetChanges((s.pullSheet ?? []) as any, (w.pullSheet ?? []).filter((l: any) => !l.moneyOnly) as any).length === 0
  if (same) return s
  return { ...packetWithChange(s, co), changeOrder: co.number }
}

/** A pull sheet line that is work, not a part (tear out, haul away, removal, labor). */
export const isWorkLine = (item: string) => /\b(tear ?out|haul[- ]?away|remov(e|al)|labor|disposal)\b/i.test(item || '')
/** "Tear out and haul away the old fence (13 sections)" */
export function workStepText(item: string, qty: number | string): string {
  const n = Number(qty)
  if (/tear ?out/i.test(item)) return `Tear out and haul away the old fence${n > 0 ? ` (${n} section${n === 1 ? '' : 's'})` : ''}`
  return `${item}${n > 0 ? ` (${n})` : ''}`
}

/**
 * The job's 811 locate as the crew reads it (round 2, Oct 26 2026: the boxes
 * looked empty to the crew, so the office's ticket could be typed over): the
 * ticket and its dates in words, who saved it, and "Change the locate" to open
 * the boxes. Nothing on file: '' (the boxes show at once).
 */
export function locateOnFile(loc: ReturnType<typeof locateOf>, by: string | null | undefined, at: Date | null | undefined): string {
  if (!hasLocate(loc)) return ''
  const row = (label: string, v: string | null, key: string) => `<tr><th>${label}</th><td data-packet-locate-${key}>${v ? esc(v) : '<span class="small">Not entered</span>'}</td></tr>`
  const when = at ? at.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' }) : ''
  return `<table class="locate" data-packet-locate-on-file><tbody>${row('Ticket', loc.ticket, 'ticket')}${row('Called in', loc.calledDate ? locateDay(loc.calledDate) : null, 'called')}${row('Good to dig', loc.goodDate ? locateDay(loc.goodDate) : null, 'good')}${row('Expires', loc.expDate ? locateDay(loc.expDate) : null, 'exp')}</tbody></table>
      ${by ? `<p class="small" data-packet-locate-by>Saved by ${esc(by)}${when ? ` on ${esc(when)}` : ''}.</p>` : ''}
      <button type="button" id="locEdit" class="btn btn2 noprint" data-packet-locate-edit>Change the locate</button>`
}

/**
 * The posts of a new fence or a move ("2 corner posts · 2 end posts · 1 gate
 * post"); none for a repair (its work is listed above) or when every count is
 * 0 (round 2b, Oct 26 2026: a gate rehang read "0 corner posts · 0 end posts ·
 * 0 gate posts").
 */
export function postsLine(posts: { corners: number; ends: number; gatePosts: number } | null | undefined, workType?: string | null): string {
  if (!posts || workType === 'repair') return ''
  const ends = Math.max(0, posts.ends - posts.gatePosts)
  if (posts.corners + ends + posts.gatePosts === 0) return ''
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  return `<p data-packet-posts>${[n(posts.corners, 'corner post'), n(ends, 'end post'), n(posts.gatePosts, 'gate post')].join(' · ')}</p>`
}

export const packetPublic = Router()
export const packetStaff = Router()

const DAYS_AFTER_COMPLETE = 30
const CREW_CATEGORIES = ['Progress', 'Completed'] as const

/**
 * Why a packet link no longer works, or null. `openWork`: covered warranty
 * work still to do on the job (lib/serviceTickets.ts coveredWorkOn) keeps a
 * finished job's packet open for the crew.
 */
export function packetClosed(p: { disabledAt: Date | null }, job: { completedDate: string | null; archivedAt?: Date | null; deletedAt?: Date | null } | null, now = Date.now(), openWork = 0): 'off' | 'expired' | 'gone' | null {
  if (p.disabledAt) return 'off'
  if (!job || job.archivedAt || job.deletedAt) return 'gone'
  if (job.completedDate && openWork === 0) {
    const done = new Date(job.completedDate.length <= 10 ? `${job.completedDate}T23:59:59` : job.completedDate).getTime()
    if (Number.isFinite(done) && now > done + DAYS_AFTER_COMPLETE * 86_400_000) return 'expired'
  }
  return null
}

interface Snapshot {
  planSvg?: string
  style?: string
  footageFt?: number
  sections?: number
  posts?: { corners: number; ends: number; gatePosts: number }
  runs?: Array<{ label: string; length: string; sections: number; spacing: string }>
  gates?: string[]
  skips?: string[]
  pullSheet?: Array<{ item: string; qty: number }>
  crewNotes?: string[]
  notes?: string
  companyName?: string
  companyPhone?: string
  work?: { type: 'move' | 'repair'; title: string; steps: string[]; gateHardware: string[]; needs811: boolean }
}

// ── Staff ─────────────────────────────────────────────────────────────────────

const snapSchema = z.object({
  planSvg: z.string().max(400_000).optional(),
  style: z.string().max(200).optional(),
  footageFt: z.number().optional(),
  sections: z.number().optional(),
  posts: z.object({ corners: z.number(), ends: z.number(), gatePosts: z.number() }).optional(),
  runs: z.array(z.object({ label: z.string().max(200), length: z.string().max(40), sections: z.number(), spacing: z.string().max(40) })).max(200).optional(),
  gates: z.array(z.string().max(300)).max(60).optional(),
  skips: z.array(z.string().max(300)).max(60).optional(),
  // Quantities only: a cost sent here is dropped.
  pullSheet: z.array(z.object({ item: z.string().max(300), qty: z.number() }).strip()).max(400).optional(),
  crewNotes: z.array(z.string().max(2000)).max(100).optional(),
  notes: z.string().max(10_000).optional(),
  companyName: z.string().max(200).optional(),
  companyPhone: z.string().max(60).optional(),
  // A fence move or repair: the steps, the gate hardware and whether new posts need an 811 ticket. Words only, no prices.
  work: z.object({
    type: z.enum(['move', 'repair']), title: z.string().max(200), steps: z.array(z.string().max(1000)).max(60),
    gateHardware: z.array(z.string().max(300)).max(60), needs811: z.boolean(),
  }).strip().optional(),
}).strip()

packetStaff.use(requireUser, requireAccount)

packetStaff.get('/', async (req: any, res) => {
  const p = await prisma.installPacket.findFirst({ where: { accountId: req.user.crmAccountId, jobId: String(req.query.jobId || '') } })
  // Changed since it was sent: the change order that changed the work (send the packet again for the new site plan).
  const job = p ? await prisma.savedJob.findUnique({ where: { id: p.jobId }, select: { quoteId: true } }) : null
  const co = p ? await packetChange(p.accountId, job?.quoteId, p.sentAt).catch(() => null) : null
  // The 811 locate is the job's (lib/locates.ts): the job page shows and edits it; the packet saves the same fields.
  res.json({ success: true, data: p ? { id: p.id, token: p.token, disabledAt: p.disabledAt, sentAt: p.sentAt, changedBy: co ? { number: co.number, what: co.what, all: co.all.map(a => ({ number: a.number, what: a.what })) } : null } : null })
})

// The work as it is now for a packet (the newest approved change order's drawing, runs, gates and quantities;
// never a price), for a phone that may not read change orders (the installer): it builds the gates with their
// places and swing from this drawing, as the office's phone does.
packetStaff.get('/work', async (req: any, res) => {
  try {
    const job = await prisma.savedJob.findFirst({ where: { id: String(req.query.jobId || ''), accountId: req.user.crmAccountId, deletedAt: null }, select: { quoteId: true } })
    const co = job ? await packetChange(req.user.crmAccountId, job.quoteId, new Date(0)) : null
    if (!co) { res.json({ success: true, data: null }); return }
    const w = co.work as any
    res.json({ success: true, data: { number: co.number, work: {
      fenceStyle: w.fenceStyle, runs: w.runs, runRails: w.runRails, corners: w.corners, ends: w.ends, walkGates: w.walkGates, dblGates: w.dblGates,
      tearOutSections: w.tearOutSections, tearOutGates: w.tearOutGates, sections: w.sections, footage: w.footage, layout: w.layout ?? null, planSvg: w.planSvg ?? null,
      pullSheet: (w.pullSheet ?? []).filter((l: any) => !l.moneyOnly).map((l: any) => ({ item: l.item, qty: l.qty })),
    } } })
  } catch (err) { console.error('[packet] work:', err); res.status(500).json({ success: false, error: 'Could not read the work' }) }
})

// Send (or refresh) a job's packet. A packet that was turned off gets a new link.
// The office sends and refreshes it (packets.change); the crew may make a job's first one from their home
// screen, so a scheduled install always has its packet (walkthrough round 1, Oct 25, 2026).
packetStaff.post('/', express.json({ limit: '1mb' }), async (req: any, res) => {
  try {
    const body = z.object({ jobId: z.string().min(1).max(100), snapshot: snapSchema }).parse(req.body)
    const accountId = req.user.crmAccountId
    const job = await prisma.savedJob.findFirst({ where: { id: body.jobId, accountId, deletedAt: null } })
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const existing = await prisma.installPacket.findUnique({ where: { jobId: job.id } })
    if (!can(roleOf(req), 'packets.change') && existing) { refuse(res, 'packets.change'); return }
    const token = !existing || existing.disabledAt ? crypto.randomBytes(24).toString('base64url') : existing.token
    // The work as signed plus the approved change orders, whoever taps it: a phone that may not read change
    // orders (the installer has no prices) sends the original quote's work; the server puts the change on it.
    const snapshot = await withSignedWork(accountId, job.quoteId, body.snapshot)
    const p = existing
      ? await prisma.installPacket.update({ where: { id: existing.id }, data: { token, snapshot: snapshot as any, disabledAt: null, sentAt: new Date() } })
      : await prisma.installPacket.create({ data: { accountId, jobId: job.id, token, snapshot: snapshot as any } }).catch(async e => {
        // Sent at the same moment twice: the packet made first is the packet.
        if (!isUniqueViolation(e)) throw e
        return (await prisma.installPacket.findUnique({ where: { jobId: job.id } }))!
      })
    res.json({ success: true, data: { id: p.id, token: p.token, disabledAt: p.disabledAt, sentAt: p.sentAt } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[packet] send:', err); res.status(500).json({ success: false, error: 'Could not make the packet' })
  }
})

packetStaff.post('/:id/off', requireCan('packets.change'), async (req: any, res) => {
  const n = await prisma.installPacket.updateMany({ where: { id: String(req.params.id), accountId: req.user.crmAccountId }, data: { disabledAt: new Date() } })
  res.json({ success: true, data: { updated: n.count } })
})

// ── The installer's home (Field Crew) ─────────────────────────────────────────

/** A job of this company, or a 404 answer. */
async function crewJob(req: any, res: any) {
  const job = await prisma.savedJob.findFirst({ where: { id: String(req.params.jobId), accountId: req.user.crmAccountId, deletedAt: null }, select: { id: true, crmContactId: true } })
  if (!job) res.status(404).json({ success: false, error: 'Job not found' })
  return job
}

/**
 * What the installer's card and the job page need about the install as a
 * whole: its last crew day, its crew days in order ("Finished day 1 of 2"),
 * finished or not, the 811 locate in words, and where the close out stands
 * (closed, the walkthrough signed, paid in full: yes or no, never an amount),
 * so "Job finished" says what it is still waiting for (round 2b, Oct 26 2026).
 */
export async function crewFacts(accountId: string, jobId: string) {
  const job = await prisma.savedJob.findUnique({ where: { id: jobId } })
  if (!job) return { lastDay: null, crewDays: [] as string[], jobDone: false, locate: null, closeOut: null }
  const times = await installTimes(jobId)
  const lastDay = await lastCrewDay(accountId, job)
  const crewDays = [...new Set((await prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: jobId }, select: { date: true } })).map(d => d.date).filter(isYmd))].sort()
  const w = await prisma.walkthrough.findUnique({ where: { jobId }, select: { accountId: true, homeownerSig: true, repSig: true } })
  const closeOut = {
    closed: isDonePhase(job.status),
    walkthroughSigned: !!w && w.accountId === accountId && !!w.homeownerSig && !!w.repSig,
    paidInFull: billingStatusOf(await billingViewFor(accountId, jobId)).paidInFull,
  }
  const loc = locateOf(job)
  // The 811 status on the card every day, and what Start warns about (never a block): not clear yet, expired, or
  // none when posts go in the ground (a repair with no new posts needs no ticket: its packet says so).
  const packet = await prisma.installPacket.findUnique({ where: { jobId }, select: { snapshot: true } }).catch(() => null)
  const work = (packet?.snapshot as Snapshot | null)?.work
  const startWarning = locateStartWarning(loc, todayFl(), work ? work.needs811 : true)
  const locate = hasLocate(loc) || startWarning ? { ...locateWords(loc, todayFl()), ticket: loc.ticket, warning: startWarning } : null
  return { lastDay, crewDays, jobDone: crewFinishedJob(times, lastDay), locate, closeOut }
}

/** The service and warranty visits booked with the signed in login, for My installs (lib/crewVisits.ts). No prices. */
packetStaff.get('/visits', async (req: any, res) => {
  try {
    res.json({ success: true, data: await crewVisitsFor(req.user.crmAccountId, req.user.id) })
  } catch (err) { console.error('[packet] visits:', err); res.status(500).json({ success: false, error: 'Could not load the visits' }) }
})

/** For an install on the installer's home: its packet link, the customer's notes, Start and Finish so far, and whether the job is finished. */
packetStaff.get('/crew/:jobId', async (req: any, res) => {
  try {
    const job = await crewJob(req, res)
    if (!job) return
    const p = await prisma.installPacket.findUnique({ where: { jobId: job.id } })
    res.json({ success: true, data: {
      packet: p && !p.disabledAt ? { token: p.token } : null,
      customerNotes: await customerNotesForJob(req.user.crmAccountId, job.crmContactId),
      times: await installTimes(job.id),
      // Starts made while 811 was not clear (he was warned): the office sees them under the install times.
      locateWarned: (await prisma.activityLog.findMany({ where: { entityType: 'job', entityId: job.id, body: { startsWith: 'Started before the 811 locate was clear' } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, actor: true, body: true } }))
        .map(r => ({ at: r.createdAt.toISOString(), by: r.actor, text: r.body })),
      ...(await crewFacts(req.user.crmAccountId, job.id)),
    } })
  } catch (err) { console.error('[packet] crew:', err); res.status(500).json({ success: false, error: 'Could not load the install' }) }
})

/**
 * Start or Finish on an install: who and when, on the job. Start moves a
 * scheduled job to In Progress. Finish with { jobDone: true } ("Finished the
 * job"), or Finish on the job's last crew day, is the install finished: the
 * job closes out by itself once the walkthrough is signed and it is paid in
 * full (lib/jobTruth.ts closeOutIfDone), in any order.
 */
packetStaff.post('/crew/:jobId/:kind', async (req: any, res) => {
  try {
    if (req.params.kind !== 'start' && req.params.kind !== 'finish') { res.status(404).json({ success: false, error: 'Not found' }); return }
    const job = await crewJob(req, res)
    if (!job) return
    const accountId = req.user.crmAccountId
    const me = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true, email: true } }).catch(() => null)
    const by = (me ? `${me.firstName ?? ''} ${me.lastName ?? ''}`.trim() || me.email : req.user.email) || 'Crew'
    const kind = req.params.kind === 'finish' ? 'finish' : 'start'
    const wholeJob = kind === 'finish' && req.body?.jobDone === true
    await recordInstallTime(job.id, kind, by, new Date(), wholeJob)
    // Started while the 811 locate is not clear: allowed (he was warned on his phone), and kept on the job's
    // history with who and what, for the owner (legal and safety).
    if (kind === 'start') {
      const warned = (await crewFacts(accountId, job.id)).locate?.warning
      if (warned) await prisma.activityLog.create({ data: { entityType: 'job', entityId: job.id, actor: by, body: `Started before the 811 locate was clear: ${warned}`, metadata: { kind: 'locate_warning' } } }).catch(() => null)
    }
    // "We finished the whole job" before its last booked day: the crew days still ahead come off the installer's list
    // and the Schedule (logged, restorable from Deleted Records), as a close out does (re-check, Oct 26 2026: day 2 of 2
    // still showed on My installs the next day).
    if (wholeJob) await finishScheduleRows(accountId, job.id, { accountId, userId: req.user.id ?? null }, todayFl())
    if (kind === 'start') await startedByCrew(accountId, job.id)
    else await closeOutIfDone(accountId, job.id, 'the crew finished the install')
    res.json({ success: true, data: { times: await installTimes(job.id), ...(await crewFacts(accountId, job.id)) } })
  } catch (err) { console.error('[packet] crew time:', err); res.status(500).json({ success: false, error: 'Could not save the time' }) }
})

// ── Public: the packet ────────────────────────────────────────────────────────

async function load(token: string) {
  const p = await prisma.installPacket.findUnique({ where: { token } }).catch(() => null)
  if (!p) return null
  const job = await prisma.savedJob.findUnique({ where: { id: p.jobId } }).catch(() => null)
  // Covered warranty work on the job: a $0 work order on the packet.
  const work = job ? await coveredWorkOn(job.id) : []
  return { p, job, work }
}

function headers(res: any, nonce: string) {
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Cache-Control', 'no-store')
}

const page = (title: string, body: string, nonce: string, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${CSS}${PACKET_CSS}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`

// Photos and video on a packet, through the public door (same signed links as the app).
packetPublic.get('/m/:id/:variant', (req, res) => serveSignedMedia(req, res))

packetPublic.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  headers(res, nonce)
  const found = await load(String(req.params.token))
  const closed = found ? packetClosed(found.p, found.job, Date.now(), found.work.length) : 'gone'
  if (!found || closed) {
    const snap = (found?.p.snapshot ?? {}) as Snapshot
    res.status(found ? 410 : 404).type('html').send(page('Install packet', `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(snap.companyName || 'Getter Done Fence')}</p></div></header>
      <main class="wrap"><section><h1>This install packet is not active</h1><p>${closed === 'expired' ? 'Packets close 30 days after the job is complete.' : closed === 'off' ? 'This link was turned off. Ask the office for a new one.' : 'Ask the office for a current link.'}</p>${snap.companyPhone ? `<p>Office: <a href="tel:${esc(snap.companyPhone.replace(/[^\d+]/g, ''))}"><b>${esc(phone(snap.companyPhone))}</b></a></p>` : ''}</section></main>`, nonce))
    return
  }
  const { p, job, work } = found
  // The crew days as booked on the Schedule (Schedule install: one entry a day).
  const bookedDays = [...new Set((await prisma.scheduledGridJob.findMany({ where: { accountId: p.accountId, deletedAt: null, stagingJobId: p.jobId }, select: { date: true } })).map(g => g.date).filter(isYmd))].sort()
  // An approved change order changed the work after this packet was sent: the work as it is now, what changed marked.
  const coChange = await packetChange(p.accountId, job!.quoteId, p.sentAt).catch(() => null)
  const s = packetWithChange(p.snapshot as Snapshot, coChange)
  const coLines = coChange ? sheetChanges((p.snapshot as Snapshot).pullSheet ?? [], s.pullSheet ?? []) : []
  // The fence's plain name (packets made before plain names carry the style's code).
  const styleText = panelWords(await plainStyleName(s.style ?? job!.fenceStyle), s.runs ?? [])
  // The job's, its quote's and its site visit's photos and video shared with the crew (Crew or Customer), and what the
  // crew added from here. Never Internal ones: one can be a supplier invoice with prices (lib/quoteMedia.ts).
  const ttl = 3 * 86_400_000
  const fromQuote = await jobQuoteMediaOr(p.accountId, job!.quoteId)
  const media = await prisma.mediaItem.findMany({
    where: { accountId: p.accountId, deletedAt: null, kind: { in: ['photo', 'video'] }, AND: [{ OR: [{ jobId: job!.id }, ...fromQuote] }, { OR: [{ visibility: { in: ['crew', 'customer'] } }, { source: 'crew' }] }] },
    orderBy: { takenAt: 'asc' },
  })
  const items = media.map(m => serializeMedia(m, ttl))
  // Walkthrough video first, then marked up photos, then the rest.
  items.sort((a, b) => rank(a) - rank(b))
  // /api/media/f/<id>/<v>?… → m/<id>/<v>?… (under /p/i, the public door)
  const fix = (u: string | null) => (u ? u.replace(/^\/api\/media\/f\//, 'm/') : null)

  const job_ = job!
  const loc = locateOf(job_)
  // Work (tear out and haul away) is a step for the crew, not a material to pull.
  const parts = (s.pullSheet ?? []).filter(i => !isWorkLine(i.item))
  const workLines = (s.pullSheet ?? []).filter(i => isWorkLine(i.item))
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job_.customerAddress)}`
  // The crew never sees a price: a dollar amount typed in a note is left out (lib/costRedact.ts).
  const crewNotes = (s.crewNotes ?? []).filter(Boolean).map(forCrew)
  // What the customer told us ("have 2 dogs"), read now so a note added after the packet was sent shows (lib/crewInstall.ts).
  const fromCustomer = await customerNotesForJob(p.accountId, job_.crmContactId).catch(() => [] as string[])
  const body = `<header class="top"><img src="../logo.png" alt="" class="logo"><div><p class="co">${esc(s.companyName || 'Getter Done Fence')}</p><p class="small">Install packet${s.companyPhone ? ` · Office <a href="tel:${esc(s.companyPhone.replace(/[^\d+]/g, ''))}">${esc(phone(s.companyPhone))}</a>` : ''}</p></div>
    <button type="button" id="print" class="printbtn noprint">Print / PDF</button></header>
  <main class="wrap">
    <h1>${esc(job_.customerName)}</h1>
    <p><a href="${esc(map)}" class="maplink">${esc(job_.customerAddress)}</a>${job_.customerPhone ? ` · <a href="tel:${esc(job_.customerPhone.replace(/[^\d+]/g, ''))}">${esc(phone(job_.customerPhone))}</a>` : ''}</p>
    <p class="facts" data-packet-install="${esc(job_.scheduledDate || '')}">Install: ${esc(installWhen(job_.scheduledDate, job_.scheduledEndDate, job_.estimatedDays, bookedDays))}${job_.crewAssigned ? ` · Crew: ${esc(await crewNameFor(job_.accountId, job_.crewAssigned))}` : ''}</p>
    ${coChange ? `<section class="notes" data-packet-change-order><h2>${esc(packetChangeHeading(coChange))}</h2>${coChange.all.map(a => `<p data-packet-co-item="${a.number}">${coChange.all.length > 1 ? `CO-${a.number}: ` : ''}<b>${esc(a.what)}</b> (approved ${esc(a.approvedAt.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }))}${a.rev ? `, contract rev ${a.rev}` : ''}).</p>`).join('')}<p>The fence, runs and pull sheet below are the new ones, with ${coChange.all.length > 1 ? 'every change above' : 'this change'}.${coChange.work.planSvg ? '' : ' The site plan is left out until the office sends the new drawing.'}</p>${coLines.length ? `<h3>Pull sheet changes</h3><ul>${coLines.map(l => `<li data-packet-co-line><b>${esc(partWithPair(l.item))}</b>: ${esc(l.was)} → ${esc(l.now)}</li>`).join('')}</ul>` : ''}</section>` : ''}
    ${s.notes ? `<section class="notes" data-packet-notes><h2>Gate codes and notes</h2><p>${esc(forCrew(onceEach(s.notes))).replace(/\n/g, '<br>')}</p></section>` : ''}
    ${fromCustomer.length ? `<section class="notes" data-packet-customer-notes><h2>Customer notes</h2><ul>${fromCustomer.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
    ${crewNotes.length ? `<section class="notes"><h2>Crew notes</h2><ul>${crewNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
    ${await workOrders(work)}
    ${s.work ? `<section class="notes" data-packet-work><h2>${esc(s.work.title)}</h2><ol>${s.work.steps.map(x => `<li>${esc(forCrew(x))}</li>`).join('')}</ol>${s.work.gateHardware.length ? `<h3>Gate hardware</h3><ul>${s.work.gateHardware.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="small">The pull sheet below is only the NEW material.</p></section>` : ''}
    <section data-packet-locate-section><h2>811 locate</h2>${s.work?.needs811 ? '<p data-packet-811><b>New posts go in the ground: an 811 locate ticket is needed before digging.</b></p>' : ''}
      <p class="facts" id="locStatus" data-packet-locate-status="${esc(locateStatus(loc, todayFl()))}">${esc(locateWords(loc, todayFl()).text)}</p>
      ${(() => { const w = locateStartWarning(loc, todayFl(), s.work ? s.work.needs811 : true); return `<p id="locWarn" data-packet-locate-warn style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;border-radius:10px;padding:10px 12px;font-weight:700"${w ? '' : ' hidden'}>${w ? `⚠ ${esc(w)}` : ''}</p>` })()}
      <div id="locOnFile">${locateOnFile(loc, job_.locateUpdatedBy, job_.locateUpdatedAt)}</div>
      <div id="locForm" data-packet-locate-form${hasLocate(loc) ? ' hidden' : ''}>
      <div class="row"><label class="field">Ticket number<input id="ticket" value="${esc(loc.ticket ?? '')}" data-was="${esc(loc.ticket ?? '')}" maxlength="40" autocomplete="off"></label>
      <label class="field">Called in<input id="lcalled" type="date" value="${esc(loc.calledDate ?? '')}"></label></div>
      <div class="row"><label class="field">Good to dig<input id="ldate" type="date" value="${esc(loc.goodDate ?? '')}"></label>
      <label class="field">Expires<input id="lexp" type="date" value="${esc(loc.expDate ?? '')}"></label></div>
      <button type="button" id="saveLocate" class="btn noprint">Save locate</button></div>
      <p id="locMsg" class="small" aria-live="polite">${hasLocate(loc) ? 'This is the same locate the office sees on the job.' : 'The office sees it on the job right away.'}</p>
    </section>
    <section data-packet-fence><h2>${s.work?.type === 'repair' ? 'The existing fence' : 'The fence'}</h2>
      <p class="facts">${esc(styleText)}${s.footageFt ? ` · ${Math.round(s.footageFt)} ft` : ''}${s.sections ? ` · ${s.sections} sections` : ''}</p>
      ${postsLine(s.posts, s.work?.type)}
      ${safeSvg(s.planSvg) ? `<div class="plan">${safeSvg(s.planSvg)}</div><p class="small">Purple: new fence. Purple squares: corner posts. Dark squares: gate hinge posts. Dots: end and gate latch posts. Dashed arcs: which way each gate swings. Open dots: line posts. Dark arrows: where photos were taken.${s.work?.type === 'move' ? ' Brown dashed: the old fence line.' : s.work?.type === 'repair' ? ' Red: the sections to repair.' : ''} Not to scale for permitting.</p>` : ''}
      ${s.runs?.length ? `<table><thead><tr><th>Run</th><th>Length</th><th>Sections</th><th>Posts apart</th></tr></thead><tbody>${s.runs.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.length)}</td><td>${r.sections}</td><td>${esc(r.spacing)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${s.gates?.length ? `<h3>Gates</h3><ul>${s.gates.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${s.skips?.length ? `<h3>Skips (not included)</h3><ul>${s.skips.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
    </section>
    ${workLines.length ? `<section class="notes" data-packet-work-steps><h2>Work on this job</h2><ul>${workLines.map(i => `<li>${esc(workStepText(i.item, i.qty))}</li>`).join('')}</ul></section>` : ''}
    ${parts.length ? `<section><h2>Pull sheet</h2><table><thead><tr><th>Material</th><th>Qty</th></tr></thead><tbody>${parts.map(i => `<tr><td>${esc(partWithPair(i.item))}</td><td>${esc(i.qty)}</td></tr>`).join('')}</tbody></table></section>` : ''}
    <section><h2>Photos and video</h2>
      ${items.length ? `<div class="media">${items.map(m => {
        const src = fix(m.markupUrl ?? m.url)
        const media = m.kind === 'video'
          ? `<video src="${esc(fix(m.previewUrl ?? m.url))}" ${m.thumbUrl ? `poster="${esc(fix(m.thumbUrl))}"` : ''} controls playsinline preload="none"></video>`
          : `<a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(m.category)}" loading="lazy"></a>`
        // A staff caption with a price in it (an Internal photo from the quote) never reaches the crew (lib/costRedact.ts).
        return `<figure>${media}<figcaption><b>${esc(m.category)}</b>${m.source === 'crew' ? ' · from the crew' : ''}<br>${esc(forCrew(m.caption || ''))}</figcaption></figure>`
      }).join('')}</div>` : '<p class="small">No photos are shared with the crew yet. Photos from the quote and the site visit show here, and the job photos set to Crew or Customer.</p>'}
    </section>
    <section class="noprint"><h2>Add photos</h2>
      <p class="small">Photos and video you add here go to the office.</p>
      <label class="field">What they show<select id="cat">${CREW_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></label>
      <label class="field">Note (optional)<input id="note" maxlength="500"></label>
      <label class="btn filebtn">Choose photos or video<input id="files" type="file" accept="image/*,video/*" multiple hidden></label>
      <p id="upMsg" class="small"></p>
      <div id="sent" class="media" aria-live="polite"></div>
    </section>
  </main>`
  const script = `
  (function(){
    document.getElementById('print').addEventListener('click',function(){window.print()});
    var tok=${JSON.stringify(String(req.params.token))};
    // An empty date box shows "Not set" (Safari greys in today's date, which reads as filled in); a tap opens the picker.
    ['lcalled','ldate','lexp'].forEach(function(id){var el=document.getElementById(id);if(!el)return;
      var hint=document.createElement('span');hint.className='small unsethint';hint.textContent='Not set';el.parentNode.appendChild(hint);
      function show(){var empty=!el.value;el.classList.toggle('unset',empty);hint.style.display=empty?'block':'none'}
      el.addEventListener('input',show);el.addEventListener('change',show);show()});
    // The office's locate on file: shown in words; the boxes open only on "Change the locate".
    function bindEdit(){var edit=document.getElementById('locEdit');
      if(edit)edit.addEventListener('click',function(){document.getElementById('locForm').hidden=false;edit.hidden=true;document.getElementById('ticket').focus()})}
    bindEdit();
    function saveLoc(replace){
      var m=document.getElementById('locMsg');m.textContent='Saving...';
      var v=function(id){return document.getElementById(id).value};
      fetch(tok+'/locate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:v('ticket'),calledDate:v('lcalled'),goodDate:v('ldate'),expDate:v('lexp'),replace:!!replace})})
        .then(function(r){return r.json()}).then(function(j){
          if(j.success){m.textContent='Saved. The office sees it on the job.';document.getElementById('ticket').setAttribute('data-was',v('ticket'));var st=document.getElementById('locStatus');if(j.data&&j.data.text){st.textContent=j.data.text;st.setAttribute('data-packet-locate-status',j.data.status)}
            var lw=document.getElementById('locWarn');if(lw&&j.data){lw.textContent=j.data.warning?'\\u26a0 '+j.data.warning:'';lw.hidden=!j.data.warning}
            // The table on file shows what was just saved (the ticket, its dates, who saved it), the boxes close.
            if(j.data&&typeof j.data.onFile==='string'&&j.data.onFile){document.getElementById('locOnFile').innerHTML=j.data.onFile;document.getElementById('locForm').hidden=true;bindEdit()}}
          else if(j.code==='REPLACE_TICKET'){if(window.confirm(j.error))saveLoc(true);else m.textContent='Not saved. The office\\'s ticket is kept.'}
          else m.textContent=j.error||'Could not save.'
        }).catch(function(){m.textContent='No connection. Try again.'});
    }
    document.getElementById('saveLocate').addEventListener('click',function(){saveLoc(false)});
    var files=document.getElementById('files'),msg=document.getElementById('upMsg');
    files.addEventListener('change',function(){
      var list=[].slice.call(files.files);if(!list.length)return;var i=0,wait=3000;
      // Each photo keeps one id, so one sent again after the signal dropped is saved once.
      var ids=list.map(function(){return Date.now().toString(36)+Math.random().toString(36).slice(2,12)});
      var cat=document.getElementById('cat').value,note=document.getElementById('note').value;
      function next(){
        if(i>=list.length){msg.textContent=list.length+' uploaded. Thank you.';files.value='';return}
        var f=list[i],fd=new FormData();fd.append('category',cat);fd.append('caption',note);fd.append('cid',ids[i]);fd.append('file',f);
        var x=new XMLHttpRequest();x.open('POST',tok+'/media');
        x.upload.onprogress=function(e){if(e.lengthComputable)msg.textContent='Uploading '+(i+1)+' of '+list.length+': '+Math.round(e.loaded/e.total*100)+'%'};
        x.onload=function(){if(x.status>=200&&x.status<300){shown(f);wait=3000;i++;next()}else if(x.status>=500){retry()}else{var e='';try{e=JSON.parse(x.responseText).error}catch(_){}msg.textContent=(e||'That file could not be uploaded.')+' Choose it again to try.'}};
        x.onerror=retry;
        x.send(fd);
      }
      // What the crew just sent, so they can see it went (it is Internal for the office until marked).
      function shown(f){var fig=document.createElement('figure'),el=document.createElement(f.type.indexOf('video')===0?'video':'img');el.src=URL.createObjectURL(f);if(el.tagName==='VIDEO'){el.controls=true;el.setAttribute('playsinline','')}else{el.alt=''}var cap=document.createElement('figcaption');cap.textContent='Sent from this phone: '+cat+(note?' · '+note:'');fig.appendChild(el);fig.appendChild(cap);document.getElementById('sent').appendChild(fig)}
      // No signal: keep the page open and it sends by itself.
      function retry(){msg.textContent='No signal. '+(list.length-i)+' waiting; they will send by themselves when there is signal. Keep this page open.';setTimeout(next,wait);wait=Math.min(wait*2,30000)}
      next();
    });
  })();`
  res.type('html').send(page(`Install packet: ${job_.customerName}`, body, nonce, script))
})

/**
 * Covered warranty work: a $0 work order per ticket (the issue, the office's
 * notes, the visit day, the customer's photos). No charge to the customer;
 * the crew enters hours and materials with the office when it is fixed.
 */
async function workOrders(work: Awaited<ReturnType<typeof coveredWorkOn>>): Promise<string> {
  if (!work.length) return ''
  const fix = (u: string | null) => (u ? u.replace(/^\/api\/media\/f\//, 'm/') : null)
  const parts: string[] = []
  for (const t of work) {
    const appt = t.appointmentId ? await prisma.appointment.findFirst({ where: { id: t.appointmentId, deletedAt: null, status: { not: 'cancelled' } }, select: { startAt: true, assignedTo: true } }) : null
    const media = (await prisma.mediaItem.findMany({ where: { serviceTicketId: t.id, deletedAt: null }, orderBy: { takenAt: 'asc' } })).map(m => serializeMedia(m, 3 * 86_400_000))
    const visit = appt?.startAt ? appt.startAt.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not booked yet'
    parts.push(`<section class="notes" data-packet-warranty-work="${esc(t.id)}"><h2>Warranty work order: $0, no charge to the customer</h2>
      <p><b>${esc(issueLabel(t.issue))}</b>${t.warrantyName ? ` · Covered by the ${esc(t.warrantyName)}` : ''}</p>
      <p>Visit: ${esc(visit)}${appt?.assignedTo ? ` · ${esc(appt.assignedTo)}` : ''}</p>
      ${t.notes ? `<p>${esc(forCrew(t.notes)).replace(/\n/g, '<br>')}</p>` : ''}
      ${media.length ? `<div class="media">${media.map(m => m.kind === 'video'
        ? `<figure><video src="${esc(fix(m.previewUrl ?? m.url))}" controls playsinline preload="none"></video><figcaption>From the customer</figcaption></figure>`
        : `<figure><a href="${esc(fix(m.url))}"><img src="${esc(fix(m.thumbUrl ?? m.url))}" alt="The customer's photo" loading="lazy"></a><figcaption>From the customer${m.caption ? `: ${esc(m.caption)}` : ''}</figcaption></figure>`).join('')}</div>` : ''}
      <p class="small">Take Completed photos below when it is fixed, and tell the office your hours and the materials used.</p></section>`)
  }
  return parts.join('')
}

function rank(m: { kind: string; category: string; markupUrl: string | null }): number {
  if (m.kind === 'video' && m.category === 'Site walk') return 0
  if (m.markupUrl) return 1
  return m.kind === 'video' ? 3 : 2
}

packetPublic.post('/:token/locate', express.json({ limit: '8kb' }), async (req, res) => {
  const found = await load(String(req.params.token))
  if (!found || packetClosed(found.p, found.job, Date.now(), found.work.length)) { res.status(410).json({ success: false, error: 'This packet is not active.' }); return }
  const b = z.object({ ticket: z.string().max(60).optional(), calledDate: z.string().max(20).optional(), goodDate: z.string().max(20).optional(), expDate: z.string().max(20).optional(), date: z.string().max(20).optional(), replace: z.boolean().optional() }).safeParse(req.body)
  if (!b.success) { res.status(400).json({ success: false, error: 'Check the ticket and the dates.' }); return }
  try {
    // The job's one locate record (lib/locates.ts), the same the job page edits. A packet page opened before
    // the four fields sends { ticket, date }: its date is the good to dig date. A box left empty keeps what the
    // job has (the crew never wipes the office's dates), and a different ticket number replaces the office's
    // only when the crew says so (round 2, Oct 26 2026).
    const was = locateOf(found.job)
    const keep = (v: string | undefined, old: string | null) => (v && v.trim() ? v : old ?? '')
    const ticket = keep(b.data.ticket, was.ticket)
    if (was.ticket && ticket.trim() !== was.ticket && !b.data.replace) {
      res.status(409).json({ success: false, code: 'REPLACE_TICKET', error: `The job already has 811 ticket ${was.ticket}${found.job?.locateUpdatedBy ? ` (saved by ${found.job.locateUpdatedBy})` : ''}. Replace it with ${ticket.trim()}?` })
      return
    }
    const row = await saveLocate(found.p.accountId, found.p.jobId, { ticket, calledDate: keep(b.data.calledDate, was.calledDate), goodDate: keep(b.data.goodDate ?? b.data.date, was.goodDate), expDate: keep(b.data.expDate, was.expDate) }, 'Crew (install packet)')
    const w = locateWords(locateOf(row), todayFl())
    // The table on file as it is now (escaped server side, the same as the page draws it).
    const work = (found.p.snapshot as Snapshot | null)?.work
    const warning = locateStartWarning(locateOf(row), todayFl(), work ? work.needs811 : true)
    res.json({ success: true, data: { status: w.status, text: w.text, warning, onFile: locateOnFile(locateOf(row), row.locateUpdatedBy, row.locateUpdatedAt) } })
  } catch (err: any) {
    if (err?.status) { res.status(err.status).json({ success: false, error: err.message }); return }
    console.error('[packet] locate:', err)
    res.status(500).json({ success: false, error: 'Could not save. Try again.' })
  }
})

const crewUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _f, cb) => cb(null, mediaDir('incoming')), filename: (_req, _f, cb) => cb(null, `crew-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`) }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
})
const OK_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm|3gpp))$/

packetPublic.post('/:token/media', crewUpload.single('file'), async (req: any, res) => {
  const file = req.file
  const drop = () => { if (file) fs.rm(file.path, { force: true }, () => {}) }
  const found = await load(String(req.params.token))
  if (!found || packetClosed(found.p, found.job, Date.now(), found.work.length)) { drop(); res.status(410).json({ success: false, error: 'This packet is not active.' }); return }
  if (!file || !OK_TYPES.test(file.mimetype)) { drop(); res.status(400).json({ success: false, error: 'Send a photo or video.' }); return }
  const category = CREW_CATEGORIES.includes(req.body?.category) ? req.body.category : 'Progress'
  // Sent again after the signal dropped: the first one stands.
  const cid = typeof req.body?.cid === 'string' && /^[a-z0-9]{6,40}$/.test(req.body.cid) ? `crew-${req.body.cid}` : null
  if (cid && await prisma.mediaItem.findUnique({ where: { clientId: cid } })) { drop(); res.json({ success: true }); return }
  const id = crypto.randomUUID()
  const ext = path.extname(file.originalname || '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || (file.mimetype.startsWith('video/') ? 'mp4' : 'jpg')
  const final = path.join(mediaDir(found.p.accountId), `${id}.${ext}`)
  fs.renameSync(file.path, final)
  try {
    await prisma.mediaItem.create({
    data: {
      id, accountId: found.p.accountId, clientId: cid ?? `crew-${id}`, kind: file.mimetype.startsWith('video/') ? 'video' : 'photo', mime: file.mimetype,
      path: final, bytes: file.size, jobId: found.job!.id, quoteKey: found.job!.quoteId ?? null, customerId: found.job!.crmContactId ?? null,
      takenBy: 'Crew (install packet)', takenAt: new Date(), caption: String(req.body?.caption || '').slice(0, 500), category,
      // Internal until the office marks it Customer.
      visibility: 'internal', source: 'crew',
    },
    })
  } catch (e) {
    // The same photo arrived twice at the same moment: the first one stands.
    if (!isUniqueViolation(e)) throw e
    fs.rmSync(final, { force: true })
    res.json({ success: true }); return
  }
  processMediaQueue().catch(err => console.error('[media] queue:', err))
  res.json({ success: true })
})

const PACKET_CSS = `
a[href^="tel:"],.maplink{white-space:nowrap;display:inline-block;padding:15px 0;margin:-15px 0}
.maplink{white-space:normal}
.printbtn{margin-left:auto;min-height:48px;border:1px solid var(--line);background:#fff;border-radius:10px;padding:0 12px;font-weight:700;color:var(--p)}
.maplink{color:var(--p);font-weight:700}.notes{border-color:#FACC15;background:#FFFBEB}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}th{color:var(--g);font-weight:600}
h3{font-size:15px;margin:14px 0 6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
[hidden]{display:none!important}.btn2{background:#fff;color:var(--p);border:1px solid var(--line)}.locate th{width:40%}
.field select{display:block;width:100%;height:48px;font-size:16px;border:1px solid #CBC4D6;border-radius:10px;margin-top:4px;padding:0 10px;background:#fff}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.media figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.media img,.media video{width:100%;max-height:320px;object-fit:cover;display:block;background:#000}.media figcaption{padding:8px;font-size:13px;color:var(--g)}
.filebtn{display:flex;align-items:center;justify-content:center}
.unset{color:transparent}.unset::-webkit-datetime-edit{color:transparent}.unset:focus{color:inherit}.unset:focus::-webkit-datetime-edit{color:inherit}.unsethint{display:block;color:#6b7280;margin-top:2px}
@media print{.noprint{display:none!important}body{background:#fff}section{break-inside:avoid;border:0;padding:8px 0}.media{grid-template-columns:repeat(2,1fr)}.media video{display:none}}
`
