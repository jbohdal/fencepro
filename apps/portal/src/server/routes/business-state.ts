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
import { resolveSecret } from '../lib/secrets.js'

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

const patchSchema = z.object(Object.fromEntries(fields.map(f => [f, z.any().optional()])))

router.get('/', async (req: any, res) => {
  try {
    let s = await prisma.businessState.findUnique({ where: { accountId: req.user.crmAccountId } })
    if (!s) {
      s = await prisma.businessState.create({ data: { accountId: req.user.crmAccountId } })
    }
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
      if (data[f] !== undefined) updateData[f] = JSON.parse(JSON.stringify(data[f]))
    }
    const s = await prisma.businessState.upsert({
      where: { accountId: req.user.crmAccountId },
      create: { accountId: req.user.crmAccountId, ...updateData },
      update: updateData,
    })
    res.json({ success: true, data: s })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[business-state] patch error:', err)
    res.status(500).json({ success: false, error: 'Failed to update business state' })
  }
})

export default router
