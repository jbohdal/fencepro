/**
 * Inventory state — singleton per account.
 * Mirrors /api/pipeline pattern: GET auto-creates empty defaults, PUT
 * replaces the whole blob. The default inventory catalog ships from the
 * client on first save (server has no opinion on which items exist).
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
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

const inventorySchema = z.object({
  items: z.array(z.any()).default([]),
  bundles: z.array(z.any()).default([]),
  locations: z.array(z.any()).default([]),
  stockLevels: z.array(z.any()).default([]),
  transactions: z.array(z.any()).default([]),
})

router.get('/', async (req: any, res) => {
  try {
    let inv = await prisma.inventoryState.findUnique({ where: { accountId: req.user.crmAccountId } })
    if (!inv) {
      inv = await prisma.inventoryState.create({
        data: {
          accountId: req.user.crmAccountId,
          items: [],
          bundles: [],
          locations: [],
          stockLevels: [],
          transactions: [],
        },
      })
    }
    res.json({ success: true, data: inv })
  } catch (err) {
    console.error('[inventory] get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load inventory' })
  }
})

router.put('/', async (req: any, res) => {
  try {
    const data = inventorySchema.parse(req.body)
    const inv = await prisma.inventoryState.upsert({
      where: { accountId: req.user.crmAccountId },
      create: {
        accountId: req.user.crmAccountId,
        items: JSON.parse(JSON.stringify(data.items)),
        bundles: JSON.parse(JSON.stringify(data.bundles)),
        locations: JSON.parse(JSON.stringify(data.locations)),
        stockLevels: JSON.parse(JSON.stringify(data.stockLevels)),
        transactions: JSON.parse(JSON.stringify(data.transactions)),
      },
      update: {
        items: JSON.parse(JSON.stringify(data.items)),
        bundles: JSON.parse(JSON.stringify(data.bundles)),
        locations: JSON.parse(JSON.stringify(data.locations)),
        stockLevels: JSON.parse(JSON.stringify(data.stockLevels)),
        transactions: JSON.parse(JSON.stringify(data.transactions)),
      },
    })
    await audit(req, 'update', 'InventoryState', inv.id, {
      newValues: {
        itemsCount: data.items.length,
        bundlesCount: data.bundles.length,
        locationsCount: data.locations.length,
        stockLevelsCount: data.stockLevels.length,
        transactionsCount: data.transactions.length,
      },
    })
    res.json({ success: true, data: inv })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[inventory] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save inventory' })
  }
})

export default router
