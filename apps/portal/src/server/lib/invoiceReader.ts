/**
 * Reading an invoice file on this Mac, free: no cloud, no paid service.
 *
 *   - A text PDF is read from its text (PDFKit).
 *   - A photo, or a PDF page that is only a picture (a scan), is read by the
 *     Mac's built in text recognition (Vision). Tesseract can be used instead
 *     (`engine: 'tesseract'`, after `brew install tesseract`) to compare; the
 *     app uses Vision (see the comparison in docs and tests).
 *
 * The helper tools/invoice-reader.swift is compiled with swiftc the first time
 * it is needed, into tools/.bin, and again whenever its source changes.
 *
 * The result is words with their place on the page, grouped into rows (a
 * tilted photo is straightened first), plus a picture of each page to show
 * next to the lines.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'

const run = promisify(execFile)

/**
 * A word and its place on the page (fractions of the page, top left 0,0).
 * `n` is its place in the order the reader gave the words (a text PDF: the
 * order they are drawn), set when rows are made; it is how two totals the PDF
 * puts in one box at one height are told apart (Stephens 2023, parseInvoice).
 */
export interface Word { t: string; x: number; y: number; w: number; h: number; c: number; l?: number; n?: number }
export interface Row {
  /** Index on its page, top to bottom. */
  i: number
  page: number
  text: string
  /** Words split where there is a wide gap (columns). */
  cells: string[]
  words: Word[]
  /** Lowest confidence of any word (1 for PDF text). */
  conf: number
  box: { x: number; y: number; w: number; h: number }
}
export interface ReadPage { page: number; source: 'pdf-text' | 'ocr'; image: string; width: number; height: number; rows: Row[] }
export interface ReadResult { engine: 'vision' | 'tesseract' | 'pdf-text'; ms: number; pages: ReadPage[] }

const TOOLS = process.env.INVOICE_TOOLS_DIR || fileURLToPath(new URL('../../../tools', import.meta.url))
const SWIFT_SRC = path.join(TOOLS, 'invoice-reader.swift')
export const TESSERACT_BIN = process.env.TESSERACT_BIN || (fs.existsSync('/opt/homebrew/bin/tesseract') ? '/opt/homebrew/bin/tesseract' : 'tesseract')

let compiling: Promise<string> | null = null

