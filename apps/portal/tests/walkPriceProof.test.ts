/**
 * The walk list's price proof (Jonathan, Nov 5 2026: "Take every existing
 * quote that has a drawing. Build the equivalent walk list ... price both, and
 * compare ... Every one must match exactly."). Reads a copy of the quotes,
 * Settings, Inventory, kits and Good / Better / Best taken read only
 * (PROOF_DIR: quotes.json, config.json, inventory.json, tiersets.json); prices
 * each quote's drawing as the quote builder does and the walk list made from
 * it (yardToWalk, walkToYard), and compares per run sections and the 6 or 8 ft
 * pick, post counts by type, the gate list, the pull sheet parts, cost and the
 * customer's price for Good, Better and Best. Skipped without PROOF_DIR.
 *
 * Sketch and measure (Nov 6 2026): each walk list quote made into a sketch and
 * back (walkToSketch, sketchToWalk) prices the same as its walk list, and each
 * drawing walked, sketched and walked again prices the same as the drawing.
 */

import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { quoteJobFor } from '../../web/src/estimate'
import { deriveLayout, teePostFor, type YardLayout } from '../../web/src/yardLayout'
import { layoutPanelFt } from '../../web/src/gateSlide'
import { walkToYard, yardToWalk, type WalkList } from '../../web/src/walkList'
import { sketchToWalk, walkToSketch } from '../../web/src/sketch'

const DIR = process.env.PROOF_DIR
describe.skipIf(!DIR)('walk list price proof (every quote with a drawing)', () => {
  test('each drawing and its walk list price exactly the same', () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR!, f), 'utf8'))
    const quotes = read('quotes.json') as any[]
    const config = read('config.json'), inv = read('inventory.json'), sets = read('tiersets.json') as any[]
    const data = { config, inventory: inv.items ?? [], kits: inv.kits ?? [] }
    const styleOf = (name: string) => (config.fenceStyles ?? []).find((s: any) => s.name === name)
    const results: Array<{ id: string; ok: boolean; why?: string }> = []
    const sketchDrawn: typeof results = [], sketchWalked: typeof results = []
    for (const q of quotes) {
      const yard = q.layout?.yard as YardLayout
      const style = styleOf(q.fenceStyle)
      if (!yard || !Array.isArray(yard.sides) || !style) { if ((q.layout?.walk as WalkList | undefined)?.lines) sketchWalked.push({ id: q.id, ok: false, why: 'walk list quote not priced: no yard or style' }); results.push({ id: q.id, ok: false, why: !style ? `fence style ${q.fenceStyle} is not in Settings` : 'no drawing' }); continue }
      const nearIn = layoutPanelFt(style) * 12
      const teeAs = teePostFor(style)
      const walk = yardToWalk(yard, nearIn)
      const priced = (y: YardLayout) => {
        const r = deriveLayout(y, nearIn, { teeAs })
        const work = q.work && typeof q.work === 'object' ? q.work : null
        const set = q.proposal?.tierSet ?? sets.find(s => String(s.category).trim().toLowerCase() === String(style.category ?? '').trim().toLowerCase()) ?? null
        const req: any = {
          fenceStyle: q.fenceStyle, runs: r.runs.map(x => ({ ft: x.ft, rail: 'auto' })), corners: r.corners, ends: r.ends, walkGates: r.walkGates, dblGates: r.dblGates,
          gateWidths: r.gateWidthsFt, ...(r.linePosts ? { extraLinePosts: r.linePosts } : {}),
          ...(yard.cornersOverride == null && yard.endsOverride == null && r.tees ? { tees: r.tees } : {}),
          tearOutSections: q.tearOutSections ?? 0, tearOutGates: q.tearOutGates ?? 0, extraLaborHrs: q.adjLaborHrs ?? 0, hasSalesman: !!q.hasSalesman, priceAdjust: q.priceAdjust ?? 0,
          overrides: q.pricing ?? {}, jobType: work?.type ?? 'new', move: work?.move ?? null, repair: work?.repair ?? null,
          tierSet: set, tierPrefs: q.proposal?.tierPrefs ?? { off: [], swap: {} },
        }
        const job = quoteJobFor(data as any, req, typeof q.pricing?.overheadPct === 'number' ? q.pricing.overheadPct : undefined)
        return {
          runs: r.runs.map(x => x.ft), sections: job.calc.perRunSections, rails: job.calc.perRunRail,
          posts: { corners: r.corners, ends: r.ends, lines: r.linePosts, tees: r.tees }, gates: { walk: r.walkGates, dbl: r.dblGates, widths: r.gateWidthsFt },
          parts: (job.pullSheet ?? []).map((l: any) => [l.item, l.qty, Math.round((l.unitCost ?? 0) * 100)]),
          cost: Math.round(job.totals.totalCOGS * 100), price: Math.round(job.totals.price * 100),
          tiers: (job.tiers ?? []).map((t: any) => [t.spec?.key, t.style?.name ?? null, t.option ? Math.round(t.option.finalPrice * 100) : null, t.option?.sections ?? null]),
        }
      }
      const cmp = (label: string, list: typeof results, a: ReturnType<typeof priced>, b: ReturnType<typeof priced>) => {
        const ok = JSON.stringify(a) === JSON.stringify(b)
        let why: string | undefined
        if (!ok) for (const k of Object.keys(a) as Array<keyof typeof a>) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { why = `${k}: ${label} ${JSON.stringify(a[k]).slice(0, 160)} vs ${JSON.stringify(b[k]).slice(0, 160)}`; break }
        list.push({ id: q.id, ok, ...(why ? { why } : {}) })
      }
      const a = priced(yard)
      cmp('drawing / walk', results, a, priced(walkToYard(walk)))
      cmp('drawing / sketch', sketchDrawn, a, priced(walkToYard(sketchToWalk(walkToSketch(walk)))))
      const own = q.layout?.walk as WalkList | undefined
      if (own && Array.isArray(own.lines)) cmp('walk list / sketch', sketchWalked, priced(walkToYard(own)), priced(walkToYard(sketchToWalk(walkToSketch(own)))))
    }
    for (const [name, list] of [['drawings walked, sketched and walked again', sketchDrawn], ['walk list quotes as sketches', sketchWalked]] as const) {
      const bad = list.filter(r => !r.ok)
      console.log(`[sketch price proof] ${name}: ${list.length} tested, ${list.length - bad.length} the same, ${bad.length} different`)
      for (const r of bad) console.log(`[sketch price proof] ${r.id}: ${r.why}`)
      expect(bad, name).toEqual([])
    }
    const bad = results.filter(r => !r.ok)
    console.log(`[walk price proof] ${results.length} quotes with a drawing tested: ${results.length - bad.length} the same, ${bad.length} different`)
    for (const r of bad) console.log(`[walk price proof] ${r.id}: ${r.why}`)
    fs.writeFileSync(path.join(DIR!, 'proof-result.json'), JSON.stringify({ tested: results.length, same: results.length - bad.length, different: bad, sketch: { drawn: sketchDrawn.length, drawnDifferent: sketchDrawn.filter(r => !r.ok), walked: sketchWalked.length, walkedDifferent: sketchWalked.filter(r => !r.ok) } }, null, 1))
    expect(bad).toEqual([])
  }, 600_000)
})
