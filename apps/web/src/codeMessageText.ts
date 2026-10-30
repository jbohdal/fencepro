/**
 * The details of a Message from Code (codeMessages.ts) as simple markdown:
 * split into blocks and inline pieces here, drawn as plain React elements by
 * CodeMessagesPage.tsx (never as HTML, so nothing in a message can run).
 * No imports, so the tests read it as is.
 */

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'para'; text: string }

/**
 * Split the details into blocks: # headings, - or 1. lists, ``` code, > quotes,
 * and paragraphs (their single line breaks kept). Anything else is text.
 */
export function mdBlocks(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: MdBlock[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ type: 'para', text: para.join('\n') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      out.push({ type: 'code', text: code.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { flush(); out.push({ type: 'heading', level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2].trim() }); continue }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const ordered = /\d/.test(li[1])
      const last = out[out.length - 1]
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(li[2])
      else out.push({ type: 'list', ordered, items: [li[2]] })
      continue
    }
    const q = /^\s*>\s?(.*)$/.exec(line)
    if (q) {
      flush()
      const last = out[out.length - 1]
      if (last?.type === 'quote') last.text += '\n' + q[1]
      else out.push({ type: 'quote', text: q[1] })
      continue
    }
    if (!line.trim()) { flush(); continue }
    // A line under a list item that is indented carries on that item.
    const last = out[out.length - 1]
    if (!para.length && /^\s{2,}\S/.test(line) && last?.type === 'list') { last.items[last.items.length - 1] += '\n' + line.trim(); continue }
    para.push(line)
  }
  flush()
  return out
}

export type MdSpan = { type: 'text' | 'bold' | 'code' | 'link'; text: string; href?: string }

/** Inline: **bold**, `code`, [words](https://link) and bare https links. Only http(s) links are links. */
export function mdSpans(text: string): MdSpan[] {
  const out: MdSpan[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>]+)/g
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ type: 'text', text: text.slice(at, m.index) })
    if (m[1] !== undefined) out.push({ type: 'bold', text: m[1] })
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] })
    else if (m[3] !== undefined) out.push({ type: 'link', text: m[3], href: m[4] })
    else out.push({ type: 'link', text: m[5], href: m[5] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) })
  return out
}
