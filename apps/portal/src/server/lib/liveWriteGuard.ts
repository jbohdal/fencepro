/**
 * A script that changes data refuses to run against the live database unless
 * the person running it said so on purpose AND a fresh backup exists.
 *
 *   EZBIZ_LIVE_WRITE_OK=1 node --import tsx apps/portal/scripts/<script>.ts
 *
 * and a database backup (~/ezbiz-backups/ezbiz-db_*.dump, made by
 * `bash ~/ezbiz/deploy/mac/backup.sh`) from the last 30 minutes.
 *
 * "Live" is the database named `ezbiz`, or any database when NODE_ENV is
 * production. The practice database (ezbiz_dev) is not affected. Read only
 * scripts (feedback report, invoice dry run) do not call this. The server's
 * own jobs (backups, duplicate check, start up steps) do not run through
 * scripts and are not affected either.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import dotenv from 'dotenv'
import { LIVE_DATABASE_NAME, databaseNameOf } from './liveGuard.js'

export const LIVE_WRITE_FLAG = 'EZBIZ_LIVE_WRITE_OK'
export const BACKUP_MAX_AGE_MS = 30 * 60 * 1000

export interface LiveWriteCheck {
  databaseUrl: string | undefined
  env: NodeJS.ProcessEnv
  backupDir: string
  now: number
}

/** True when the URL names the live database (or this is production). */
export function isLiveTarget(databaseUrl: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || databaseNameOf(databaseUrl) === LIVE_DATABASE_NAME
}

/** The newest database backup in `dir` and its age, or null when there is none. */
export function newestBackup(dir: string, now: number = Date.now()): { file: string; ageMs: number } | null {
  let best: { file: string; mtime: number } | null = null
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { return null }
  for (const name of names) {
    if (!/^ezbiz-db_.*\.dump$/.test(name)) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      if (!st.isFile() || st.size === 0) continue
      if (!best || st.mtimeMs > best.mtime) best = { file: path.join(dir, name), mtime: st.mtimeMs }
    } catch { /* skip */ }
  }
  return best ? { file: best.file, ageMs: now - best.mtime } : null
}

/** Why this script may not write, or null when it may. */
export function liveWriteRefusal(script: string, c: LiveWriteCheck): string | null {
  if (!isLiveTarget(c.databaseUrl, c.env)) return null
  if (c.env[LIVE_WRITE_FLAG] !== '1') {
    return `${script} changes data and DATABASE_URL names the live database. It did not run. ` +
      `To run it on live on purpose: take a backup (bash ~/ezbiz/deploy/mac/backup.sh), then run it again with ${LIVE_WRITE_FLAG}=1.`
  }
  const b = newestBackup(c.backupDir, c.now)
  if (!b) return `${script}: no database backup found in ${c.backupDir}. Run bash ~/ezbiz/deploy/mac/backup.sh first. It did not run.`
  if (b.ageMs > BACKUP_MAX_AGE_MS) {
    return `${script}: the newest backup (${path.basename(b.file)}) is ${Math.round(b.ageMs / 60000)} minutes old; it must be under 30. ` +
      'Run bash ~/ezbiz/deploy/mac/backup.sh first. It did not run.'
  }
  return null
}

/** Call first thing in a script that writes. Exits with code 2 when refused. */
export function assertLiveWriteAllowed(script: string): void {
  // Prisma reads .env on its own; read it here too, so the check sees the same database.
  if (!process.env.DATABASE_URL) dotenv.config()
  if (!process.env.DATABASE_URL) { console.error(`[live-write-guard] ${script}: DATABASE_URL is not set, so it is not clear which database this would change. It did not run.`); process.exit(2) }
  const refusal = liveWriteRefusal(script, {
    databaseUrl: process.env.DATABASE_URL,
    env: process.env,
    backupDir: process.env.EZBIZ_BACKUP_DIR || path.join(os.homedir(), 'ezbiz-backups'),
    now: Date.now(),
  })
  if (refusal) { console.error(`[live-write-guard] ${refusal}`); process.exit(2) }
  if (isLiveTarget(process.env.DATABASE_URL)) console.warn(`[live-write-guard] ${script}: writing to LIVE (${LIVE_WRITE_FLAG}=1, fresh backup found).`)
}
