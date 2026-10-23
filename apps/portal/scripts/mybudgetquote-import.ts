/**
 * Import Jonathan's MyBudgetQuote file (the old online quote tool's requests)
 * as customers, pinned history notes and pipeline cards. The rules are in
 * src/server/lib/mybudgetquoteImport.ts.
 *
 *   npx tsx scripts/mybudgetquote-import.ts --file ~/Downloads/mybudgetquote-import-2026-10-23.csv
 *       the plan only: writes nothing to the database; prints the counts and
 *       writes the full report (--report <file.md>, default next to the CSV:
 *       mybudgetquote-dry-run-<date>.md)
 *   ... --apply                 writes it, in one transaction, as one import (Settings > Deleted Records > Imports)
 *   ... --apply --live          required as well for the live database, with EZBIZ_LIVE_WRITE_OK=1
 *                               and a backup from the last 30 minutes (lib/liveWriteGuard.ts)
 *   npx tsx scripts/mybudgetquote-import.ts --undo <batchId> [--live]
 *       Undo import: the same as the button in Settings > Deleted Records (same guards)
 *
 * Safe to run twice: rows already imported (by old_tool_ids) are skipped, so
 * a second --apply makes nothing new. Nothing is sent to anyone, and no
 * follow up or automation starts for what it makes.
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const expand = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)

const APPLY = flag('apply')
const UNDO = opt('undo')
if (APPLY || UNDO) assertLiveWriteAllowed('mybudgetquote-import.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if ((APPLY || UNDO) && dbName === LIVE_DATABASE_NAME && !flag('live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const accountId = await resolveIntakeAccountId()
  if (!accountId) { console.error('No company is set up in this database.'); process.exit(2) }

  if (UNDO) {
    const { undoImport } = await import('../src/server/lib/customerImport.js')
    const r = await undoImport({ accountId, userId: null }, UNDO, 'Undo import (script)')
    console.log(`Undone: ${r.label}. Deleted Records row ${r.logId}.`)
    console.log(`Taken back: ${Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`)
    for (const l of r.left) console.log(`  left as it is: ${l.what} (${l.why})`)
    await prisma.$disconnect()
    return
  }

  const FILE = expand(opt('file') || '')
  if (!FILE || !fs.existsSync(FILE)) { console.error('Give the CSV with --file <path>.'); process.exit(2) }
  const m = await import('../src/server/lib/mybudgetquoteImport.js')
  const rows = m.readRows(fs.readFileSync(FILE, 'utf8'))
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const REPORT = expand(opt('report') || path.join(path.dirname(FILE), `mybudgetquote-${APPLY ? 'apply' : 'dry-run'}-${day}.md`))
  console.log(`MyBudgetQuote import, ${APPLY ? 'APPLY' : 'plan only (nothing is written)'}, database "${dbName}", company ${accountId}`)
  console.log(`File ${FILE}: ${rows.length} rows`)

  let plan
  if (APPLY) {
    const r = await m.applyMbq(prisma, accountId, rows, path.basename(FILE), 'mybudgetquote-import script')
    plan = r.plan
    if (!r.batchId) console.log('\nNothing new: every row is already imported. Nothing was written.')
    else console.log(`\nWritten as import ${r.batchId}: ${r.wrote.contacts} customers, ${r.wrote.notes} notes, ${r.wrote.cards} cards, ${r.wrote.tagged} customers on file tagged, ${r.wrote.possibleMatches} possible matches.\nUndo: Settings > Deleted Records > Imports, or --undo ${r.batchId}`)
  } else {
    plan = await m.planMbq(prisma, accountId, rows, path.basename(FILE))
  }
  fs.writeFileSync(REPORT, renderReport(m, plan, { apply: APPLY, dbName }))
  const c = plan.counts
  console.log(`\n  New customers                ${c.newCustomers}`)
  console.log(`  Rows matched to customers    ${c.matchedRows} (${c.matchedCustomers} customers on file)`)
  console.log(`  Cards                        ${Object.entries(c.cardsByStage).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`)
  console.log(`  New customers without card   ${c.newWithoutCard}`)
  console.log(`  Skipped                      ${Object.values(c.skipped).reduce((a, b) => a + b, 0)}`)
  console.log(`  Possible matches             ${c.possibleMatches}`)
  console.log(`\nReport: ${REPORT}`)
  await prisma.$disconnect()
}

// ── The report (Markdown) ────────────────────────────────────────────────────

type M = typeof import('../src/server/lib/mybudgetquoteImport.js')

function renderReport(m: M, plan: any, o: { apply: boolean; dbName: string }): string {
  const c = plan.counts
  const L: string[] = []
  const n = (x: number) => x.toLocaleString('en-US')
  const who = (d: any) => `${d.row.first} ${d.row.last}`.trim()
  const contact = (r: any) => [r.phone ? m.fmtPhone(r.phone) : 'no phone', r.email || 'no email'].join(', ')
  const onFile = (x: any) => `${`${x.firstName} ${x.lastName}`.trim() || '(no name)'} (${[x.phone || 'no phone', x.email || 'no email'].join(', ')}${x.archivedAt ? ', archived' : ''})`
  const esc = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
  const decisions: any[] = plan.decisions

  L.push(`# MyBudgetQuote import: ${o.apply ? 'APPLIED' : 'dry run'} (${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })})`, '')
  L.push(`Database: \`${o.dbName}\`${o.dbName === 'ezbiz_dev' ? ' (the practice copy of live, refreshed from live today; live was only read)' : ''}. File: \`${plan.file}\`, ${n(c.rows)} rows. ${o.apply ? '' : 'Nothing was written.'}`, '')
  L.push('## Counts', '')
  L.push('| What | Count |', '|---|---:|')
  L.push(`| Rows in the file | ${n(c.rows)} |`)
  L.push(`| New customers | ${n(c.newCustomers)} |`)
  L.push(`| Rows matched to existing customers | ${n(c.matchedRows)} (${n(c.matchedCustomers)} customers on file) |`)
  for (const [k, v] of Object.entries(c.cardsByStage)) L.push(`| Cards created in ${k} | ${n(v as number)} |`)
  L.push(`| Cards created, total | ${n(sum(c.cardsByStage))} |`)
  L.push(`| New customers created without a card | ${n(c.newWithoutCard)} |`)
  for (const [k, v] of Object.entries(c.newWithoutCardWhy)) L.push(`| &nbsp;&nbsp;of which: ${esc(k)} | ${n(v as number)} |`)
  L.push(`| Matched rows given no card | ${n(sum(c.matchedWithoutCardWhy))} |`)
  for (const [k, v] of Object.entries(c.matchedWithoutCardWhy)) L.push(`| &nbsp;&nbsp;of which: ${esc(k)} | ${n(v as number)} |`)
  L.push(`| Skipped | ${n(sum(c.skipped))} |`)
  for (const [k, v] of Object.entries(c.skipped)) L.push(`| &nbsp;&nbsp;${esc(k)} | ${n(v as number)} |`)
  L.push(`| Possible matches made | ${n(c.possibleMatches)} |`, '')
  L.push('Flagged rows, by flag (a row can have several):', '', '| Flag | Rows |', '|---|---:|')
  for (const [k, v] of Object.entries(c.flags).sort((a: any, b: any) => b[1] - a[1])) L.push(`| ${esc(k)} | ${n(v as number)} |`)
  L.push('', `Rows with at least one flag: ${n(plan.rows.filter((r: any) => r.flags.length).length)}.`, '')

  L.push('## Lead source mapping (please confirm)', '')
  L.push('Mapped to the live list of lead sources (Settings > Lead Sources, read from the copy). Anything not mapped stays as its own source, as written; Settings > Lead Sources then lists it to Add or Merge.', '')
  L.push('| MyBudgetQuote says | Rows | Saved as | |', '|---|---:|---|---|')
  for (const s of plan.sourceMap) L.push(`| ${esc(s.from)} | ${n(s.rows)} | ${esc(s.to)} | ${s.mapped ? 'mapped to an existing source' : 'not mapped: its own source'} |`)
  L.push('', 'Proposed but not done without your say so: "Other Social Media (Twitter, Instagram, Pinterest)" could go to Instagram, "Mail Ad" to Door Hanger. Say the word and the script maps them.', '')
  L.push(`**source_other** (the words people typed when they picked Other, ${n(plan.sourceOther.reduce((a: number, s: any) => a + s.rows, 0))} rows): never used as the lead source; kept word for word in the history note and the stored row. Many say Billboard or ChatGPT; your Billboard maricamp / billboard 441 sources could take some of these by hand later.`, '')
  L.push('| They wrote | Rows |', '|---|---:|')
  for (const s of plan.sourceOther) L.push(`| ${esc(s.text)} | ${s.rows} |`)
  L.push('')

  const matched = decisions.filter(d => d.kind === 'matched')
  L.push(`## Every match to an existing customer (${matched.length} rows)`, '')
  L.push('Matched only on the same phone (last 10 digits) or the same email (any capitals); never on a name. Nothing on the customer on file is changed except the tag "MyBudgetQuote import"; the row is added as a pinned history note.', '')
  const letters = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')
  const namesDiffer = (d: any) => { const last = letters(d.row.last); return !last || !letters(`${d.onFile.firstName}${d.onFile.lastName}`).includes(last) }
  L.push(`Rows where the name on file does not contain the file's last name: ${matched.filter(namesDiffer).length} (marked NAMES DIFFER below; matched anyway, by the phone/email rule).`, '')
  L.push('| # | Row (file) | Phone, email (file) | Old status | Existing customer | Matched by | Card? |', '|---:|---|---|---|---|---|---|')
  matched.forEach((d, i) => L.push(`| ${i + 1} | ${esc(who(d))} (line ${d.row.line}, ${d.row.stage} #${d.row.order}) | ${esc(contact(d.row))} | ${esc(d.row.status)} | ${esc(onFile(d.onFile))}${namesDiffer(d) ? ' **NAMES DIFFER**' : ''} | ${d.matchedBy} | ${d.card.make ? `yes, ${d.card.stage}` : `no: ${esc(d.card.why)}`} |`))
  L.push('')

  const soldNew = decisions.filter(d => d.kind === 'new' && m.isSold(d.row))
  const soldMatched = decisions.filter(d => d.kind === 'matched' && m.isSold(d.row))
  L.push(`## "Old tool status Sold" rows not matched to anyone on file (${soldNew.length})`, '')
  L.push('Each is made as a customer (with the history note and tags) but gets NO card, as you said. Please look at each one.', '')
  L.push('| Name | Phone, email | Address | Latest | Old estimate |', '|---|---|---|---|---|')
  for (const d of soldNew) L.push(`| ${esc(who(d))} | ${esc(contact(d.row))} | ${esc(m.fullAddress(d.row))} | ${d.row.latest} | ${esc(m.estimateLine(d.row))} |`)
  L.push('', `Sold rows that did match a customer on file: ${soldMatched.length}${soldMatched.length ? ` (${soldMatched.map(d => `${who(d)} -> ${`${d.onFile.firstName} ${d.onFile.lastName}`.trim()}`).join('; ')})` : ''}.`, '')

  const two = decisions.filter(d => d.kind === 'skip' && d.candidates)
  L.push(`## Rows matching two or more existing customers (${two.length}): not imported`, '')
  if (!two.length) L.push('None.', '')
  else {
    L.push('| Row (file) | Phone, email | Matches |', '|---|---|---|')
    for (const d of two) L.push(`| ${esc(who(d))} (line ${d.row.line}) | ${esc(contact(d.row))} | ${d.candidates.map((x: any) => `${esc(onFile(x.c))} by ${x.by}`).join('; ')} |`)
    L.push('', 'Tell me which customer each one is (or "new") and the script takes it.', '')
  }

  L.push('## Anthony Gonzalez and "Ant G" (1 Walnut Drive): possible match', '')
  if (!plan.pairs.length) L.push('No pair found among the new customers (one of them may have matched a customer on file; see the matches above).', '')
  L.push('Rule used: two NEW customers in the file with the same email and the same street. Besides the Walnut Drive pair this finds the pairs below, all looking like one person who filled the form twice; each gets the same possible match notice (Merge, or Not the same person). Say so if you want only Walnut Drive.', '')
  for (const p of plan.pairs) {
    L.push(`- ${who(p.contact)} (${contact(p.contact.row)}, ${p.contact.row.latest}, ${p.contact.row.status}, ${p.contact.card.make ? `card in ${p.contact.card.stage}` : 'no card'}) and ${who(p.match)} (${contact(p.match.row)}, ${p.match.row.latest}, ${p.match.row.status}, ${p.match.card.make ? `card in ${p.match.card.stage}` : 'no card'}): both made; ${who(p.contact)}'s page shows "Possible match: ${who(p.match)}" (same ${p.reason}, same street) with Merge / Not the same person.`)
  }
  L.push('')
  if (plan.sameEmailOther.length) {
    L.push(`Other new customers sharing an email with another row (different street, so no possible match is made; the file's "different addresses" flag): ${plan.sameEmailOther.length} emails.`, '')
    for (const g of plan.sameEmailOther) L.push(`- ${g.email}: ${g.rows.map((d: any) => `${who(d)}, ${d.row.address || 'no street'} (${d.row.latest.slice(0, 10)})`).join('; ')}`)
    L.push('')
  }

  L.push('## Where each field goes', '')
  L.push('- Name, phone ((352) 555-0100 form), email (lower case), address (street, city, state zip; also city/state/zip fields), lead source (mapped): on a NEW customer only. A matched customer keeps its own.')
  L.push('- "Customer since" (createdAt) of a new customer: first_request_date.')
  L.push('- Everything else, every row: one pinned note "MyBudgetQuote history" (estimate as "Old online estimate $X to $Y (date)", never a quote; old tool status, furthest step, finished quote, requests, lead source and their own words, best time to contact, their notes, attachments, old tool ids, flags; on a match also the name/phone/email/address as the old tool had them).')
  L.push('- The same fields, structured (estimates in cents, flags and ids as lists, lat/long, why no card): a new table CustomerImportRow, one per row, shown on the customer page as "MyBudgetQuote history" (flags in amber).')
  L.push('- Tags: "MyBudgetQuote import" on every new and matched customer; "MyBudgetQuote dropoff" on the older dropoffs. Both are built in and hidden from the tag picker (like Imported, JobNimbus); customer search finds them by tag.')
  L.push('- Card (where made): the column from pipeline_stage, dated latest_date, order_in_stage kept (1 on top), no price on the card (the estimate is in its note line).')
  L.push('- Not set: texting consent (stays unknown), follow ups, automations, appointments, notifications, portal invites.', '')

  L.push('## Five sample customers as they would look', '')
  const pick = (f: (d: any) => boolean) => decisions.find(f)
  const samples = [
    [`${plan.firstStage}, new, with an estimate`, pick(d => d.kind === 'new' && d.row.stage === plan.firstStage && d.row.lowCents != null)],
    ['A card in another column, new', pick(d => d.kind === 'new' && d.row.stage !== plan.firstStage && d.card.make && d.row.customerNotes)],
    ['Older dropoff, customer only', pick(d => d.kind === 'new' && !d.card.make && d.tags.includes(m.TAG_DROPOFF))],
    ['Matched to a customer on file', pick(d => d.kind === 'matched')],
    ['Flagged (contact cleared)', pick(d => d.kind !== 'skip' && d.row.flags.some((f: string) => /contact cleared/.test(f)))],
  ].filter(([, d]) => d) as Array<[string, any]>
  for (const [title, d] of samples) {
    const r = d.row
    L.push(`### ${title}: ${who(d)}`, '')
    if (d.kind === 'new') {
      L.push(`- Customer: ${who(d)}; phone ${r.phone ? m.fmtPhone(r.phone) : 'none'}; email ${r.email || 'none'}; address ${m.fullAddress(r) || 'none'}`)
      L.push(`- Lead source: ${d.leadSource}; customer since ${r.firstRequest || r.latest.slice(0, 10)}`)
    } else L.push(`- Existing customer ${onFile(d.onFile)}, matched by ${d.matchedBy}; not changed except the tag`)
    L.push(`- Tags: ${d.tags.join(', ')}`)
    L.push(`- Card: ${d.card.make ? `${d.card.stage}, dated ${r.latest.slice(0, 10)}, position ${r.order} of the file's ${d.card.stage} rows` : `none (${d.card.why})`}`)
    L.push('- Pinned note:', '', '```', d.noteBody, '```', '')
  }
  return L.join('\n') + '\n'
}

main().catch(err => { console.error(err?.stack || err); process.exit(1) })
