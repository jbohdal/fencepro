/**
 * Vendor state — singleton per account.
 * Same pattern as /api/inventory-state and /api/pipeline.
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { logRemovedVendors } from '../lib/deletion.js'
import { findOrCreate, isUniqueViolation, oneById } from '../lib/once.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { can, isFullRole, refuse, removedIds, roleOf, sameJson } from '../lib/permissions.js'
import { hidesCosts } from '../lib/costRedact.js'
import { billWithCharges } from '../lib/invoiceMath.js'

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
    // Bills and what was paid on them are costs: not for a Salesman or Installer (lib/costRedact.ts).
    res.json({ success: true, data: hidesCosts(roleOf(req)) ? { ...v, bills: [], payments: [] } : v })
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
      // A bill from a vendor document always comes to lines + tax + freight + fees (lib/invoiceMath).
      bills: oneById(JSON.parse(JSON.stringify(data.bills)) as any[]).map(billWithCharges),
      payments: oneById(JSON.parse(JSON.stringify(data.payments)) as any[]),
    }
    // Vendors and bills: the office may add and edit them; removing one is a delete, for the owner or an admin.
    const role = roleOf(req)
    const saved = await prisma.vendorState.findUnique({ where: { accountId } })
    // A saved bill whose total was short (see billWithCharges) put right is not a change by this person.
    const savedAs = (k: 'vendors' | 'bills' | 'payments') => { const v = (saved as any)?.[k] ?? []; return k === 'bills' && Array.isArray(v) ? v.map(billWithCharges) : v }
    const changed = (['vendors', 'bills', 'payments'] as const).some(k => !sameJson(savedAs(k), fields[k]))
    const removes = (['vendors', 'bills', 'payments'] as const).some(k => removedIds((saved as any)?.[k], fields[k]).length)
    const refused = !changed ? null
      : !isFullRole(role) && !can(role, 'billing.change') ? 'billing.change' as const
      : removes && !can(role, 'records.delete') ? 'records.delete' as const
      : null
    if (refused) { refuse(res, refused, { data: saved, version: saved?.version ?? 0 }); return }
    // A vendor removed goes to Settings > Deleted Records (its bills stay: they are the books).
    const done = await prisma.$transaction(async tx => {
      const d = await tx.vendorState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
      if (d.count && saved) await logRemovedVendors(tx, { accountId, userId: req.user?.id ?? null }, saved.vendors, fields.vendors)
      return d
    })
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
