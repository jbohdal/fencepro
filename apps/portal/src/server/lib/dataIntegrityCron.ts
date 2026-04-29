/**
 * In-process cron jobs for data-integrity monitoring.
 *
 * Runs alongside the API server (via setInterval). For multi-instance deploys
 * a proper distributed scheduler should be used, but for the current single-
 * pm2-process deploy this is the simplest correct option that doesn't require
 * provisioning a separate cron service.
 *
 * Jobs:
 *  - DAILY_SNAPSHOT (06:00 UTC):  record today's row counts; alert if any
 *    count drops by more than 5 vs. yesterday.
 *  - BACKUP_STALENESS (07:00 UTC): alert if no successful backup row exists
 *    in the BackupLog table from the last 25 hours.
 */

import prisma from './prisma.js'
import { sendEmail, buildEmailHtml } from './emailService.js'

const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_FROM_EMAIL || ''
const ANOMALY_THRESHOLD = parseInt(process.env.MONITORING_ANOMALY_THRESHOLD || '5', 10)

/** Truncate a Date to midnight UTC. */
function utcMidnight(d: Date = new Date()): Date {
  const r = new Date(d)
  r.setUTCHours(0, 0, 0, 0)
  return r
}

async function gatherCounts(): Promise<{
  customerCount: number
  contactCount: number
  quoteCount: number
  jobCount: number
  invoiceCount: number
  paymentCount: number
  documentCount: number
  portalAccountCount: number
}> {
  // Use Promise.all to limit DB chatter. Each table that doesn't exist returns 0
  // (the catch in each function — important during partial deploys).
  const [
    customerCount,
    contactCount,
    quoteCount,
    jobCount,
    invoiceCount,
    paymentCount,
    documentCount,
    portalAccountCount,
  ] = await Promise.all([
    prisma.customer.count().catch(() => 0),
    prisma.crmContact.count({ where: { archivedAt: null } }).catch(() => 0),
    // Quote table is named differently across the schema — we use a soft fallback.
    Promise.resolve(0), // placeholder until /api/quotes is wired to a real Quote model
    Promise.resolve(0), // placeholder for jobs (today: localStorage on the CRM)
    prisma.invoice.count().catch(() => 0),
    Promise.resolve(0), // placeholder for payments
    prisma.document.count().catch(() => 0),
    prisma.portalAccount.count().catch(() => 0),
  ])
  return { customerCount, contactCount, quoteCount, jobCount, invoiceCount, paymentCount, documentCount, portalAccountCount }
}

