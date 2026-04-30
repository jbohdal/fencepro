/**
 * Shared helpers for backup-database.ts, pre-deploy-backup.ts, and restore-database.ts.
 *
 * Design notes:
 * - All backups are written to a LOCAL directory first (BACKUP_LOCAL_DIR) so the
 *   pg_dump succeeds even if S3 / DigitalOcean Spaces is unavailable. Local-only
 *   protection is better than no protection.
 * - If S3-style credentials are present (AWS_S3_BACKUP_BUCKET + AWS keys), the
 *   compressed dump is also uploaded for off-site safety.
 * - Sensitive values (DATABASE_URL, AWS keys) are NEVER printed. Only file size,
 *   timestamps, and table-row counts are logged.
 * - The script assumes `pg_dump`, `gzip`, and `psql` are available on the host
 *   (they ship with `postgresql-client` on Ubuntu).
 */

import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import zlib from 'zlib'
import { pipeline } from 'stream/promises'
import { createReadStream, createWriteStream } from 'fs'
import { sendEmail, buildEmailHtml } from '../src/server/lib/emailService.js'

const execFileP = promisify(execFile)

export const BACKUP_LOCAL_DIR =
  process.env.BACKUP_LOCAL_DIR || '/var/backups/ezbiz'

export const BACKUP_RETENTION_DAYS = parseInt(
  process.env.BACKUP_RETENTION_DAYS || '30',
  10,
)

export interface BackupResult {
  success: boolean
  filePath?: string
  fileSizeBytes?: number
  startedAt: Date
  completedAt: Date
  remoteUrl?: string
  error?: string
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.host
    return `postgresql://***:***@${host}/${u.pathname.replace(/^\//, '')}`
  } catch {
    return '<unparseable DATABASE_URL>'
  }
}

export function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
}

export async function dumpDatabase(
  filePrefix: string,
  options: { quiet?: boolean } = {},
): Promise<BackupResult> {
  const startedAt = new Date()
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return {
      success: false,
      startedAt,
      completedAt: new Date(),
      error: 'DATABASE_URL is not set',
    }
  }

  if (!options.quiet) {
    console.log(`[backup] starting ${filePrefix} against ${maskUrl(dbUrl)}`)
  }

  await ensureDir(BACKUP_LOCAL_DIR)
  const baseName = `${filePrefix}_${timestamp()}.sql.gz`
  const filePath = path.join(BACKUP_LOCAL_DIR, baseName)

  // pg_dump → gzip → file. We use --format=plain so the dump is human-readable
  // and can be inspected / restored with `psql -f` from any machine.
  // --no-owner / --no-privileges avoid restoring ownership grants from prod.
  const args = [
    '--format=plain',
    // --clean + --if-exists make the dump cleanly RESTORABLE on top of an
    // existing database. Without these, restoring against a non-empty DB
    // errors on the first CREATE TYPE / CREATE TABLE because the object
    // already exists. With them, each object is DROPped first (and the DROP
    // is suppressed if the target doesn't exist yet, so it also works on a
    // fresh empty DB).
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--no-acl',
    '--quote-all-identifiers',
    dbUrl,
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile('pg_dump', args, { maxBuffer: 1024 * 1024 * 1024 })
      const gzip = zlib.createGzip({ level: 6 })
      const out = createWriteStream(filePath, { mode: 0o600 })
      child.stdout!.pipe(gzip).pipe(out)
      child.stderr?.on('data', (chunk) => {
        // pg_dump uses stderr for status; only echo non-empty
        const s = chunk.toString().trim()
        if (s && !options.quiet) console.error(`[pg_dump] ${s}`)
      })
      out.on('finish', () => resolve())
      out.on('error', reject)
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code !== 0) reject(new Error(`pg_dump exited with code ${code}`))
      })
    })
  } catch (err) {
    return {
      success: false,
      startedAt,
      completedAt: new Date(),
      error: (err as Error).message,
    }
  }

  const stat = await fs.stat(filePath)
  const fileSizeBytes = stat.size

  // Optional: upload to S3 / Spaces. Implementation kept dependency-free using
  // the AWS CLI if available. If `aws` is not installed, skip silently.
  let remoteUrl: string | undefined
  const bucket = process.env.AWS_S3_BACKUP_BUCKET
  const region = process.env.AWS_BACKUP_REGION || process.env.AWS_REGION
  const endpoint = process.env.AWS_S3_BACKUP_ENDPOINT // for DO Spaces / R2 compat
  if (bucket && region && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    try {
      const subPath = filePrefix.startsWith('pre-deploy') ? 'pre-deploy-backups' : 'database-backups'
      const remoteKey = `${subPath}/${baseName}`
      const cmd = ['s3', 'cp', filePath, `s3://${bucket}/${remoteKey}`, '--region', region, '--sse', 'AES256']
      if (endpoint) cmd.push('--endpoint-url', endpoint)
      execFileSync('aws', cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
      remoteUrl = `s3://${bucket}/${remoteKey}`
      if (!options.quiet) console.log(`[backup] uploaded to ${remoteUrl}`)
    } catch (err) {
      // Don't fail the whole backup just because S3 upload missed — the local
      // file is still valid. Just record the failure.
      if (!options.quiet) {
        console.warn(`[backup] WARN: S3 upload failed (${(err as Error).message.split('\n')[0]}). Local backup retained at ${filePath}.`)
      }
    }
  } else if (!options.quiet) {
    console.log('[backup] AWS S3 / Spaces upload skipped (AWS_S3_BACKUP_BUCKET not configured) — backup is local-only.')
  }

  return {
    success: true,
    filePath,
    fileSizeBytes,
    startedAt,
    completedAt: new Date(),
    remoteUrl,
  }
}

