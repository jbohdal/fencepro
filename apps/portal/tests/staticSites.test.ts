/**
 * One process serves the API, the web app and the customer portal.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { mountStaticSites } from '../src/server/lib/staticSites.js'

let tmp: string
let server: Server
let base: string

function listen(app: express.Express): Promise<Server> {
  return new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-static-'))
  const web = path.join(tmp, 'web')
  const portal = path.join(tmp, 'portal')
  for (const dir of [web, portal]) fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(web, 'index.html'), '<html>WEB APP</html>')
  fs.writeFileSync(path.join(web, 'favicon.svg'), '<svg/>')
  fs.writeFileSync(path.join(web, 'assets', 'index-abc123.js'), 'console.log("web")')
  fs.writeFileSync(path.join(web, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(portal, 'index.html'), '<html>PORTAL</html>')
  fs.writeFileSync(path.join(portal, 'assets', 'index-def456.js'), 'console.log("portal")')
  fs.writeFileSync(path.join(tmp, 'outside.txt'), 'outside the web folder')

  const app = express()
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }) })
  app.get('/api/files/photo.png', (_req, res) => { res.json({ from: 'api' }) })
  mountStaticSites(app, { webDistDir: web, portalDistDir: portal })
  server = await listen(app)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('API routes are matched first', () => {
  test('an API route still answers', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
  test('an API path that looks like a file is still the API', async () => {
    const res = await fetch(`${base}/api/files/photo.png`)
    expect(await res.json()).toEqual({ from: 'api' })
  })
  test('an unknown API path is a JSON 404, never index.html', async () => {
    for (const method of ['GET', 'POST']) {
      const res = await fetch(`${base}/api/no-such-thing`, { method })
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toMatch(/json/)
      expect(await res.text()).not.toContain('WEB APP')
    }
  })
})

describe('web app at /', () => {
  test('/ is index.html and is not cached', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('WEB APP')
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })
  test('any other page path is index.html and is not cached', async () => {
    const res = await fetch(`${base}/reset-password?token=abc`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('WEB APP')
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })
  test('/assets files are cached for a long time', async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"web"')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })
  test('a missing asset is a 404, not index.html', async () => {
    const res = await fetch(`${base}/assets/index-old000.js`)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('WEB APP')
  })
  test('other real files in the build are served', async () => {
    const res = await fetch(`${base}/favicon.svg`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<svg/>')
  })
  test('a POST to a page path is not answered with index.html', async () => {
    const res = await fetch(`${base}/anything`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('customer portal at /portal/', () => {
  test('/portal/ is the portal index.html and is not cached', async () => {
    for (const p of ['/portal/', '/portal', '/portal/invoices']) {
      const res = await fetch(`${base}${p}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('PORTAL')
      expect(res.headers.get('cache-control')).toBe('no-cache')
    }
  })
  test('/portal/assets comes from the portal build, cached for a long time', async () => {
    const res = await fetch(`${base}/portal/assets/index-def456.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"portal"')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })
  test('the two builds do not see each other\'s assets', async () => {
    expect((await fetch(`${base}/portal/assets/index-abc123.js`)).status).toBe(404)
    expect((await fetch(`${base}/assets/index-def456.js`)).status).toBe(404)
  })
})

describe('nothing outside the build folders is readable', () => {
  test('path tricks and hidden files never return a file', async () => {
    for (const p of ['/..%2Foutside.txt', '/%2e%2e/outside.txt', '/assets/..%2F..%2Foutside.txt', '/portal/..%2F..%2Foutside.txt', '/.env']) {
      const res = await fetch(`${base}${p}`)
      const body = await res.text()
      expect(body).not.toContain('outside the web folder')
      expect(body).not.toContain('SECRET=1')
    }
  })
})

describe('off by default', () => {
  test('with no folders set, nothing is mounted', async () => {
    const app = express()
    app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }) })
    mountStaticSites(app, {})
    const s = await listen(app)
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
    expect((await fetch(`${url}/`)).status).toBe(404)
    await new Promise(resolve => s.close(resolve))
  })
  test('a folder without index.html is skipped', async () => {
    const app = express()
    mountStaticSites(app, { webDistDir: path.join(tmp, 'does-not-exist') })
    const s = await listen(app)
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    expect((await fetch(`${url}/`)).status).toBe(404)
    await new Promise(resolve => s.close(resolve))
  })
})
