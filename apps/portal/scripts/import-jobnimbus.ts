/**
 * Import the old JobNimbus contacts (Sept 2022 to Feb 2024) as customers,
 * notes, closed out pipeline cards and, for paid work, a SOLD quote with a
 * completed, paid job.
 *
 *   npx tsx scripts/import-jobnimbus.ts --file ~/Downloads/jobnimbus_contacts_2022_2024.csv
 *       prints the plan and writes nothing
 *   ... --apply                 writes to the database in DATABASE_URL
 *   ... --apply --live          required as well when that database is the live one
 *   ... --decisions file.json   the owner's answers:
 *                               "merge": { "<csv row>": "<customer id>" } and "separate": [<csv row>, ...]
 *                                 for contacts that share only a name with an existing customer
 *                                 (undecided ones are held back and listed);
 *                               "installedCard": [<csv row>, ...] merged customers who were in fact
 *                                 installed and get a Paid & Closed card;
 *                               "extraNotes": { "<csv row>": "<text>" } one more note on that customer;
 *                               "createJob": [<csv row>, ...] paid JobNimbus work the owner confirmed is a
 *                                 separate job from the ones that customer already has
 *   ... --raw-lead-source       keep JobNimbus's own lead source wording instead of EZ Biz's
 *
 * Safe to run twice: every record it creates has an id worked out from the
 * CSV row, anything already there is left alone, and records it created
 * itself are never mistaken for "already in EZ Biz".
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { START_IDS } from '../src/server/lib/pipelineStageModel.js'

const BATCH = 200
const NOTE_AUTHOR = 'JobNimbus import'
const TAG = 'JobNimbus'
const JOB_NOTE = 'Imported from JobNimbus, install date unknown'

// JobNimbus wording -> the wording EZ Biz customers already use, so reports group them together.
const LEAD_SOURCE: Record<string, string> = {
  'Web Search': 'website/google', 'mySalesman': 'mysalesman', 'Referral': 'Referral',
  'Yard Sign': 'yard sign', 'Facebook': 'facebook',
}
// A misspelling on existing customers, put right on every customer as part of this import.
const SPELLING_FIX = { from: 'refferal', to: 'Referral' }
const FROM_SCHEDULE_TAG = 'From schedule'
// JobNimbus status (its own words, left) -> pipeline stage id (Settings > Pipeline Stages, right). All closed out, none active.
const STAGE: Record<string, string> = {
  'Paid & Closed': START_IDS.paidClosed, 'Lost': START_IDS.lostSale, 'No Answer': START_IDS.noAnswer,
  'Pending Customer Signature': START_IDS.lostSale, '': START_IDS.lostSale,
}

/* ── arguments ── */
const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
const expand = (p: string) => p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
const FILE = expand(opt('file') || '')
const APPLY = flag('apply')
// --apply on the live database also needs EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes (lib/liveWriteGuard.ts).
if (APPLY) assertLiveWriteAllowed('import-jobnimbus.ts')
const RAW_SOURCE = flag('raw-lead-source')
if (!FILE || !fs.existsSync(FILE)) { console.error('Give the CSV with --file <path>.'); process.exit(2) }
const decisions: { merge?: Record<string, string>; separate?: number[]; installedCard?: number[]; extraNotes?: Record<string, string>; createJob?: number[] } =
  opt('decisions') ? JSON.parse(fs.readFileSync(expand(opt('decisions')!), 'utf8')) : {}

