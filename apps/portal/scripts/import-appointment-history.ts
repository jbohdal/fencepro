/**
 * Bring the sales and installation appointments from Contractor Accelerator
 * in as appointments on the matching customers.
 *
 *   npx tsx scripts/import-appointment-history.ts \
 *     --file ~/Downloads/projects_20261008_085532.csv \
 *     --projects-log ~/Library/Logs/ezbiz/project-import_2026-10-08_2127.csv
 *       prints the plan and writes nothing
 *   ... --apply            writes to the database in DATABASE_URL
 *   ... --apply --live     required as well when that is the live database
 *
 * Each project's first and last sales appointment becomes an Estimate, its
 * installation appointment an Install, matched to the customer the project
 * import put the project on. Past ones come in Completed, outcome "Imported
 * from Contractor Accelerator", and never go to Google Calendar. One still to
 * come comes in Scheduled, as an ordinary appointment, so it does.
 *
 * Times in the file are Florida wall clock times. Safe to run twice: each
 * appointment's key is its project and which appointment it was.
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { floridaTime } from '../src/server/lib/appointments.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const BATCH = 200
const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const expand = (p = '') => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)
const FILE = expand(opt('file')), PROJECTS_LOG = expand(opt('projects-log'))
const APPLY = flag('apply')
// --apply on the live database also needs EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes (lib/liveWriteGuard.ts).
if (APPLY) assertLiveWriteAllowed('import-appointment-history.ts')
if (!FILE || !fs.existsSync(FILE) || !PROJECTS_LOG || !fs.existsSync(PROJECTS_LOG)) {
  console.error('Give --file <projects csv> and --projects-log <project-import log csv>.'); process.exit(2)
}
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !flag('live')) { console.error('This is the live database. Take a backup, then add --live.'); process.exit(2) }

const LOG = expand(opt('log') || `~/Library/Logs/ezbiz/appointment-history-${dbName}-${APPLY ? 'apply' : 'plan'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`)
fs.mkdirSync(path.dirname(LOG), { recursive: true })
const log = (line = '', echo = true) => { fs.appendFileSync(LOG, line + '\n'); if (echo) console.log(line) }

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = rows.shift()!.map(h => h.trim())
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/** "2024-02-21 08:00:00" on a Florida clock. */
const at = (s: string) => floridaTime(s.slice(0, 10), s.slice(11, 16))

async function main() {
  const prisma = new PrismaClient()
  log(`Appointment history import, ${APPLY ? 'APPLY' : 'plan only'}, database "${dbName}", ${new Date().toString()}`)
  log(`File ${FILE}\nProjects log ${PROJECTS_LOG}\nLog ${LOG}\n`)

  const projects = parseCsv(fs.readFileSync(FILE, 'utf8'))
  const placed = new Map(parseCsv(fs.readFileSync(PROJECTS_LOG, 'utf8')).map(r => [r.old_project_ref, r.ezbiz_customer_id]))
  const contacts = await prisma.crmContact.findMany({ where: { archivedAt: null }, select: { id: true, accountId: true, firstName: true, lastName: true } })
  const byId = new Map(contacts.map(c => [c.id, c]))

  const now = new Date()
  const rows: any[] = [], missing: string[] = []
  const counts = { estimatePast: 0, estimateFuture: 0, install: 0 }
  for (const p of projects) {
    const ref = p['Reference ID'].replace(/^#/, '')
    const wanted: Array<{ key: string; when: string; type: 'estimate' | 'install' }> = []
    if (p['First Sales Appointment']) wanted.push({ key: 'sales-first', when: p['First Sales Appointment'], type: 'estimate' })
    if (p['Last Sales Appointment'] && p['Last Sales Appointment'] !== p['First Sales Appointment']) wanted.push({ key: 'sales-last', when: p['Last Sales Appointment'], type: 'estimate' })
    if (p['First Installation Appointment']) wanted.push({ key: 'install-first', when: p['First Installation Appointment'], type: 'install' })
    if (p['Last Installation Appointment'] && p['Last Installation Appointment'] !== p['First Installation Appointment']) wanted.push({ key: 'install-last', when: p['Last Installation Appointment'], type: 'install' })
    if (!wanted.length) continue
    const contact = byId.get(placed.get(ref) || '')
    if (!contact?.accountId) { missing.push(`project #${ref} ${p['Customer Name']}: no matching customer in EZ Biz`); continue }
    for (const w of wanted) {
      const start = at(w.when)
      const past = start.getTime() < now.getTime()
      const end = w.type === 'install' ? floridaTime(w.when.slice(0, 10), '23:59') : new Date(start.getTime() + 60 * 60_000)
      if (w.type === 'install') counts.install++; else if (past) counts.estimatePast++; else counts.estimateFuture++
      rows.push({
        accountId: contact.accountId, crmContactId: contact.id, type: w.type,
        status: past ? 'completed' : 'scheduled', outcome: past ? 'imported' : null,
        startAt: w.type === 'install' ? floridaTime(w.when.slice(0, 10), '00:00') : start, endAt: end, allDay: w.type === 'install',
        address: p['Property Address'] || '', assignedTo: p['Salesperson Name'] || '',
        notes: `From Contractor Accelerator project #${ref}${p['Description'] ? `: ${p['Description']}` : ''}${w.type === 'install' ? ` (booked for ${w.when.slice(11, 16)})` : ''}.`,
        // Past history stays off Google Calendar; one still to come is an ordinary appointment.
        source: past ? 'import' : 'manual', sourceRef: `ca:${ref}:${w.key}`,
        completedAt: past ? end : null, createdBy: 'Contractor Accelerator import',
        history: [{ at: now.toISOString(), by: 'Contractor Accelerator import', kind: 'booked', to: { startAt: start.toISOString() } }],
      })
    }
  }

  log('PLAN')
  log(`  Projects in the file                 ${projects.length}`)
  log(`  Appointments to bring in             ${rows.length}`)
  log(`    Estimates, past (Completed)        ${counts.estimatePast}`)
  log(`    Estimates, still to come           ${counts.estimateFuture}`)
  log(`    Installs (all day, past)           ${counts.install}`)
  log(`  On ${new Set(rows.map(r => r.crmContactId)).size} customers; by person: ${Object.entries(rows.reduce((m: Record<string, number>, r) => { m[r.assignedTo] = (m[r.assignedTo] || 0) + 1; return m }, {})).map(([k, v]) => `${k || 'nobody'} ${v}`).join(', ')}`)
  log(`  Projects with no matching customer   ${missing.length}`)
  missing.forEach(m => log('    ' + m))
  for (const r of rows.filter(r => r.status === 'scheduled')) log(`  Still to come: ${byId.get(r.crmContactId)?.firstName} ${byId.get(r.crmContactId)?.lastName}, ${r.startAt.toISOString()} (goes to Google Calendar)`)
  fs.appendFileSync(LOG, '\nEVERY RECORD\n' + JSON.stringify(rows, null, 1) + '\n')
  if (!APPLY) { log('\nNothing was written.'); await prisma.$disconnect(); return }

  log('\nWRITING')
  let made = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const n = (await prisma.appointment.createMany({ data: rows.slice(i, i + BATCH), skipDuplicates: true })).count
    made += n
    log(`  batch ${i / BATCH + 1} of ${Math.ceil(rows.length / BATCH)}: ${n} new`, false)
  }
  log(`  appointments: ${made} created, ${rows.length - made} already there`)
  log('\nDone. Reload any open EZ Biz tabs.')
  await prisma.$disconnect()
}

main().catch(err => { log('FAILED: ' + (err?.stack || err)); process.exit(1) })
