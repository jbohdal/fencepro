/**
 * The words in a pdfkit PDF, for tests: each content stream inflated, each
 * text run (Tj / TJ, hex or literal strings) decoded, runs joined with spaces
 * and white space squeezed, so a paragraph wrapped over several lines reads
 * as one line again.
 */

import zlib from 'zlib'

function decodeRun(run: string): string {
  let out = ''
  const re = /<([0-9a-fA-F\s]*)>|\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(run))) {
    if (m[1] !== undefined) {
      const hex = m[1].replace(/\s+/g, '')
      for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
    } else {
      out += m[2].replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[c])
    }
  }
  return out
}

export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  const parts: string[] = []
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let s: RegExpExecArray | null
  while ((s = streams.exec(raw))) {
    let body = s[1]
    try { body = zlib.inflateSync(Buffer.from(s[1], 'latin1')).toString('latin1') } catch { /* not compressed */ }
    if (!/\bBT\b/.test(body)) continue
    const runs = /\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\([^)]*\))\s*Tj/g
    let r: RegExpExecArray | null
    while ((r = runs.exec(body))) parts.push(decodeRun(r[1] ?? r[2]))
  }
  // WinAnsi right single quote (pdfkit writes ' as 0x92 in some fonts) back to a plain one.
  return parts.join(' ').replace(/\x92/g, "'").replace(/\s+/g, ' ').trim()
}
