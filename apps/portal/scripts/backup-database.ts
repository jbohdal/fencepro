/**
 * Daily database backup script.
 *
 * Run via cron at 02:00 UTC every day:
 *   0 2 * * *  cd /var/www/fencepro/repo && /usr/bin/env node --import tsx apps/portal/scripts/backup-database.ts >> /var/log/ezbiz-backup.log 2>&1
 *
 * Or invoke from the API process via apps/portal/src/server/lib/backupCron.ts (added in Phase 5).
 *
 * This script:
 *   1. Runs pg_dump → gzip → /var/backups/ezbiz/backup_YYYY-MM-DD_HH-MM-SS.sql.gz
 *   2. Optionally uploads to S3/Spaces if AWS_S3_BACKUP_BUCKET is configured
 *   3. Records the result in the BackupLog table
 *   4. Sends an email summary to ADMIN_ALERT_EMAIL
 *   5. Prunes local backups older than BACKUP_RETENTION_DAYS (default 30)
 */

import 'dotenv/config'
import prisma from '../src/server/lib/prisma.js'
import { dumpDatabase, pruneOldLocalBackups, notifyBackupResult, BACKUP_RETENTION_DAYS } from './backup-shared.js'

async function main(): Promise<number> {
  const result = await dumpDatabase('backup')

  // Persist the result to the BackupLog table (best-effort).
  try {
    await prisma.backupLog.create({
      data: {
        backupType: 'daily',
        filePath: result.filePath || '',
        fileSizeBytes: result.fileSizeBytes ? BigInt(result.fileSizeBytes) : BigInt(0),
        status: result.success ? 'success' : 'failed',
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        errorMessage: result.error,
        remoteUrl: result.remoteUrl,
      },
    })
  } catch (err) {
    console.warn(`[backup] WARN: could not write BackupLog row (${(err as Error).message}). Backup itself ${result.success ? 'succeeded' : 'failed'}.`)
  }

  // Notify
  await notifyBackupResult('daily', result).catch((err) => {
    console.warn(`[backup] WARN: notification email failed: ${(err as Error).message}`)
  })

  if (result.success) {
    const pruned = await pruneOldLocalBackups('backup_')
    console.log(`[backup] OK — local file ${result.filePath}, ${pruned} old backups pruned (retention ${BACKUP_RETENTION_DAYS}d).`)
    return 0
  }
  console.error(`[backup] FAILED — ${result.error}`)
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[backup] uncaught error:', err)
    process.exit(1)
  })
