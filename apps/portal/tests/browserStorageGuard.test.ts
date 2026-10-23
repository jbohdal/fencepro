/**
 * Rule 1: no business data and no sign in in the browser's storage. The staff
 * sign in is the httpOnly cookie `ezbiz_staff` (lib/staffSession.ts); the
 * customer portal has its own (lib/portalSession.ts).
 *
 * This fails on any use of localStorage, sessionStorage or IndexedDB in the
 * web app (apps/web/src, its public files and its other pages) outside the
 * allow-list Jonathan approved on Oct 20, 2026 (apps/web/src/browserStorage.ts):
 *
 *   - browserStorage.ts: the per device board choices (answer 4) through
 *     readPref / writePref, and the clean up of what older versions left;
 *   - crmAuth.ts: until stage D, reading and deleting the old sign in's two
 *     keys to move a phone over to the cookie (never writing them);
 *   - outbox.ts, mediaStore.ts, voiceClient.ts: the offline queues (answer 1),
 *     IndexedDB only, encrypted through vault.ts;
 *   - vault.ts: the queues' non-extractable key, IndexedDB only;
 *   - public/sw.js: the app's own files in Cache Storage (not this rule's
 *     storages; it never caches /api).
 *
 * Comments are left out before looking, so a comment that names
 * localStorage is not a use.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const WEB = path.resolve(__dirname, '../../web')
const SRC = path.join(WEB, 'src')
const STORAGE = /\b(localStorage|sessionStorage|indexedDB|IDBFactory|openDatabase)\b/

/** Where each storage may be used. Anything else is a failure. */
const ALLOWED: Record<string, RegExp[]> = {
  'src/browserStorage.ts': [/\blocalStorage\b/, /\bsessionStorage\b/],
  'src/crmAuth.ts': [/\blocalStorage\b/],
  'src/outbox.ts': [/\bindexedDB\b/],
  'src/mediaStore.ts': [/\bindexedDB\b/],
  'src/voiceClient.ts': [/\bindexedDB\b/],
  'src/vault.ts': [/\bindexedDB\b/],
}
const QUEUE_DBS = ['ezbiz-outbox', 'ezbiz-media', 'ezbiz-voice', 'ezbiz-vault']

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p)
    return /\.(ts|tsx|js|mjs|html)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

/** The code without comments (block, line and HTML comments); strings are kept. */
function code(text: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < text.length) {
    const c = text[i], n = text[i + 1]
    if (quote) {
      out += c
      if (c === '\\') { out += n ?? ''; i += 2; continue }
      if (c === quote) quote = null
      i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); const chunk = text.slice(i, e < 0 ? text.length : e + 2); out += chunk.replace(/[^\n]/g, ''); i = e < 0 ? text.length : e + 2; continue }
    if (c === '/' && n === '/' && text[i - 1] !== ':' && text[i - 1] !== '\\') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue }
    if (c === '<' && text.startsWith('<!--', i)) { const e = text.indexOf('-->', i); i = e < 0 ? text.length : e + 3; continue }
    out += c; i++
  }
  return out
}

const files = [...walk(SRC), ...walk(path.join(WEB, 'public')), ...walk(path.join(WEB, 'quote-widget')), ...walk(path.join(WEB, 'customer-portal')), path.join(WEB, 'index.html')]
const rel = (f: string) => path.relative(WEB, f)
const read = (f: string) => code(fs.readFileSync(f, 'utf8'))

