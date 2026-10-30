/**
 * Settings → Moves and Repairs: every multiplier and rate fence moves and
 * repairs are priced with (moveRepair.ts), the minimum job price and the Wood
 * factor, with plain labels. Money is typed in dollars and kept in integer
 * cents. A blank rate stays blank: quotes warn until it is filled in.
 */

import { useState } from 'react'
import type { AppConfig } from './configStore'
import { moveRepairSettings, blankSettings, latestRateChange, REPAIR_LABEL, DEFAULT_MOVE_REPAIR, type MoveRepairSettings } from './moveRepair'
import { isQuotable } from './styleAvailability'

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

function Money({ label, cents, onChange, hint, data }: { label: string; cents: number | null; onChange: (c: number | null) => void; hint?: string; data: string }) {
  // What is typed stays as typed ("12." on the way to "12.50"); the saved value is whole cents.
  const [text, setText] = useState(cents === null ? '' : (cents / 100).toFixed(2))
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-800">{label}</span>
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      <span className="flex items-center gap-1 mt-1">
        <span className="text-gray-500">$</span>
        <input type="number" inputMode="decimal" min={0} step="0.01" className={`${input} ${cents === null ? 'border-amber-400 bg-amber-50' : ''}`}
          value={text} placeholder="Not set"
          onChange={e => { const v = e.target.value; setText(v); const t = v.trim(); onChange(t === '' ? null : Math.max(0, Math.round(Number(t) * 100))) }}
          onBlur={() => setText(cents === null ? '' : (cents / 100).toFixed(2))} data-mr={data} />
      </span>
    </label>
  )
}

function Num({ label, value, onChange, hint, suffix, data, allowBlank, step = '0.05' }: { label: string; value: number | null; onChange: (n: number | null) => void; hint?: string; suffix?: string; data: string; allowBlank?: boolean; step?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-800">{label}</span>
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      <span className="flex items-center gap-1 mt-1">
        <input type="number" inputMode="decimal" min={0} step={step} className={input} value={value ?? ''} placeholder={allowBlank ? 'Blank' : ''}
          onChange={e => { const v = e.target.value.trim(); onChange(v === '' ? (allowBlank ? null : 0) : Math.max(0, Number(v) || 0)) }} data-mr={data} />
        {suffix && <span className="text-gray-500 text-sm shrink-0">{suffix}</span>}
      </span>
    </label>
  )
}

