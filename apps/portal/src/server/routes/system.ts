/**
 * /api/system: owner and admins.
 *   GET  /storage  free space on the Mac (the dashboard warns under 50 GB)
 *   GET  /setup    the Finish setup list: each item checked against the data
 *                  itself, so it ticks off when the thing is really done
 *   POST /setup    Jonathan's answers the data cannot show (the jobs not on
 *                  the GD Schedule looked at)
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { plainZod } from '../lib/plainZod.js'
import { openFindings, dismissFinding } from '../lib/duplicateCheck.js'

const router = Router()
router.use(requireAuth, requireRole('admin'))

export const LOW_DISK_BYTES = 50 * 1e9

router.get('/storage', async (_req, res) => {
  try {
    const dir = path.resolve(process.env.UPLOAD_DIR || './uploads')
    fs.mkdirSync(dir, { recursive: true })
    const s = await fs.promises.statfs(dir)
    const free = s.bavail * s.bsize, total = s.blocks * s.bsize
    res.json({ success: true, data: { freeBytes: free, totalBytes: total, lowBelowBytes: LOW_DISK_BYTES, low: free < LOW_DISK_BYTES } })
  } catch (err) {
    console.error('[system] storage error:', err)
    res.status(500).json({ success: false, error: 'Could not read the free space' })
  }
})

// The duplicate check, now: what it finds that has not been marked "This is fine".
router.get('/duplicates', async (req: any, res) => {
  try { res.json({ success: true, data: await openFindings(req.user.accountId) }) }
  catch (err) { console.error('[system] duplicate check error:', err); res.status(500).json({ success: false, error: 'The duplicate check did not run' }) }
})
router.post('/duplicates/dismiss', async (req: any, res) => {
  const key = z.object({ key: z.string().min(3).max(300) }).safeParse(req.body)
  if (!key.success) { res.status(400).json({ success: false, error: 'Which finding?' }); return }
  await dismissFinding(req.user.accountId, key.data.key)
  res.json({ success: true })
})

const SETUP_KEY = 'setup'
/** The three jobs Jonathan is closing out. */
const CLOSE_OUT = [/pahl/i, /madsen/i, /tieman/i]
const DAY = 86_400_000
/** Gate parts still to add for these styles (old parts lists had no gate itself), and Durafence has no parts list. */
const GATE_STYLES = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail']
const DURAFENCE = 'Durafence'
/** Where the Xcode check looks (EZ_XCODE_APP only for the tests). */
const xcodePath = () => process.env.EZ_XCODE_APP || '/Applications/Xcode.app'

async function answers(accountId: string): Promise<Record<string, any>> {
  const r = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: SETUP_KEY } } })
  return (r?.value as Record<string, any>) ?? {}
}

export interface SetupItem { key: string; label: string; done: boolean; detail: string; link?: string; answer?: Array<{ label: string; value: string }> }

/** A job is closed out when it is archived, its quote was Lost, it is Paid, or it is Complete (or Invoiced) and paid. */
export function closedOut(j: { status: string; paymentStatus?: string | null; archivedAt?: Date | null; deletedAt?: Date | null }, quoteStatus?: string | null): boolean {
  if (j.archivedAt || j.deletedAt) return true
  if (quoteStatus === 'LOST') return true
  if (j.status === 'paid') return true
  return j.paymentStatus === 'paid' && ['completed', 'invoiced'].includes(j.status)
}

/**
 * The Finish setup list, each item checked against the data itself (so it
 * ticks off when the thing is really done), with the screen to do it on.
 * Each link is honored by the app: Settings ?tab= and ?focus=, Inventory
 * ?tab= and ?price=, Operations ?q= (searches notes too) and ?ids=,
 * Customers ?filter=.
 */
