/**
 * Admin Audit Log API.
 *
 * GET  /api/admin/audit-log         — paged list with filters
 * GET  /api/admin/audit-log.csv     — CSV export of the same query
 * GET  /api/admin/backups           — list of recent backup runs
 * GET  /api/admin/monitoring        — daily count snapshots
 *
 * All endpoints require an admin JWT.
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

function requireAdmin(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' }); return
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role }
    next()
  } catch { res.status(401).json({ success: false, error: 'Invalid token' }) }
}

router.use(requireAdmin)

// ── List audit log ──
router.get('/audit-log', async (req: any, res) => {
  const { user, entityType, action, since, until, limit = '100', offset = '0' } = req.query
  const where: Record<string, unknown> = {}
  if (user) where.OR = [{ userId: String(user) }, { userEmail: String(user) }]
  if (entityType) where.entityType = String(entityType)
  if (action) where.action = String(action)
  if (since || until) {
    where.createdAt = {
      ...(since ? { gte: new Date(String(since)) } : {}),
      ...(until ? { lte: new Date(String(until)) } : {}),
    }
  }
  const take = Math.min(500, parseInt(String(limit), 10) || 100)
  const skip = Math.max(0, parseInt(String(offset), 10) || 0)
  try {
    const [rows, total] = await Promise.all([
      prisma.crmAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.crmAuditLog.count({ where }),
    ])
    res.json({ success: true, data: { rows, total, limit: take, offset: skip } })
  } catch (err) {
    console.error('[admin-audit] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to load audit log' })
  }
})

// ── CSV export ──
router.get('/audit-log.csv', async (req: any, res) => {
  const { user, entityType, action, since, until } = req.query
  const where: Record<string, unknown> = {}
  if (user) where.OR = [{ userId: String(user) }, { userEmail: String(user) }]
  if (entityType) where.entityType = String(entityType)
  if (action) where.action = String(action)
  if (since || until) {
    where.createdAt = {
      ...(since ? { gte: new Date(String(since)) } : {}),
      ...(until ? { lte: new Date(String(until)) } : {}),
    }
  }
  try {
    const rows = await prisma.crmAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 })
    const headers = ['createdAt', 'userEmail', 'action', 'entityType', 'entityId', 'ipAddress', 'oldValues', 'newValues']
    const lines = [headers.join(',')]
    rows.forEach((r) => {
      const cells = [
        r.createdAt.toISOString(),
        r.userEmail || '',
        r.action,
        r.entityType,
        r.entityId || '',
        r.ipAddress || '',
        r.oldValues ? JSON.stringify(r.oldValues) : '',
        r.newValues ? JSON.stringify(r.newValues) : '',
      ].map((v) => {
        const s = String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
      })
      lines.push(cells.join(','))
    })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(lines.join('\n'))
  } catch (err) {
    console.error('[admin-audit] csv error:', err)
    res.status(500).json({ success: false, error: 'Failed to export audit log' })
  }
})

// ── Backup history ──
router.get('/backups', async (_req, res) => {
  try {
    const rows = await prisma.backupLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
    // serialize BigInt
    const data = rows.map((r) => ({ ...r, fileSizeBytes: Number(r.fileSizeBytes) }))
    res.json({ success: true, data })
  } catch (err) {
    console.error('[admin-audit] backups error:', err)
    res.status(500).json({ success: false, error: 'Failed to load backup log' })
  }
})

// ── Monitoring snapshots ──
router.get('/monitoring', async (_req, res) => {
  try {
    const rows = await prisma.monitoringSnapshot.findMany({ orderBy: { snapshotDate: 'desc' }, take: 60 })
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('[admin-audit] monitoring error:', err)
    res.status(500).json({ success: false, error: 'Failed to load monitoring snapshots' })
  }
})

export default router
