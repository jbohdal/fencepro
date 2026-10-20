/**
 * What each automation step does, and what it would do (dry run).
 *
 * Every side effect is done once per run and step: the key "<runId>:<step>"
 * goes in the AutomationEffect ledger in the same transaction as a task, a
 * notification, an invoice or a checklist, so a worker that stopped after
 * making the task but before noting the step done finds it there and does not
 * make a second one. Email and push cannot be in a database transaction: the
 * ledger notes "sending" first, and a step found still "sending" after a stop
 * is not sent again by itself (Jonathan checks and presses Run again).
 */

import prisma from '../prisma.js'
import { storeFile } from '../storage/index.js'
import { applyPipelineDelta } from '../pipelineDelta.js'
import { fillTemplate, floridaDay, proposalLinkFor, loadLeads, opsStageName, type EntityContext } from './context.js'
import { loadOpsStages } from '../opsStages.js'
import { fieldsForStage, stageOfJob } from '../opsStageModel.js'
import { PermanentStepError, type Step } from './types.js'
import { checkJobMove, checkPipelineMoves } from './stageRules.js'
import { recordCardMoves, recordJobChanges } from './hooks.js'
import { emailSenderFor, GMAIL_NOT_CONNECTED, gmailStatus } from './gmail.js'
import { sendPush } from './push.js'
import { plainStyleName } from '../estimates.js'
import { walkthroughApi, WALKTHROUGH_MISSING } from './walkthroughAdapter.js'
import { ensurePermit, packetInputFor, portalFor, renderPacket } from './permits.js'

export interface StepRun {
  accountId: string
  runId: string
  ruleId: string
  ruleName: string
  stepIndex: number
  step: Step
  entity: EntityContext
  now: Date
}
export interface StepOutcome { detail: string; link?: string }

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const effectKey = (r: StepRun, part = '') => `${r.runId}:${r.stepIndex}${part ? ':' + part : ''}`

/** Do a database side effect once: it and its ledger row are saved together. */
async function onceInDb<T>(key: string, runId: string, fn: (tx: Tx) => Promise<T>): Promise<{ result: T; already: boolean }> {
  return prisma.$transaction(async tx => {
    const had = await tx.automationEffect.findUnique({ where: { key } })
    if (had) return { result: had.result as T, already: true }
    const result = await fn(tx)
    await tx.automationEffect.create({ data: { key, runId, status: 'done', result: (result ?? null) as any } })
    return { result, already: false }
  })
}

/** Do an outside side effect (email, push, webhook) at most once by itself. */
async function onceOutside<T>(key: string, runId: string, fn: () => Promise<T>, unsure: string): Promise<{ result: T; already: boolean }> {
  const had = await prisma.automationEffect.findUnique({ where: { key } })
  if (had?.status === 'done') return { result: had.result as T, already: true }
  if (had?.status === 'sending') throw new PermanentStepError(unsure)
  await prisma.automationEffect.create({ data: { key, runId, status: 'sending' } })
  let result: T
  try {
    result = await fn()
  } catch (err) {
    // It did not go: forget the "sending" note so the next try sends it.
    await prisma.automationEffect.deleteMany({ where: { key, status: 'sending' } })
    throw err
  }
  await prisma.automationEffect.update({ where: { key }, data: { status: 'done', result: (result ?? null) as any } })
  return { result, already: false }
}

const entityLink = (e: EntityContext) => e.board === 'sales' ? `/pipeline?card=${encodeURIComponent(e.entityId)}` : `/operations?job=${encodeURIComponent(e.entityId)}`
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
/** sms: link with the text filled in; "?&body=" opens with the text on both iPhone and Android. */
export function smsLink(phone: string, body: string): string {
  const digits = phone.replace(/[^\d+]/g, '')
  return `sms:${digits}?&body=${encodeURIComponent(body)}`
}