describe('the staff app keeps nothing in the browser but the allowed list', () => {
  test('no localStorage, sessionStorage or IndexedDB outside the allow-list', () => {
    const hits: string[] = []
    for (const f of files) {
      const lines = read(f).split('\n')
      const allowed = ALLOWED[rel(f)] ?? []
      lines.forEach((line, i) => {
        if (!STORAGE.test(line)) return
        const words = [...line.matchAll(new RegExp(STORAGE.source, 'g'))].map(m => m[0])
        if (words.every(w => allowed.some(a => a.test(w)))) return
        hits.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 160)}`)
      })
    }
    expect(hits).toEqual([])
  })

  test('the old sign in keys are only read and deleted (crmAuth.ts), never written, and nothing else is kept there', () => {
    const auth = read(path.join(SRC, 'crmAuth.ts'))
    expect(auth).not.toMatch(/localStorage\.setItem/)
    const uses = auth.split('\n').filter(l => /localStorage/.test(l))
    expect(uses.length).toBeGreaterThan(0)
    for (const l of uses) expect(l, l.trim()).toMatch(/OLD_KEYS/)
    expect(auth).toMatch(/const OLD_KEYS = \['crm_access_token', 'crm_refresh_token'\] as const/)
    for (const f of files) {
      const t = read(f)
      if (rel(f) !== 'src/crmAuth.ts' && rel(f) !== 'src/browserStorage.ts') expect(/crm_access_token|crm_refresh_token|crm_last_email/.test(t), rel(f)).toBe(false)
    }
  })

  test('board choices go through readPref / writePref, with keys on the list', () => {
    const lib = read(path.join(SRC, 'browserStorage.ts'))
    const prefKeys = [...lib.slice(lib.indexOf('DEVICE_PREF_KEYS = ['), lib.indexOf('] as const')).matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1])
    expect(prefKeys.length).toBe(10)
    for (const k of prefKeys) expect(k).toMatch(/^fencepro_(pipeline|ops)_/)
    // The only localStorage reads and writes in browserStorage.ts are readPref / writePref and the clean up.
    expect((lib.match(/localStorage\.setItem/g) ?? []).length).toBe(1)
    expect((lib.match(/localStorage\.getItem/g) ?? []).length).toBe(1)
    for (const board of ['SalesPipelineBoard.tsx', 'OperationsBoard.tsx']) {
      const t = read(path.join(SRC, board))
      expect(t).toMatch(/readPref\(/)
      const keys = [...t.matchAll(/const [A-Z_]+_KEY\s*=\s*'(fencepro_[a-z0-9_]+)'/g)].map(m => m[1])
      expect(keys.length, board).toBeGreaterThan(0)
      for (const k of keys) expect(prefKeys, `${board}: ${k}`).toContain(k)
    }
  })

  test('the offline queues open only their own databases, and every record is sealed (vault.ts)', () => {
    for (const f of ['outbox.ts', 'mediaStore.ts', 'voiceClient.ts', 'vault.ts']) {
      const t = read(path.join(SRC, f))
      const names = [...t.matchAll(/indexedDB\.open\(\s*([^,)]+)/g)].map(m => m[1].trim())
      expect(names.length, f).toBeGreaterThan(0)
      for (const n of names) {
        const literal = n.match(/^'([^']+)'$/)?.[1] ?? (t.match(new RegExp(`\\b${n}\\s*=\\s*'([^']+)'`))?.[1])
        expect(QUEUE_DBS, `${f}: ${n}`).toContain(literal)
      }
      if (f !== 'vault.ts') expect(t, f).toMatch(/from '\.\/vault'/)
    }
    expect(read(path.join(SRC, 'outbox.ts'))).toMatch(/sealed: await sealJson\(op\)/)
    expect(read(path.join(SRC, 'mediaStore.ts'))).toMatch(/head: sealHead, pieces/)
    expect(read(path.join(SRC, 'voiceClient.ts'))).toMatch(/audio: await sealBytes\(/)
    // The key cannot be read out of the browser: made non-extractable.
    expect(read(path.join(SRC, 'vault.ts'))).toMatch(/generateKey\(\{ name: 'AES-GCM', length: 256 \}, false, \['encrypt', 'decrypt'\]\)/)
  })

  test('no login header anywhere but the one time move over; every call carries the cookie and the app header', () => {
    for (const f of files) {
      const t = read(f)
      if (rel(f) === 'src/crmAuth.ts') continue
      expect(/Authorization['"]?\s*[:\]]|Bearer /.test(t), rel(f)).toBe(false)
      expect(/getAccessToken|setTokens|accessToken\b/.test(t), rel(f)).toBe(false)
    }
    const auth = read(path.join(SRC, 'crmAuth.ts'))
    expect(auth).toMatch(/credentials: 'include'/)
    expect(auth).toMatch(/headers\.set\(APP_HEADER, '1'\)/)
    expect(auth).toMatch(/export const APP_HEADER = 'X-Staff-Request'/)
    expect((auth.match(/Bearer /g) ?? []).length).toBe(1)
  })

  test('the Settings and budget copies, who was signed in and the old one time moves are gone', () => {
    const all = files.map(read).join('\n')
    for (const gone of ['fencepro_config', 'fencepro_budget', 'fencepro_user', 'legacyMigrationEnabled', 'ezbiz_migrate_legacy_local_data', 'migrateLocal', '_db_migrated_v1', 'fencepro_integrations', 'fencepro_customer_notes']) {
      expect(all.includes(gone), gone).toBe(false)
    }
  })

  test('old business data is deleted on load without being read: everything not on the list goes', () => {
    const lib = read(path.join(SRC, 'browserStorage.ts'))
    expect(lib).toMatch(/const KEEP = new Set<string>\(\[\.\.\.DEVICE_PREF_KEYS, \.\.\.MOVE_OVER_KEYS\]\)/)
    expect(lib).toMatch(/if \(k !== null && !KEEP\.has\(k\)\) \{ localStorage\.removeItem\(k\)/)
    expect(read(path.join(SRC, 'App.tsx'))).toMatch(/clearOldBrowserData\(\)/)
  })
})