export default function MoveRepairSettings({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const s = moveRepairSettings(config)
  const set = (patch: Partial<MoveRepairSettings>) => onChange({ ...config, moveRepair: { ...s, ...patch } })
  const blanks = blankSettings(s)
  const styles = config.fenceStyles.filter(isQuotable)
  return (
    <div className="space-y-8" data-move-repair-settings>
      <div>
        <h2 data-settings-dup-title className="text-lg font-bold text-gray-900">Moves and Repairs</h2>
        <p className="text-sm text-gray-600 mt-1">How a fence move or a repair is priced, for every style. Labor starts from each style's install rate (the subcontractor rate per section in Settings → Pricing, or the hourly crew rate) times the multipliers here. Price = (materials + labor + disposal) ÷ (1 − Target Margin).</p>
        {blanks.length > 0 && (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-mr-blank>
            Still blank: {blanks.join('; ')}. Quotes warn and count blank rates as $0 until they are filled in.
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Taking a fence down</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Num data="removalMultiplier" label="Careful removal multiplier" hint="Removal labor per section = the style's install rate per section × this (default 1.5)" value={s.removalMultiplier} onChange={v => set({ removalMultiplier: v ?? DEFAULT_MOVE_REPAIR.removalMultiplier })} suffix="×" />
          <Num data="gateRemovalMultiplier" label="Gate removal multiplier" hint="Gate removal labor = the gate install rate × this (default 1.5)" value={s.gateRemovalMultiplier} onChange={v => set({ gateRemovalMultiplier: v ?? DEFAULT_MOVE_REPAIR.gateRemovalMultiplier })} suffix="×" />
        </div>
      </section>

      <section className="space-y-3" data-settings-focus="post-pull">
        <h3 className="text-sm font-bold text-gray-900">Pulling old posts</h3>
        <p className="text-xs text-gray-600">Per post. Concrete costs much more to get rid of than pipe and donuts.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Money data="pullNdLaborCents" label="Pull labor per post, no dig" cents={s.pullNdLaborCents} onChange={c => set({ pullNdLaborCents: c })} />
          <Money data="pullNdDisposalCents" label="Disposal per post, no dig" cents={s.pullNdDisposalCents} onChange={c => set({ pullNdDisposalCents: c })} />
          <Money data="pullDsLaborCents" label="Pull labor per post, dig set (concrete)" cents={s.pullDsLaborCents} onChange={c => set({ pullDsLaborCents: c })} />
          <Money data="pullDsDisposalCents" label="Disposal per post, dig set (concrete)" cents={s.pullDsDisposalCents} onChange={c => set({ pullDsDisposalCents: c })} />
          <Money data="footerDisposalCents" label="Concrete footer disposal per post" hint={`The repair item "${REPAIR_LABEL.footerDisposal}": the salesman picks how many. No dig old posts only (dig set haul already covers the concrete)`} cents={s.footerDisposalCents} onChange={c => set({ footerDisposalCents: c })} />
        </div>
        {(() => { const h = latestRateChange(s); return h ? <p className="text-xs text-gray-500" data-mr-rates-since>Rates set {h.effectiveFrom} by {h.by}{h.note ? ` (${h.note})` : ''}. Quotes saved before keep the prices they were priced with.</p> : null })()}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Damage allowance on a move</h3>
        <Num data="damagePctDefault" label="Sections that need new panel parts" hint="% of the sections moved, rounded up to whole sections; each quote can change it (0 to 100%)" value={s.damagePctDefault} onChange={v => set({ damagePctDefault: Math.min(100, v ?? 0) })} suffix="%" step="1" />
        <details className="rounded-lg border border-gray-200 p-3">
          <summary className="text-sm font-medium text-gray-800 cursor-pointer min-h-[44px] flex items-center">Per style (blank: {s.damagePctDefault}%)</summary>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            {styles.map(st => (
              <label key={st.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 text-gray-700">{st.label || st.name}</span>
                <input type="number" min={0} max={100} className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm" placeholder={`${s.damagePctDefault}`}
                  value={s.damagePctByStyle[st.name] ?? ''} data-mr-damage-style={st.name}
                  onChange={e => { const v = e.target.value.trim(); const next = { ...s.damagePctByStyle }; if (v === '') delete next[st.name]; else next[st.name] = Math.min(100, Math.max(0, Number(v) || 0)); set({ damagePctByStyle: next }) }} />
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Repair items: labor</h3>
        <p className="text-xs text-gray-600">Labor for each item = the style's install rate per section (posts use the per section rate too) or per gate × the multiplier. Parts come from the style's material kits.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {(Object.keys(s.itemMultipliers) as Array<keyof MoveRepairSettings['itemMultipliers']>).map(k => (
            <Num key={k} data={`item-${k}`} label={REPAIR_LABEL[k]} value={s.itemMultipliers[k]} suffix="×"
              onChange={v => set({ itemMultipliers: { ...s.itemMultipliers, [k]: v ?? DEFAULT_MOVE_REPAIR.itemMultipliers[k] } })} />
          ))}
        </div>
        <p className="text-xs text-gray-600">Haul away debris is charged per section at the tear out rate (Settings → Pricing: haul away, tear out and sub tear out per section).</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Profit and minimum</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Num data="repairProfitPct" label="Repair Profit %" hint="Blank: each style's own Target Profit %. Set: Target Margin = Overhead % + this, for moves and repairs" value={s.repairProfitPct} onChange={v => set({ repairProfitPct: v })} suffix="%" allowBlank step="0.5" />
          <Money data="minimumJobCents" label="Minimum job price" hint="Moves and repairs never price under this (default $350). The customer only sees the price." cents={s.minimumJobCents} onChange={c => set({ minimumJobCents: c ?? DEFAULT_MOVE_REPAIR.minimumJobCents })} />
        </div>
        <label className="flex items-center justify-between gap-3 min-h-[48px] text-sm">
          <span><span className="font-medium text-gray-800">Also apply the minimum to new fences</span><span className="block text-xs text-gray-500">Off by default</span></span>
          <input type="checkbox" className="w-6 h-6 accent-orange-500" checked={s.minimumAppliesToNew} onChange={e => set({ minimumAppliesToNew: e.target.checked })} data-mr="minimumAppliesToNew" />
        </label>
        <Num data="photosRequired" label="Photos needed before a move or repair proposal is sent" hint="The salesman can send anyway with one tap and a reason" value={s.photosRequired} onChange={v => set({ photosRequired: Math.round(v ?? 0) })} step="1" />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Wood</h3>
        <Num data="woodFactorPct" label="Wood factor" hint="Wood material and labor = the matching White Vinyl 6 ft privacy numbers × this, for new fences, moves and repairs (default 115%)" value={s.woodFactorPct} onChange={v => set({ woodFactorPct: v && v > 0 ? v : DEFAULT_MOVE_REPAIR.woodFactorPct })} suffix="%" step="1" />
      </section>
    </div>
  )
}
