/**
 * Vendor state — singleton per account.
 * Same pattern as /api/inventory-state and /api/pipeline.
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { findOrCreate, isUniqueViolation, oneById } from '../lib/once.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'

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

const vendorStateSchema = z.object({
  vendors: z.array(z.any()).default([]),
  bills: z.array(z.any()).default([]),
  payments: z.array(z.any()).default([]),
})

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const v = await findOrCreate(
      () => prisma.vendorState.findUnique({ where: { accountId } }),
      () => prisma.vendorState.create({ data: { accountId, vendors: [], bills: [], payments: [] } }),
    )
    res.json({ success: true, data: v })
  } catch (err) {
    console.error('[vendor-state] get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load vendors' })
  }
})

router.put('/', async (req: any, res) => {
  try {
    const data = vendorStateSchema.parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    const fields = {
      vendors: oneById(JSON.parse(JSON.stringify(data.vendors)) as any[]),
      bills: oneById(JSON.parse(JSON.stringify(data.bills)) as any[]),
      payments: oneById(JSON.parse(JSON.stringify(data.payments)) as any[]),
    }
    const done = await prisma.vendorState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
    if (done.count === 0) {
      const current = await prisma.vendorState.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      try { await prisma.vendorState.create({ data: { accountId, ...fields } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.vendorState.findUnique({ where: { accountId } })
        refuseStale(res, now, now?.version ?? 0); return
      }
    }
    const v = (await prisma.vendorState.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'VendorState', v.id, {
      newValues: { vendorsCount: data.vendors.length, billsCount: data.bills.length, paymentsCount: data.payments.length },
    })
    res.json({ success: true, data: v })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[vendor-state] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save vendors' })
  }
})

export default router
