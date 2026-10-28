/**
 * The app's own pictures are small (audit #17, Oct 27 2026: iPhone Safari
 * "A problem repeatedly occurred").
 *
 * The office app showed the company logo from /logo.png, a 2400 x 2400 photo
 * (23 MB once Safari opens it), in a 32 to 56 px box on every page: the sign in
 * page, the top bar and the side menu. Each page load opened it again and
 * Safari's page kept about 57 MB more each time (Playwright WebKit, iPhone
 * size: the sign in page alone grew 57 MB a load, 23 MB of it in the GPU
 * process; with the 240 px logo, 14 MB, and the GPU none). The app now uses
 * /logo-240.png. /logo.png stays, full size, for the proposal and the papers.
 *
 * Checks every picture the app's code names by a fixed address (src="/x.png")
 * is a file in web/public no bigger than 512 x 512.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const WEB = path.resolve(__dirname, '../../web')
const SRC = path.join(WEB, 'src')
const MAX = 512

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return files(p)
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

/** Width and height of a PNG from its header. */
function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file)
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('the office app shows small pictures', () => {
  const used = new Map<string, string[]>()
  for (const f of files(SRC)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/src="(\/[\w./-]+\.png)"/g)) {
      used.set(m[1], [...(used.get(m[1]) ?? []), path.relative(SRC, f)])
    }
  }

  test('the app shows the logo from the small file, never the 2400 px one', () => {
    expect(used.has('/logo-240.png')).toBe(true)
    expect(used.get('/logo.png') ?? []).toEqual([])
  })

  test(`every picture the app names is in web/public and at most ${MAX} x ${MAX}`, () => {
    for (const [src, where] of used) {
      const file = path.join(WEB, 'public', src)
      expect(fs.existsSync(file), `${src} (${where.join(', ')})`).toBe(true)
      const { w, h } = pngSize(file)
      expect(Math.max(w, h), `${src} is ${w} x ${h} (${where.join(', ')})`).toBeLessThanOrEqual(MAX)
    }
  })

  test('the full size logo is still there for the proposal and the papers', () => {
    expect(pngSize(path.join(WEB, 'public', 'logo.png')).w).toBeGreaterThanOrEqual(1000)
  })
})
