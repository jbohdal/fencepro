/**
 * Every list query on a record that can be deleted filters deletedAt on that
 * record itself (Oct 20, 2026: deleting a customer left their card on the
 * pipeline and their job on the operations board, because the boards only
 * looked at the customer).
 *
 * Reads the server's source: each findMany, count, aggregate and groupBy on a
 * customer, quote, job, appointment, schedule entry, change order or intake
 * row must name deletedAt in its arguments. One that rightly reads deleted rows
 * too (by id lists already filtered, the sold stamp, the stage usage counts of
 * the scheduled deletion) says so in a comment starting "all rows:" on the line
 * above (or a few lines above, over a Promise.all of them). No database is touched.
 */

import fs from 'fs'
import path from 'path'
import { describe, test, expect } from 'vitest'

const ROOT = path.resolve(__dirname, '../src/server')
const MODELS = ['crmContact', 'savedQuote', 'savedJob', 'appointment', 'scheduledGridJob', 'changeOrder', 'intakeLead']
const LISTS = ['findMany', 'count', 'aggregate', 'groupBy']
const CALL = new RegExp(`\\.(${MODELS.join('|')})\\.(${LISTS.join('|')})\\(`, 'g')

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.ts$/.test(e.name) ? [p] : []
  })
}

/** The text between the call's parentheses. */
function argsAt(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i)
  }
  return src.slice(open + 1)
}

export function unfilteredLists(src: string): Array<{ line: number; call: string }> {
  const out: Array<{ line: number; call: string }> = []
  for (const m of src.matchAll(CALL)) {
    const at = m.index!
    const args = argsAt(src, at + m[0].length - 1)
    if (/deletedAt/.test(args)) continue
    const lineNo = src.slice(0, at).split('\n').length
    const before = src.split('\n').slice(Math.max(0, lineNo - 6), lineNo).join('\n')
    if (/all rows:/.test(before)) continue
    out.push({ line: lineNo, call: `${m[1]}.${m[2]}` })
  }
  return out
}

describe('list queries filter deletedAt on the record they list', () => {
  test('the checker finds a list without deletedAt and passes one with it', () => {
    expect(unfilteredLists('prisma.savedJob.findMany({ where: { accountId } })')).toHaveLength(1)
    expect(unfilteredLists('prisma.savedJob.findMany({ where: { accountId, deletedAt: null } })')).toHaveLength(0)
    expect(unfilteredLists('// all rows: the sold stamp\nprisma.savedQuote.count({ where: { accountId } })')).toHaveLength(0)
  })

  test('every server list query on a deletable record names deletedAt', () => {
    const bad = files(ROOT)
      .filter(f => !f.endsWith(`${path.sep}deletion.ts`))
      .flatMap(f => unfilteredLists(fs.readFileSync(f, 'utf8')).map(x => `${path.relative(ROOT, f)}:${x.line} ${x.call}`))
    expect(bad).toEqual([])
  })
})
