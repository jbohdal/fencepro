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
import { oneById } from '../lib/once.js'
import { resolveSecret } from '../lib/secrets.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { kvChangeRefusal, refuse, roleOf } from '../lib/permissions.js'
import { hidesCosts, KV_COST_KEYS } from '../lib/costRedact.js'
import { OPS_STAGES_KEY } from '../lib/opsStages.js'
import { PIPELINE_STAGES_KEY } from '../lib/pipelineStages.js'
import { OPTION_LIST_KEY } from '../lib/optionLists.js'
import { auditSettingChange } from '../lib/settingsAudit.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

const KEY_PATTERN = /^[a-z0-9_]{1,64}$/

/**
 * Keys only the server reads or writes: the push signing key, the Gmail sign-in
 * token, and anything named like a secret. Never sent to a browser, whatever
 * the role, and never changed from one (until Oct 2026 GET /api/kv returned
 * them to every signed-in login).
 */
const SERVER_ONLY_KEYS = new Set(['push_vapid', 'gmail_token'])
export function isServerOnlyKey(key: string): boolean {
  return SERVER_ONLY_KEYS.has(key) || /(token|secret|vapid|password|private)/i.test(key)
}
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
    // Job costing (actual costs) and supplier prices are costs: not for a Salesman or Installer (lib/costRedact.ts).
    const hide = hidesCosts(roleOf(req)) ? KV_COST_KEYS : new Set<string>()
    for (const r of rows) { if (hide.has(r.key) || isServerOnlyKey(r.key)) continue; out[r.key] = r.value; versions[r.key] = r.version }
    res.json({ success: true, data: out, versions })
  } catch (err) {
    console.error('[kv] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to load' })
  }
})

router.put('/:key', async (req: any, res) => {
  const key = String(req.params.key || '')
  if (!KEY_PATTERN.test(key)) { res.status(400).json({ success: false, error: 'Invalid key' }); return }
  if (isServerOnlyKey(key)) { res.status(403).json({ success: false, error: 'This setting is kept on the server.' }); return }
  if (!req.body || !('value' in req.body)) { res.status(400).json({ success: false, error: 'value is required' }); return }
  const value = req.body.value
  const base = baseVersionOf(req.body)
  if (base === null) { refuseUnversioned(res); return }
  const accountId = req.user.crmAccountId
  try {
    const where = { accountId_key: { accountId, key } }
    // Settings and price lists are for the owner, admin and manager; removing files or site plans is deleting them.
    const saved = await prisma.accountKeyValue.findUnique({ where })
    const refused = kvChangeRefusal(roleOf(req), key, saved ? saved.value : null, value ?? null)
    if (refused) { refuse(res, refused, { data: saved ? saved.value : null, version: saved?.version ?? 0 }); return }
    // Operations stages change only through /api/ops-stages, which makes sure no stage in use disappears.
    if (key === OPS_STAGES_KEY) { res.status(403).json({ success: false, code: 'USE_OPS_STAGES', error: 'Operations stages are saved from Settings > Operations Stages.' }); return }
    // Pipeline stages, lead sources and tags too: only their own routes save them, with their checks.
    if (key === PIPELINE_STAGES_KEY) { res.status(403).json({ success: false, code: 'USE_PIPELINE_STAGES', error: 'Pipeline stages are saved from Settings > Pipeline Stages.' }); return }
    if (key === OPTION_LIST_KEY.leadSources || key === OPTION_LIST_KEY.customerTags) { res.status(403).json({ success: false, code: 'USE_OPTION_LISTS', error: 'Lead sources and tags are saved from Settings > Lead Sources and Settings > Customer Tags.' }); return }
    const stale = async () => {
      const current = await prisma.accountKeyValue.findUnique({ where })
      refuseStale(res, current ? current.value : null, current?.version ?? 0)
    }
    if (value === null || value === undefined) {
      const del = await prisma.accountKeyValue.deleteMany({ where: { accountId, key, version: base } })
      if (del.count === 0 && (base !== 0 || await prisma.accountKeyValue.findUnique({ where }))) { await stale(); return }
      await auditSettingChange(req, `kv/${key}`, saved ? saved.value : null, null)
      res.json({ success: true, data: null, version: 0 })
      return
    }
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > MAX_VALUE_BYTES) {
      res.status(413).json({ success: false, error: 'That is too much data to save in one piece.' })
      return
    }
    // A list keeps one entry per id (operations stages, site plans, files...).
    const parsed = JSON.parse(json)
    const clean = (Array.isArray(parsed) ? oneById(parsed) : parsed) as Prisma.InputJsonValue
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
    // Who changed which saved setting, from which device (Settings > Change log).
    await auditSettingChange(req, `kv/${key}`, saved ? saved.value : null, clean, { version: row?.version ?? 1 })
    res.json({ success: true, data: true, version: row?.version ?? 1 })
  } catch (err) {
    console.error('[kv] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save' })
  }
})

export default router
