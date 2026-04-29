/**
 * Migration safety check.
 *
 * Scans pending Prisma migrations (or, in this project's case, the diff between
 * the current schema in code and the production DB) for destructive
 * operations: DROP TABLE, DROP COLUMN, DROP DEFAULT, ALTER COLUMN ... DROP NOT
 * NULL, etc. If any are found, the script exits non-zero unless
 * ALLOW_DESTRUCTIVE_MIGRATION=1 is explicitly set.
 *
 * Usage in deploy:
 *   node --import tsx apps/portal/scripts/migration-safety-check.ts || exit 1
 */

import 'dotenv/config'
import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

const DESTRUCTIVE_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /DROP\s+TABLE/i, label: 'DROP TABLE' },
  { regex: /DROP\s+COLUMN/i, label: 'DROP COLUMN' },
  { regex: /ALTER\s+TABLE\s+\S+\s+DROP\s+/i, label: 'ALTER TABLE … DROP' },
  { regex: /TRUNCATE/i, label: 'TRUNCATE' },
  { regex: /DELETE\s+FROM/i, label: 'DELETE FROM' },
  { regex: /ALTER\s+COLUMN\s+\S+\s+DROP\s+DEFAULT/i, label: 'DROP DEFAULT' },
  { regex: /ALTER\s+COLUMN\s+\S+\s+TYPE\s+/i, label: 'ALTER COLUMN TYPE (data may truncate)' },
]

async function main(): Promise<number> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[migration-check] DATABASE_URL is not set')
    return 2
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ezbiz-migrate-check-'))
  const sqlPath = path.join(tmpDir, 'migration.sql')

  console.log('[migration-check] computing schema diff (code → DB)…')
  try {
    execFileSync('npx', [
      'prisma',
      'migrate',
      'diff',
      '--from-url', dbUrl,
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--script',
    ], { stdio: ['ignore', require('fs').openSync(sqlPath, 'w'), 'inherit'], cwd: process.cwd().endsWith('portal') ? process.cwd() : path.join(process.cwd(), 'apps/portal') })
  } catch (err) {
    console.error('[migration-check] could not compute diff:', (err as Error).message)
    return 1
  }

  const sql = await fs.readFile(sqlPath, 'utf8')
  if (!sql.trim()) {
    console.log('[migration-check] No schema changes pending. ✅')
    return 0
  }

  const findings: string[] = []
  for (const { regex, label } of DESTRUCTIVE_PATTERNS) {
    if (regex.test(sql)) findings.push(label)
  }

  if (findings.length === 0) {
    console.log('[migration-check] Schema diff is purely additive. ✅')
    console.log('[migration-check] First 20 lines of the planned diff:')
    console.log(sql.split('\n').slice(0, 20).map((l) => '  ' + l).join('\n'))
    return 0
  }

  console.error('[migration-check] ❌ DESTRUCTIVE OPERATIONS DETECTED:')
  for (const f of findings) console.error('  • ' + f)
  console.error('')
  console.error('[migration-check] Refusing to proceed automatically. To allow:')
  console.error('  1. Run pre-deploy-backup.ts and confirm the backup file exists')
  console.error('  2. Re-run with: ALLOW_DESTRUCTIVE_MIGRATION=1 node --import tsx apps/portal/scripts/migration-safety-check.ts')
  console.error('  3. Review the planned SQL at:', sqlPath)

  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION === '1') {
    console.warn('[migration-check] ALLOW_DESTRUCTIVE_MIGRATION=1 — proceeding despite destructive ops.')
    return 0
  }
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[migration-check] uncaught error:', err)
    process.exit(1)
  })
