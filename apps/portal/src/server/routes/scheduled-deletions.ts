/**
 * /api/scheduled-deletions: what is set to be deleted and when (the
 * dashboard reminder), and "Keep them" to cancel. Owner and admins only.
 */

import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ocalaDay } from '../lib/scheduledDeletions.js'

const router = Router()
router.use(requireAuth, requireRole('admin'))

router.get('/', async (req: any, res) => {
  try {
    const rows = await prisma.scheduledDeletion.findMany({
      where: { accountId: req.user.accountId, status: 'scheduled' },
      orderBy: { deleteOn: 'asc' },
    })
    res.json({ success: true, today: ocalaDay(), data: rows.map(r => ({ id: r.id, what: r.what, labels: r.labels, count: Array.isArray(r.recordIds) ? r.recordIds.length : 0, remindOn: r.remindOn, deleteOn: r.deleteOn })) })
  } catch (err) {
    console.error('[scheduled-deletions] list error:', err)
    res.status(500).json({ success: false, error: 'Could not load scheduled deletions' })
  }
})

router.post('/:id/cancel', async (req: any, res) => {
  try {
    const done = await prisma.scheduledDeletion.updateMany({
      where: { id: req.params.id, accountId: req.user.accountId, status: 'scheduled' },
      data: { status: 'cancelled', result: `Kept: cancelled on ${ocalaDay()}` },
    })
    if (!done.count) { res.status(404).json({ success: false, error: 'Nothing scheduled with that id' }); return }
    res.json({ success: true })
  } catch (err) {
    console.error('[scheduled-deletions] cancel error:', err)
    res.status(500).json({ success: false, error: 'Could not cancel' })
  }
})

export default router
