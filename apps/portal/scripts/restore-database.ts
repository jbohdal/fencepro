/**
 * Database restoration script.
 *
 * Usage:
 *   node --import tsx apps/portal/scripts/restore-database.ts <backup-file>
 *
 * The backup file may be:
 *   - a local path to a .sql.gz or .sql file
 *   - an s3:// URL (downloads via aws CLI)
 *
 * The script ALWAYS prompts for "CONFIRM" before overwriting the current
 * database. Restoration is irreversible without another backup.
 *
 * After restoring, the script prints row counts of key tables so the operator
 * can sanity-check that the data is reasonable.
 */

import 'dotenv/config'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import readline from 'readline'
import prisma from '../src/server/lib/prisma.js'
import { gunzipFile, applySqlFile, quickCounts } from './backup-shared.js'

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans) }))
}

async function downloadFromS3(s3Url: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ezbiz-restore-'))
  const localPath = path.join(tmp, path.basename(s3Url))
  const args = ['s3', 'cp', s3Url, localPath]
  if (process.env.AWS_S3_BACKUP_ENDPOINT) {
    args.push('--endpoint-url', process.env.AWS_S3_BACKUP_ENDPOINT)
  }
  const region = process.env.AWS_BACKUP_REGION || process.env.AWS_REGION
  if (region) args.push('--region', region)
  console.log(`[restore] downloading ${s3Url} → ${localPath}`)
  execFileSync('aws', args, { stdio: 'inherit' })
  return localPath
}

async function main(): Promise<number> {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: restore-database.ts <backup-file-or-s3-url>')
    return 2
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is not set in env. Aborting.')
    return 2
  }

  // Resolve the backup file
  let localBackupPath: string
  if (arg.startsWith('s3://')) {
    localBackupPath = await downloadFromS3(arg)
  } else {
    const stat = await fs.stat(arg).catch(() => null)
    if (!stat) {
      console.error(`Backup file not found: ${arg}`)
      return 2
    }
    localBackupPath = path.resolve(arg)
  }

  console.log(`[restore] Source: ${localBackupPath}`)
  console.log(`[restore] Target DB host: ${(() => { try { return new URL(dbUrl).host } catch { return '<unparseable>' } })()}`)

  // Show pre-restore counts so the operator can compare
  console.log('[restore] Current row counts (before restore):')
  const beforeCounts = await quickCounts(dbUrl)
  for (const [table, count] of Object.entries(beforeCounts)) {
    console.log(`  ${table}: ${count}`)
  }

  console.log('')
  console.log('⚠️  WARNING — this will overwrite the current database with the contents of the backup.')
  console.log('   Existing data added since the backup was taken will be LOST.')
  console.log('   Type "CONFIRM" (uppercase) to proceed; anything else aborts.')
  const ans = (await prompt('Confirmation: ')).trim()
  if (ans !== 'CONFIRM') {
    console.log('[restore] Aborted by operator.')
    return 0
  }

  // Decompress if needed
  let sqlPath = localBackupPath
  if (localBackupPath.endsWith('.gz')) {
    console.log('[restore] decompressing…')
    sqlPath = await gunzipFile(localBackupPath)
  }

  console.log('[restore] applying dump (this can take a while)…')
  const startedAt = new Date()
  try {
    await applySqlFile(sqlPath, dbUrl)
  } catch (err) {
    console.error('[restore] FAILED:', (err as Error).message)
    return 1
  }
  const completedAt = new Date()
  const durationS = (completedAt.getTime() - startedAt.getTime()) / 1000
  console.log(`[restore] dump applied in ${durationS.toFixed(1)}s`)

  console.log('[restore] Post-restore row counts:')
  const afterCounts = await quickCounts(dbUrl)
  for (const [table, count] of Object.entries(afterCounts)) {
    const diff = count - (beforeCounts[table] || 0)
    const sign = diff > 0 ? '+' : ''
    console.log(`  ${table}: ${count}  (${sign}${diff} vs. before)`)
  }

  // Best-effort log of the event
  try {
    await prisma.backupLog.create({
      data: {
        backupType: 'restore',
        filePath: localBackupPath,
        fileSizeBytes: BigInt((await fs.stat(localBackupPath)).size),
        status: 'success',
        startedAt,
        completedAt,
        errorMessage: null,
      },
    })
  } catch { /* ignore */ }

  console.log('')
  console.log('[restore] DONE. Verify the row counts above look reasonable. If anything is wrong, restore from a different backup before any users hit the system.')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[restore] uncaught error:', err)
    process.exit(1)
  })
