/**
 * The sub's link (Jonathan, Nov 6 2026): no login, like the customer portal;
 * one per job, closed 30 days after the job is complete, turned off by the
 * office at any time. It shows the job as the install packet does (address,
 * map, the installer sheet or walk list, pull sheet, gates, plain fence name,
 * install day, the 811 ticket), only the notes the office chose, and the sub's
 * own pay for this job: never the customer's price, margin or other jobs.
 *
 * What the sub does on it:
 *   check out   at the shop: each pull sheet line ticked, a photo of the loaded
 *               trailer; the job's materials are then picked up (they are the
 *               job's, not shop stock)
 *   on the job  started, finished, footage installed, gates hung, problems,
 *               before and after photos, signed off with name and date; a
 *               problem (damage, site issue) reported any time
 *   check in    leftovers counted at the shop, with a photo; they go into shop
 *               stock in Inventory
 *
 * Anything that does not add up (footage, gates, material out − used −
 * returned) is a flag for the owner. Submitted: the job shows "Installed,
 * confirm" and the owner gets a push; one tap confirms it (confirmInstalled).
 */

import prisma from './prisma.js'
import { floridaDay } from './automations/context.js'
import { hashToken, SubError } from './subcontractors.js'
import { plusDays, type Ymd } from './installDays.js'

type Json = any

export interface SheetLine { item: string; qty: number }

/** The sub's job by the token in their link, or why it is closed. */
export async function subJobByToken(token: string) {
  if (!token || token.length < 20 || token.length > 100) return { sj: null, closed: 'gone' as const }
  const sj = await prisma.subJob.findUnique({ where: { tokenHash: hashToken(token) }, include: { sub: true } })
  if (!sj) return { sj: null, closed: 'gone' as const }
  const job = await prisma.savedJob.findUnique({ where: { id: sj.jobId } })
  if (!job || job.deletedAt || job.archivedAt) return { sj, job, closed: 'gone' as const }
  if (sj.linkDisabledAt) return { sj, job, closed: 'off' as const }
  if (job.completedDate && /^\d{4}-\d{2}-\d{2}$/.test(job.completedDate) && plusDays(job.completedDate, 30) < floridaDay(new Date())) {
    // Still open for a callback on their workmanship the office sent them.
    const callback = await prisma.serviceTicket.count({ where: { jobId: sj.jobId, subcontractorId: sj.subId, subWorkmanship: true, stage: { notIn: ['fixed', 'closed'] } } })
    if (!callback) return { sj, job, closed: 'expired' as const }
  }
  return { sj, job, closed: null }
}

/** The job's parts to pull (the packet's pull sheet with the approved change orders; work lines are not material). */
export async function partsOf(accountId: string, jobId: string): Promise<SheetLine[]> {
  const p = await prisma.installPacket.findUnique({ where: { jobId } })
  const job = await prisma.savedJob.findUnique({ where: { id: jobId }, select: { quoteId: true } })
  const { packetChange, packetWithChange, workNow } = await import('./changeOrderWork.js')
  const { isWorkLine } = await import('./workWords.js')
  let sheet: Json[] = []
  if (p) {
    const co = await packetChange(accountId, job?.quoteId, p.sentAt).catch(() => null)
    sheet = (packetWithChange(p.snapshot as Json, co) as Json).pullSheet ?? []
  } else if (job?.quoteId) {
    // No packet sent yet: the job's work as it is now (the signed quote with its approved change orders).
    const w = (await workNow(accountId, job.quoteId).catch(() => ({ work: null }))).work as Json
    sheet = Array.isArray(w?.pullSheet) ? w.pullSheet : []
  }
  return sheet
    .filter(l => l && typeof l.item === 'string' && !isWorkLine(l.item) && !l.moneyOnly)
    .map(l => ({ item: String(l.item), qty: Math.max(0, Math.round(Number(l.qty) || 0)) }))
    .filter(l => l.qty > 0)
}

// ── What the sub sends ───────────────────────────────────────────────────────

const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const whole = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null }
const words = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max)
const ids = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)).slice(0, 40) : [])

async function event(sjId: string, what: string, to = '') {
  const cur = await prisma.subJob.findUnique({ where: { id: sjId }, select: { events: true } })
  await prisma.subJob.update({ where: { id: sjId }, data: { events: [...((cur?.events as Json[]) ?? []), { at: new Date().toISOString(), what, how: 'sub link', to }] as Json } })
}

