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

const fields = [
  'bundles', 'quoteOptions', 'contractSections', 'jobChecklists', 'defaultMilestones',
  'plEntries', 'balanceSheet', 'cashFlowManual', 'automations',
  'emailTemplates', 'settings', 'config', 'budget', 'pendingOrders', 'purchaseOrders',
  'invoices', 'payments', 'statements', 'pullSheets',
] as const

/** The parts of the record that are settings, not the books (those have their own history). */
const SETTINGS_FIELDS = ['bundles', 'quoteOptions', 'contractSections', 'jobChecklists', 'defaultMilestones', 'automations', 'emailTemplates', 'settings', 'config', 'budget'] as const

const patchSchema = z.object(Object.fromEntries(fields.map(f => [f, z.any().optional()])))

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const s = await findOrCreate(
      () => prisma.businessState.findUnique({ where: { accountId } }),
      () => prisma.businessState.create({ data: { accountId } }),
    )
    res.json({ success: true, data: s })
  } catch (err) {
    console.error('[business-state] get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load business state' })
  }
})

router.patch('/', async (req: any, res) => {
  try {
    const data = patchSchema.parse(req.body)
    const updateData: any = {}
    for (const f of fields) {
      // Lists keep one entry per id; job checklists one item per milestone (see lib/seeds).
      if (data[f] !== undefined) updateData[f] = normalizeBusinessField(f, JSON.parse(JSON.stringify(data[f])))
    }
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    // Settings, prices and the books are for the owner, admin and manager; each key is checked on its own.
    const saved = await prisma.businessState.findUnique({ where: { accountId } })
    // A Salesman or Installer never had the costs (lib/costRedact.ts): the ones their
    // phone left out are put back as saved; a cost or the books sent is refused below.
    if (hidesCosts(roleOf(req)) || hidesPrices(roleOf(req))) {
      for (const k of Object.keys(updateData)) updateData[k] = restoreCosts(updateData[k], (saved as any)?.[k], hideFor(roleOf(req)))
    }
    const refused = businessPatchRefusal(roleOf(req), req.user.id ?? null, saved as any, updateData)
    if (refused) { refuse(res, refused, { data: saved, version: saved?.version ?? 0 }); return }
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
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      try { await prisma.businessState.create({ data: { accountId, ...updateData } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.businessState.findUnique({ where: { accountId } })
        refuseStale(res, now, now?.version ?? 0); return
      }
    }
    const s = (await prisma.businessState.findUnique({ where: { accountId } }))!
    // A Sales Order marked Ordered closes its job's "Order materials for …" task (lib/taskAutoClose.ts).
    if (updateData.pendingOrders !== undefined) closeTasksSoon()
    // Settings saved here (company config, appointments, templates...) go to the change log (Settings > Change log).
    for (const f of SETTINGS_FIELDS) {
      if (updateData[f] !== undefined) await auditSettingChange(req, `business-state/${f}`, (saved as any)?.[f] ?? null, (s as any)[f], { version: s.version })
    }
    res.json({ success: true, data: s })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[business-state] patch error:', err)
    res.status(500).json({ success: false, error: 'Failed to update business state' })
  }
})

export default router
