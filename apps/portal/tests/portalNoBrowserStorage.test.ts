/**
 * The customer portal keeps nothing in the browser (Jonathan, Oct 20, 2026:
 * "no sign in or business data in browser storage, same as the rest of the
 * app"). The sign in is an httpOnly cookie the page never sees, and every page
 * reads from /api/portal.
 *
 * Walks every file the portal loads (web/src/CustomerPortalApp.tsx and what it
 * imports, statically or lazily; type only imports are left out, they are not
 * in the built code) and fails if any of them touches localStorage,
 * sessionStorage or IndexedDB, imports the office's sign in or stores, or
 * sends a login header. Also checks that main.tsx starts the portal without
 * loading the office's app.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const SRC = path.resolve(__dirname, '../../web/src')
const STORAGE = /\b(localStorage|sessionStorage|indexedDB|IDBFactory|openDatabase)\b/

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** Every file a start file loads (relative imports; `import type` / `export type` left out). */
function graph(start: string): string[] {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const f = queue.shift()!
    if (seen.has(f)) continue
    seen.add(f)
    const text = fs.readFileSync(f, 'utf8')
    const specs = [
      ...[...text.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map(m => m[1]),
      ...[...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map(m => m[1]),
      ...[...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
    ]
    for (const s of specs) {
      const r = resolve(f, s)
      if (r && !/\.css$/.test(r)) queue.push(r)
    }
  }
  return [...seen]
}

const rel = (f: string) => path.relative(SRC, f)

describe('the customer portal keeps nothing in the browser', () => {
  const files = graph(path.join(SRC, 'CustomerPortalApp.tsx'))

  // The site plan is the image the server sends (GET /site-plans/<quote>.svg): the drawing code is not loaded any more.
  test('it loads its pages and its server client, nothing of the office', () => {
    const names = files.map(rel)
    expect(names).toEqual(expect.arrayContaining(['CustomerPortalApp.tsx', 'portalApiClient.ts', 'SignaturePad.tsx']))
    for (const office of ['crmAuth.ts', 'portalStaffApi.ts', 'customerStore.ts', 'quoteStore.ts', 'jobStore.ts', 'configStore.ts', 'outbox.ts', 'App.tsx', 'businessStateStore.ts', 'billingStore.ts']) {
      expect(names, office).not.toContain(office)
    }
  })

  test('no file it loads touches localStorage, sessionStorage or IndexedDB', () => {
    const hits = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
      .map((line, i) => (STORAGE.test(line) ? `${rel(f)}:${i + 1}: ${line.trim()}` : null))
      .filter((x): x is string => !!x))
    expect(hits).toEqual([])
  })

  test('it never sends a login header or keeps a token: the cookie does it', () => {
    const client = fs.readFileSync(path.join(SRC, 'portalApiClient.ts'), 'utf8')
    expect(client).toMatch(/credentials:\s*'include'/)
    expect(client).toMatch(/X-Portal-Request/)
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8')
      expect(/Authorization['"]?\s*[:\]]|Bearer /.test(text), rel(f)).toBe(false)
      expect(/accessToken|refreshToken/.test(text), rel(f)).toBe(false)
    }
  })

  test('main.tsx starts the portal on its own: no static import of the office app', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8')
    const staticImports = [...main.matchAll(/^\s*import\s+(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1])
    expect(staticImports.filter(s => s.startsWith('.'))).toEqual([])
    expect(main).toMatch(/startsWith\('#\/portal\/'\)[\s\S]*import\('\.\/CustomerPortalApp'\)/)
    expect(fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8')).not.toMatch(/from '\.\/CustomerPortalApp'/)
  })

  test('the old portal stores are gone', () => {
    expect(fs.existsSync(path.join(SRC, 'portalAccountStore.ts'))).toBe(false)
    const all = fs.readdirSync(SRC).filter(f => /\.(ts|tsx)$/.test(f)).map(f => fs.readFileSync(path.join(SRC, f), 'utf8'))
    expect(all.some(t => t.includes('fencepro_portal_session'))).toBe(false)
    expect(all.some(t => t.includes('fencepro_portal_accounts_cache'))).toBe(false)
  })
})