/** What still has to leave the shop: the job's pull sheet now (a change order may add to it) less what was taken. */
export function stillToTake(parts: SheetLine[], checkout: Json): SheetLine[] {
  const taken = (item: string) => ((checkout?.lines ?? []) as Json[]).filter(l => l.item === item).reduce((t, l) => t + (Number(l.taken) || 0), 0)
  return parts.map(p => ({ item: p.item, qty: Math.max(0, p.qty - taken(p.item)) })).filter(p => p.qty > 0)
}

/**
 * Check out at the shop: the lines taken (qty taken, ticked) and the trailer photo. The job's materials are picked
 * up. Again after a change order adds material: only what is still to take, added to what was taken before.
 */
export async function checkOut(sj: Json, body: Json) {
  if (sj.checkin?.at) throw new SubError(409, 'Checked in already. Call the office to change it.')
  const parts = await partsOf(sj.accountId, sj.jobId)
  const todo = sj.checkout?.at ? stillToTake(parts, sj.checkout) : parts
  if (!parts.length) throw new SubError(409, 'This job has no pull sheet yet. Call the office.')
  if (!todo.length) throw new SubError(409, 'Checked out already: everything on the pull sheet left the shop. Call the office to change it.')
  const sent: Json[] = Array.isArray(body?.lines) ? body.lines : []
  const round = todo.map(p => {
    const x = sent.find(y => y?.item === p.item)
    return { item: p.item, pull: p.qty, taken: x ? whole(x.taken) ?? 0 : 0, ticked: !!x?.ticked }
  })
  if (round.some(l => !l.ticked)) throw new SubError(400, 'Tick every line when it is on the trailer (change the count if it is not all there).')
  const photos = ids(body?.photos)
  if (!photos.length) throw new SubError(400, 'Take a photo of the loaded trailer.')
  const was = sj.checkout?.at ? sj.checkout : null
  // One line per part: what was taken in every round; `pull` is the pull sheet when last checked out.
  const lines = parts.map(p => {
    const before = (was?.lines ?? []).find((l: Json) => l.item === p.item)
    const now = round.find(r => r.item === p.item)
    return { item: p.item, pull: p.qty, taken: (Number(before?.taken) || 0) + (now?.taken ?? 0) }
  }).filter(l => l.taken > 0 || parts.some(p => p.item === l.item))
  const rounds = [...(was?.rounds ?? (was ? [{ at: was.at, photos: was.photos }] : [])), { at: new Date().toISOString(), photos }]
  const checkout = { at: was?.at ?? new Date().toISOString(), lastAt: new Date().toISOString(), lines, photos: [...(was?.photos ?? []), ...photos], rounds, name: words(body?.name, 120) }
  await prisma.subJob.update({ where: { id: sj.id }, data: { checkout: checkout as Json } })
  // The job's materials left the shop with the sub (Materials: loaded; the pull sheet is pulled).
  await prisma.savedJob.update({ where: { id: sj.jobId }, data: { materialsStatus: 'loaded', pullSheetPulled: true } })
  await event(sj.id, was ? 'Checked out more material at the shop' : 'Checked out at the shop')
  await reflag(sj.id)
}

