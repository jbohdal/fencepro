/**
 * The quote builder's fence move and repair screens (moveRepair.ts does the
 * math): Job type at the Style step, the old line for a move, the "What
 * happened?" price list for a repair, and the internal cost breakdown on the
 * Price step (owner, admins, managers and the office only).
 */

import { useState } from 'react'
import SitePlan from './SitePlan'
import type { LayoutResult, YardLayout } from './yardLayout'
import {
  REPAIR_ITEMS, REPAIR_LABEL, REPAIR_HINT, WHAT_HAPPENED, starterNote, isStarterItem, oldLine as oldLineFacts, workWidth, repairPartChoices,
  type JobType, type MoveInputs, type RepairInputs, type RepairItemKey, type WorkResult, type PostType,
} from './moveRepair'
import type { QuoteStyle } from './quoteCalc'

const fmt = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

export function JobTypePicker({ value, onChange }: { value: JobType; onChange: (t: JobType) => void }) {
  const opts: Array<[JobType, string]> = [['new', 'New fence'], ['move', 'Move fence'], ['repair', 'Repair']]
  return (
    <div data-job-type>
      <h3 className="text-xs font-semibold text-gray-500 mb-2">Job type</h3>
      <div className="grid grid-cols-3 gap-1 bg-gray-100 rounded-xl p-1" role="radiogroup" aria-label="Job type">
        {opts.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} data-job-type-option={k}
            className={`min-h-[48px] rounded-lg text-sm font-semibold ${value === k ? 'bg-white text-gray-900 shadow-sm ring-2 ring-orange-400' : 'text-gray-600'}`}>{label}</button>
        ))}
      </div>
    </div>
  )
}