const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !flag('live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live to import into it.`)
  process.exit(2)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG = expand(opt('log') || `~/Library/Logs/ezbiz/jobnimbus-import-${dbName}-${APPLY ? 'apply' : 'plan'}-${stamp}.log`)
fs.mkdirSync(path.dirname(LOG), { recursive: true })
function log(line = '', echo = true) { fs.appendFileSync(LOG, line + '\n'); if (echo) console.log(line) }

/* ── helpers ── */
const NAMESPACE = crypto.createHash('sha1').update('ezbiz:jobnimbus-import').digest().subarray(0, 16)
/** A UUID (version 5) that is always the same for the same text. */
function uuid5(name: string): string {
  const h = crypto.createHash('sha1').update(NAMESPACE).update(name).digest().subarray(0, 16)
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
const digits = (s: string | null | undefined) => { const d = (s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const lower = (s: string | null | undefined) => (s || '').trim().toLowerCase()
const nameKey = (a: string, b: string) => (a + b).toLowerCase().replace(/[^a-z]/g, '')
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPhone = (s: string) => { const d = digits(s); return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s.trim() }

/** "2023-04-26 14:32" on a Florida clock -> the moment in UTC. */
function floridaToUtc(local: string): Date {
  const [d, t] = local.trim().split(' ')
  const guess = new Date(`${d}T${t || '12:00'}:00Z`)
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' UTC')
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime()))
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false; else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = rows.shift()!
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

interface Row {
  n: number                // line in the CSV, header is line 1
  sig: string              // what this row's ids are worked out from
  first: string; last: string; email: string; phone: string; phone2: string
  address: string; city: string; state: string; zip: string
  status: string; source: string; invoices: number
  local: string; day: string; at: Date; estimated: boolean
  inEzbiz: string; flags: string
}

interface Existing {
  id: string; firstName: string; lastName: string; email: string | null; phone: string | null
  notes: string | null; leadSource: string | null; createdAt: Date
  serviceAddress: string | null; city: string | null; state: string | null; zip: string | null; tags: unknown
}

interface Group {
  rows: Row[]                       // oldest first
  existing: Existing | null         // merge into this customer
  how: string                       // why it merges
  contactId: string
}

async function main() {
  const prisma = new PrismaClient()
  log(`JobNimbus import, ${APPLY ? 'APPLY' : 'plan only'}, database "${dbName}", ${new Date().toString()}`)
  log(`File ${FILE}`)
  log(`Log  ${LOG}\n`)

  const all: Row[] = parseCsv(fs.readFileSync(FILE, 'utf8')).map((r, i) => ({
    n: i + 2,
    sig: [r.first_name, r.last_name, lower(r.email), digits(r.phone), r.date_created].join('|'),
    first: r.first_name, last: r.last_name, email: lower(r.email), phone: r.phone, phone2: r.phone_2,
    address: r.address, city: r.city, state: /^[A-Za-z]{2}$/.test(r.state) && r.state === r.state.toUpperCase() ? r.state : '', zip: r.zip,
    status: r.old_status, source: r.lead_source, invoices: Number(r.approved_invoices_total || 0) || 0,
    local: r.date_created, day: r.date_created.slice(0, 10), at: floridaToUtc(r.date_created), estimated: r.date_estimated === 'yes',
    inEzbiz: r.already_in_ezbiz, flags: r.flags,
  }))
  const skipped = all.filter(r => /own test or lead form entry/i.test(r.flags))
  const rows = all.filter(r => !skipped.includes(r))

  /* ── what is already in EZ Biz (never counting what this import made itself) ── */
  const account = await prisma.crmContact.groupBy({ by: ['accountId', 'ownerId'], _count: true, orderBy: { _count: { id: 'desc' } }, take: 1 })
  const accountId = account[0]?.accountId, ownerId = account[0]?.ownerId ?? null
  if (!accountId) throw new Error('No customers in this database, so no account to import into.')
  const ownIds = new Set(all.map(r => uuid5('contact:' + r.sig)))
  const contacts: Existing[] = (await prisma.crmContact.findMany({
    where: { accountId, archivedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, notes: true, leadSource: true, createdAt: true, serviceAddress: true, city: true, state: true, zip: true, tags: true },
  })).filter(c => !ownIds.has(c.id))
  const byRef = new Map<string, Existing>(), byEmail = new Map<string, Existing[]>(), byPhone = new Map<string, Existing[]>(), byName = new Map<string, Existing[]>()
  const push = (m: Map<string, Existing[]>, k: string, c: Existing) => { if (k) m.set(k, [...(m.get(k) || []), c]) }
  const misspelled = contacts.filter(c => c.leadSource === SPELLING_FIX.from).length
  for (const c of contacts) {
    if (c.leadSource === SPELLING_FIX.from) c.leadSource = SPELLING_FIX.to   // as it will read once the spelling is fixed
    const ref = /ref #(\d+)/.exec(c.notes || ''); if (ref) byRef.set(ref[1], c)
    push(byEmail, lower(c.email), c); push(byPhone, digits(c.phone), c); push(byName, nameKey(c.firstName, c.lastName), c)
  }

  /* ── one person per shared email or phone inside the file ── */
  const parent = new Map<Row, Row>(rows.map(r => [r, r]))
  const find = (r: Row): Row => { let p = parent.get(r)!; while (p !== parent.get(p)) p = parent.get(p)!; parent.set(r, p); return p }
  const seen = new Map<string, Row>()
  for (const r of rows) for (const k of [r.email && 'e:' + r.email, digits(r.phone) && 'p:' + digits(r.phone)]) {
    if (!k) continue
    const other = seen.get(k)
    if (other) parent.set(find(r), find(other)); else seen.set(k, r)
  }
  const clusters = new Map<Row, Row[]>()
  for (const r of rows) clusters.set(find(r), [...(clusters.get(find(r)) || []), r])

  const flagged: string[] = [], held: { row: Row; lookalikes: Existing[] }[] = [], furtherMatches: string[] = [], groups: Group[] = []
  const who = (r: Row) => `row ${r.n} ${r.first} ${r.last}`.trim()
  for (const members of clusters.values()) {
    members.sort((a, b) => a.at.getTime() - b.at.getTime() || a.n - b.n)
    const hits = new Map<string, { c: Existing; how: string }>()
    for (const r of members) {
      const ref = /^yes.*#(\d+)/.exec(r.inEzbiz)?.[1]
      const mine: { c: Existing; how: string }[] = [
        ...(byEmail.get(r.email) || []).map(c => ({ c, how: 'email' })),
        ...[digits(r.phone), digits(r.phone2)].flatMap(p => (p && byPhone.get(p)) || []).map(c => ({ c, how: 'phone' })),
      ]
      if (ref && byRef.get(ref)) hits.set(byRef.get(ref)!.id, { c: byRef.get(ref)!, how: `file says #${ref}` })
      else if (ref) flagged.push(`${who(r)}: the file says Contractor Accelerator customer #${ref}, which is not in EZ Biz${mine[0] ? `; matched ${mine[0].c.firstName} ${mine[0].c.lastName} by ${mine[0].how} instead` : '; imported as new'}`)
      for (const m of mine) if (!hits.has(m.c.id)) {
        hits.set(m.c.id, m)
        if (!r.inEzbiz.startsWith('yes') || !ref || !byRef.get(ref)) furtherMatches.push(`${who(r)} (${r.status || 'no status'}, ${r.day}) = existing ${m.c.firstName} ${m.c.lastName}, same ${m.how}, customer since ${m.c.createdAt.toISOString().slice(0, 10)}`)
      }
    }
    const first = [...hits.values()][0]
    if (hits.size > 1) flagged.push(`${members.map(who).join(' + ')}: matches ${hits.size} different existing customers (${[...hits.values()].map(h => `${h.c.firstName} ${h.c.lastName}`).join(', ')}); merged into the first`)
    let existing = first?.c ?? null, how = first?.how ?? ''
    if (!existing) {
      // Same name as an existing customer but nothing else in common: the owner decides.
      const lead = members[0]
      const looks = members.flatMap(r => nameKey(r.first, r.last).length > 5 ? byName.get(nameKey(r.first, r.last)) || [] : [])
      const forced = members.map(r => decisions.merge?.[String(r.n)]).find(Boolean)
      if (forced) {
        existing = contacts.find(c => c.id === forced) ?? null; how = 'same name, your decision'
        if (!existing) throw new Error(`--decisions merges row ${lead.n} into ${forced}, which is not a customer here.`)
      } else if (looks.length && !members.some(r => decisions.separate?.includes(r.n))) { held.push({ row: lead, lookalikes: [...new Set(looks)] }); continue }
    }
    groups.push({ rows: members, existing, how, contactId: existing?.id ?? uuid5('contact:' + members[0].sig) })
  }

  /* ── cards and jobs already there ── */
  const state = await prisma.pipelineState.findUnique({ where: { accountId } })
  if (!state) throw new Error('This account has no pipeline yet. Open the Sales Pipeline once, then run again.')
  const leads = (state.leads as any[]) || []
  const ownCards = new Set(all.map(r => uuid5('card:' + r.sig)))
  const hasCard = new Set(leads.filter(l => l.customerId && !ownCards.has(l.id)).map(l => l.customerId as string))
  const gdJobs = await prisma.savedJob.findMany({
    where: { accountId, archivedAt: null, crmContactId: { in: groups.filter(g => g.existing).map(g => g.contactId) }, notes: { contains: 'GD Schedule' } },
    select: { crmContactId: true, completedDate: true, scheduledDate: true, contractValue: true, createdAt: true },
  })

  /* ── build everything ── */
  const newContacts: any[] = [], updates: { id: string; data: any; why: string }[] = [], notes: any[] = [], quotes: any[] = [], jobs: any[] = [], cards: any[] = []
  const jobsByYear: Record<string, { count: number; total: number }> = {}
  const list2024: string[] = [], keptCard: string[] = [], scheduleWins: string[] = [], separateJobs: string[] = [], filled: string[] = []
  const cardsPerColumn: Record<string, number> = {}
  let noCard = 0
  const sourceOf = (r: Row) => RAW_SOURCE ? r.source : (LEAD_SOURCE[r.source] ?? r.source)

  for (const g of groups) {
    const lead = g.rows[0]
    const name = g.existing ? `${g.existing.firstName} ${g.existing.lastName}`.trim() : `${lead.first} ${lead.last}`.trim()
    const street = lead.address, tail = [lead.city, [lead.state, lead.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    const fullAddress = [street, tail].filter(Boolean).join(', ')
    if (g.rows.length > 1) flagged.push(`${g.rows.map(r => `${who(r)} (${r.status || 'no status'}, ${money(r.invoices)}, ${r.day})`).join(' + ')}: same email or phone, imported as one customer, ${name}`)

    if (!g.existing) {
      newContacts.push({
        id: g.contactId, accountId, ownerId, firstName: lead.first, lastName: lead.last,
        email: lead.email || null, phone: lead.phone ? fmtPhone(lead.phone) : null,
        serviceAddress: fullAddress || null, city: lead.city || null, state: lead.state || null, zip: lead.zip || null,
        leadSource: sourceOf(lead) || null, tags: [TAG], notes: 'Imported from JobNimbus (old CRM, Sept 2022 to Feb 2024).',
        createdAt: lead.at,
      })
    } else {
      const data: any = {}, why: string[] = []
      // Two JobNimbus people can land on the same existing customer, so the
      // customer in hand is kept up to date for the next one.
      if (lead.at < g.existing.createdAt) { why.push(`Customer Since ${g.existing.createdAt.toISOString().slice(0, 10)} -> ${lead.day}`); data.createdAt = g.existing.createdAt = lead.at }
      const src = g.rows.map(sourceOf).find(Boolean)
      if (!(g.existing.leadSource || '').trim() && src) { data.leadSource = g.existing.leadSource = src; why.push(`lead source filled: ${src}`) }
      // A customer the GD Schedule import made has a name and nothing else:
      // JobNimbus supplies the contact details. Nothing already there is overwritten.
      if (Array.isArray(g.existing.tags) && g.existing.tags.includes(FROM_SCHEDULE_TAG)) {
        const got: string[] = []
        const fill = (field: 'phone' | 'email' | 'serviceAddress' | 'city' | 'state' | 'zip', value: string) => {
          if (value && !(g.existing![field] || '').trim()) { data[field] = g.existing![field] = value; got.push(field === 'serviceAddress' ? 'address' : field) }
        }
        fill('phone', lead.phone ? fmtPhone(lead.phone) : ''); fill('email', lead.email); fill('serviceAddress', fullAddress)
        fill('city', lead.city); fill('state', lead.state); fill('zip', lead.zip)
        if (got.length) { why.push(`filled from JobNimbus: ${got.join(', ')}`); filled.push(name) }
      }
      if (why.length) updates.push({ id: g.existing.id, data, why: `${name}: ${why.join(', ')}` })
    }

    for (const r of g.rows) {
      const parts = [
        g.existing ? `Also in JobNimbus since ${r.day}, status ${r.status || 'unreadable'}.` : '',
        `From JobNimbus: status ${r.status || 'unreadable'}, lead source ${r.source || 'none'}, invoices ${money(r.invoices)}${r.estimated ? ', date estimated' : ''}.`,
        r.phone2 ? `Second phone ${fmtPhone(r.phone2)}.` : '',
        g.rows.length > 1 && !g.existing ? `JobNimbus record for ${r.first} ${r.last}, created ${r.day}.` : '',
      ].filter(Boolean)
      notes.push({ id: uuid5('note:' + r.sig), crmContactId: g.contactId, accountId, body: parts.join(' '), createdBy: NOTE_AUTHOR, createdById: ownerId, createdAt: r.at })
      if (r.status !== 'Paid & Closed' && r.invoices > 0) flagged.push(`${who(r)}: status ${r.status || 'blank'} but ${money(r.invoices)} in approved invoices; no job created (rule 6)`)
      if (!r.status) flagged.push(`${who(r)}: status blank or unreadable; card goes to the Lost stage, marked`)
      const extra = decisions.extraNotes?.[String(r.n)]
      if (extra) notes.push({ id: uuid5('extra-note:' + r.sig), crmContactId: g.contactId, accountId, body: extra, createdBy: NOTE_AUTHOR, createdById: ownerId, createdAt: new Date(r.at.getTime() + 1000) })
    }

    /* jobs */
    let jobTotal = 0
    const seenAmounts = new Set<number>()
    // A merged customer who already has GD Schedule jobs may be a repeat
    // customer: the JobNimbus work is the same job only when the dates are
    // within 60 days and the prices within 10%. The owner went through these
    // one by one; the rows he confirmed as separate work are in createJob.
    // Every other one keeps the schedule's job and price, with nothing added.
    const onSchedule = gdJobs.filter(j => j.crmContactId === g.contactId)
    for (const r of g.rows) {
      if (r.status !== 'Paid & Closed' || r.invoices <= 0) continue
      if (g.existing && onSchedule.length && !decisions.createJob?.includes(r.n)) {
        const line = `${who(r)} ${r.day} ${money(r.invoices)}: ${name} already has ${onSchedule.length} GD Schedule job${onSchedule.length > 1 ? 's' : ''} (${onSchedule.map(j => `${j.completedDate || j.scheduledDate || '?'} ${money(j.contractValue)}`).join(', ')})`
        scheduleWins.push(line)
        if (r.day.startsWith('2024')) list2024.push('SKIP    ' + line)
        continue
      }
      if (seenAmounts.has(r.invoices)) { flagged.push(`${who(r)}: ${money(r.invoices)} is the same invoice total as this customer's other JobNimbus record; one job created, not two`); continue }
      const year = r.day.slice(0, 4)
      if (g.existing && onSchedule.length) separateJobs.push(`${who(r)} ${r.day} ${money(r.invoices)}: a separate job from ${name}'s GD Schedule job${onSchedule.length > 1 ? 's' : ''} (${onSchedule.map(j => `${j.completedDate || j.scheduledDate || '?'} ${money(j.contractValue)}`).join(', ')})`)
      if (year === '2024') list2024.push(`CREATE  ${who(r)} ${r.day} ${money(r.invoices)}: ${g.existing ? 'existing customer with no GD Schedule job' : 'not an EZ Biz customer before this import'}`)
      seenAmounts.add(r.invoices); jobTotal += r.invoices
      jobsByYear[year] = { count: (jobsByYear[year]?.count || 0) + 1, total: (jobsByYear[year]?.total || 0) + r.invoices }
      const quoteId = uuid5('quote:' + r.sig)
      const snapshot = { customerName: name, customerPhone: lead.phone ? fmtPhone(lead.phone) : (g.existing?.phone || ''), customerEmail: lead.email || g.existing?.email || '', customerAddress: fullAddress }
      quotes.push({
        id: quoteId, accountId, ownerId, crmContactId: g.contactId, ...snapshot, leadSource: sourceOf(r),
        runs: [], pullSheet: [], finalPrice: r.invoices, pricing: { finalPrice: r.invoices },
        status: 'SOLD', date: r.day, notes: JOB_NOTE, createdAt: r.at,
      })
      jobs.push({
        id: uuid5('job:' + r.sig), accountId, quoteId, crmContactId: g.contactId, status: 'paid', ...snapshot,
        quotePrice: r.invoices, contractValue: r.invoices, estimatedDays: 1,
        completedDate: r.day, paymentStatus: 'paid', amountPaid: r.invoices, paymentDate: r.day,
        notes: JOB_NOTE, leadSource: sourceOf(r), createdAt: r.at,
      })
    }

    /* one card, closed out */
    // Only brand new JobNimbus customers get one. An existing customer gets a
    // card only where the owner said they were installed.
    const installed = g.rows.find(r => decisions.installedCard?.includes(r.n))
    const paid = installed ?? g.rows.find(r => r.status === 'Paid & Closed')
    const statuses = new Set(g.rows.map(r => r.status))
    const cardRow = paid ?? g.rows[0]
    const stage = paid ? START_IDS.paidClosed : statuses.size === 1 ? STAGE[cardRow.status] ?? START_IDS.lostSale : START_IDS.lostSale
    if (g.existing && !installed) { if (!hasCard.has(g.contactId)) noCard++ }
    else if (hasCard.has(g.contactId)) keptCard.push(`${name}: keeps the current card (${[...leads, ...cards].find(l => l.customerId === g.contactId)?.stage})`)
    else {
      hasCard.add(g.contactId)   // one card per customer, even when two JobNimbus people merge into them
      cardsPerColumn[stage] = (cardsPerColumn[stage] || 0) + 1
      cards.push({
        id: uuid5('card:' + cardRow.sig), customerId: g.contactId,
        firstName: g.existing?.firstName ?? lead.first, lastName: g.existing?.lastName ?? lead.last,
        phone: lead.phone ? fmtPhone(lead.phone) : (g.existing?.phone || ''), email: lead.email || g.existing?.email || '', address: fullAddress,
        leadSource: sourceOf(cardRow), leadTemp: 0, fenceType: '', sections: 0, quotePrice: jobTotal, crew: '', scheduledDate: '',
        jobValue: jobTotal, paymentStatus: jobTotal > 0 ? 'paid' : '', balanceDue: 0,
        notes: `From JobNimbus: status ${cardRow.status || 'unreadable'}.${installed ? ' Installed, on the GD Schedule.' : ''}${cardRow.status ? '' : ' FLAGGED: status was blank or unreadable in JobNimbus.'}${cardRow.status === 'Pending Customer Signature' ? ' Never signed.' : ''}`,
        stage, createdAt: cardRow.day, lastMoved: cardRow.day,
      })
    }
  }

  /* ── the plan ── */
  const merged = groups.filter(g => g.existing)
  log('PLAN')
  log(`  Rows in the file                      ${all.length}`)
  log(`  Skipped (own test or lead form entry) ${skipped.length}`)
  log(`  Held for your decision (same name)    ${held.length}`)
  log(`  New customers                         ${newContacts.length}   (from ${groups.filter(g => !g.existing).reduce((s, g) => s + g.rows.length, 0)} rows)`)
  log(`  Merged into existing customers        ${merged.length}   (from ${merged.reduce((s, g) => s + g.rows.length, 0)} rows; ${updates.filter(u => u.data.createdAt).length} get an earlier Customer Since, ${updates.filter(u => u.data.leadSource).length} get a lead source)`)
  log(`  Notes                                 ${notes.length}`)
  log(`  Pipeline cards                        ${cards.length}   ${Object.entries(cardsPerColumn).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
  log(`  Existing customers given no card      ${noCard}   (${merged.length - noCard - (decisions.installedCard?.length || 0)} more already have one, kept as it is)`)
  log(`  Details filled in from JobNimbus      ${filled.length}   (customers the GD Schedule import made)`)
  log(`  Spelling "${SPELLING_FIX.from}" -> "${SPELLING_FIX.to}"       ${misspelled} customers`)
  log(`  No job, the schedule's job stays      ${scheduleWins.length}`)
  log(`  SOLD quotes + paid jobs               ${jobs.length}   total ${money(jobs.reduce((s, j) => s + j.contractValue, 0))}`)
  for (const y of Object.keys(jobsByYear).sort()) log(`      ${y}: ${jobsByYear[y].count} jobs, ${money(jobsByYear[y].total)}`)
  log(`  Paid & Closed with $0 (card, no job)  ${groups.flatMap(g => g.rows).filter(r => r.status === 'Paid & Closed' && r.invoices <= 0).length}`)
  log(`  Lead source wording                   ${RAW_SOURCE ? 'as JobNimbus wrote it' : Object.entries(LEAD_SOURCE).map(([a, b]) => `${a} -> ${b}`).join(', ')}`)
  const section = (title: string, lines: string[]) => { log(`\n${title} (${lines.length})`); lines.forEach(l => log('  ' + l)) }
  section('HELD: same name as an existing customer, nothing else in common', held.map(h => `row ${h.row.n} ${h.row.first} ${h.row.last}, ${h.row.city || 'no city'}, ${h.row.status || 'no status'}, ${money(h.row.invoices)}, ${h.row.day}  ~  existing ${h.lookalikes.map(c => `${c.firstName} ${c.lastName} since ${c.createdAt.toISOString().slice(0, 10)} [${c.id}]`).join(' / ')}`))
  section('FURTHER MATCHES by email or phone that the file did not mark', furtherMatches)
  section('2024 Paid & Closed jobs', list2024)
  section('NO JOB: the merged customer already has a GD Schedule job, which stays as it is', scheduleWins)
  section('JOB CREATED beside existing GD Schedule jobs: separate work, confirmed by the owner', separateJobs)
  section('EXISTING CARDS KEPT', keptCard)
  section('FLAGGED', flagged)
  section('EXISTING CUSTOMERS CHANGED', updates.map(u => u.why))
  fs.appendFileSync(LOG, '\nEVERY RECORD\n' + JSON.stringify({ newContacts, updates, notes, quotes, jobs, cards }, null, 1) + '\n')

  if (!APPLY) { log(`\nNothing was written. Full detail is in the log.`); await prisma.$disconnect(); return }

  /* ── write, in batches; anything already there is left alone ── */
  log('\nWRITING')
  async function inBatches(what: string, items: any[], write: (chunk: any[]) => Promise<number>) {
    let made = 0
    for (let i = 0; i < items.length; i += BATCH) {
      const n = await write(items.slice(i, i + BATCH)); made += n
      log(`  ${what}: batch ${i / BATCH + 1} of ${Math.ceil(items.length / BATCH)}, ${n} new`, false)
    }
    log(`  ${what}: ${made} created, ${items.length - made} already there`)
  }
  await inBatches('customers', newContacts, async c => (await prisma.crmContact.createMany({ data: c, skipDuplicates: true })).count)
  const respelled = await prisma.crmContact.updateMany({ where: { accountId, leadSource: SPELLING_FIX.from }, data: { leadSource: SPELLING_FIX.to } })
  log(`  lead source spelling fixed on ${respelled.count} customers`)
  let changed = 0
  for (const u of updates) { await prisma.crmContact.update({ where: { id: u.id }, data: u.data }); changed++ }
  log(`  existing customers updated: ${changed}`)
  await inBatches('notes', notes, async c => (await prisma.crmContactNote.createMany({ data: c, skipDuplicates: true })).count)
  await inBatches('quotes', quotes, async c => (await prisma.savedQuote.createMany({ data: c, skipDuplicates: true })).count)
  await inBatches('jobs', jobs, async c => (await prisma.savedJob.createMany({ data: c, skipDuplicates: true })).count)

  // The pipeline is one record with a version. Add the cards to the newest
  // copy and save only if nobody else saved in between; otherwise try again.
  for (let attempt = 1; ; attempt++) {
    const now = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    const current = (now.leads as any[]) || []
    const ids = new Set(current.map(l => l.id)), withCard = new Set(current.map(l => l.customerId).filter(Boolean))
    const add = cards.filter(c => !ids.has(c.id) && !withCard.has(c.customerId))
    if (!add.length) { log(`  pipeline cards: 0 created, ${cards.length} already there`); break }
    const done = await prisma.pipelineState.updateMany({ where: { accountId, version: now.version }, data: { leads: [...current, ...add], version: { increment: 1 } } })
    if (done.count === 1) { log(`  pipeline cards: ${add.length} created, ${cards.length - add.length} already there (pipeline version ${now.version} -> ${now.version + 1})`); break }
    if (attempt >= 5) throw new Error('The pipeline kept changing while saving. Nothing was lost; run the import again.')
  }
  log('\nDone. Reload any open EZ Biz tabs.')
  await prisma.$disconnect()
}

main().catch(err => { log('FAILED: ' + (err?.stack || err)); process.exit(1) })
