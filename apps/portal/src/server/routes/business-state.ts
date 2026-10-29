/**
 * Business state — singleton per account.
 *
 * Catch all for Phase 8 + 9 config: bundles, quote options, contract
 * sections, job checklists, default milestones, P&L entries, balance
 * sheet entries, cash flow manual lines, automations, email templates,
 * settings, company config, budget.
 *
 * Each sub field is a JSON document. The client patches by sending the
 * partial fields it wants to update; the server merges shallow.
 *
 * The Salesman (lib/salesScopeRecords.ts; Jonathan, Oct 28 2026): every answer
 * leaves out the invoices, payments, statements, pull sheets, Sales Orders,
 * purchase orders and job milestones of other people's customers, jobs and
 * quotes; a save from the Salesman has each of those put back exactly as
 * stored first, and one that adds or changes an entry outside the Salesman's
 * scope is refused (404).
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { findOrCreate, isUniqueViolation } from '../lib/once.js'
import { normalizeBusinessField } from '../lib/seeds.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { recordNewPayments } from '../lib/automations/hooks.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { businessPatchRefusal, refuse, roleOf } from '../lib/permissions.js'
import { hidesCosts, hidesPrices, hideFor, restoreCosts } from '../lib/costRedact.js'
import { auditSettingChange } from '../lib/settingsAudit.js'
import { closeTasksSoon } from '../lib/taskAutoClose.js'
import { materialsFollowOrders } from '../lib/materialsFromOrders.js'
import { salesScopeOf, salesScope, forgetScope, type SalesScope } from '../lib/salesScope.js'
import { salesBusinessView, salesBusinessPatch, OutsideScopeError } from '../lib/salesScopeRecords.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
  next()
}

router.use(requireUser, requireAccount)

/** For the Salesman: every answer's record (the saved one, a 409's newer one, a refusal's) as the Salesman reads it. */
async function salesmanAnswers(req: any, res: any): Promise<{ scope: SalesScope } | null> {
  const scope = await salesScopeOf(req)
  if (!scope) return null
  const held = { scope }
  const json = res.json.bind(res)
  res.json = (body: any) => json(body && typeof body === 'object' && body.data && typeof body.data === 'object' ? { ...body, data: salesBusinessView(held.scope, body.data) } : body)
  return held
}

const fields = [
  'bundles', 'quoteOptions', 'contractSections', 'jobChecklists', 'defaultMilestones',
  'plEntries', 'balanceSheet', 'cashFlowManual', 'automations',
  'emailTemplates', 'settings', 'config', 'budget', 'pendingOrders', 'purchaseOrders',
  'invoices', 'payments', 'statements', 'pullSheets',
] as const

/** The parts of the record that are settings, not the books (those have their own history). */
const SETTINGS_FIELDS = ['bundles', 'quoteOptions', 'contractSections', 'jobChecklists', 'defaultMilestones', 'automations', 'emailTemplates', 'settings', 'config', 'budget'] as const

const patchSchema = z.object(Object.fromEntries(fields.map(f => [f, z.any().optional()])))

/**
 * Parts a browser may ask to be left out of the answer (`?omit=jobChecklists,pendingOrders`),
 * for the phone (audit #17, Oct 27 2026: this answer was 3.9 MB on every page load, two
 * thirds of it every job's milestone list). The job checklists are read with the job
 * (/api/saved-jobs/:id/milestones, lib/jobTruth.ts), the Sales Orders when Inventory >
 * Sales Orders opens (web businessStateStore.ts needBusinessFields). Saving is unchanged:
 * a patch still sends only the parts it changes, and a part left out is never sent.
 */
export const OMITTABLE = new Set<string>(['jobChecklists', 'pendingOrders'])
export function omittedParts(query: unknown): Set<string> {
  const raw = (query as { omit?: unknown } | null | undefined)?.omit
  const words = (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === 'string').flatMap(x => x.split(','))
  return new Set(words.map(w => w.trim()).filter(w => OMITTABLE.has(w)))
}
/** The record without the parts asked to be left out (a copy; the record itself is untouched). */
export function leanState<T>(s: T, omit: Set<string>): T {
  if (!s || typeof s !== 'object' || omit.size === 0) return s
  const out = { ...(s as Record<string, unknown>) }
  for (const k of omit) delete out[k]
  return out as T
}

