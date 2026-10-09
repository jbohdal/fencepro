/**
 * Account key/value store — /api/kv
 *
 * Holds the small per company documents that used to live only in one
 * browser (see AccountKeyValue in the schema). Scoped to the caller's
 * company; keys are a fixed character set; values are size capped.
 *
 *   GET  /api/kv          → { key: value, ... } for the company, plus `versions`
 *   PUT  /api/kv/:key     → { value, baseVersion } upsert; value null deletes the key.
 *                           Refused with the current value when baseVersion is not
 *                           the key's current version (0 for a key that is not there).
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

const KEY_PATTERN = /^[a-z0-9_]{1,64}$/
const MAX_VALUE_BYTES = 4_000_000

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (payload.role === 'customer') { res.status(403).json({ success: false, error: 'Staff only' }); return }
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

router.use(requireUser)

router.get('/', async (req: any, res) => {
  try {
    const rows = await prisma.accountKeyValue.findMany({ where: { accountId: req.user.crmAccountId } })
    const out: Record<string, unknown> = {}
    const versions: Record<string, number> = {}
    for (const r of rows) { out[r.key] = r.value; versions[r.key] = r.version }
    res.json({ success: true, data: out, versions })
  } catch (err) {
    console.error('[kv] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to load' })
  }
})

router.put('/:key', async (req: any, res) => {
  const key = String(req.params.key || '')
  if (!KEY_PATTERN.test(key)) { res.status(400).json({ success: false, error: 'Invalid key' }); return }
  if (!req.body || !('value' in req.body)) { res.status(400).json({ success: false, error: 'value is required' }); return }
  const value = req.body.value
  const base = baseVersionOf(req.body)
  if (base === null) { refuseUnversioned(res); return }
  const accountId = req.user.crmAccountId
  try {
    const where = { accountId_key: { accountId, key } }
    const stale = async () => {
      const current = await prisma.accountKeyValue.findUnique({ where })
      refuseStale(res, current ? current.value : null, current?.version ?? 0)
    }
    if (value === null || value === undefined) {
      const del = await prisma.accountKeyValue.deleteMany({ where: { accountId, key, version: base } })
      if (del.count === 0 && (base !== 0 || await prisma.accountKeyValue.findUnique({ where }))) { await stale(); return }
      res.json({ success: true, data: null, version: 0 })
      return
    }
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > MAX_VALUE_BYTES) {
      res.status(413).json({ success: false, error: 'That is too much data to save in one piece.' })
      return
    }
    const clean = JSON.parse(json) as Prisma.InputJsonValue
    const done = await prisma.accountKeyValue.updateMany({ where: { accountId, key, version: base }, data: { value: clean, updatedBy: req.user.id, version: { increment: 1 } } })
    if (done.count === 0) {
      if (base !== 0) { await stale(); return }
      try {
        await prisma.accountKeyValue.create({ data: { accountId, key, value: clean, updatedBy: req.user.id } })
      } catch {
        await stale(); return           // another tab created the key first
      }
    }
    const row = await prisma.accountKeyValue.findUnique({ where })
    res.json({ success: true, data: true, version: row?.version ?? 1 })
  } catch (err) {
    console.error('[kv] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save' })
  }
})

export default router