/** The job report (saved as they go; `submit`: signed off, the office is asked to confirm). */
export async function saveReport(sj: Json, body: Json) {
  if (sj.submittedAt) throw new SubError(409, 'Sent to the office already. Call the office to change it.')
  const was = (sj.report ?? {}) as Json
  const report = {
    startedOn: day(body?.startedOn) ?? was.startedOn ?? null,
    finishedOn: day(body?.finishedOn) ?? was.finishedOn ?? null,
    footage: whole(body?.footage) ?? was.footage ?? null,
    gates: whole(body?.gates) ?? was.gates ?? null,
    problemsFound: body?.problemsFound !== undefined ? words(body.problemsFound) : was.problemsFound ?? '',
    before: body?.before !== undefined ? ids(body.before) : was.before ?? [],
    after: body?.after !== undefined ? ids(body.after) : was.after ?? [],
    signName: body?.signName !== undefined ? words(body.signName, 120) : was.signName ?? '',
    signedOn: day(body?.signedOn) ?? was.signedOn ?? null,
    problems: was.problems ?? [],
  }
  const submit = body?.submit === true
  const today = floridaDay(new Date())
  for (const [k, w] of [['startedOn', 'The day you started'], ['finishedOn', 'The day you finished'], ['signedOn', 'The sign off date']] as const) {
    if (report[k] && report[k]! > today) throw new SubError(400, `${w} is after today. Sign off once the work is done.`)
  }
  if (submit) {
    const missing: string[] = []
    if (!report.startedOn) missing.push('the day you started')
    if (!report.finishedOn) missing.push('the day you finished')
    if (report.footage === null) missing.push('the feet installed')
    if (report.gates === null) missing.push('the gates hung')
    if (!report.after.length) missing.push('after photos')
    if (!report.signName) missing.push('your name to sign off')
    if (!report.signedOn) missing.push('the sign off date')
    if (missing.length) throw new SubError(400, `Fill in ${missing.join(', ')}.`)
    if (report.finishedOn! < report.startedOn!) throw new SubError(400, 'The day you finished is before the day you started.')
  }
  await prisma.subJob.update({ where: { id: sj.id }, data: { report: report as Json, ...(submit ? { submittedAt: new Date() } : {}) } })
  await reflag(sj.id)
  if (submit) {
    await event(sj.id, 'Signed off: installed')
    const job = await prisma.savedJob.findUnique({ where: { id: sj.jobId }, select: { customerName: true } })
    const fresh = await prisma.subJob.findUnique({ where: { id: sj.id }, select: { flags: true } })
    const n = Array.isArray(fresh?.flags) ? (fresh!.flags as Json[]).length : 0
    await ownerPush(sj.accountId, `Installed, confirm: ${job?.customerName ?? 'a job'}`, `${sj.sub?.businessName ?? 'The sub'} signed off the install.${n ? ` ${n} thing${n === 1 ? '' : 's'} do not add up.` : ''} Tap to confirm.`, `/operations?job=${sj.jobId}`, `sub-done-${sj.jobId}`)
  }
}

/** "Report a problem" any time: property damage or a site issue, with photos. The owner gets a push. */
export async function reportProblem(sj: Json, body: Json) {
  const kind = body?.kind === 'damage' ? 'damage' : 'site'
  const text = words(body?.text)
  if (!text) throw new SubError(400, 'Say what happened.')
  const was = (sj.report ?? {}) as Json
  const problems = [...(was.problems ?? []), { at: new Date().toISOString(), kind, text, photos: ids(body?.photos) }]
  await prisma.subJob.update({ where: { id: sj.id }, data: { report: { ...was, problems } as Json } })
  await event(sj.id, kind === 'damage' ? 'Reported property damage' : 'Reported a site issue')
  const job = await prisma.savedJob.findUnique({ where: { id: sj.jobId }, select: { customerName: true } })
  await ownerPush(sj.accountId, `${kind === 'damage' ? 'Property damage' : 'Site issue'}: ${job?.customerName ?? 'a job'}`, `${sj.sub?.businessName ?? 'The sub'}: ${text.slice(0, 140)}`, `/operations?job=${sj.jobId}`, `sub-problem-${sj.jobId}`)
}

/** Check in at the shop: leftovers counted, with a photo; they go into shop stock. */
export async function checkIn(sj: Json, body: Json) {
  if (sj.checkin?.at) throw new SubError(409, 'Checked in already. Call the office to change it.')
  if (!sj.checkout?.at) throw new SubError(409, 'Check out first: nothing left the shop on this link yet.')
  const out: Json[] = sj.checkout.lines ?? []
  const sent: Json[] = Array.isArray(body?.lines) ? body.lines : []
  const lines = out.map(o => ({ item: o.item, back: whole(sent.find(x => x?.item === o.item)?.back) ?? 0 }))
  const photos = ids(body?.photos)
  if (!photos.length) throw new SubError(400, 'Take a photo of what you brought back.')
  const stock = await leftoversToStock(sj.accountId, sj.jobId, lines.filter(l => l.back > 0))
  const checkin = { at: new Date().toISOString(), lines, photos, notInCatalog: stock.missing }
  await prisma.subJob.update({ where: { id: sj.id }, data: { checkin: checkin as Json } })
  await event(sj.id, 'Checked in at the shop')
  await reflag(sj.id)
}

