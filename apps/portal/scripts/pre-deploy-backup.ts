/**
 * Pre-deployment backup.
 *
 * Run as the FIRST step of every deploy, BEFORE any prisma db push or service
 * restart. The deploy must abort if this script exits non-zero.
 *
 * Usage in deploy script:
 *   cd /var/www/fencepro/repo
 *   node --import tsx apps/portal/scripts/pre-deploy-backup.ts || exit 1
 */

import 'dotenv/config'
import prisma from '../src/server/lib/prisma.js'
import { dumpDatabase, notifyBackupResult } from './backup-shared.js'

async function main(): Promise<number> {
  const result = await dumpDatabase('pre-deploy')

  try {
    await prisma.backupLog.create({
      data: {
        backupType: 'pre-deploy',
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
    console.warn(`[pre-deploy-backup] WARN: BackupLog write failed: ${(err as Error).message}`)
  }

  await notifyBackupResult('pre-deploy', result).catch(() => {})

  if (!result.success) {
    console.error(`[pre-deploy-backup] FAILED — ${result.error}`)
    console.error('[pre-deploy-backup] DEPLOY MUST ABORT. Resolve the backup issue before continuing.')
    return 1
  }

  console.log(`[pre-deploy-backup] OK — ${result.filePath} (${(result.fileSizeBytes! / 1_048_576).toFixed(2)} MB)`)
  console.log('[pre-deploy-backup] Safe to proceed with deployment.')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[pre-deploy-backup] uncaught error:', err)
    process.exit(1)
  })
