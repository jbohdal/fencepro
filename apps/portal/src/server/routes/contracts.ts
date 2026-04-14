import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  try {
    const accountId = req.user!.accountId

    const contracts = await prisma.contract.findMany({
      where: { accountId },
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
