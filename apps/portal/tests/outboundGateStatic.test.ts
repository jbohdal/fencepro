/**
 * Every call in the server that can reach a real person goes through the
 * outbound gate (lib/outboundGate.ts). Reads the source, touches nothing.
 *
 * A "reaching" call is: web-push's sendNotification, nodemailer's sendMail,
 * SendGrid's mail send, Twilio's Messages, Gmail's messages.send, a Google
 * Calendar event or calendar write, and a POST fetch to an address held in a
 * variable (webhooks). Each must have a gate check (outboundBlockReason,
 * realDeliveryAllowed, or a helper named held...) in the same function, before
 * the call. A call that cannot reach a person says why in a comment starting
 * "not a person:" on one of the three lines above it.
 * (Oct 26, 2026: dev test runs pushed to Jonathan's phone through call sites
 * that had no check.)
 */

import fs from 'fs'
import path from 'path'
import { describe, test, expect } from 'vitest'

const ROOTS = [path.resolve(__dirname, '../src/server'), path.resolve(__dirname, '../scripts')]

const REACHING: Array<{ name: string; re: RegExp }> = [
  { name: 'web push', re: /webpush\.sendNotification\(/ },
  { name: 'SMTP send', re: /\.sendMail\(/ },
  { name: 'SendGrid', re: /api\.sendgrid\.com\/v3\/mail/ },
  { name: 'Twilio text', re: /api\.twilio\.com[^\n]*Messages/ },
  { name: 'Gmail send', re: /messages\.send\(/ },
  { name: 'Google Calendar write', re: /\b(events|calendars)\.(insert|update|delete|patch)\(/ },
  { name: 'POST to an address in a variable', re: /\bfetch\(\s*[a-z_][\w.]*\s*,\s*\{[^}]*method:\s*'POST'/s },
]
const GATE = /outboundBlockReason\(|realDeliveryAllowed\(|\bheld[A-Z]\w*\(/
/** The start of the function a line is in: a function declaration or a method / arrow member. */
const FN_HEAD = /^\s*(export\s+)?(async\s+)?function\b|^\s+(async\s+)?(?!(if|for|while|switch|catch|return)\b)[a-zA-Z]\w*\s*\([^()]*\)\s*(:\s*[^={]+)?\{\s*$/
/** Calls that cannot reach a person, by file, with the reason. */
const NOT_A_PERSON: Record<string, { what: string; why: string }> = {
  'src/server/routes/proposal.ts': { what: 'POST to an address in a variable', why: "the proposal page's own browser script posting view beats back to this server" },
}

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : []
  })
}

export function ungatedCalls(src: string): Array<{ line: number; what: string }> {
  const lines = src.split('\n')
  const out: Array<{ line: number; what: string }> = []
  for (const { name, re } of REACHING) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of src.matchAll(g)) {
      const lineNo = src.slice(0, m.index!).split('\n').length // 1-based
      const above = lines.slice(Math.max(0, lineNo - 4), lineNo).join('\n')
      if (/not a person:/.test(above)) continue
      // Walk back to the function this call is in; the gate must be between its head and the call.
      let head = lineNo - 1
      while (head > 0 && !FN_HEAD.test(lines[head])) head--
      const body = lines.slice(head, lineNo).join('\n')
      if (GATE.test(body)) continue
      out.push({ line: lineNo, what: name })
    }
  }
  return out
}

describe('every call that can reach a person goes through the outbound gate', () => {
  test('the checker finds an ungated send and passes a gated one', () => {
    expect(ungatedCalls(`async function a() {\n  await webpush.sendNotification(sub, p)\n}`)).toHaveLength(1)
    expect(ungatedCalls(`async function a() {\n  if (outboundBlockReason()) return\n  await webpush.sendNotification(sub, p)\n}`)).toHaveLength(0)
    expect(ungatedCalls(`async function a(url) {\n  await fetch(url, { method: 'POST', body })\n}`)).toHaveLength(1)
    expect(ungatedCalls(`async function a() {\n  await cal.events.insert({})\n}`)).toHaveLength(1)
    expect(ungatedCalls(`async function a() {\n  // not a person: the token endpoint\n  await fetch(url, { method: 'POST' })\n}`)).toHaveLength(0)
    // A gate in an earlier function does not count.
    expect(ungatedCalls(`function b() { outboundBlockReason() }\nasync function a() {\n  await gmail.users.messages.send({})\n}`)).toHaveLength(1)
  })

  test('the server and its scripts', () => {
    const found: string[] = []
    let calls = 0
    for (const root of ROOTS) {
      for (const f of files(root)) {
        const src = fs.readFileSync(f, 'utf8')
        for (const { re } of REACHING) calls += (src.match(new RegExp(re.source, re.flags + 'g')) || []).length
        const rel = path.relative(path.resolve(__dirname, '..'), f)
        for (const u of ungatedCalls(src)) if (NOT_A_PERSON[rel]?.what !== u.what) found.push(`${rel}:${u.line} ${u.what}`)
      }
    }
    expect(found).toEqual([])
    // The senders this guards are really there (a rename must not empty the check).
    expect(calls).toBeGreaterThanOrEqual(10)
  })

  test('the gate is read inside the lowest level senders', () => {
    const lib = path.resolve(__dirname, '../src/server')
    const read = (p: string) => fs.readFileSync(path.join(lib, p), 'utf8')
    expect(read('lib/automations/push.ts')).toMatch(/const realSender[\s\S]*outboundBlockReason\(\)[\s\S]*webpush\.sendNotification/)
    expect(read('lib/sms.ts')).toMatch(/export async function sendSms[^]*?outboundBlockReason\(\)[^]*?api\.twilio\.com/)
    expect(read('lib/emailService.ts')).toMatch(/async function sendViaSendGrid[^]*?heldEmail\(/)
    expect(read('lib/emailService.ts')).toMatch(/async function sendViaSmtp[^]*?heldEmail\(/)
    // No call site decides by itself any more.
    for (const f of files(lib)) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/pushDeliveryAllowed/)
  })
})
