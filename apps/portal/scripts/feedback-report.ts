/**
 * Print what people sent with "Send feedback" in the app, newest first, with
 * a link to each screenshot file (open it to see the screen). Read only:
 * everything is read inside a read-only transaction, and nothing is changed.
 * This is the daily feedback review (deploy/mac/nightly-check.sh runs it).
 *
 *   cd ~/ezbiz/apps/portal && npx tsx scripts/feedback-report.ts
 *   ... --status new          only New (or seen = Looked at, done = Fixed, needs_jonathan)
 *   ... --since 2026-10-26    only what was sent from that day on (Ocala time; a full time works too)
 *   ... --days 7              only the last 7 days
 *   ... --limit 20            at most 20 (default 50)
 *   ... --copy-shots <folder> copy each screenshot there (<id>.jpg) and link the copy
 *   ... --json                one JSON object per line instead of text
 *
 * Uses DATABASE_URL from the .env of the folder it is run from, so run from
 * ~/ezbiz for live (from the working folder it reads the dev copy). Prints no
 * settings or secrets.
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { liveDatabaseMisuse } from '../src/server/lib/liveGuard.js'
import { parseReportArgs, sinceMoment, entryText, entryJson, statusWords, type ReportArgs, type ReportRow } from '../src/server/lib/feedbackReport.js'

let args: ReportArgs
try { args = parseReportArgs(process.argv.slice(2)) } catch (err) { console.error((err as Error).message); process.exit(2) }
const dbUrl = process.env.DATABASE_URL || ''
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '?' } })()

/** The screenshot to point to: a copy in --copy-shots, or the file itself. */
function shotFor(f: ReportRow): { file: string | null; exists: boolean } {
  if (!f.screenshotPath) return { file: null, exists: false }
  const exists = fs.existsSync(f.screenshotPath)
  if (!exists || !args.copyShots) return { file: f.screenshotPath, exists }
  fs.mkdirSync(args.copyShots, { recursive: true })
  const copy = path.resolve(args.copyShots, `${f.id.replace(/[^A-Za-z0-9_-]/g, '_')}.jpg`)
  fs.copyFileSync(f.screenshotPath, copy)
  return { file: copy, exists: true }
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const since = sinceMoment(args)
    const rows = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return tx.feedback.findMany({
        where: { ...(args.status ? { status: args.status } : {}), ...(since ? { createdAt: { gte: since } } : {}) },
        orderBy: { createdAt: 'desc' }, take: args.limit,
      })
    })
    if (args.json) {
      for (const f of rows) console.log(entryJson(f, shotFor(f)))
      return
    }
    const what = [args.status ? statusWords(args.status) : '', since ? `since ${since.toLocaleString('en-US', { timeZone: 'America/New_York' })}` : ''].filter(Boolean).join(', ')
    console.log(`Feedback in database "${dbName}": ${rows.length}${what ? ` (${what})` : ''}, newest first\n`)
    for (const f of rows) console.log(entryText(f, shotFor(f)))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error('Could not read feedback:', (err as Error).message); process.exit(1) })
