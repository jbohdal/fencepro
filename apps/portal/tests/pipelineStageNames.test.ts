/**
 * No stage names in the code. The 13 start stages' names are their permanent
 * ids, written only in pipelineStageModel.ts (START_IDS). Everything else
 * asks what a stage is for (its group or role), so renaming "Signed Contract"
 * to "Sold" in Settings breaks nothing and no old name shows anywhere.
 *
 * Fails on any of the 13 names in the app's source (comments aside) outside
 * the model and the tests. "Appointment" is also an everyday word (an
 * appointment's type, an audit record's kind): only a quoted 'Appointment'
 * compared with or used as a stage counts, and the known other uses are
 * listed below with why.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { START_IDS } from '../src/server/lib/pipelineStageModel.js'
import { withoutComments } from './fixtures/sourceScan'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOTS = ['../src', '../scripts', '../../web/src'].map(r => path.resolve(here, r))
const MODEL = new Set(['pipelineStageModel.ts'])

/** Lines allowed to hold a name, by file: [a piece of the line, why]. */
const ALLOWED: Record<string, Array<[string, string]>> = {
  'import-jobnimbus.ts': [
    ["'Paid & Closed':", 'JobNimbus\'s own status word, read from its export'],
    ["'No Answer':", 'JobNimbus\'s own status word, read from its export'],
    ["r.status === 'Paid & Closed'", 'JobNimbus\'s own status word, read from its export'],
    ["r.status !== 'Paid & Closed'", 'JobNimbus\'s own status word, read from its export'],
    ['Paid & Closed with $0', 'the import log, about JobNimbus statuses'],
    ['2024 Paid & Closed jobs', 'the import log, about JobNimbus statuses'],
  ],
}

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dist') out.push(...files(p)); continue }
    if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const NAMES = Object.values(START_IDS).filter(n => n !== START_IDS.appointment)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')
const NAME_RE = new RegExp(`\\b(${NAMES.map(esc).join('|')})\\b`)
// 'Appointment' as a stage: compared with a stage, a stage's value, or in a list of stages.
const APPT_RE = /(stage\w*\s*(===|!==|==|:|=)\s*['"`]Appointment['"`])|(['"`]Appointment['"`]\s*(===|!==)\s*\w*stage)|(\[\s*['"`][^'"`]+['"`]\s*,\s*['"`]Appointment['"`])|(['"`]Appointment['"`]\s*:\s*(PENDING|\[|\{|0\.|'bg-))|includes\(\s*['"`]Appointment['"`]|indexOf\(\s*['"`]Appointment['"`]/

describe('stage names live only in the model', () => {
  test('none of the 13 names appears in the app\'s code outside pipelineStageModel.ts', () => {
    const hits: string[] = []
    let scanned = 0
    for (const root of ROOTS) {
      for (const f of files(root)) {
        scanned++
        const base = path.basename(f)
        if (MODEL.has(base)) continue
        const lines = withoutComments(readFileSync(f, 'utf8')).split('\n')
        lines.forEach((line, i) => {
          if (!NAME_RE.test(line) && !APPT_RE.test(line)) return
          if ((ALLOWED[base] ?? []).some(([piece]) => line.includes(piece))) return
          hits.push(`${path.relative(path.resolve(here, '../..'), f)}:${i + 1}: ${line.trim().slice(0, 160)}`)
        })
      }
    }
    expect(scanned).toBeGreaterThan(300)
    expect(hits).toEqual([])
  })

  test('the check itself finds a name in code and skips one in a comment', () => {
    expect(NAME_RE.test(withoutComments("if (stage === 'Signed Contract') go()"))).toBe(true)
    expect(NAME_RE.test(withoutComments('// moves it to Signed Contract\nconst a = 1'))).toBe(false)
    expect(NAME_RE.test(withoutComments("const u = 'http://x' // Lost Sale"))).toBe(false)
    expect(APPT_RE.test("if (lead.stage === 'Appointment')")).toBe(true)
    expect(APPT_RE.test("other: 'Appointment',")).toBe(false)
    expect(APPT_RE.test("await audit(req, 'create', 'Appointment', a.id)")).toBe(false)
  })
})
