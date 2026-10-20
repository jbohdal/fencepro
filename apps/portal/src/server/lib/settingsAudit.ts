/**
 * Every Settings save is written to the change log (CrmAuditLog, action
 * 'settings_changed') with who, from which address and device, which setting,
 * and a short list of what changed: "Permit Pending: isComplete false → true".
 *
 * Big documents are not copied whole: the log keeps a short hash of before and
 * after plus the changed parts by name. A value under a name that looks like a
 * secret (token, secret, password, key...) is never written, only "changed".
 *
 * Owner screen: Settings > Change log (SettingsChangeLog.tsx, GET /api/admin/settings-changes).
 */

import crypto from 'crypto'
import type { Request } from 'express'
import { audit } from './auditLog.js'

const MAX_LINES = 40
const MAX_LINE = 200
const MAX_DEPTH = 5
const SECRETISH = /(token|secret|password|passwd|apikey|api_key|privatekey|private_key|vapid|credential|authorization|^key$|Key$)/i

/** A short, stable fingerprint of a JSON value (12 hex characters). */
export function shortHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value ?? null)).digest('hex').slice(0, 12)
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function show(v: unknown): string {
  if (v === undefined) return '(none)'
  if (v === null) return 'null'
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 57) + '...' : v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return Array.isArray(v) ? `[${v.length} items]` : '{...}'
}

/** The name an item in a list goes by: its name or label, else its id. */
function itemName(item: Record<string, unknown>): string {
  const n = item.name ?? item.label ?? item.title ?? item.key ?? item.id
  return typeof n === 'string' || typeof n === 'number' ? String(n) : '?'
}
const idOf = (item: unknown): string | null => {
  if (!isObj(item)) return null
  const id = item.id ?? item.key
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

function walk(before: unknown, after: unknown, path: string, depth: number, out: string[]): void {
  if (out.length >= MAX_LINES || same(before, after)) return
  const leaf = path.split('.').pop() || path
  if (path && SECRETISH.test(leaf)) { out.push(`${path} changed (value hidden)`); return }
  // Lists of things with ids (stages, styles, templates): matched by id, so a reorder reads as one line.
  if (Array.isArray(before) && Array.isArray(after) && depth < MAX_DEPTH &&
      [...before, ...after].every(x => idOf(x) !== null)) {
    const was = new Map(before.map(x => [idOf(x)!, x as Record<string, unknown>]))
    const now = new Map(after.map(x => [idOf(x)!, x as Record<string, unknown>]))
    for (const [id, item] of now) if (!was.has(id)) out.push(`${path ? path + ': ' : ''}added ${itemName(item)}`)
    for (const [id, item] of was) if (!now.has(id)) out.push(`${path ? path + ': ' : ''}removed ${itemName(item)}`)
    for (const [id, item] of now) {
      const old = was.get(id)
      if (old) walk(old, item, `${path ? path + ' > ' : ''}${itemName(item)}`, depth + 1, out)
    }
    const order = (l: unknown[]) => l.map(idOf).filter(id => was.has(id!) && now.has(id!)).join('|')
    if (order(before) !== order(after)) out.push(`${path || 'list'}: order changed`)
    return
  }
  if (isObj(before) && isObj(after) && depth < MAX_DEPTH) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      walk(before[k], after[k], path ? `${path}.${k}` : k, depth + 1, out)
    }
    return
  }
  const scalar = (v: unknown) => v === null || v === undefined || typeof v !== 'object'
  if (scalar(before) && scalar(after)) out.push(`${path || 'value'}: ${show(before)} → ${show(after)}`)
  else out.push(`${path || 'value'} changed`)
}

/** Short lines saying what changed between two versions of a setting. */
export function describeChange(before: unknown, after: unknown): string[] {
  const out: string[] = []
  walk(before ?? null, after ?? null, '', 0, out)
  const lines = out.map(l => l.length > MAX_LINE ? l.slice(0, MAX_LINE - 3) + '...' : l)
  if (out.length >= MAX_LINES) lines.push('(more changes not listed)')
  return lines
}

/**
 * Write one 'settings_changed' row (entity type 'Settings'). `setting` names
 * what was saved, as the log shows it: "ops-stages", "kv/fencepro_files",
 * "business-state/config", "pipeline/stages". Never throws.
 */
export async function auditSettingChange(req: Request, setting: string, before: unknown, after: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    const changes = describeChange(before, after)
    if (changes.length === 0) return
    const sid = (req as any).staffSessionId ?? null
    await audit(req, 'settings_changed', 'Settings', setting, {
      oldValues: { hash: shortHash(before) },
      newValues: { hash: shortHash(after), changes, ...(sid ? { session: String(sid).slice(0, 8) } : {}), ...extra },
    })
  } catch (err) {
    console.error(`[audit] settings change on ${setting} not recorded: ${(err as Error).message}`)
  }
}
