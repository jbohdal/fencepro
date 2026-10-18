/**
 * Print what people sent with "Send feedback" in the app, newest first, with
 * the path of each screenshot file (open it to see the screen). Read only:
 * everything is read inside a read-only transaction, and nothing is changed.
 *
 *   cd ~/ezbiz/apps/portal && npx tsx scripts/feedback-report.ts
 *   ... --status new          only New (or seen, done)
 *   ... --limit 20            at most 20 (default 50)
 *   ... --days 7              only the last 7 days
 *   ... --json                one JSON object per line instead of text
 *
 * Uses DATABASE_URL from the .env of the folder it is run from, so run from
 * ~/ezbiz for live (from the working folder it reads the dev copy). Prints no
 * settings or secrets.
 */

import 'dotenv/config'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { liveDatabaseMisuse } from '../src/server/lib/liveGuard.js'

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const status = arg('--status')
const limit = Math.max(1, Math.min(1000, parseInt(arg('--limit') || '50', 10) || 50))
const days = parseInt(arg('--days') || '', 10)
const asJson = process.argv.includes('--json')

if (status && !['new', 'seen', 'done'].includes(status)) { console.error('--status is new, seen or done'); process.exit(2) }
const dbUrl = process.env.DATABASE_URL || ''
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '?' } })()

const when = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

async function main() {
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return tx.feedback.findMany({
        where: { ...(status ? { status } : {}), ...(Number.isFinite(days) && days > 0 ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}) },
        orderBy: { createdAt: 'desc' }, take: limit,
      })
    })
    if (asJson) {
      for (const f of rows) console.log(JSON.stringify({ ...f, screenshotExists: !!f.screenshotPath && fs.existsSync(f.screenshotPath) }))
      return
    }
    console.log(`Feedback in database "${dbName}": ${rows.length}${status ? ` (${status})` : ''}, newest first\n`)
    for (const f of rows) {
      const shot = f.screenshotPath ? `${f.screenshotPath}${fs.existsSync(f.screenshotPath) ? '' : '  (file missing)'}` : '(none)'
      const errs = Array.isArray(f.errors) ? (f.errors as Array<{ at?: string; message?: string }>) : []
      console.log(`── ${when(f.createdAt)}  [${f.status.toUpperCase()}]  ${f.userName || f.userId} (${f.role})`)
      console.log(`   id:         ${f.id}`)
      console.log(`   page:       ${f.path || '-'}`)
      console.log(`   screen:     ${f.screen || '-'}`)
      console.log(`   device:     ${f.userAgent || '-'}`)
      console.log(`   app file:   ${f.appFile || '-'}`)
      console.log(`   screenshot: ${shot}`)
      if (f.statusBy) console.log(`   marked ${f.status} by ${f.statusBy}${f.statusAt ? ` on ${when(f.statusAt)}` : ''}`)
      for (const e of errs) console.log(`   app error:  ${e.at ?? ''} ${e.message ?? ''}`)
      console.log(`   text:\n${(f.text || '(no text)').split('\n').map(l => '     ' + l).join('\n')}\n`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error('Could not read feedback:', (err as Error).message); process.exit(1) })