/** The compiled helper, compiling it first if needed (about 10 s, once). */
export function readerBinary(): Promise<string> {
  if (compiling) return compiling
  compiling = (async () => {
    const src = fs.readFileSync(SWIFT_SRC)
    const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)
    const dir = path.join(TOOLS, '.bin')
    const bin = path.join(dir, `invoice-reader-${hash}`)
    if (fs.existsSync(bin)) return bin
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${bin}.${process.pid}.tmp`
    try {
      await run('xcrun', ['swiftc', '-O', '-o', tmp, SWIFT_SRC], { timeout: 180_000 })
    } catch (err: any) {
      throw new Error(`Could not build the invoice reader with swiftc (Xcode command line tools): ${String(err?.stderr || err?.message || err).slice(0, 300)}`)
    }
    fs.renameSync(tmp, bin)
    return bin
  })().catch(err => { compiling = null; throw err })
  return compiling
}

interface RawPage { source: 'pdf-text' | 'ocr'; width: number; height: number; image: string; words: Word[] }

async function readWithVision(file: string, outDir: string): Promise<RawPage[]> {
  const bin = await readerBinary()
  const { stdout } = await run(bin, [file, outDir], { maxBuffer: 64 * 1024 * 1024, timeout: 300_000 })
  return JSON.parse(stdout).pages as RawPage[]
}

/** Tesseract's words (TSV), with its line numbers so a tilt can be measured. */
async function tesseractWords(image: string): Promise<{ words: Word[]; width: number; height: number }> {
  const { stdout } = await run(TESSERACT_BIN, [image, 'stdout', '--psm', '4', 'tsv'], { maxBuffer: 64 * 1024 * 1024, timeout: 300_000 })
  const lines = stdout.split('\n').slice(1)
  let width = 1, height = 1
  const raw: Array<{ t: string; left: number; top: number; w: number; h: number; c: number; l: number }> = []
  for (const line of lines) {
    const f = line.split('\t')
    if (f.length < 12) continue
    const level = Number(f[0])
    if (level === 1) { width = Number(f[8]); height = Number(f[9]); continue }
    if (level !== 5 || !f[11]?.trim()) continue
    raw.push({ t: f[11].trim(), left: +f[6], top: +f[7], w: +f[8], h: +f[9], c: Math.max(0, +f[10]) / 100, l: Number(f[2]) * 10000 + Number(f[3]) * 100 + Number(f[4]) })
  }
  return { width, height, words: raw.map(r => ({ t: r.t, x: r.left / width, y: r.top / height, w: r.w / width, h: r.h / height, c: r.c, l: r.l })) }
}

async function readWithTesseract(file: string, outDir: string): Promise<RawPage[]> {
  // Pages and their pictures come from the helper; scanned pages and photos are re-read by Tesseract.
  const pages = await readWithVision(file, outDir)
  const isPdf = /\.pdf$/i.test(file)
  for (const p of pages) {
    if (p.source !== 'ocr') continue
    const t = await tesseractWords(isPdf ? p.image : file)
    p.words = t.words
  }
  return pages
}

// ── Words into rows ───────────────────────────────────────────────────────────

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/** The tilt of a photo, from words the reader put on the same line (radians, in page pixels). */
export function measureTilt(words: Word[], aspect: number): number {
  const byLine = new Map<number, Word[]>()
  for (const w of words) if (w.l != null) byLine.set(w.l, [...(byLine.get(w.l) ?? []), w])
  const slopes: number[] = []
  for (const ws of byLine.values()) {
    if (ws.length < 2) continue
    const s = [...ws].sort((a, b) => a.x - b.x)
    const a = s[0], b = s[s.length - 1]
    const dx = (b.x + b.w / 2 - a.x - a.w / 2) * aspect
    if (dx < 0.15 * aspect) continue
    slopes.push(Math.atan2((b.y + b.h / 2) - (a.y + a.h / 2), dx))
  }
  return slopes.length >= 3 ? median(slopes) : 0
}

/**
 * A text PDF word whose box is far wider than its letters could be. PDFKit
 * gives nonsense places for the first word drawn after the text jumps back
 * left (Stephens 06-249853: "HOT" in "HOT DIP" came back 312 pt wide, from
 * the quantity column to past the description), so sorting by place swapped
 * it with its neighbour ("DIP HOT", "BAND BRACE", "LOOP AL CAP", "TIE ALUM").
 * Only for PDF text (`l` unset): a photo's words come from Vision or Tesseract.
 */
export function strayWord(w: Word, aspect: number): boolean {
  if (w.l != null || !(w.h > 0)) return false
  return w.w * aspect > Math.max(1, w.t.length) * w.h * 1.6 + w.h
}

/**
 * Put stray words (above) where they are printed: a PDF gives its text in
 * reading order, so a stray word sits just before the next word on its line
 * (else just after the one before it), sized by its letters.
 */
export function placeStrayWords(words: Word[], aspect: number): Word[] {
  const stray = words.map(w => strayWord(w, aspect))
  if (!stray.some(Boolean)) return words
  const sameLine = (a: Word, b: Word) => Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) < Math.max(a.h, b.h) * 0.6
  return words.map((w, i) => {
    if (!stray[i]) return w
    const width = (w.t.length * w.h * 0.62) / aspect
    const gap = (w.h * 0.3) / aspect
    for (let j = i + 1; j < words.length; j++) {
      if (!sameLine(w, words[j])) break
      if (!stray[j]) return { ...w, x: words[j].x - gap - width, w: width }
    }
    for (let j = i - 1; j >= 0; j--) {
      if (!sameLine(w, words[j])) break
      if (!stray[j]) return { ...w, x: words[j].x + words[j].w + gap, w: width }
    }
    return w
  })
}

/**
 * Group words into rows: straighten by the measured tilt, then put words whose
 * middles are within half a word height of each other on one row.
 * `aspect` is page width / height.
 */
export function wordsToRows(input: Word[], page: number, aspect = 0.77): Row[] {
  if (!input.length) return []
  const words = placeStrayWords(input, aspect)
  const tilt = measureTilt(words, aspect)
  const cos = Math.cos(-tilt), sin = Math.sin(-tilt)
  const placed = words.map((w0, n) => {
    const w = { ...w0, n }
    const cx = (w.x + w.w / 2) * aspect, cy = w.y + w.h / 2
    return { w, sx: cx * cos - cy * sin, sy: cx * sin + cy * cos }
  })
  const hMed = median(words.map(w => w.h)) || 0.01
  placed.sort((a, b) => a.sy - b.sy)
  const groups: Array<typeof placed> = []
  for (const p of placed) {
    const g = groups[groups.length - 1]
    const gy = g ? g.reduce((s, q) => s + q.sy, 0) / g.length : 0
    if (g && Math.abs(p.sy - gy) < hMed * 0.6) g.push(p)
    else groups.push([p])
  }
  return groups.map((g, i) => {
    g.sort((a, b) => a.sx - b.sx)
    const cells: string[] = []
    let cur = ''
    let lastRight = -1
    for (const p of g) {
      const left = p.sx - (p.w.w * aspect) / 2
      // A gap wider than about two letters starts a new column.
      if (cur && left - lastRight > hMed * 1.4) { cells.push(cur); cur = '' }
      cur = cur ? `${cur} ${p.w.t}` : p.w.t
      lastRight = p.sx + (p.w.w * aspect) / 2
    }
    if (cur) cells.push(cur)
    const xs = g.map(p => p.w.x), ys = g.map(p => p.w.y)
    const x2 = g.map(p => p.w.x + p.w.w), y2 = g.map(p => p.w.y + p.w.h)
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...x2) - Math.min(...xs), h: Math.max(...y2) - Math.min(...ys) }
    return { i, page, text: cells.join(' '), cells, words: g.map(p => p.w), conf: Math.min(...g.map(p => p.w.c)), box }
  })
}

/**
 * Read one file. `outDir` gets a picture of each page (page-N.jpg).
 * `firstPage` numbers the pages when several files make one invoice.
 */
export async function readInvoiceFile(file: string, outDir: string, opts: { engine?: 'vision' | 'tesseract'; firstPage?: number } = {}): Promise<ReadResult> {
  const t0 = Date.now()
  fs.mkdirSync(outDir, { recursive: true })
  const engine = opts.engine ?? 'vision'
  const raw = engine === 'tesseract' ? await readWithTesseract(file, outDir) : await readWithVision(file, outDir)
  const first = opts.firstPage ?? 1
  const pages: ReadPage[] = raw.map((p, i) => ({
    page: first + i, source: p.source, image: p.image, width: p.width, height: p.height,
    rows: wordsToRows(p.words, first + i, p.width && p.height ? p.width / p.height : 0.77),
  }))
  const allText = raw.every(p => p.source === 'pdf-text')
  return { engine: allText ? 'pdf-text' : engine, ms: Date.now() - t0, pages }
}