export async function setupList(accountId: string): Promise<SetupItem[]> {
  const [biz, inv, jobs, closeJobs, scheduleContacts, cal, voice, offsite, kv, a] = await Promise.all([
    prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }),
    prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } }),
    prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null, notes: { contains: 'Tag: not on GD Schedule' } }, select: { id: true } }),
    prisma.savedJob.findMany({
      where: { accountId, OR: [{ customerName: { contains: 'pahl', mode: 'insensitive' } }, { customerName: { contains: 'madsen', mode: 'insensitive' } }, { customerName: { contains: 'tieman', mode: 'insensitive' } }] },
      select: { id: true, customerName: true, status: true, paymentStatus: true, archivedAt: true, deletedAt: true, quoteId: true },
    }),
    prisma.crmContact.count({ where: { accountId, deletedAt: null, archivedAt: null, notes: { contains: 'Created from the GD Schedule' }, AND: [{ OR: [{ phone: null }, { phone: '' }] }, { OR: [{ email: null }, { email: '' }] }] } }),
    prisma.calendarSyncState.findUnique({ where: { accountId } }).catch(() => null),
    prisma.voiceCheck.findMany({ where: { accountId }, select: { userAgent: true } }).catch(() => [] as Array<{ userAgent: string | null }>),
    prisma.backupLog.findFirst({ where: { backupType: 'offsite', status: 'success', completedAt: { gte: new Date(Date.now() - 2 * DAY) } }, orderBy: { completedAt: 'desc' } }),
    prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'uptimeRobotSeenAt' } } }),
    answers(accountId),
  ])
  const cfg = (biz?.config ?? {}) as any
  const styles = (Array.isArray(cfg.fenceStyles) ? cfg.fenceStyles : []) as any[]
  // A style turned off, or not available for quoting (commercial and industrial on hold), is left out.
  const quotable = (s: any) => s?.isActive !== false && s?.quotable !== false
  const styleQuotable = (name: string) => { const s = styles.find(x => x?.name === name); return !s || quotable(s) }
  const p = cfg.pricing ?? {}
  const pos = (n: unknown) => Number(n) > 0
  const styleRate = (cat: string) => styles.some((s: any) => quotable(s) && s.category === cat && pos(s.subRate))
  const missingRates = [
    !pos(p.subWalkGate) && 'walk gate', !pos(p.subDblGate) && 'double gate',
    !pos(p.subTearOutSection) && 'tear out per section', !pos(p.subTearOutGate) && 'tear out per gate',
    !(pos(p.subRateByCategory?.Chainlink) || styleRate('Chainlink')) && 'chain link',
    !(pos(p.subRateByCategory?.Aluminum) || styleRate('Aluminum')) && 'aluminum',
  ].filter(Boolean) as string[]
  const items = (Array.isArray(inv?.items) ? inv!.items : []) as any[]
  const activeItems = items.filter(i => i?.status !== 'inactive' && i?.status !== 'discontinued')
  const unconfirmed = activeItems.filter(i => !i?.priceUpdatedAt || i?.priceImported).length
  // Inventory > Fill in: $0 prices; gate parts and the Durafence list only for styles available for quoting.
  const kits = (Array.isArray(inv?.kits) ? inv!.kits : []) as any[]
  const filledIn = (style: string) => kits.some(k => k?.styleName === style && !k?.archived && k?.filledInAt)
  const zeroPrices = activeItems.filter(i => !(Number(i?.unitCost) > 0)).length
  const gatesLeft = GATE_STYLES.filter(styleQuotable).filter(s => !filledIn(s))
  const fillLeft = [zeroPrices && `${zeroPrices} prices at $0`, gatesLeft.length && `gate parts for ${gatesLeft.join(', ')}`, styleQuotable(DURAFENCE) && !filledIn(DURAFENCE) && 'a Durafence parts list'].filter(Boolean) as string[]
  const quoteIds = closeJobs.map(j => j.quoteId).filter((x): x is string => !!x)
  // all rows: the status of the quotes of jobs already listed.
  const quoteStatus = new Map((quoteIds.length ? await prisma.savedQuote.findMany({ where: { accountId, id: { in: quoteIds } }, select: { id: true, status: true } }) : []).map(q => [q.id, q.status]))
  const closeOpen = closeJobs.filter(j => CLOSE_OUT.some(rx => rx.test(j.customerName || '')) && !closedOut(j, j.quoteId ? quoteStatus.get(j.quoteId) : null))
  const offSchedule = jobs.length
  const phones = voice.filter(v => /Android|iPhone|iPad/i.test(v.userAgent || ''))
  const xcode = fs.existsSync(xcodePath())
  const robotAt = kv?.value ? Date.parse(String(kv.value)) : NaN
  const statusLabel = (j: { status: string; paymentStatus?: string | null }) => `${j.status.replace(/_/g, ' ')}${j.paymentStatus === 'paid' ? ', paid' : ', not paid'}`

  return [
    { key: 'sub-rates', label: 'Subcontractor rates for gates, tear out, chain link and aluminum', done: missingRates.length === 0,
      detail: missingRates.length ? `Still missing: ${missingRates.join(', ')}.` : 'All set.', link: '/settings?tab=pricing&focus=sub-rates' },
    { key: 'inventory-prices', label: 'Confirm Inventory prices', done: unconfirmed === 0,
      detail: unconfirmed ? `${unconfirmed} of ${activeItems.length} prices not confirmed yet.` : 'Every price confirmed.', link: '/inventory?tab=catalog&price=unconfirmed' },
    { key: 'fill-in', label: 'Fill in Inventory: prices and missing parts', done: fillLeft.length === 0,
      detail: (fillLeft.length ? `Still to fill in: ${fillLeft.join('; ')}.` : 'All filled in.') + (GATE_STYLES.concat(DURAFENCE).some(s => !styleQuotable(s)) ? ' Commercial and industrial parts wait until those styles are available for quoting.' : ''),
      link: '/inventory?tab=fillin' },
    { key: 'close-out', label: 'Close out Diane Pahl, Brenda Madsen and Bill Tieman', done: closeOpen.length === 0,
      detail: closeOpen.length ? closeOpen.map(j => `${j.customerName}: ${statusLabel(j)}`).join('; ') + '. Done when each is Complete and paid, archived, or its quote is Lost.' : 'All closed out.',
      link: closeOpen.length ? `/operations?ids=${closeOpen.map(j => j.id).join(',')}` : '/operations' },
    { key: 'off-schedule', label: `The ${offSchedule} jobs not on the GD Schedule`, done: !!a.offScheduleReviewedAt || offSchedule === 0,
      detail: a.offScheduleReviewedAt ? `Looked at ${String(a.offScheduleReviewedAt).slice(0, 10)}.` : 'Open shows them in Operations. Look them over, then tick this off.',
      link: '/operations?q=not on GD Schedule', answer: [{ label: "I've looked at them", value: 'reviewed' }] },
    { key: 'schedule-contacts', label: 'Customers from the GD Schedule with no phone or email', done: scheduleContacts === 0,
      detail: scheduleContacts ? `${scheduleContacts} customer${scheduleContacts === 1 ? '' : 's'} still ha${scheduleContacts === 1 ? 's' : 've'} neither.` : 'All have a phone or an email.', link: '/customers?filter=missing-contact-schedule' },
    { key: 'google-calendar', label: 'Google Calendar connected to the "Getter Done Fence" calendar', done: cal?.calendarName === 'Getter Done Fence' && !!cal?.activatedAt && !cal?.lastError,
      detail: cal?.calendarName ? `Connected to "${cal.calendarName}"${cal.calendarName === 'Getter Done Fence' ? '' : ' (should be "Getter Done Fence")'}${cal.activatedAt ? '' : '; not turned on yet'}${cal.lastError ? `; last error: ${cal.lastError}` : ''}.` : 'Not connected.', link: '/settings?tab=calendar' },
    { key: 'voice-check', label: 'Voice check on your phones', done: phones.length > 0,
      detail: phones.length ? `${phones.length} phone check${phones.length === 1 ? '' : 's'} done.` : 'Open this on your phone and tap "Run voice check on this device".', link: '/settings?tab=voice&focus=voice-check' },
    { key: 'xcode', label: 'Xcode on the Mac (for the iPhone tests)', done: xcode, detail: xcode ? 'Installed.' : 'Install Xcode from the Mac App Store (free), then tell Claude Code.' },
    { key: 'uptimerobot', label: 'Outside watch (free UptimeRobot)', done: Number.isFinite(robotAt) && Date.now() - robotAt < 2 * DAY,
      detail: Number.isFinite(robotAt) ? `Last check from UptimeRobot ${new Date(robotAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}.` : 'Not watching yet.' },
    { key: 'offsite-backup', label: 'Backups copied to Google Drive', done: !!offsite,
      detail: offsite ? `Last copy ${offsite.completedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}.` : 'Connect Google Drive once (Claude Code walks you through it).' },
  ]
}

router.get('/setup', async (req: any, res) => {
  try {
    res.json({ success: true, data: await setupList(req.user.accountId) })
  } catch (err) {
    console.error('[system] setup error:', err)
    res.status(500).json({ success: false, error: 'Could not load the setup list' })
  }
})

const answerSchema = z.object({ key: z.enum(['off-schedule']), value: z.string().max(20) })

router.post('/setup', async (req: any, res) => {
  try {
    const { key, value } = answerSchema.parse(req.body)
    const accountId = req.user.accountId
    const a = await answers(accountId)
    if (value !== 'reviewed') throw new z.ZodError([])
    if (key === 'off-schedule') a.offScheduleReviewedAt = new Date().toISOString()
    await prisma.accountKeyValue.upsert({
      where: { accountId_key: { accountId, key: SETUP_KEY } },
      create: { accountId, key: SETUP_KEY, value: a, updatedBy: req.user.id },
      update: { value: a, updatedBy: req.user.id, version: { increment: 1 } },
    })
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) || 'Not a valid answer' }); return }
    console.error('[system] setup answer error:', err)
    res.status(500).json({ success: false, error: 'Could not save that' })
  }
})

export default router
