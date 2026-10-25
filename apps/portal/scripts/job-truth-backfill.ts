/**
 * Job truth backfill (walkthrough round 1, Oct 25 2026): existing jobs made to
 * agree with the one source of truth for each thing.
 *
 *   npx tsx scripts/job-truth-backfill.ts            the report: nothing is written
 *   npx tsx scripts/job-truth-backfill.ts --apply    makes the changes listed (database in DATABASE_URL)
 *   ... --apply --live                               required as well for the live database, with
 *                                                    EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 *
 * What it lists, and with --apply changes:
 *   1. 811 locates typed on crew packets (InstallPacket.locateTicket / locateDate)
 *      moved onto the job's one locate record (lib/locates.ts): the ticket number,
 *      and the packet's date as the good to dig date. A field the job already
 *      has is kept. The packet's own fields are left as they were.
 *   2. Milestone ticks that disagree with the job's records (lib/jobReadiness.ts):
 *      a tick on Locate Complete, Permit Approved or Crew Assigned that the
 *      records say is not done is cleared (those follow their record from now
 *      on). Hand ticks on the others are kept and listed: they show "ticked by
 *      hand" on the job.
 *   3. Quoted costs saved for another option than the one signed (lib/jobCosting.ts
 *      quotedMatchesQuote): replaced by the accepted option's cost.
 *   4. Payment status out of step with the payment schedule: the job's paid
 *      figures and status set from the schedule (lib/contractBilling.ts settleIn).
 *   5. Jobs signed off at the final walkthrough and paid in full that are not
 *      Complete: moved to Complete (lib/jobTruth.ts closeOutIfDone).
 *   6. Jobs with an install date and no Schedule entries (scheduled the old way):
 *      one entry per crew day made from the start, end and crew
 *      (lib/installScheduling.ts jobsMissingEntries).
 *   7. Pipeline cards behind their job: a sold job's card still in a selling
 *      stage goes to Signed Contract; a finished job's card to Job Complete
 *      (lib/jobTruth.ts cardsBehind).
 *   8. Job costing takeoffs still in draft whose lines are not the signed work
 *      (started from another option): made again from the signed quote after
 *      3 (lib/jobCosting.ts rebuildDraftTakeoff). Submitted or approved ones are
 *      never changed.
 *
 * The milestone list (2) is worked out as the jobs will be after 1, so the
 * locates moved in count. Nothing is texted or emailed. Run on live only
 * after Jonathan's OK.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('job-truth-backfill.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const mdy = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d || '-')

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { locateOf, locateFromPacket, locateFields } = await import('../src/server/lib/locates.js')
  const { milestones, staleTicks, milestoneOfLabel } = await import('../src/server/lib/jobReadiness.js')
  const { readinessFactsFor, clearStaleTicks, saveLocate, billingViewFor, billingStatusOf, closeOutIfDone } = await import('../src/server/lib/jobTruth.js')
  const { quotedMatchesQuote, snapshotQuotedCost } = await import('../src/server/lib/jobCosting.js')
  const { settleIn } = await import('../src/server/lib/contractBilling.js')
  const { jobsMissingEntries, makeMissingEntries } = await import('../src/server/lib/installScheduling.js')
  const { cardsBehind, moveCardTo } = await import('../src/server/lib/jobTruth.js')
  const { quotedNow, takeoffMatchesQuoted, rebuildDraftTakeoff, linesOf } = await import('../src/server/lib/jobCosting.js')
  console.log(`Job truth backfill, database "${dbName}", ${APPLY ? 'APPLY' : 'report only (nothing is written)'}\n`)

  const jobs = await prisma.savedJob.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } })
  const byId = new Map(jobs.map(j => [j.id, j]))
  const name = (j: { customerName: string; id: string }) => `${j.customerName || '(no name)'} (job ${j.id})`

  // ── 1. Locates from crew packets ──
  const packets = await prisma.installPacket.findMany({ where: { OR: [{ locateTicket: { not: null } }, { locateDate: { not: null } }] } })
  const locMoves: Array<{ jobId: string; from: ReturnType<typeof locateOf>; to: ReturnType<typeof locateOf> }> = []
  for (const p of packets) {
    const j = byId.get(p.jobId)
    if (!j) continue
    const cur = locateOf(j)
    const next = locateFromPacket(cur, p)
    if (next) locMoves.push({ jobId: j.id, from: cur, to: next })
  }
  console.log(`1. 811 locates typed on crew packets, moved onto the job: ${locMoves.length}`)
  for (const m of locMoves) {
    const j = byId.get(m.jobId)!
    console.log(`   ${name(j)}: ticket ${m.from.ticket ?? '(none)'} -> ${m.to.ticket ?? '(none)'}; good to dig ${mdy(m.from.goodDate)} -> ${mdy(m.to.goodDate)}`)
  }
  // The jobs as they will be after the move, for the milestone list.
  const after = jobs.map(j => {
    const m = locMoves.find(x => x.jobId === j.id)
    return m ? { ...j, ...locateFields(m.to) } : j
  })

  // ── 2. Milestone ticks against the records ──
  const accounts = [...new Set(jobs.map(j => j.accountId))]
  const stale: Array<{ job: typeof jobs[number]; ticks: ReturnType<typeof staleTicks> }> = []
  const kept: Array<{ job: typeof jobs[number]; label: string; by: string | null; at: string | null; records: string }> = []
  for (const accountId of accounts) {
    const s = await prisma.businessState.findUnique({ where: { accountId }, select: { jobChecklists: true } })
    const map = ((s?.jobChecklists as any) ?? {}) as Record<string, any[]>
    const mine = after.filter(j => j.accountId === accountId && Array.isArray(map[j.id]) && map[j.id].some(t => t?.isComplete))
    const facts = await readinessFactsFor(accountId, mine)
    for (const j of mine) {
      const f = facts.get(j.id)!
      const ticks = staleTicks(f, map[j.id])
      if (ticks.length) stale.push({ job: j, ticks })
      for (const m of milestones(f, map[j.id])) if (m.by === 'hand' && milestoneOfLabel(m.label)) kept.push({ job: j, label: m.label, by: m.tickedBy, at: m.tickedAt, records: m.detail })
    }
  }
  const staleCount = stale.reduce((s, x) => s + x.ticks.length, 0)
  console.log(`\n2. Milestone ticks the records disagree with, cleared (they follow the record from now on): ${staleCount} on ${stale.length} job${stale.length === 1 ? '' : 's'}`)
  for (const x of stale) {
    console.log(`   ${name(x.job)}`)
    for (const t of x.ticks) console.log(`     ${t.label}: ticked${t.tickedBy ? ` by ${t.tickedBy}` : ''}${t.tickedAt ? ` ${mdy(t.tickedAt)}` : ''} -> not ticked; the job says ${t.records}`)
  }
  console.log(`   Kept, shown "ticked by hand" on the job (the records do not show it done): ${kept.length}`)
  for (const k of kept) console.log(`     ${name(k.job)}: ${k.label}${k.by ? ` (by ${k.by}${k.at ? `, ${mdy(k.at)}` : ''})` : ''}; the records say ${k.records}`)

  // ── 3. Quoted cost against the signed option ──
  const quoted = await prisma.jobQuotedCost.findMany()
  const quotes = new Map((await prisma.savedQuote.findMany({ where: { id: { in: quoted.map(q => q.quoteId) } } })).map(q => [q.id, q]))
  const qMis: Array<{ row: typeof quoted[number]; q: any; job: typeof jobs[number] | undefined }> = []
  for (const row of quoted) {
    const q = quotes.get(row.quoteId)
    if (!q || q.status !== 'SOLD') continue
    if (!quotedMatchesQuote(row, q)) qMis.push({ row, q, job: jobs.find(j => j.quoteId === row.quoteId) })
  }
  console.log(`\n3. Sold jobs whose quoted cost is not the option signed: ${qMis.length}`)
  for (const m of qMis) {
    const opt = typeof m.q.chosenOption === 'number' ? (m.q.proposal as any)?.options?.[m.q.chosenOption] : null
    console.log(`   ${m.job ? name(m.job) : `(no job) quote ${m.q.id}`}, customer ${m.q.customerName}`)
    console.log(`     stored quoted cost: ${m.row.fenceStyle} at ${money(m.row.priceCents)}, cost ${money(m.row.totalCents)} (saved ${m.row.signedVia} ${m.row.signedAt.toISOString().slice(0, 10)})`)
    console.log(`     accepted option: ${opt?.label ? `${opt.label}: ` : ''}${m.q.fenceStyle} at ${money(Math.round(m.q.finalPrice * 100))}, cost ${money(Math.round((m.q.totalCOGS || 0) * 100))}${m.q.acceptedAt ? ` (signed ${m.q.acceptedAt.toISOString().slice(0, 10)})` : ''}`)
  }

  // ── 4. Payment status against the payment schedule ──
  const schedules = await prisma.paymentSchedule.findMany()
  const payFix: Array<{ job: typeof jobs[number]; from: string; to: string; text: string }> = []
  for (const sch of schedules) {
    const j = byId.get(sch.jobId)
    if (!j) continue
    const v = await billingViewFor(sch.accountId, sch.jobId)
    if (!v) continue
    const st = billingStatusOf(v)
    const want = v.paidCents <= 0 ? 'invoiced' : v.paidCents >= v.contractCents ? 'paid' : 'partial'
    const paidOk = Math.round(j.amountPaid * 100) === v.paidCents
    const valueOk = Math.round(j.contractValue * 100) === v.contractCents
    if (j.paymentStatus !== want || !paidOk || !valueOk) {
      payFix.push({ job: j, from: `${j.paymentStatus}, paid ${money(Math.round(j.amountPaid * 100))}, contract ${money(Math.round(j.contractValue * 100))}`, to: `${want}, paid ${money(v.paidCents)}, contract ${money(v.contractCents)}`, text: st.text })
    }
  }
  console.log(`\n4. Jobs whose payment status is out of step with their payment schedule: ${payFix.length}`)
  for (const p of payFix) console.log(`   ${name(p.job)}: ${p.from} -> ${p.to}. Shown as: ${p.text}`)

  // ── 5. Signed off and paid in full, not Complete ──
  const walks = await prisma.walkthrough.findMany()
  const close: Array<typeof jobs[number]> = []
  for (const w of walks) {
    if (!w.homeownerSig || !w.repSig) continue
    const j = byId.get(w.jobId)
    if (!j || ['completed', 'invoiced', 'paid', 'on_hold'].includes(j.status) || j.archivedAt) continue
    const st = billingStatusOf(await billingViewFor(w.accountId, w.jobId))
    if (st.paidInFull) close.push(j)
  }
  console.log(`\n5. Signed off at the walkthrough and paid in full, not Complete yet: ${close.length}`)
  for (const j of close) console.log(`   ${name(j)}: ${j.status} (${j.opsStage || 'no stage'}) -> Complete`)

  // ── 6. Install dates with no Schedule entries ──
  const missing: Array<{ accountId: string; m: Awaited<ReturnType<typeof jobsMissingEntries>>[number] }> = []
  for (const accountId of accounts) for (const m of await jobsMissingEntries(accountId)) missing.push({ accountId, m })
  console.log(`\n6. Jobs with an install date and no Schedule entries (entries to make, one per crew day): ${missing.length}`)
  for (const { m } of missing) console.log(`   ${m.customerName} (job ${m.jobId}, ${m.status}): ${m.days.map(mdy).join(', ')} on ${m.crewName || '(no crew)'}${m.crewFound ? '' : ' (the job\'s crew was not found in Schedule > Settings: the first crew)'}`)

  // ── 7. Pipeline cards behind their job ──
  const behind: Array<{ accountId: string; c: Awaited<ReturnType<typeof cardsBehind>>[number] }> = []
  for (const accountId of accounts) for (const c of await cardsBehind(accountId)) behind.push({ accountId, c })
  console.log(`\n7. Pipeline cards behind their job: ${behind.length}`)
  for (const { c } of behind) console.log(`   ${c.customerName} (job ${c.jobId}, ${c.jobStatus}): card ${c.fromName} -> ${c.toName}`)

  // ── 8. Draft takeoffs not of the signed work ──
  const drafts = await prisma.jobTakeoff.findMany({ where: { status: 'draft' } })
  const wrong: Array<{ t: typeof drafts[number]; job: typeof jobs[number]; style: string; parts: string }> = []
  for (const t of drafts) {
    const j = byId.get(t.jobId)
    if (!j) continue
    // As it will be after 3: the signed option's cost, when 3 replaces it.
    const mis = qMis.find(m => m.q.id === j.quoteId)
    const quoted = mis ? { fenceStyle: mis.q.fenceStyle, lines: (Array.isArray(mis.q.pullSheet) ? mis.q.pullSheet : []).filter((l: any) => l && typeof l.item === 'string' && l.item.trim()).map((l: any) => ({ part: String(l.item), qty: Number(l.qty) || 0 })) } as any : await quotedNow(t.accountId, j.quoteId)
    if (quoted && !takeoffMatchesQuoted(t, quoted)) wrong.push({ t, job: j, style: quoted.fenceStyle, parts: linesOf(t).slice(0, 3).map((l: any) => l.part).join('; ') })
  }
  console.log(`\n8. Draft takeoffs whose lines are not the signed work (made again from the signed quote): ${wrong.length}`)
  for (const w of wrong) console.log(`   ${name(w.job)}: takeoff started ${w.t.createdAt.toISOString().slice(0, 10)}, ${linesOf(w.t).length} lines (${w.parts}...) -> the signed ${w.style}`)

  if (!APPLY) { console.log('\nReport only. Nothing was written. Run with --apply to make these changes.'); await prisma.$disconnect(); return }

  // ── Apply ──
  let n1 = 0, n2 = 0, n3 = 0, n4 = 0, n5 = 0
  for (const m of locMoves) {
    const j = byId.get(m.jobId)!
    await saveLocate(j.accountId, j.id, { ticket: m.to.ticket, calledDate: m.to.calledDate, goodDate: m.to.goodDate, expDate: m.to.expDate }, 'Backfill: from the crew packet')
    n1++
  }
  for (const x of stale) n2 += (await clearStaleTicks(x.job.accountId, x.job.id, x.ticks.map(t => t.label))).length
  for (const m of qMis) if (await snapshotQuotedCost(m.q.accountId, m.q.id, m.row.signedVia === 'proposal' || m.row.signedVia === 'share' ? m.row.signedVia : (m.q.acceptedAt ? 'proposal' : 'app') as any)) n3++
  for (const p of payFix) {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-billing:' + p.job.id}))`
      await settleIn(tx, p.job.accountId, p.job.id, 'backfill: payment status from the schedule', { userId: null, name: 'Backfill' })
    }, { timeout: 20_000 })
    n4++
  }
  for (const j of close) if ((await closeOutIfDone(j.accountId, j.id, 'backfill: signed off and paid in full')).moved) n5++
  let n6 = 0, n7 = 0, n8 = 0
  for (const { accountId, m } of missing) n6 += await makeMissingEntries(accountId, m)
  for (const { accountId, c } of behind) {
    const j = byId.get(c.jobId)
    if (await moveCardTo(accountId, c.cardId, c.to, { quoteId: j?.quoteId ?? null, jobId: c.jobId })) n7++
  }
  // After 3, so the signed option's cost is the one the takeoff is made from (3 may have rebuilt some already).
  for (const w of wrong) if (await rebuildDraftTakeoff(w.t.accountId, w.t.jobId, 'backfill: started from another option')) n8++
  console.log(`\nApplied: ${n1} locates moved, ${n2} milestone ticks cleared, ${n3} quoted costs replaced, ${n4} payment statuses set, ${n5} jobs closed out, ${n6} Schedule entries made, ${n7} pipeline cards moved, ${n8} draft takeoffs made again.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
