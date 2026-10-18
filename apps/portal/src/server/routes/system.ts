/**
 * /api/system: owner and admins.
 *   GET  /storage  free space on the Mac (the dashboard warns under 50 GB)
 *   GET  /setup    the Finish setup list: each item checked against the data
 *                  itself, so it ticks off when the thing is really done
 *   POST /setup    Jonathan's answers the data cannot show (Abigail width,
 *                  the jobs not on the GD Schedule looked at)
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { plainZod } from '../lib/plainZod.js'

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

const SETUP_KEY = 'setup'
const CLOSE_OUT = [/pahl/i, /madsen/i, /tieman/i]
const DAY = 86_400_000

async function answers(accountId: string): Promise<Record<string, any>> {
  const r = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: SETUP_KEY } } })
  return (r?.value as Record<string, any>) ?? {}
}

export interface SetupItem { key: string; label: string; done: boolean; detail: string; link?: string; answer?: Array<{ label: string; value: string }> }

router.get('/setup', async (req: any, res) => {
  try {
    const accountId = req.user.accountId
    const [biz, inv, jobs, scheduleContacts, cal, voice, offsite, kv, a] = await Promise.all([
      prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }),
      prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } }),
      prisma.savedJob.findMany({ where: { accountId, archivedAt: null }, select: { customerName: true, status: true, notes: true } }),
      prisma.crmContact.count({ where: { accountId, archivedAt: null, notes: { contains: 'Created from the GD Schedule' }, AND: [{ OR: [{ phone: null }, { phone: '' }] }, { OR: [{ email: null }, { email: '' }] }] } }),
      prisma.calendarSyncState.findUnique({ where: { accountId } }).catch(() => null),
      prisma.voiceCheck.findMany({ where: { accountId }, select: { userAgent: true } }).catch(() => [] as Array<{ userAgent: string | null }>),
      prisma.backupLog.findFirst({ where: { backupType: 'offsite', status: 'success', completedAt: { gte: new Date(Date.now() - 2 * DAY) } }, orderBy: { completedAt: 'desc' } }),
      prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'uptimeRobotSeenAt' } } }),
      answers(accountId),
    ])
    const cfg = (biz?.config ?? {}) as any
    const p = cfg.pricing ?? {}
    const pos = (n: unknown) => Number(n) > 0
    const styleRate = (cat: string) => (cfg.fenceStyles ?? []).some((s: any) => s.category === cat && pos(s.subRate))
    const missingRates = [
      !pos(p.subWalkGate) && 'walk gate', !pos(p.subDblGate) && 'double gate',
      !pos(p.subTearOutSection) && 'tear out per section', !pos(p.subTearOutGate) && 'tear out per gate',
      !(pos(p.subRateByCategory?.Chainlink) || styleRate('Chainlink')) && 'chain link',
      !(pos(p.subRateByCategory?.Aluminum) || styleRate('Aluminum')) && 'aluminum',
    ].filter(Boolean) as string[]
    const items = (Array.isArray(inv?.items) ? inv!.items : []) as any[]
    const unconfirmed = items.filter(i => i?.status !== 'inactive' && i?.status !== 'discontinued' && (!i?.priceUpdatedAt || i?.priceImported)).length
    // Inventory > Fill in: $0 prices, the gate parts of commercial chain link and Industrial Abigail, a Durafence parts list.
    const kits = (Array.isArray(inv?.kits) ? inv!.kits : []) as any[]
    const filledIn = (style: string) => kits.some(k => k?.styleName === style && !k?.archived && k?.filledInAt)
    const zeroPrices = items.filter(i => i?.status !== 'inactive' && i?.status !== 'discontinued' && !(Number(i?.unitCost) > 0)).length
    const gatesLeft = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail'].filter(s => !filledIn(s))
    const fillLeft = [zeroPrices && `${zeroPrices} prices at $0`, gatesLeft.length && `gate parts for ${gatesLeft.join(', ')}`, !filledIn('Durafence') && 'a Durafence parts list'].filter(Boolean) as string[]
    const closeOpen = CLOSE_OUT.map(rx => jobs.filter(j => rx.test(j.customerName || ''))).flat().filter(j => j.status !== 'paid')
    const offSchedule = jobs.filter(j => /Tag: not on GD Schedule/.test(j.notes || '')).length
    const phones = voice.filter(v => /Android|iPhone|iPad/i.test(v.userAgent || ''))
    const xcode = fs.existsSync('/Applications/Xcode.app')
    const robotAt = kv?.value ? Date.parse(String(kv.value)) : NaN

    const list: SetupItem[] = [
      { key: 'sub-rates', label: 'Subcontractor rates for gates, tear out, chain link and aluminum', done: missingRates.length === 0,
        detail: missingRates.length ? `Still missing: ${missingRates.join(', ')}.` : 'All set.', link: '/settings?tab=pricing' },
      { key: 'abigail', label: 'Industrial Abigail: 6 or 8 ft sections?', done: !!a.abigailWidthFt,
        detail: a.abigailWidthFt ? `${a.abigailWidthFt} ft sections${a.abigailWidthFt === 6 ? ' (Claude Code changes the parts list to match)' : ''}.` : 'The price book sheet says 6 ft; the app prices it at 8 ft.',
        link: '/settings?tab=styles', answer: [{ label: '6 ft', value: '6' }, { label: '8 ft', value: '8' }] },
      { key: 'inventory-prices', label: 'Confirm Inventory prices', done: unconfirmed === 0,
        detail: unconfirmed ? `${unconfirmed} of ${items.length} prices not confirmed yet.` : 'Every price confirmed.', link: '/inventory' },
      { key: 'fill-in', label: 'Fill in Inventory: prices and missing parts', done: fillLeft.length === 0,
        detail: fillLeft.length ? `Still to fill in: ${fillLeft.join('; ')}.` : 'All filled in.', link: '/inventory?tab=fillin' },
      { key: 'close-out', label: 'Close out Diane Pahl, Madsen and Tieman', done: closeOpen.length === 0,
        detail: closeOpen.length ? closeOpen.map(j => `${j.customerName}: ${j.status}`).join('; ') + '. Done when each is paid.' : 'All paid.', link: '/operations' },
      { key: 'off-schedule', label: `The ${offSchedule} jobs not on the GD Schedule`, done: !!a.offScheduleReviewedAt || offSchedule === 0,
        detail: a.offScheduleReviewedAt ? `Looked at ${String(a.offScheduleReviewedAt).slice(0, 10)}.` : 'Look them over (search "not on GD Schedule" in Operations), then tick this off.',
        link: '/operations', answer: [{ label: "I've looked at them", value: 'reviewed' }] },
      { key: 'schedule-contacts', label: 'Customers from the GD Schedule with no phone or email', done: scheduleContacts === 0,
        detail: scheduleContacts ? `${scheduleContacts} customers still have neither.` : 'All have a phone or an email.', link: '/customers' },
      { key: 'google-calendar', label: 'Google Calendar connected to the "Getter Done Fence" calendar', done: cal?.calendarName === 'Getter Done Fence' && !!cal?.activatedAt && !cal?.lastError,
        detail: cal?.calendarName ? `Connected to "${cal.calendarName}"${cal.calendarName === 'Getter Done Fence' ? '' : ' (should be "Getter Done Fence")'}${cal.lastError ? `; last error: ${cal.lastError}` : ''}.` : 'Not connected.', link: '/settings?tab=calendar' },
      { key: 'voice-check', label: 'Voice check on your phones', done: phones.length > 0,
        detail: phones.length ? `${phones.length} phone check${phones.length === 1 ? '' : 's'} done.` : 'Run Settings > Voice > Check on each phone.', link: '/settings?tab=voice' },
      { key: 'xcode', label: 'Xcode on the Mac (for the iPhone tests)', done: xcode, detail: xcode ? 'Installed.' : 'Install Xcode from the Mac App Store (free), then tell Claude Code.' },
      { key: 'uptimerobot', label: 'Outside watch (free UptimeRobot)', done: Number.isFinite(robotAt) && Date.now() - robotAt < 2 * DAY,
        detail: Number.isFinite(robotAt) ? `Last check from UptimeRobot ${new Date(robotAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}.` : 'Not watching yet.' },
      { key: 'offsite-backup', label: 'Backups copied to Google Drive', done: !!offsite,
        detail: offsite ? `Last copy ${offsite.completedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}.` : 'Connect Google Drive once (Claude Code walks you through it).' },
    ]
    res.json({ success: true, data: list })
  } catch (err) {
    console.error('[system] setup error:', err)
    res.status(500).json({ success: false, error: 'Could not load the setup list' })
  }
})

const answerSchema = z.object({ key: z.enum(['abigail', 'off-schedule']), value: z.string().max(20) })

router.post('/setup', async (req: any, res) => {
  try {
    const { key, value } = answerSchema.parse(req.body)
    const accountId = req.user.accountId
    const a = await answers(accountId)
    if (key === 'abigail') { if (!['6', '8'].includes(value)) throw new z.ZodError([]); a.abigailWidthFt = Number(value) }
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