/**
 * Leftovers into shop stock (Inventory): the shop's location (the first yard or warehouse), each part by its
 * name, one transaction each. One write with the version bumped, so an open Inventory screen reloads first.
 */
export async function leftoversToStock(accountId: string, jobId: string, lines: Array<{ item: string; back: number }>): Promise<{ added: number; missing: string[] }> {
  if (!lines.length) return { added: 0, missing: [] }
  return prisma.$transaction(async tx => {
    const inv = await tx.inventoryState.findUnique({ where: { accountId } })
    if (!inv) return { added: 0, missing: lines.map(l => l.item) }
    const items: Json[] = Array.isArray(inv.items) ? inv.items as Json[] : []
    const locations: Json[] = Array.isArray(inv.locations) ? inv.locations as Json[] : []
    const levels: Json[] = Array.isArray(inv.stockLevels) ? [...inv.stockLevels as Json[]] : []
    const txs: Json[] = Array.isArray(inv.transactions) ? [...inv.transactions as Json[]] : []
    const shop = locations.find(l => l?.isActive !== false && (l.type === 'yard' || l.type === 'warehouse')) ?? locations[0] ?? { id: 'loc-yard' }
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
    const missing: string[] = []
    let added = 0
    const now = new Date().toISOString()
    for (const l of lines) {
      const item = items.find(i => i && norm(String(i.name ?? '')) === norm(l.item))
      if (!item) { missing.push(l.item); continue }
      let lvl = levels.find(s => s.itemId === item.id && s.locationId === shop.id)
      if (!lvl) { lvl = { itemId: item.id, locationId: shop.id, quantity: 0, minQuantity: 0, maxQuantity: 0, reorderPoint: 0, reorderQty: 0, lastUpdated: now }; levels.push(lvl) }
      lvl.quantity = Math.round((Number(lvl.quantity) || 0) + l.back) ; lvl.lastUpdated = now
      txs.push({ id: `sub-in-${jobId}-${item.id}-${Date.now().toString(36)}`, itemId: item.id, itemName: item.name, locationId: shop.id, type: 'stock_in', quantityDelta: l.back, quantityAfter: lvl.quantity, referenceId: jobId, referenceType: 'sub_checkin', notes: 'Leftovers checked in by the sub', createdAt: now })
      added++
    }
    await tx.inventoryState.update({ where: { accountId }, data: { stockLevels: levels as Json, transactions: txs as Json, version: { increment: 1 } } })
    return { added, missing }
  })
}

// ── What does not add up ────────────────────────────────────────────────────

/** The job's fence and gates now (with approved change orders). */
async function jobCounts(accountId: string, jobId: string): Promise<{ feet: number; gates: number }> {
  const job = await prisma.savedJob.findUnique({ where: { id: jobId }, select: { quoteId: true } })
  if (!job?.quoteId) return { feet: 0, gates: 0 }
  const { workNow } = await import('./changeOrderWork.js')
  const { work } = await workNow(accountId, job.quoteId).catch(() => ({ work: null }))
  const w = (work ?? {}) as Json
  const runs = Array.isArray(w.runs) ? w.runs.map((r: Json) => Number(typeof r === 'object' && r ? r.ft : r) || 0) : []
  return { feet: Math.round(runs.reduce((t: number, f: number) => t + (f > 0 ? f : 0), 0)), gates: (Number(w.walkGates) || 0) + (Number(w.dblGates) || 0) }
}

export interface Flag { key: string; text: string }

