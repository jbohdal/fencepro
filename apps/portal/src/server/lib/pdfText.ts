/**
 * Text the PDFs can draw.
 *
 * Every PDF here (contracts, change orders, the walkthrough certificate,
 * receipts, pull sheets, permit packets, invoices) uses pdfkit's built in
 * Helvetica, which only has the WinAnsi characters. pdfkit writes any other
 * character as its raw code, so "→" (U+2192) came out as "!'" on the signed
 * change order. pdfSafeText turns each character the font cannot draw into
 * readable text ("→" becomes "to", "≥" becomes ">=", "é" stays, "ő" becomes
 * "o", an emoji is dropped), and pdfDocument makes a PDFDocument whose text
 * drawing and measuring always go through it.
 */

import PDFDocument from 'pdfkit'

/** Unicode characters outside Latin-1 that Helvetica (WinAnsi) can draw. */
const WIN_ANSI_EXTRA = new Set([
  0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021,
  0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
])

export function pdfCanDraw(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return c === 0x0a || c === 0x09 || c === 0x0d || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(c)
}

/** Readable stand ins for characters the font cannot draw. */
const STAND_IN: Record<string, string> = {
  // arrows: "40 ft → 50 ft" reads "40 ft to 50 ft"
  '→': ' to ', '⟶': ' to ', '⇒': ' to ', '➜': ' to ', '➔': ' to ', '➝': ' to ', '▶': ' to ', '►': ' to ',
  '←': ' from ', '⟵': ' from ', '⇐': ' from ',
  '↔': ' / ', '⇔': ' / ', '↑': ' up ', '↓': ' down ',
  // math and measures
  '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '—', '⁃': '-',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '∼': '~', '⁄': '/', '∕': '/',
  '′': "'", '″': '"', '‴': "'''", 'ʹ': "'", 'ʺ': '"',
  '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
  '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
  '№': 'No.', '℉': '°F', '℃': '°C',
  // quotes and marks
  '‛': "'", '‟': '"', '❛': "'", '❜': "'", '❝': '"', '❞': '"',
  '∙': '·', '⋅': '·', '●': '•', '◦': '•', '▪': '•', '■': '•', '□': '-', '‣': '•', '⁌': '•', '⁍': '•',
  '✓': 'Yes', '✔': 'Yes', '☑': 'Yes', '✗': 'No', '✘': 'No', '☐': '-', '✕': 'x', '✖': 'x',
  '★': '*', '☆': '*', '⚠': '!',
  // thin, narrow, figure and other spaces become a plain space; invisible ones go
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  ' ': '\n', ' ': '\n',
  '​': '', '‌': '', '‍': '', '⁠': '', '﻿': '', '️': '', '︎': '',
}

/** The text with every character the PDF font cannot draw made readable. */
export function pdfSafeText(s: string): string {
  if (!s) return s
  let out = ''
  let changed = false
  let spaceOwed = false // a stand in's trailing space, written only before more text
  const put = (t: string) => {
    if (!t) return
    if (spaceOwed && !/^\s/.test(t)) out += ' '
    spaceOwed = false
    out += t
  }
  for (const ch of s) {
    if (pdfCanDraw(ch)) { put(ch); continue }
    changed = true
    let stand = STAND_IN[ch]
    if (stand === undefined) {
      // An accented letter the font lacks ("ő"): its plain letter.
      const plain = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')
      const c = ch.codePointAt(0) ?? 0
      if (plain && plain !== ch && [...plain].every(pdfCanDraw)) stand = plain
      // Pictures (emoji, symbols) and control characters are dropped; anything else shows as "?".
      else stand = c < 0x20 || (c >= 0x7f && c < 0xa0) || c >= 0x2190 ? '' : '?'
    }
    if (stand.trim() && (stand.startsWith(' ') || stand.endsWith(' '))) {
      // " to ": no doubled space next to the spaces the writer already typed.
      let t = stand
      if (t.startsWith(' ') && (out === '' || /\s$/.test(out) || spaceOwed)) t = t.trimStart()
      const owes = t.endsWith(' ')
      put(owes ? t.trimEnd() : t)
      spaceOwed = owes
    } else put(stand)
  }
  return changed ? out : s
}

type Doc = PDFKit.PDFDocument

/** A PDFDocument whose text, widthOfString and heightOfString only see drawable text. */
export function pdfDocument(options?: PDFKit.PDFDocumentOptions): Doc {
  const doc = new PDFDocument(options)
  const text = doc.text.bind(doc) as (...a: unknown[]) => Doc
  const widthOfString = doc.widthOfString.bind(doc) as (...a: unknown[]) => number
  const heightOfString = doc.heightOfString.bind(doc) as (...a: unknown[]) => number
  const safe = (t: unknown) => (typeof t === 'string' ? pdfSafeText(t) : t)
  const d = doc as unknown as Record<string, unknown>
  d.text = (t: unknown, ...rest: unknown[]) => text(safe(t), ...rest)
  d.widthOfString = (t: unknown, ...rest: unknown[]) => widthOfString(safe(t), ...rest)
  d.heightOfString = (t: unknown, ...rest: unknown[]) => heightOfString(safe(t), ...rest)
  return doc
}