/** Delete local backup files older than BACKUP_RETENTION_DAYS, by prefix. */
export async function pruneOldLocalBackups(prefix: string): Promise<number> {
  let pruned = 0
  let entries: string[] = []
  try {
    entries = await fs.readdir(BACKUP_LOCAL_DIR)
  } catch {
    return 0
  }
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 86_400_000
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue
    const p = path.join(BACKUP_LOCAL_DIR, entry)
    try {
      const stat = await fs.stat(p)
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(p)
        pruned++
      }
    } catch { /* ignore */ }
  }
  return pruned
}

const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_FROM_EMAIL || ''

export async function notifyBackupResult(label: string, result: BackupResult): Promise<void> {
  if (!ADMIN_EMAIL) return
  const sizeMb = result.fileSizeBytes ? (result.fileSizeBytes / 1_048_576).toFixed(2) : 'n/a'
  const durationMs = result.completedAt.getTime() - result.startedAt.getTime()
  if (result.success) {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `EZBiz ${label} backup: ${sizeMb} MB`,
      body: buildEmailHtml(`
        <p><strong>EZBiz ${label} backup completed.</strong></p>
        <ul>
          <li>File: ${result.filePath}</li>
          ${result.remoteUrl ? `<li>Remote: ${result.remoteUrl}</li>` : ''}
          <li>Size: ${sizeMb} MB</li>
          <li>Duration: ${(durationMs / 1000).toFixed(1)}s</li>
          <li>Started: ${result.startedAt.toISOString()}</li>
          <li>Completed: ${result.completedAt.toISOString()}</li>
        </ul>
      `),
      disableClickTracking: true,
    })
  } else {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `ALERT — EZBiz ${label} backup FAILED on ${result.startedAt.toISOString().slice(0, 10)}`,
      body: buildEmailHtml(`
        <p><strong>The EZBiz ${label} backup failed.</strong></p>
        <p>Error: <code>${result.error || 'unknown'}</code></p>
        <p>This is your second-line backup. DigitalOcean's daily managed-DB backup is still your first line of defense, but please investigate this script's failure as soon as possible.</p>
        <p>Started: ${result.startedAt.toISOString()}<br>Failed at: ${result.completedAt.toISOString()}</p>
      `),
      disableClickTracking: true,
    })
  }
}

/** Decompress a .sql.gz file to a .sql file in the same directory. Returns the new path. */
export async function gunzipFile(gzPath: string): Promise<string> {
  const sqlPath = gzPath.replace(/\.gz$/, '')
  await pipeline(
    createReadStream(gzPath),
    zlib.createGunzip(),
    createWriteStream(sqlPath, { mode: 0o600 }),
  )
  return sqlPath
}

/** Run `psql --file <path> $DATABASE_URL`. */
export async function applySqlFile(sqlPath: string, dbUrlOverride?: string): Promise<void> {
  const dbUrl = dbUrlOverride || process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is not set')
  await execFileP('psql', ['--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file', sqlPath, dbUrl])
}

/** Quick sanity check: row counts of the most-important tables. */
export async function quickCounts(dbUrlOverride?: string): Promise<Record<string, number>> {
  const dbUrl = dbUrlOverride || process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is not set')
  const tables = ['CrmContact', 'CrmUser', 'PortalAccount', 'Invoice', 'VendorContact']
  const results: Record<string, number> = {}
  for (const t of tables) {
    try {
      const { stdout } = await execFileP('psql', [
        dbUrl,
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT COUNT(*) FROM "${t}"`,
      ])
      results[t] = parseInt(stdout.trim(), 10) || 0
    } catch {
      results[t] = -1 // table missing or query failed
    }
  }
  return results
}

export const __privateForTests = { maskUrl }
