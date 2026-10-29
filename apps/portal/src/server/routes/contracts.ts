import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { salesScopeOf } from '../lib/salesScope.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  try {
    const accountId = req.user!.accountId

    // The Salesman: the contracts synced from the Salesman's own and assigned quotes only (their external id is the quote's).
    const scope = await salesScopeOf(req)
    const contracts = await prisma.contract.findMany({
      where: { accountId, ...(scope ? { externalCrmId: { in: [...scope.quoteIds] } } : {}) },
      orderBy: { startDate: 'desc' },
    })

    res.json({
      success: true,
      data: contracts.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate?.toISOString() || null,
        status: c.status,
      })),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load contracts' })
  }
})

export default router
