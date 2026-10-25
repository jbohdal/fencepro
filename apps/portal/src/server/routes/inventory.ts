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
import { logRemovedInventoryItems } from '../lib/deletion.js'
import { findOrCreate, isUniqueViolation, oneById } from '../lib/once.js'
import { oneActiveKitPerStyle } from '../lib/seeds.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { inventoryChangeRefusal, refuse, roleOf } from '../lib/permissions.js'
import { hidesCosts, hidesPrices, hideFor, restoreCosts } from '../lib/costRedact.js'
import { clearCostReviewOnKitSave } from '../lib/costReview.js'

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
  // Optional so a phone still on the build before kits cannot wipe them.
  kits: z.array(z.any()).optional(),
})

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const inv = await findOrCreate(
      () => prisma.inventoryState.findUnique({ where: { accountId } }),
      () => prisma.inventoryState.create({ data: { accountId, items: [], bundles: [], locations: [], stockLevels: [], transactions: [] } }),
    )
    res.json({ success: true, data: inv })
  } catch (err) {
    console.error('[inventory] get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load inventory' })
  }
})

router.put('/', async (req: any, res) => {
  try {
    const data = inventorySchema.parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    const fields = {
      items: oneById(JSON.parse(JSON.stringify(data.items)) as any[]),
      bundles: oneById(JSON.parse(JSON.stringify(data.bundles)) as any[]),
      locations: oneById(JSON.parse(JSON.stringify(data.locations)) as any[]),
      stockLevels: JSON.parse(JSON.stringify(data.stockLevels)),
      transactions: oneById(JSON.parse(JSON.stringify(data.transactions)) as any[]),
      // One kit set in use per style (a second one sent at the same moment is archived, not lost).
      ...(data.kits ? { kits: oneActiveKitPerStyle(JSON.parse(JSON.stringify(data.kits)) as any[]) } : {}),
    }
    // Prices and kits are for the owner, admin and manager; the office may change stock; a sale may set stock aside.
    const saved = await prisma.inventoryState.findUnique({ where: { accountId } })
    // The Installer never had the costs or prices (lib/costRedact.ts): every one stays as saved.
    if (hidesCosts(roleOf(req)) || hidesPrices(roleOf(req))) {
      for (const k of Object.keys(fields) as Array<keyof typeof fields>) (fields as any)[k] = restoreCosts(fields[k], (saved as any)?.[k], hideFor(roleOf(req)))
    }
    const refused = inventoryChangeRefusal(roleOf(req), saved ?? {}, { ...fields, kits: data.kits === undefined ? undefined : fields.kits })
    if (refused) { refuse(res, refused, { data: saved, version: saved?.version ?? 0 }); return }
    // A catalog item removed goes to Settings > Deleted Records, with its stock counts.
    const done = await prisma.$transaction(async tx => {
      const d = await tx.inventoryState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
      if (d.count && saved) await logRemovedInventoryItems(tx, { accountId, userId: req.user?.id ?? null }, saved as any, { items: fields.items, stockLevels: fields.stockLevels })
      return d
    })
    if (done.count === 0) {
      const current = await prisma.inventoryState.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      try { await prisma.inventoryState.create({ data: { accountId, ...fields } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.inventoryState.findUnique({ where: { accountId } })
        refuseStale(res, now, now?.version ?? 0); return
      }
    }
    // A style flagged "needs cost review" (the Bell) whose kit set was just saved: the reminder is done (lib/costReview.ts).
    if (fields.kits) await clearCostReviewOnKitSave(accountId, (saved as any)?.kits, fields.kits).catch(err => console.error('[cost review] clear failed:', err))
    const inv = (await prisma.inventoryState.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'InventoryState', inv.id, {
      newValues: {
        itemsCount: data.items.length,
        bundlesCount: data.bundles.length,
        locationsCount: data.locations.length,
        stockLevelsCount: data.stockLevels.length,
        transactionsCount: data.transactions.length,
        kitsCount: data.kits?.length,
      },
    })
    res.json({ success: true, data: inv })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[inventory] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save inventory' })
  }
})

export default router
