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
 *
 * The Salesman (lib/salesScopeRecords.ts; Jonathan, Oct 28 2026): in the keys
 * kept per customer (the customer activity log, quote share links, job costing
 * lines, the old change orders, imported quotes) the entries of other people's
 * customers, jobs and quotes are left out of every answer; a save may remove
 * or change only an entry on the copy the phone was handed (lib/salesServed.ts),
 * every other one is put back exactly as stored; one sent for someone else's
 * is refused (404). The
 * duplicate check's lists (customers' phones) are not sent to the Salesman.
 * Site plans and their files stay company wide (Jonathan's word).
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
import { salesScopeOf, salesScope, forgetScope } from '../lib/salesScope.js'
import { salesKvView, salesKvValue, KV_NOT_FOR_SALESMAN, KV_PER_CUSTOMER, KV_LIST, OutsideScopeError } from '../lib/salesScopeRecords.js'
import { handedOut, handedOutHad, handedAt, afterOwnSave, keysOfList, NOTHING, type Had } from '../lib/salesServed.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

const KEY_PATTERN = /^[a-z0-9_]{1,64}$/

/**
 * Keys only the server reads or writes: the push signing key, the Gmail sign-in
 * token, and anything named like a secret. Never sent to a browser, whatever
 * the role, and never changed from one (until Oct 2026 GET /api/kv returned
 * them to every signed-in login).
 */
const SERVER_ONLY_KEYS = new Set(['push_vapid', 'gmail_token', 'ops_locate_clear_day'])
export function isServerOnlyKey(key: string): boolean {
  return SERVER_ONLY_KEYS.has(key) || key.startsWith('install:') || /(token|secret|vapid|password|private)/i.test(key)
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
    const scope = await salesScopeOf(req)
    for (const r of rows) {
      if (hide.has(r.key) || isServerOnlyKey(r.key) || (scope && KV_NOT_FOR_SALESMAN(r.key))) continue
      out[r.key] = scope ? salesKvView(scope, r.key, r.value) : r.value
      versions[r.key] = r.version
      // What the Salesman's phone now holds of a per customer key: a later save may remove only that (lib/salesServed.ts).
      if (scope && KV_PER_CUSTOMER.has(r.key)) handedOut(scope.userId, scope.accountId, `kv:${r.key}`, r.version, new Map([[KV_LIST, keysOfList(out[r.key])]]))
    }
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
  let value = req.body.value
  const base = baseVersionOf(req.body)
  if (base === null) { refuseUnversioned(res); return }
  const accountId = req.user.crmAccountId
  try {
    const where = { accountId_key: { accountId, key } }
    // Settings and price lists are for the owner, admin and manager; removing files or site plans is deleting them.
    const saved = await prisma.accountKeyValue.findUnique({ where })
    // The Salesman: every answer (a refusal's or a 409's value) as the Salesman reads it; what the Salesman's
    // copy left out is put back exactly as stored before the save.
    let scope = await salesScopeOf(req)
    const salesUser = scope ? { userId: scope.userId, accountId: scope.accountId } : null
    // What the Salesman's phone held at the version this save is built on, and what it holds after (lib/salesServed.ts).
    let had: Had | null = null
    let sentByPhone: Set<string> | null = null
    let leftOut = 0
    if (scope) {
      const json = res.json.bind(res)
      res.json = (body: any) => {
        if (!(scope && body && typeof body === 'object' && 'data' in body)) return json(body)
        const data = salesKvView(scope, key, body.data)
        // A 409's or a refusal's copy is the phone's copy from now on (the answer to a save is only `true`).
        if (body.success !== true && typeof body.version === 'number' && KV_PER_CUSTOMER.has(key)) {
          handedOut(scope.userId, scope.accountId, `kv:${key}`, body.version, new Map([[KV_LIST, keysOfList(data)]]))
        }
        return json({ ...body, data })
      }
      if (KV_NOT_FOR_SALESMAN(key)) { res.status(404).json({ success: false, error: 'Not found' }); return }
      if (KV_PER_CUSTOMER.has(key)) {
        had = (!saved && base === 0) ? NOTHING : handedAt(scope.userId, scope.accountId, `kv:${key}`, base)
        // Not known (the server restarted, or a copy this login was never handed): never guessed. The 409 hands the
        // phone the current copy; it puts its change on that and saves again (web syncGuard.ts).
        if (!had) { refuseStale(res, saved ? saved.value : null, saved?.version ?? 0); return }
      }
      const sent = value ?? null
      // An entry for someone else's customer, job or quote is left out (`leftOut`), the rest is saved (Oct 30 2026).
      const merge = (s: NonNullable<typeof scope>) => {
        try { return salesKvValue(s, key, saved ? saved.value : null, sent, had ?? NOTHING) } catch (e) { if (e instanceof OutsideScopeError) return null; throw e }
      }
      let m = merge(scope)
      if (!m || m.leftOut > 0) {
        // Maybe a customer, quote or job made a moment ago: read the scope again once.
        forgetScope(scope.userId)
        const again = await salesScope(scope.userId, scope.accountId)
        if (again) { scope = again; m = merge(again) }
      }
      if (!m) { res.status(404).json({ success: false, error: 'Not found' }); return }
      ;({ value, accepted: sentByPhone, leftOut } = m)
    }
    // The phone keeps what it sent as its copy of the new version: remembered for its next save.
    const remember = (version: number) => {
      if (salesUser && had && sentByPhone) handedOutHad(salesUser.userId, salesUser.accountId, `kv:${key}`, version, afterOwnSave(had, new Map([[KV_LIST, sentByPhone]])))
    }
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
    let newVersion = base + 1
    if (done.count === 0) {
      if (base !== 0) { await stale(); return }
      try {
        newVersion = (await prisma.accountKeyValue.create({ data: { accountId, key, value: clean, updatedBy: req.user.id } })).version
      } catch {
        await stale(); return           // another tab created the key first
      }
    }
    remember(newVersion)
    const row = await prisma.accountKeyValue.findUnique({ where })
    // Who changed which saved setting, from which device (Settings > Change log).
    await auditSettingChange(req, `kv/${key}`, saved ? saved.value : null, clean, { version: row?.version ?? 1 })
    // Some of it was not the Salesman's to send: the answer carries her copy as saved, which the app takes as its own.
    if (leftOut && scope) { res.json({ success: true, data: row?.value ?? null, version: row?.version ?? 1, leftOut }); return }
    res.json({ success: true, data: true, version: row?.version ?? 1 })
  } catch (err) {
    console.error('[kv] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save' })
  }
})

export default router