export async function recordDailySnapshot(): Promise<{ snapshot: Awaited<ReturnType<typeof gatherCounts>> & { snapshotDate: Date }; alerts: string[] }> {
  const today = utcMidnight()
  const counts = await gatherCounts()

  // Upsert today's snapshot
  const snapshot = await prisma.monitoringSnapshot.upsert({
    where: { snapshotDate: today },
    update: counts,
    create: { snapshotDate: today, ...counts },
  })

  // Compare against yesterday
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const prev = await prisma.monitoringSnapshot.findUnique({ where: { snapshotDate: yesterday } })

  const alerts: string[] = []
  if (prev) {
    const checks: Array<[keyof typeof counts, string]> = [
      ['customerCount', 'Customer'],
      ['contactCount', 'Contact'],
      ['quoteCount', 'Quote'],
      ['jobCount', 'Job'],
      ['invoiceCount', 'Invoice'],
      ['paymentCount', 'Payment'],
      ['documentCount', 'Document'],
      ['portalAccountCount', 'Portal account'],
    ]
    for (const [key, label] of checks) {
      const before = (prev as any)[key] as number
      const after = counts[key]
      if (before - after > ANOMALY_THRESHOLD) {
        alerts.push(`${label} count dropped from ${before} to ${after} (Δ ${after - before})`)
      }
    }
  }

  if (alerts.length > 0 && ADMIN_EMAIL) {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: 'ALERT — Unexpected data decrease detected in EZBiz',
      body: buildEmailHtml(`
        <p><strong>EZBiz daily data-integrity check found unusual decreases:</strong></p>
        <ul>${alerts.map((a) => `<li>${a}</li>`).join('')}</ul>
        <p>Please log in to the Admin → Audit Log to investigate. If this looks wrong, restore from a recent backup before continuing.</p>
        <p>Today's counts:</p>
        <ul>${Object.entries(counts).map(([k, v]) => `<li>${k}: ${v}</li>`).join('')}</ul>
      `),
      disableClickTracking: true,
    }).catch((err) => console.warn('[data-integrity] alert email failed:', (err as Error).message))
  }

  console.log(`[data-integrity] snapshot recorded for ${today.toISOString().slice(0, 10)} — ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  if (alerts.length === 0) console.log('[data-integrity] no anomalies vs. yesterday')

  return { snapshot: { ...counts, snapshotDate: snapshot.snapshotDate }, alerts }
}

export async function checkBackupStaleness(): Promise<void> {
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000)
  const recent = await prisma.backupLog.findFirst({
    where: { status: 'success', backupType: { in: ['daily', 'pre-deploy', 'manual'] }, completedAt: { gte: cutoff } },
    orderBy: { completedAt: 'desc' },
  })
  if (recent) return
  const lastAny = await prisma.backupLog.findFirst({ orderBy: { completedAt: 'desc' } })
  const lastWhen = lastAny ? lastAny.completedAt.toISOString() : 'never'
  console.warn(`[data-integrity] STALE BACKUP — no successful backup in 25h. Last attempt: ${lastWhen}`)
  if (ADMIN_EMAIL) {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: 'ALERT — EZBiz backup is stale (>25h)',
      body: buildEmailHtml(`
        <p>The EZBiz daily backup hasn't successfully run in over 25 hours.</p>
        <p>Last completed: <strong>${lastWhen}</strong></p>
        <p>Run the backup manually on the VPS:</p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;">cd /var/www/fencepro/repo &amp;&amp; node --import tsx apps/portal/scripts/backup-database.ts</pre>
        <p>If the manual run fails, check disk space and pg_dump is installed.</p>
      `),
      disableClickTracking: true,
    }).catch(() => {})
  }
}

/**
 * Schedule the jobs. Called from index.ts at server startup.
 *
 * Uses naive setInterval ticking every 60 seconds and firing each job once
 * per UTC day at the target hour. Idempotent — re-firing the same job in the
 * same UTC day is harmless because both jobs are upserts / read-only.
 */
export function startDataIntegrityCron(): void {
  if (process.env.DISABLE_CRON === '1') {
    console.log('[data-integrity] cron disabled by DISABLE_CRON=1')
    return
  }
  const lastFired = new Map<string, string>() // jobName → 'YYYY-MM-DD@HH'

  function shouldFire(name: string, atHourUTC: number): boolean {
    const now = new Date()
    if (now.getUTCHours() !== atHourUTC) return false
    const key = `${now.toISOString().slice(0, 10)}@${atHourUTC}`
    if (lastFired.get(name) === key) return false
    lastFired.set(name, key)
    return true
  }

  async function tick(): Promise<void> {
    if (shouldFire('snapshot', 6)) {
      try { await recordDailySnapshot() } catch (e) { console.error('[data-integrity] snapshot failed:', (e as Error).message) }
    }
    if (shouldFire('backupStaleness', 7)) {
      try { await checkBackupStaleness() } catch (e) { console.error('[data-integrity] staleness check failed:', (e as Error).message) }
    }
  }

  // Tick once a minute. Each job only runs at its target UTC hour.
  setInterval(() => { tick().catch(() => {}) }, 60_000)
  console.log('[data-integrity] cron started (snapshot 06:00 UTC, backup-staleness 07:00 UTC)')
}