async function makeTask(r: StepRun, part: string, t: { title: string; description: string; assignTo: string; dueInDays: number }) {
  const { result, already } = await onceInDb(effectKey(r, part), r.runId, async tx => {
    const task = await tx.task.create({
      data: {
        title: t.title.slice(0, 200), description: t.description.slice(0, 4000), assignedTo: t.assignTo || null,
        jobId: r.entity.job?.id ?? (r.entity.board === 'sales' ? r.entity.entityId : null), jobName: r.entity.name,
        dueDate: addDays(r.now, t.dueInDays), createdBy: `automation:${r.runId}:${r.stepIndex}`, automationId: r.ruleId,
        priority: 'normal',
      },
    })
    return { taskId: task.id }
  })
  return { taskId: (result as any)?.taskId as string, already }
}

async function bell(r: StepRun, part: string, title: string, body: string, link: string) {
  return onceInDb(effectKey(r, part), r.runId, async tx => {
    const n = await tx.notification.create({ data: { title: title.slice(0, 200), body: body.slice(0, 1000), type: 'automation', link, jobId: r.entity.job?.id ?? null } })
    return { notificationId: n.id }
  })
}

async function pushOnce(r: StepRun, part: string, title: string, body: string, url: string) {
  const { result } = await onceOutside(effectKey(r, part), r.runId, async () => {
    const p = await sendPush(r.accountId, { title, body, url, tag: r.runId })
    if (p.subscribers > 0 && p.sent === 0 && p.failed > 0) throw new Error(`Push could not be delivered: ${p.errors[0] ?? 'unknown error'}`)
    return p
  }, 'The push may already have gone out when the app stopped. Press Run again to send it anyway.')
  const p = result as any
  return p?.subscribers ? `push sent to ${p.sent} phone${p.sent === 1 ? '' : 's'}` : 'no phone has push turned on yet (Automations, Turn on push)'
}

async function email(r: StepRun, subject: string, body: string): Promise<StepOutcome> {
  if (!r.entity.email.includes('@')) throw new PermanentStepError(`${r.entity.name} has no email address on file.`)
  const sender = await emailSenderFor(r.accountId) // GmailNotConnectedError: retried, then reported
  const { result, already } = await onceOutside(effectKey(r, 'email'), r.runId, async () => {
    const sent = await sender.send({ to: r.entity.email, subject, text: body, messageId: `${r.runId}.${r.stepIndex}@ezbiz.automations` })
    return { gmailId: sent.id, to: r.entity.email }
  }, `This email may already have been sent when the app stopped. Check Gmail's Sent folder for "${subject}" to ${r.entity.email}; press Run again only if it is not there.`)
  return { detail: `${already ? 'already emailed' : 'emailed'} ${(result as any)?.to ?? r.entity.email}: "${subject}"` }
}

async function preparedText(r: StepRun, part: string, body: string, assignTo: string): Promise<StepOutcome> {
  if (!r.entity.phone) throw new PermanentStepError(`${r.entity.name} has no phone number on file, so there is no text to prepare.`)
  const link = smsLink(r.entity.phone, body)
  await makeTask(r, part, { title: `Text ${r.entity.name}`, description: `${body}\n\nTap to send from your phone: ${link}`, assignTo, dueInDays: 0 })
  await bell(r, `${part}:bell`, `Text ready for ${r.entity.name}`, body, entityLink(r.entity))
  return { detail: `text prepared for ${r.entity.phone} (tap to send from the task)`, link }
}

// ── Business record (invoices, checklists): versioned saves, tried again if a browser saved in between ──

async function updateBusiness(accountId: string, key: string, runId: string, change: (cur: any) => Record<string, unknown> | null): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const had = await prisma.automationEffect.findUnique({ where: { key } })
    if (had) return had.result
    const cur = await prisma.businessState.findUnique({ where: { accountId } })
    if (!cur) throw new Error('The business record is not set up yet.')
    const data = change(cur)
    if (!data) return null
    try {
      return await prisma.$transaction(async tx => {
        const done = await tx.businessState.updateMany({ where: { accountId, version: cur.version }, data: { ...data, version: { increment: 1 } } as any })
        if (done.count === 0) throw Object.assign(new Error('stale'), { stale: true })
        const result = { saved: Object.keys(data) }
        await tx.automationEffect.create({ data: { key, runId, status: 'done', result } })
        return result
      })
    } catch (err) {
      if ((err as any)?.stale) continue
      throw err
    }
  }
  throw new Error('The business record kept changing while this step tried to save; it will try again.')
}

// ── Steps ────────────────────────────────────────────────────────────────────