function Stepper({ value, onChange, label, min = 0 }: { value: number; onChange: (n: number) => void; label: string; min?: number }) {
  return (
    <div className="flex items-center gap-1 shrink-0" data-stepper={label}>
      <button type="button" aria-label={`One less ${label}`} className="w-12 h-12 rounded-lg border border-gray-300 text-xl font-bold disabled:opacity-40" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="w-8 text-center text-lg font-bold tabular-nums" data-stepper-value>{value}</span>
      <button type="button" aria-label={`One more ${label}`} className="w-12 h-12 rounded-lg border border-gray-300 text-xl font-bold" onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

function Toggle({ on, onChange, label, hint, data }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; data?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 min-h-[48px]" data-toggle={data}>
      <span><span className="block text-sm font-medium text-gray-800">{label}</span>{hint && <span className="block text-xs text-gray-500">{hint}</span>}</span>
      <input type="checkbox" className="w-6 h-6 accent-orange-500 shrink-0" checked={on} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

function PostTypePick({ value, onChange, label }: { value: PostType; onChange: (v: PostType) => void; label: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1">
        {([['nd', 'No dig'], ['ds', 'Dig set (concrete)']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} data-post-type={k}
            className={`min-h-[44px] rounded-lg text-sm font-medium ${value === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>{l}</button>
        ))}
      </div>
    </div>
  )
}

const numIn = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-400'

// ── Move ─────────────────────────────────────────────────────────────────────

export function MovePanel({ style, move, setMove, defaultPostType, defaultDamagePct, newLine, yard, layoutResult, runSections, widthFt }: {
  style: QuoteStyle | undefined
  move: MoveInputs
  setMove: (fn: (m: MoveInputs) => MoveInputs) => void
  defaultPostType: PostType
  defaultDamagePct: number
  newLine: { walkGates: number; dblGates: number; footage: number; sections: number }
  yard: YardLayout | null
  layoutResult: LayoutResult | null
  runSections: number[]
  widthFt: number
}) {
  const width = style ? workWidth(style) : 6
  const facts = oldLineFacts(move, width)
  const set = (patch: Partial<MoveInputs>) => setMove(m => ({ ...m, ...patch }))
  const optNum = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v) || 0))
  const gates = newLine.walkGates + newLine.dblGates
  const sides = yard ? yard.sides.filter(s => s.on && s.lengthIn > 0) : []
  return (
    <div className="space-y-4 rounded-xl border border-orange-200 bg-orange-50/40 p-3" data-move-panel>
      <div>
        <h3 className="text-sm font-bold text-gray-900">The old fence line</h3>
        <p className="text-xs text-gray-600">The Yard step is the NEW line ({Math.round(newLine.footage)} ft, {newLine.sections} sections, {gates} gate{gates === 1 ? '' : 's'}). Enter the old line here.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">Old line footage (ft, fence only)
          <input type="number" inputMode="decimal" min={0} className={numIn} value={move.oldFt || ''} placeholder="0" onChange={e => set({ oldFt: Math.max(0, Number(e.target.value) || 0) })} data-move-old-ft />
        </label>
        <label className="text-xs text-gray-600">Old sections
          <input type="number" inputMode="numeric" min={0} className={numIn} value={move.oldSections ?? ''} placeholder={`${facts.sections} (auto)`} onChange={e => set({ oldSections: optNum(e.target.value) })} data-move-old-sections />
        </label>
        <label className="text-xs text-gray-600">Old walk gates
          <input type="number" inputMode="numeric" min={0} className={numIn} value={move.oldWalkGates || ''} placeholder="0" onChange={e => set({ oldWalkGates: Math.max(0, Math.round(Number(e.target.value) || 0)) })} data-move-old-walk />
        </label>
        <label className="text-xs text-gray-600">Old double gates
          <input type="number" inputMode="numeric" min={0} className={numIn} value={move.oldDblGates || ''} placeholder="0" onChange={e => set({ oldDblGates: Math.max(0, Math.round(Number(e.target.value) || 0)) })} data-move-old-dbl />
        </label>
        <label className="text-xs text-gray-600">Old posts to pull
          <input type="number" inputMode="numeric" min={0} className={numIn} value={move.oldPosts ?? ''} placeholder={`${facts.posts} (auto)`} onChange={e => set({ oldPosts: optNum(e.target.value) })} data-move-old-posts />
        </label>
        <label className="text-xs text-gray-600">Damage allowance %
          <input type="number" inputMode="decimal" min={0} max={100} className={numIn} value={move.damagePct ?? ''} placeholder={`${defaultDamagePct}% (Settings)`} onChange={e => set({ damagePct: e.target.value.trim() === '' ? null : Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} data-move-damage />
        </label>
      </div>
      <PostTypePick label={`Old posts are (default from the style: ${defaultPostType === 'nd' ? 'no dig' : 'dig set'})`} value={move.oldPostType} onChange={v => set({ oldPostType: v })} />
      <Toggle label="New post caps" hint="Off: the old caps are reused" on={move.newPostCaps} onChange={v => set({ newPostCaps: v })} data="new-caps" />
      {gates > 0 && (
        <div data-move-gates>
          <p className="text-xs font-semibold text-gray-600">Gates: every gate gets a new hinge and latch kit. Replace a gate to use a whole new gate kit.</p>
          {Array.from({ length: gates }, (_, i) => (
            <Toggle key={i} data={`replace-gate-${i}`} label={`Replace gate ${i + 1} (${i < newLine.walkGates ? 'walk' : 'double'})`} on={!!move.replaceGates?.[i]}
              onChange={v => setMove(m => { const r = [...(m.replaceGates ?? [])]; while (r.length < gates) r.push(false); r[i] = v; return { ...m, replaceGates: r } })} />
          ))}
        </div>
      )}
      {yard && layoutResult && sides.length > 0 && (
        <div className="space-y-2" data-move-old-plan>
          <p className="text-xs font-semibold text-gray-600">Show the old line on the plan (optional)</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Along
              <select className={numIn} value={move.oldLinePlan?.sideId ?? ''} onChange={e => set({ oldLinePlan: e.target.value ? { sideId: e.target.value, offsetFt: move.oldLinePlan?.offsetFt ?? 3 } : null })} data-move-old-side>
                <option value="">Not drawn</option>
                {sides.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">Feet inside the new line
              <input type="number" inputMode="decimal" className={numIn} disabled={!move.oldLinePlan} value={move.oldLinePlan?.offsetFt ?? ''} onChange={e => move.oldLinePlan && set({ oldLinePlan: { ...move.oldLinePlan, offsetFt: Number(e.target.value) || 0 } })} data-move-old-offset />
            </label>
          </div>
          {move.oldLinePlan && (
            <SitePlan layout={yard} result={layoutResult} runSections={runSections} widthFt={widthFt}
              oldLine={{ ...move.oldLinePlan, ft: move.oldFt, label: `Old line ${Math.round(move.oldFt)} ft` }} title="New line and the old line (dashed)" />
          )}
        </div>
      )}
    </div>
  )
}

// ── Repair ───────────────────────────────────────────────────────────────────

export function RepairPanel({ style, repair, setRepair, yard, layoutResult, runSections, widthFt }: {
  style: QuoteStyle | undefined
  repair: RepairInputs
  setRepair: (fn: (r: RepairInputs) => RepairInputs) => void
  yard: YardLayout | null
  layoutResult: LayoutResult | null
  runSections: number[]
  widthFt: number
}) {
  const [showParts, setShowParts] = useState(false)
  const set = (patch: Partial<RepairInputs>) => setRepair(r => ({ ...r, ...patch }))
  const qty = (k: RepairItemKey) => repair.items[k] ?? 0
  const setQty = (k: RepairItemKey, n: number) => setRepair(r => ({ ...r, items: { ...r.items, [k]: n } }))
  const choices = style ? repairPartChoices(style) : []
  const chosen = repair.repairParts ?? choices
  const tapped = repair.tapped ?? []
  function tap(key: string) {
    setRepair(r => {
      const was = r.tapped ?? []
      const next = was.includes(key) ? was.filter(k => k !== key) : [...was, key]
      // Tapped sections are the sections to replace.
      return { ...r, tapped: next, items: { ...r.items, replaceSection: next.length } }
    })
  }
  return (
    <div className="space-y-4 rounded-xl border border-orange-200 bg-orange-50/40 p-3" data-repair-panel>
      <div>
        <h3 className="text-sm font-bold text-gray-900">What happened?</h3>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {(Object.keys(WHAT_HAPPENED) as Array<RepairInputs['what']>).map(k => (
            <button key={k} type="button" aria-pressed={repair.what === k} data-what={k}
              onClick={() => setRepair(r => ({ ...r, what: k, items: { ...WHAT_HAPPENED[k].items }, tapped: [] }))}
              className={`min-h-[52px] rounded-xl border-2 px-2 text-sm font-semibold ${repair.what === k ? 'border-orange-500 bg-white text-gray-900' : 'border-gray-200 bg-white text-gray-600'}`}>{WHAT_HAPPENED[k].label}</button>
          ))}
        </div>
      </div>
      {starterNote(repair.what, repair.items) && (
        <p className="text-sm text-gray-800 bg-white border-l-4 border-orange-500 rounded-lg px-3 py-2" data-repair-starter-note>{starterNote(repair.what, repair.items)}</p>
      )}
      {repair.what === 'storm' && (
        <Toggle data="debris-cleared" label="Tree and debris cleared before we start" hint="Or add Haul away debris below" on={!!repair.debrisCleared} onChange={v => set({ debrisCleared: v })} />
      )}
      <div className="space-y-1" data-repair-items>
        {REPAIR_ITEMS.map(k => (
          <div key={k} className={`flex items-center justify-between gap-2 rounded-lg bg-white border px-3 py-2 ${isStarterItem(repair.what, k) && qty(k) > 0 ? 'border-orange-400' : 'border-gray-200'}`} data-repair-item={k} data-repair-item-starter={isStarterItem(repair.what, k) && qty(k) > 0 ? 'yes' : undefined}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{REPAIR_LABEL[k]}</p>
              {isStarterItem(repair.what, k) && qty(k) > 0 && <p className="text-xs font-semibold text-orange-700">Added by "{WHAT_HAPPENED[repair.what].label}"</p>}
              <p className="text-xs text-gray-500">{REPAIR_HINT[k]}</p>
            </div>
            <Stepper label={REPAIR_LABEL[k]} value={qty(k)} onChange={n => setQty(k, n)} />
          </div>
        ))}
      </div>
      {qty('repairSection') > 0 && choices.length > 0 && (
        <div className="rounded-lg bg-white border border-gray-200 p-3" data-repair-parts>
          <button type="button" className="text-sm font-semibold text-orange-600 min-h-[44px]" onClick={() => setShowParts(v => !v)} data-repair-parts-toggle>
            {showParts ? 'Hide' : 'Choose'} the parts each repaired section gets ({chosen.filter(p => p.qty > 0).length} of {choices.length})
          </button>
          {showParts && choices.map(c => {
            const cur = chosen.find(p => p.part === c.part)?.qty ?? 0
            return (
              <div key={c.part} className="flex items-center justify-between gap-2 py-1">
                <span className="text-xs text-gray-700 min-w-0">{c.part.replace(/^\*+/, '')} <span className="text-gray-400">(a whole section: {c.qty})</span></span>
                <input type="number" min={0} step="any" className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm" value={cur}
                  onChange={e => { const n = Math.max(0, Number(e.target.value) || 0); set({ repairParts: choices.map(x => ({ part: x.part, qty: x.part === c.part ? n : (chosen.find(p => p.part === x.part)?.qty ?? 0) })) }) }} data-repair-part={c.part} />
              </div>
            )
          })}
        </div>
      )}
      {(qty('rehangGate') > 0 || qty('replaceGate') > 0) && (
        <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1" data-gate-kind>
          {(['walk', 'double'] as const).map(k => (
            <button key={k} type="button" aria-pressed={repair.gateKind === k} onClick={() => set({ gateKind: k })}
              className={`min-h-[44px] rounded-lg text-sm font-medium ${repair.gateKind === k ? 'bg-white shadow-sm' : 'text-gray-600'}`}>{k === 'walk' ? 'Walk gate' : 'Double gate'}</button>
          ))}
        </div>
      )}
      {(qty('resetPost') > 0 || qty('replacePost') > 0) && (
        <>
          <PostTypePick label="The posts are" value={repair.postType} onChange={v => set({ postType: v })} />
          <Toggle label="New post caps" hint="Off: the old caps are reused" on={repair.newPostCaps} onChange={v => set({ newPostCaps: v })} data="new-caps" />
        </>
      )}
      {yard && layoutResult && runSections.some(n => n > 0) && (
        <div data-repair-plan>
          <p className="text-xs font-semibold text-gray-600 mb-1">Or tap the damaged sections on the plan ({tapped.length} tapped: they are the sections to replace)</p>
          <SitePlan layout={yard} result={layoutResult} runSections={runSections} widthFt={widthFt} damaged={tapped} onSectionTap={tap} title="Tap the damaged sections" />
        </div>
      )}
    </div>
  )
}

// ── Internal breakdown ───────────────────────────────────────────────────────

export function WorkBreakdown({ work }: { work: WorkResult }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2" data-work-breakdown>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500">Where the cost comes from <span className="font-normal">· internal</span></h3>
        <span className="text-xs text-gray-500">{work.type === 'move' ? 'Fence move' : 'Repair'}</span>
      </div>
      {work.lines.map(l => (
        <div key={l.key} className={`text-sm border-b border-gray-100 pb-1 ${l.missing ? 'bg-amber-50' : ''}`} data-work-line={l.key}>
          <div className="flex justify-between gap-2">
            <span className="text-gray-800">{l.label}{l.missing && <span className="ml-1 text-xs font-semibold text-amber-800">(rate missing)</span>}</span>
            <span className="font-semibold tabular-nums whitespace-nowrap">{fmt(l.cents)}</span>
          </div>
          <p className="text-xs text-gray-500">{l.kind === 'material' ? 'Material' : l.kind === 'labor' ? 'Labor' : 'Disposal'} · {l.math}</p>
        </div>
      ))}
      <div className="pt-1 space-y-0.5 text-sm">
        <div className="flex justify-between"><span className="text-gray-600">Materials</span><span className="tabular-nums">{fmt(work.materialCents)}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Labor</span><span className="tabular-nums">{fmt(work.laborCents)}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Disposal</span><span className="tabular-nums">{fmt(work.disposalCents)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total cost</span><span className="tabular-nums" data-work-cost>{fmt(work.costCents)}</span></div>
        <div className="flex justify-between text-xs text-gray-600"><span>÷ (1 − Target Margin {work.targetMarginPct}%, {work.marginFrom})</span><span className="tabular-nums">{fmt(work.basePriceCents)}</span></div>
        {work.minimumApplied && (
          <p className="text-xs font-semibold text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5" data-minimum-applied>
            Minimum job price applied: {fmt(work.minimumCents)} (the price from cost was {fmt(work.basePriceCents)}). The customer only sees the price.
          </p>
        )}
      </div>
    </div>
  )
}