router.get('/', async (req: any, res) => {
  try {
    await salesmanAnswers(req, res)
    const accountId = req.user.crmAccountId
    const s = await findOrCreate(
      () => prisma.businessState.findUnique({ where: { accountId } }),
      () => prisma.businessState.create({ data: { accountId } }),
    )
    res.json({ success: true, data: leanState(s, omittedParts(req.query)) })
  } catch (err) {
    console.error('[business-state] get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load business state' })
  }
})

router.patch('/', async (req: any, res) => {
  try {
    const salesman = await salesmanAnswers(req, res)
    const data = patchSchema.parse(req.body)
    const updateData: any = {}
    for (const f of fields) {
      // Lists keep one entry per id; job checklists one item per milestone (see lib/seeds).
      if (data[f] !== undefined) updateData[f] = normalizeBusinessField(f, JSON.parse(JSON.stringify(data[f])))
    }
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    const omit = omittedParts(req.query)
    // Settings, prices and the books are for the owner, admin and manager; each key is checked on its own.
    const saved = await prisma.businessState.findUnique({ where: { accountId } })
    if (salesman) {
      // The Salesman's copy left out other people's entries: they are put back as stored before anything else.
      try { Object.assign(updateData, salesBusinessPatch(salesman.scope, saved as any, updateData)) } catch (e) {
        if (!(e instanceof OutsideScopeError)) throw e
        // Maybe a customer, quote or job made a moment ago: read the scope again once before refusing.
        forgetScope(salesman.scope.userId)
        const again = await salesScope(salesman.scope.userId, salesman.scope.accountId)
        if (again) salesman.scope = again
        try { if (!again) throw e; Object.assign(updateData, salesBusinessPatch(again, saved as any, updateData)) } catch (e2) {
          if (!(e2 instanceof OutsideScopeError)) throw e2
          res.status(404).json({ success: false, error: 'Not found' }); return
        }
      }
    }
    // A Salesman or Installer never had the costs (lib/costRedact.ts): the ones their
    // phone left out are put back as saved; a cost or the books sent is refused below.
    if (hidesCosts(roleOf(req)) || hidesPrices(roleOf(req))) {
      for (const k of Object.keys(updateData)) updateData[k] = restoreCosts(updateData[k], (saved as any)?.[k], hideFor(roleOf(req)))
    }
    const refused = businessPatchRefusal(roleOf(req), req.user.id ?? null, saved as any, updateData)
    if (refused) { refuse(res, refused, { data: leanState(saved, omit), version: saved?.version ?? 0 }); return }
    // One version covers the whole record, so a patch built on an older copy
    // is refused even when it touches a different field; the browser merges.
    // Payments recorded in Billing become "payment received" automation events, saved in the same step.
    const prev = updateData.payments !== undefined ? await prisma.businessState.findUnique({ where: { accountId }, select: { payments: true, invoices: true } }) : null
    const done = await prisma.$transaction(async tx => {
      const d = await tx.businessState.updateMany({ where: { accountId, version: base }, data: { ...updateData, version: { increment: 1 } } })
      if (d.count && prev) await recordNewPayments(accountId, prev.payments, updateData.payments, updateData.invoices ?? prev.invoices, tx)
      return d
    })
    if (done.count === 0) {
      const current = await prisma.businessState.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, leanState(current, omit), current?.version ?? 0); return }
      try { await prisma.businessState.create({ data: { accountId, ...updateData } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.businessState.findUnique({ where: { accountId } })
        refuseStale(res, leanState(now, omit), now?.version ?? 0); return
      }
    }
    const s = (await prisma.businessState.findUnique({ where: { accountId } }))!
    if (updateData.pendingOrders !== undefined) {
      // A Sales Order marked Ordered or Received: its job's materials follow, never backward (lib/materialsFromOrders.ts),
      // saved before the answer so this browser's next read of the jobs has it.
      await materialsFollowOrders(accountId, (saved as any)?.pendingOrders ?? [], s.pendingOrders, { by: `Sales Order, ${req.user.email ?? 'staff'}` })
        .catch(e => console.error('[business-state] materials follow orders:', e))
      // ...and closes its job's "Order materials for …" task (lib/taskAutoClose.ts).
      closeTasksSoon()
    }
    // Settings saved here (company config, appointments, templates...) go to the change log (Settings > Change log).
    for (const f of SETTINGS_FIELDS) {
      if (updateData[f] !== undefined) await auditSettingChange(req, `business-state/${f}`, (saved as any)?.[f] ?? null, (s as any)[f], { version: s.version })
    }
    res.json({ success: true, data: leanState(s, omit) })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[business-state] patch error:', err)
    res.status(500).json({ success: false, error: 'Failed to update business state' })
  }
})

export default router