export async function runStep(r: StepRun): Promise<StepOutcome> {
  const s = r.step
  const e = r.entity
  const fill = (t: string) => fillTemplate(t, e, { 'permit portal': portalFor(e.permit?.county || e.county || 'Marion')?.url ?? '' })
  switch (s.type) {
    case 'create_task': {
      const t = await makeTask(r, 'task', { title: fill(s.title), description: fill(s.description), assignTo: fill(s.assignTo), dueInDays: s.dueInDays })
      return { detail: `${t.already ? 'task was already made' : 'task made'}: "${fill(s.title)}"${s.assignTo ? ` for ${fill(s.assignTo) || 'anyone'}` : ''}, due ${floridaDay(addDays(r.now, s.dueInDays))}` }
    }
    case 'notify': {
      const title = fill(s.title), body = fill(s.body)
      await bell(r, 'bell', title, body, entityLink(e))
      const pushed = s.push ? await pushOnce(r, 'push', title, body, entityLink(e)) : 'no push (switched off for this step)'
      return { detail: `notification "${title}"; ${pushed}` }
    }
    case 'email_customer':
      return email(r, fill(s.subject), fill(s.body))
    case 'prepare_text':
      return preparedText(r, 'text', fill(s.body), fill(s.assignTo))
    case 'move_card':
      return moveCard(r, s.stage)
    case 'add_checklist': {
      const jobId = e.job?.id
      if (!jobId) throw new PermanentStepError('There is no job for this card yet, so there is no checklist to add to.')
      const items = s.items.map(fill)
      await updateBusiness(r.accountId, effectKey(r, 'checklist'), r.runId, cur => {
        const map = { ...((cur.jobChecklists as Record<string, any[]>) ?? {}) }
        const list = Array.isArray(map[jobId]) ? [...map[jobId]] : []
        const at = new Date().toISOString()
        items.forEach((label, n) => {
          const id = `auto-${r.runId.slice(0, 8)}-${r.stepIndex}-${n}`
          if (!list.some(i => i?.id === id)) list.push({ id, jobId, label, isComplete: false, sortOrder: list.length, createdAt: at, updatedAt: at })
        })
        map[jobId] = list
        return { jobChecklists: map }
      })
      return { detail: `checklist items added to the job: ${items.join(', ')}` }
    }
    case 'request_signature': {
      let link = ''
      if (s.what === 'walkthrough') {
        if (!e.job) throw new PermanentStepError('There is no job for this card yet, so there is no walkthrough to sign.')
        const api = await walkthroughApi()
        if (!api) throw new PermanentStepError(WALKTHROUGH_MISSING)
        const w: any = await api.startWalkthrough(r.accountId, e.job.id, 'automation')
        link = String(w?.signUrl || w?.url || w?.link || '')
        if (!link && w?.id && api.issueLink) link = proposalLinkFor((await api.issueLink(r.accountId, String(w.id))).token).replace(/\/p\//, '/p/w/')
        if (!link) throw new PermanentStepError('The walkthrough started, but it has no signing link for the customer.')
      } else {
        link = e.proposalLink
        if (!link) throw new PermanentStepError('This customer has no proposal link yet. Send the proposal from the quote first.')
      }
      const what = s.what === 'walkthrough' ? 'final walkthrough' : 'proposal'
      const body = `Hi ${e.firstName || 'there'}, here is your ${what} from Getter Done Fence to review and sign: ${link}`
      if (s.via === 'email') return email(r, `Please sign your ${what}`, body)
      return preparedText(r, 'text', body, '')
    }
    case 'start_walkthrough': {
      if (!e.job) throw new PermanentStepError('There is no job for this card yet, so a walkthrough cannot be started.')
      const api = await walkthroughApi()
      if (!api) throw new PermanentStepError(WALKTHROUGH_MISSING)
      const { already } = await onceInDb(effectKey(r, 'walkthrough'), r.runId, async () => {
        const w: any = await api.startWalkthrough(r.accountId, e.job.id, 'automation')
        return { walkthroughId: w?.id ?? null }
      })
      return { detail: already ? 'the walkthrough was already started' : 'final walkthrough started for the job' }
    }
    case 'final_invoice':
      return finalInvoice(r, s.dueInDays)
    case 'permit_packet':
      return permitPacket(r, fill(s.assignTo))
    case 'webhook':
      return webhook(r, s.url)
    case 'wait':
      return { detail: 'waited' }
  }
}

async function moveCard(r: StepRun, stage: string): Promise<StepOutcome> {
  const e = r.entity
  if (e.board === 'sales') {
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await prisma.pipelineState.findUnique({ where: { accountId: r.accountId } })
      const leads = ((state?.leads as any[]) ?? [])
      const card = leads.find(l => l?.id === e.entityId)
      if (!state || !card) throw new PermanentStepError('The card is not on the pipeline any more.')
      if (card.stage === stage) return { detail: `the card is in ${stage}` }
      const lead = { ...card, stage, lastMoved: floridaDay(r.now) }
      const next = applyPipelineDelta({ leads, stages: (state.stages as any[]) ?? [] }, { upsert: [{ lead }], remove: [] })
      const blocked = await checkPipelineMoves(r.accountId, leads, next.leads)
      if (blocked.length) throw new PermanentStepError(`Cannot move to ${stage}: ${blocked[0].missing.map(m => m.detail).join(' ')}`)
      const ok = await prisma.$transaction(async tx => {
        const done = await tx.pipelineState.updateMany({ where: { accountId: r.accountId, version: state.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
        if (done.count === 0) return false
        await recordCardMoves(r.accountId, leads, next.leads, state.version + 1, tx)
        return true
      })
      if (ok) return { detail: `moved the card from ${card.stage} to ${stage}` }
    }
    throw new Error('The pipeline kept changing while the card was being moved; it will try again.')
  }
  const job = await prisma.savedJob.findFirst({ where: { id: e.entityId, accountId: r.accountId, archivedAt: null } })
  if (!job) throw new PermanentStepError('The job is not there any more.')
  // By stage id, in the company's list (Settings > Operations Stages).
  const { stages } = await loadOpsStages(r.accountId)
  const fields = fieldsForStage(stages, stage, job, floridaDay(r.now))
  if (!fields) throw new PermanentStepError(`"${stage}" is not one of the Operations stages (Settings > Operations Stages).`)
  if (stageOfJob(stages, job) === stage) return { detail: `the job is in ${opsStageName(stages, stage)}` }
  const blocked = await checkJobMove(r.accountId, job, { ...job, ...fields })
  if (blocked) throw new PermanentStepError(`Cannot move to ${blocked.to}: ${blocked.missing.map(m => m.detail).join(' ')}`)
  await prisma.$transaction(async tx => {
    const updated = await tx.savedJob.update({ where: { id: job.id }, data: fields as any })
    await recordJobChanges(r.accountId, job, updated, tx)
  })
  return { detail: `moved the job to ${opsStageName(stages, stage)}` }
}

async function finalInvoice(r: StepRun, dueInDays: number): Promise<StepOutcome> {
  const job = r.entity.job
  if (!job) throw new PermanentStepError('There is no job for this card yet, so there is nothing to invoice.')
  // The contract value already holds the approved change orders (quote price + change orders, lib/changeOrders.ts).
  const totalCents = Math.round(Number(job.contractValue || 0) * 100) || (Math.round(Number(job.quotePrice || 0) * 100) + Math.round(Number(job.changeOrderTotal || 0) * 100))
  const paidCents = Math.round(Number(job.amountPaid || 0) * 100)
  const balance = totalCents - paidCents
  if (totalCents <= 0) throw new PermanentStepError('The job has no contract price, so the final invoice cannot be made.')
  const id = `auto-${r.runId.slice(0, 8)}-${r.stepIndex}`
  let number = ''
  const styleText = await plainStyleName(job.fenceStyle)
  await updateBusiness(r.accountId, effectKey(r, 'invoice'), r.runId, cur => {
    const list = Array.isArray(cur.invoices) ? [...(cur.invoices as any[])] : []
    if (list.some(i => i?.id === id)) return null
    const max = list.reduce((m, i) => Math.max(m, parseInt(String(i?.invoiceNumber || '').replace('INV-', '')) || 0), 1000)
    number = `INV-${max + 1}`
    const at = new Date().toISOString()
    const today = floridaDay(r.now)
    list.unshift({
      id, customerId: job.crmContactId ?? '', customerName: job.customerName, jobId: job.id, jobName: job.customerName,
      invoiceNumber: number, title: `Final invoice: ${styleText || 'fence installation'}`, status: 'draft',
      lineItems: [{ id: `${id}-1`, description: `Fence installation balance (${styleText || 'fence'})`, quantity: 1, unitPriceCents: totalCents, totalCents, sortOrder: 0 }],
      subtotalCents: totalCents, taxRate: 0, taxCents: 0, discountCents: 0, totalCents, amountPaidCents: paidCents, balanceDueCents: balance,
      dueDate: floridaDay(addDays(r.now, dueInDays)), issuedDate: today, notes: 'Made by an automation after the final walkthrough was signed. Check it and send it from Billing.',
      createdBy: 'automation', createdAt: at, updatedAt: at,
    })
    return { invoices: list }
  })
  return { detail: `draft final invoice ${number || id} for $${(balance / 100).toFixed(2)} balance (in Billing, not sent)` }
}

async function permitPacket(r: StepRun, assignTo: string): Promise<StepOutcome> {
  const job = r.entity.job
  if (!job) throw new PermanentStepError('There is no job for this card yet, so there is no permit packet to make.')
  await ensurePermit(r.accountId, job.id)
  const { result } = await onceInDb(effectKey(r, 'packet'), r.runId, async () => {
    const pdf = await renderPacket(await packetInputFor(r.accountId, job.id))
    const stored = storeFile(pdf, `permit-packet-${job.id}.pdf`, r.accountId)
    return { storagePath: stored.storagePath, bytes: pdf.length }
  })
  const portal = portalFor(r.entity.permit?.county || r.entity.county || 'Marion')
  const fileLink = `/api/automations/runs/${r.runId}/files/${r.stepIndex}`
  await makeTask(r, 'task', {
    title: `File the fence permit for ${r.entity.name}`,
    description: [
      `Permit packet: ${fileLink}`,
      portal ? `County permit portal (${portal.name}): ${portal.url}` : 'No online permit portal is known for this county yet.',
      portal?.note ?? '',
      'Set the permit to Applied, then Approved, on the job\'s Permit panel. Reminders come until it is Approved.',
    ].filter(Boolean).join('\n'),
    assignTo, dueInDays: 1,
  })
  return { detail: `permit packet made (${Math.round(((result as any)?.bytes ?? 0) / 1024)} KB) and a task to file it${portal ? ` on ${portal.name}` : ''}`, link: fileLink }
}

async function webhook(r: StepRun, url: string): Promise<StepOutcome> {
  const key = effectKey(r, 'webhook')
  const had = await prisma.automationEffect.findUnique({ where: { key } })
  if (had?.status === 'done') return { detail: `already posted to ${new URL(url).host}` }
  const e = r.entity
  const body = {
    rule: { id: r.ruleId, name: r.ruleName }, run: r.runId, step: r.stepIndex, at: r.now.toISOString(),
    board: e.board, entity: { kind: e.entityKind, id: e.entityId }, stage: e.stageLabel,
    customer: { name: e.name, firstName: e.firstName, lastName: e.lastName, email: e.email, phone: e.phone, address: e.address, city: e.city, county: e.county },
    job: e.job ? { id: e.job.id, style: e.style, priceCents: e.priceCents, installDate: e.installDate } : null,
  }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 10_000)
  try {
    // The same key on every try: a receiver that already has it can ignore the repeat.
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'User-Agent': 'EZBiz-Automations/1' }, body: JSON.stringify(body), signal: ctl.signal })
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  } catch (err) {
    const m = String((err as Error)?.message || err)
    throw new Error(/abort/i.test(m) ? `${new URL(url).host} did not answer within 10 seconds` : m.slice(0, 200))
  } finally { clearTimeout(t) }
  await prisma.automationEffect.upsert({ where: { key }, create: { key, runId: r.runId, status: 'done', result: { url } }, update: { status: 'done' } })
  return { detail: `posted to ${new URL(url).host}` }
}

