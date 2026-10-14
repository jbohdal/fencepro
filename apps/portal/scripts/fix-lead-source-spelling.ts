/**
 * Put right the lead source spelling "refferal" -> "Referral" wherever a
 * record carries its own copy: customers, quotes, jobs and pipeline cards.
 *
 *   npx tsx scripts/fix-lead-source-spelling.ts            counts only, writes nothing
 *   npx tsx scripts/fix-lead-source-spelling.ts --apply    writes to the database in DATABASE_URL
 *   ... --apply --live                                     required as well for the live database
 *
 * Safe to run twice: the second run finds nothing left to change.
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'

const FROM = 'refferal', TO = 'Referral'
const APPLY = process.argv.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG = path.join(os.homedir(), 'Library/Logs/ezbiz', `lead-source-spelling-${dbName}-${APPLY ? 'apply' : 'plan'}-${stamp}.log`)
fs.mkdirSync(path.dirname(LOG), { recursive: true })
const log = (line: string, echo = true) => { fs.appendFileSync(LOG, line + '\n'); if (echo) console.log(line) }

async function main() {
  const prisma = new PrismaClient()
  log(`Lead source spelling "${FROM}" -> "${TO}", ${APPLY ? 'APPLY' : 'plan only'}, database "${dbName}", ${new Date().toString()}`)
  log(`Log ${LOG}\n`)
  const where = { leadSource: FROM }
  const customers = await prisma.crmContact.findMany({ where, select: { id: true } })
  const quotes = await prisma.savedQuote.findMany({ where, select: { id: true } })
  const jobs = await prisma.savedJob.findMany({ where, select: { id: true } })
  const states = await prisma.pipelineState.findMany()
  const cards = states.flatMap(s => ((s.leads as any[]) || []).filter(l => l?.leadSource === FROM).map(l => l.id))
  log(`  customers ${customers.length}, quotes ${quotes.length}, jobs ${jobs.length}, pipeline cards ${cards.length}`)
  log('customers ' + customers.map(c => c.id).join(' '), false)
  log('quotes ' + quotes.map(c => c.id).join(' '), false)
  log('jobs ' + jobs.map(c => c.id).join(' '), false)
  log('cards ' + cards.join(' '), false)
  if (!APPLY) { log('\nNothing was written.'); await prisma.$disconnect(); return }

  log('\nWRITING')
  log(`  customers: ${(await prisma.crmContact.updateMany({ where, data: { leadSource: TO } })).count}`)
  log(`  quotes: ${(await prisma.savedQuote.updateMany({ where, data: { leadSource: TO } })).count}`)
  log(`  jobs: ${(await prisma.savedJob.updateMany({ where, data: { leadSource: TO } })).count}`)
  // The pipeline is one record with a version: change the newest copy and
  // save only if nobody else saved in between; otherwise try again.
  let fixed = 0
  for (const s of states) {
    for (let attempt = 1; ; attempt++) {
      const now = (await prisma.pipelineState.findUnique({ where: { id: s.id } }))!
      const leads = (now.leads as any[]) || []
      const n = leads.filter(l => l?.leadSource === FROM).length
      if (!n) break
      const next = leads.map(l => l?.leadSource === FROM ? { ...l, leadSource: TO } : l)
      const done = await prisma.pipelineState.updateMany({ where: { id: s.id, version: now.version }, data: { leads: next, version: { increment: 1 } } })
      if (done.count === 1) { fixed += n; break }
      if (attempt >= 5) throw new Error('The pipeline kept changing while saving. Run this again.')
    }
  }
  log(`  pipeline cards: ${fixed}`)
  log('\nDone. Reload any open EZ Biz tabs.')
  await prisma.$disconnect()
}

main().catch(err => { log('FAILED: ' + (err?.stack || err)); process.exit(1) })
