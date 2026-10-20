/**
 * Tesseract or the Mac's Vision: which reads invoice photos better?
 *
 *   pnpm exec tsx scripts/invoice-ocr-compare.ts
 *
 * Reads the test photo (tests/fixtures/invoices/photo.jpg) and harder copies
 * of it (half size and blurred; quarter size), each 3 times with each reader,
 * and prints character accuracy against what is printed on it (edit distance
 * over the rows, spaces ignored), number accuracy (every amount and quantity
 * read exactly), whether the invoice passes the total check, and time.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { readInvoiceFile } from '../src/server/lib/invoiceReader.js'
import { parseInvoice } from '../src/server/lib/invoiceParse.js'
import { checkTotals } from '../src/server/lib/invoiceMath.js'
import { PHOTO } from './make-test-invoices.js'

const FIX = fileURLToPath(new URL('../tests/fixtures/invoices', import.meta.url))
const FFMPEG = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'

const truthRows = [
  ...PHOTO.vendor, 'INVOICE', `Invoice No: ${PHOTO.number}`, `Invoice Date: ${PHOTO.date}`, 'Page 1 of 1', 'Sold To: Getter Done Fence',
  'ITEM # DESCRIPTION QTY UM PRICE AMOUNT',
  ...PHOTO.lines.map(l => `${l.item} ${l.desc} ${l.qty} ${l.um} ${l.price} ${l.amount}`),
  `Subtotal ${PHOTO.subtotal}`, `Sales Tax ${PHOTO.tax}`, `Freight ${PHOTO.freight}`, `TOTAL ${PHOTO.total}`, 'Terms: Net 30. Thank you for your business.',
]
const squash = (s: string) => s.replace(/\s+/g, '')
const numbers = (s: string) => (s.match(/\d[\d,]*\.?\d*/g) ?? []).map(x => x.replace(/,/g, ''))

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return dp[b.length]
}

async function measure(file: string, engine: 'vision' | 'tesseract') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cmp-'))
  try {
    const times: number[] = []
    let text = '', ok = false
    for (let k = 0; k < 3; k++) {
      const r = await readInvoiceFile(file, path.join(tmp, String(k)), { engine })
      times.push(r.ms)
      text = r.pages.flatMap(p => p.rows.map(x => x.text)).join('\n')
      const p = parseInvoice(r.pages)
      ok = checkTotals(p.lines, { ...p, feesCents: p.fees.reduce((s, f) => s + f.cents, 0) }).ok
    }
    const want = squash(truthRows.join('')), got = squash(text)
    const charAcc = 1 - editDistance(got, want) / want.length
    const wantNums = numbers(truthRows.join(' ')), gotNums = new Set(numbers(text))
    const numAcc = wantNums.filter(n => gotNums.has(n)).length / wantNums.length
    return { charAcc, numAcc, ok, ms: times.sort((a, b) => a - b)[1] }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-variants-'))
  try {
    const photo = path.join(FIX, 'photo.jpg')
    const half = path.join(tmp, 'half-blur.jpg'), quarter = path.join(tmp, 'quarter.jpg')
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', photo, '-vf', 'scale=iw/2:-1,gblur=sigma=1.2', '-q:v', '6', half])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', photo, '-vf', 'scale=iw/4:-1', '-q:v', '8', quarter])
    console.log('photo                 reader      chars   numbers  total check   time (median of 3)')
    for (const [name, file] of [['photo (1872 px)', photo], ['half size, blurred', half], ['quarter size (468 px)', quarter]] as const) {
      for (const engine of ['vision', 'tesseract'] as const) {
        const m = await measure(file, engine)
        console.log(`${name.padEnd(22)}${engine.padEnd(12)}${(m.charAcc * 100).toFixed(1).padStart(5)}%  ${(m.numAcc * 100).toFixed(0).padStart(5)}%    ${(m.ok ? 'passes' : 'FAILS').padEnd(12)}${(m.ms / 1000).toFixed(2)} s`)
      }
    }
    console.log('\nTimes include drawing the page picture (about the same for both).')
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

main().catch(err => { console.error(err); process.exit(1) })