// ── Dry run: what each step would do, without doing it ──────────────────────

export interface DryStep { index: number; type: Step['type']; would: string; warning?: string }

export async function describeSteps(accountId: string, steps: Step[], e: EntityContext, now: Date): Promise<DryStep[]> {
  const fill = (t: string) => fillTemplate(t, e, { 'permit portal': portalFor(e.permit?.county || e.county || 'Marion')?.url ?? '' })
  const gmail = await gmailStatus(accountId)
  const out: DryStep[] = []
  let at = now
  for (const [index, s] of steps.entries()) {
    const d = (would: string, warning?: string) => out.push({ index, type: s.type, would, ...(warning ? { warning } : {}) })
    switch (s.type) {
      case 'wait': at = new Date(at.getTime() + s.minutes * 60_000); d(`wait until ${at.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`); break
      case 'create_task': d(`make a task "${fill(s.title)}"${fill(s.assignTo) ? ` for ${fill(s.assignTo)}` : ''}, due ${floridaDay(addDays(at, s.dueInDays))}`); break
      case 'notify': d(`notify: "${fill(s.title)}"${s.body ? ` - ${fill(s.body)}` : ''}${s.push ? ' (and push to your phone)' : ''}`); break
      case 'email_customer': d(`email ${e.email || '(no email on file)'}: "${fill(s.subject)}"\n${fill(s.body)}`, !e.email.includes('@') ? 'This customer has no email address; the step would fail.' : !gmail.connected ? GMAIL_NOT_CONNECTED : undefined); break
      case 'prepare_text': d(`prepare a text to ${e.phone || '(no phone on file)'}: "${fill(s.body)}"`, e.phone ? undefined : 'No phone number on file; the step would fail.'); break
      case 'move_card': {
        let warning: string | undefined
        let toName = s.stage
        if (e.board === 'sales') {
          const { leads } = await loadLeads(accountId)
          const blocked = await checkPipelineMoves(accountId, leads, leads.map(l => l?.id === e.entityId ? { ...l, stage: s.stage } : l))
          if (blocked.length) warning = `A stage rule would block it: ${blocked[0].missing.map(m => m.label).join(', ')}`
        } else if (e.job) {
          const { stages } = await loadOpsStages(accountId)
          toName = opsStageName(stages, s.stage)
          const fields = fieldsForStage(stages, s.stage, e.job, floridaDay(now))
          const blocked = fields ? await checkJobMove(accountId, e.job, { ...e.job, ...fields }) : null
          if (!fields) warning = `"${s.stage}" is not one of the Operations stages; the step would fail.`
          if (blocked) warning = `A stage rule would block it: ${blocked.missing.map(m => m.label).join(', ')}`
        }
        d(`move the ${e.board === 'sales' ? 'card' : 'job'} from ${e.stageLabel} to ${toName}`, warning)
        break
      }
      case 'add_checklist': d(`add to the job checklist: ${s.items.map(fill).join(', ')}`, e.job ? undefined : 'No job for this card yet; the step would fail.'); break
      case 'request_signature': d(`send the ${s.what === 'walkthrough' ? 'final walkthrough' : 'proposal'} signing link by ${s.via === 'text' ? 'a prepared text' : 'email'}`, s.what === 'proposal' && !e.proposalLink ? 'No proposal link yet.' : s.via === 'email' && !gmail.connected ? GMAIL_NOT_CONNECTED : undefined); break
      case 'start_walkthrough': d('start the final walkthrough for the job', !e.job ? 'No job for this card yet.' : !(await walkthroughApi()) ? WALKTHROUGH_MISSING : undefined); break
      case 'final_invoice': {
        const total = e.job ? Math.round(Number(e.job.contractValue || 0) * 100) - Math.round(Number(e.job.amountPaid || 0) * 100) : 0
        d(`make a draft final invoice for $${(total / 100).toFixed(2)} (not sent)`, e.job ? undefined : 'No job for this card yet.')
        break
      }
      case 'permit_packet': {
        const portal = portalFor(e.permit?.county || e.county || 'Marion')
        d(`make the permit packet PDF and a task to file it${portal ? ` on ${portal.name} (${portal.url})` : ''}`, e.job ? undefined : 'No job for this card yet.')
        break
      }
      case 'webhook': d(`POST the card's details as JSON to ${s.url}`); break
    }
  }
  return out
}