/** The flags for a sub's job from what they reported (pure; `parts`: the pull sheet). */
export function flagsOf(sj: { checkout?: Json; report?: Json; checkin?: Json }, counts: { feet: number; gates: number }, parts: SheetLine[]): Flag[] {
  const out: Flag[] = []
  const r = sj.report ?? {}
  if (typeof r.footage === 'number' && counts.feet > 0 && Math.abs(r.footage - counts.feet) > Math.max(3, counts.feet * 0.03)) {
    out.push({ key: 'footage', text: `Footage: the sub says ${r.footage} ft installed; the job is ${counts.feet} ft.` })
  }
  if (typeof r.gates === 'number' && r.gates !== counts.gates) out.push({ key: 'gates', text: `Gates: the sub says ${r.gates} hung; the job has ${counts.gates}.` })
  const out_: Json[] = sj.checkout?.lines ?? []
  // Out of the shop against the job's pull sheet now (a change order may have changed it).
  for (const o of out_) {
    const need = parts.find(p => p.item === o.item)?.qty ?? 0
    if (!sj.checkin?.lines && o.taken !== need) out.push({ key: `short:${o.item}`, text: `${o.item}: ${o.taken} left the shop; the pull sheet is ${need}.` })
  }
  if (sj.checkin?.lines) {
    // Used = out − returned; it should be what the pull sheet says the job takes.
    for (const o of out_) {
      const back = Number((sj.checkin.lines as Json[]).find(x => x.item === o.item)?.back) || 0
      const need = parts.find(p => p.item === o.item)?.qty ?? 0
      const used = o.taken - back
      if (used !== need) out.push({ key: `material:${o.item}`, text: `${o.item}: ${o.taken} out − ${back} back = ${used} used; the pull sheet is ${need} (${used > need ? `${used - need} more` : `${need - used} fewer`}).` })
    }
    for (const m of sj.checkin.notInCatalog ?? []) out.push({ key: `catalog:${m}`, text: `${m}: brought back, but no part of that name in Inventory; count it in by hand.` })
  }
  return out
}

async function reflag(sjId: string) {
  const sj = await prisma.subJob.findUnique({ where: { id: sjId } })
  if (!sj) return
  const [counts, parts] = await Promise.all([jobCounts(sj.accountId, sj.jobId), partsOf(sj.accountId, sj.jobId)])
  await prisma.subJob.update({ where: { id: sj.id }, data: { flags: flagsOf(sj as Json, counts, parts) as Json } })
}

// ── The owner's one tap ─────────────────────────────────────────────────────

/** "Installed, confirm": the job moves to Complete, with its final furnishing date (the sub's finish day, editable). */
export async function confirmInstalled(accountId: string, jobId: string, by: { userId: string; name: string }, finalFurnishingDate: Ymd | null) {
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId } })
  if (!sj?.submittedAt) throw new SubError(409, 'The sub has not signed off this job yet.')
  const finished = finalFurnishingDate ?? (sj.report as Json)?.finishedOn ?? floridaDay(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(finished)) throw new SubError(400, 'Pick the final furnishing date.')
  // The last day work was done: never a day still to come (it starts the lien and warranty clocks).
  if (finished > floridaDay(new Date())) throw new SubError(400, 'The final furnishing date is after today. Confirm once the work is done.')
  const { loadOpsStages } = await import('./opsStages.js')
  const { fieldsForStage, stageById, firstStageFor } = await import('./opsStageModel.js')
  const { checkJobMove } = await import('./automations/stageRules.js')
  const { recordJobChanges } = await import('./automations/hooks.js')
  const existing = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!existing) throw new SubError(404, 'That job is not there any more.')
  const { stages } = await loadOpsStages(accountId)
  const target = stageById(stages, 'completed') ? 'completed' : firstStageFor(stages, 'completed')
  const stageFields = target ? fieldsForStage(stages, target, existing as Json, finished, { stageOnly: true }) ?? {} : {}
  const update: Json = { ...stageFields, ...(target ? { opsStage: target } : {}), completedDate: finished, finalFurnishingDate: finished }
  const blocked = await checkJobMove(accountId, existing, { ...existing, ...update })
  if (blocked) throw new SubError(409, `${blocked.name} cannot move to ${blocked.to} yet. Missing: ${blocked.missing.map((x: Json) => x.label.toLowerCase()).join(', ')}.`)
  await prisma.$transaction(async tx => {
    const row = await tx.savedJob.update({ where: { id: jobId }, data: update })
    await recordJobChanges(accountId, existing, row, tx)
    await tx.subJob.update({ where: { id: sj.id }, data: { confirmedAt: new Date(), confirmedBy: by.name } })
  })
  await event(sj.id, `Installed, confirmed by ${by.name}; final furnishing date ${finished}`)
  // Paid in full before the install was confirmed: ready to pay the sub now.
  await (await import('./paymentClearing.js')).checkReadyToPaySub(accountId, jobId).catch(e => console.error('[sub link] ready to pay:', e))
  return { finalFurnishingDate: finished }
}

async function ownerPush(accountId: string, title: string, body: string, url: string, tag: string) {
  const { sendPush } = await import('./automations/push.js')
  await sendPush(accountId, { title, body, url, tag }).catch(e => console.error('[sub link] push:', e))
}
