/**
 * Settings → Site plans: when the office site plan flags a drawn side against
 * the quote (feet and percent, the larger counts), the setback from the
 * property line it warns about, and where each county's property lines come
 * from. Saved with the other settings (config.sitePlan); the server reads the
 * same values for the flags, the Mark plan done check and the property lines.
 */

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { AppConfig, ParcelSource, SitePlanSettings as Settings } from './configStore'
import { MARION_SOURCE, NEARBY_COUNTIES, fdorSource, sitePlanSettings } from './sitePlanDefaults'
import NumberField from './NumberField'

export default function SitePlanSettings({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const s = sitePlanSettings(config)
  const set = (patch: Partial<Settings>) => onChange({ ...config, sitePlan: { ...s, ...patch } })
  const [other, setOther] = useState({ county: '', no: '' })
  const counties = Object.keys(s.parcelSources).sort()
  const addCounty = (county: string, source: ParcelSource) => set({ parcelSources: { ...s.parcelSources, [county]: source } })
  const otherNo = Math.round(Number(other.no))
  const otherOk = other.county.trim().length > 1 && otherNo >= 11 && otherNo <= 77

  return (
    <div className="space-y-6" data-site-plan-settings>
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Quoted against drawn</h3>
        <p className="text-sm text-gray-600 mb-3">The site plan flags a side when its drawn feet are off from the quoted feet by more than this many feet or this percent of the side, whichever is more. Each flag is answered (keep the wheel number, or use the drawn length) before the plan can be marked done.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <label className="block text-sm text-gray-700">Feet
            <NumberField value={s.tolFt} min={0} decimals={1} label="Flag tolerance, feet" onCommit={v => set({ tolFt: Math.max(0, v || 0) })} data-site-plan-tol-ft />
          </label>
          <label className="block text-sm text-gray-700">Percent
            <NumberField value={s.tolPct} min={0} decimals={1} label="Flag tolerance, percent" onCommit={v => set({ tolPct: Math.max(0, v || 0) })} data-site-plan-tol-pct />
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Property line setback</h3>
        <p className="text-sm text-gray-600 mb-3">Feet the fence should stay inside the property line. The plan warns about a side closer than this. 0: it warns only about a side that crosses the line.</p>
        <label className="block text-sm text-gray-700 max-w-[12rem]">Setback, feet
          <NumberField value={s.setbackFt} min={0} decimals={1} label="Property line setback, feet" onCommit={v => set({ setbackFt: Math.max(0, v || 0) })} data-site-plan-setback />
        </label>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Where property lines come from</h3>
        <p className="text-sm text-gray-600 mb-3">The county records the plan asks for a job's property lines, by the job's county. They are approximate, not a survey. A county not listed: the plan works without lines and says so.</p>
        <ul className="space-y-2" data-site-plan-counties>
          {counties.map(c => {
            const src = s.parcelSources[c]
            return (
              <li key={c} className="flex items-start gap-2 rounded-lg border border-gray-200 p-3" data-site-plan-county={c}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{c} County</p>
                  <p className="text-sm text-gray-700">{src.name}{c === 'Marion' && src.url === MARION_SOURCE.url ? ', with the City of Ocala\'s records as its backup' : ''}</p>
                  <p className="text-xs text-gray-500 break-all">{src.url}{src.where ? ` (${src.where})` : ''}</p>
                </div>
                <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-red-200 text-red-600 shrink-0" aria-label={`Remove ${c} County`}
                  onClick={() => { const next = { ...s.parcelSources }; delete next[c]; set({ parcelSources: next }) }} data-site-plan-county-remove={c}><Trash2 size={16} /></button>
              </li>
            )
          })}
          {!counties.length && <li className="text-sm text-amber-800">No counties: the plan has no property lines anywhere.</li>}
        </ul>
        <p className="text-sm font-semibold text-gray-800 mt-4 mb-2">Add a county</p>
        <div className="flex flex-wrap gap-2">
          {NEARBY_COUNTIES.filter(n => !s.parcelSources[n.county]).map(n => (
            <button key={n.county} type="button" className="btn btn-secondary min-h-[48px]" onClick={() => addCounty(n.county, n.source)} data-site-plan-add-county={n.county}>+ {n.county}</button>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-gray-200 p-3 space-y-2 max-w-lg">
          <p className="text-sm text-gray-700">Another Florida county, from the state's yearly records: its name and its county number (Dept. of Revenue, 11 to 77).</p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-sm text-gray-700">County
              <input className="mt-1 block border border-gray-300 rounded-lg px-3 min-h-[48px] text-base w-44" value={other.county} onChange={e => setOther(o => ({ ...o, county: e.target.value }))} placeholder="Putnam" data-site-plan-other-county />
            </label>
            <label className="text-sm text-gray-700">County number
              <input className="mt-1 block border border-gray-300 rounded-lg px-3 min-h-[48px] text-base w-28" inputMode="numeric" value={other.no} onChange={e => setOther(o => ({ ...o, no: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="64" data-site-plan-other-no />
            </label>
            <button type="button" className="btn btn-secondary min-h-[48px]" disabled={!otherOk}
              onClick={() => { const name = other.county.trim().replace(/\s+county$/i, ''); addCounty(name.charAt(0).toUpperCase() + name.slice(1), fdorSource(otherNo)); setOther({ county: '', no: '' }) }} data-site-plan-other-add>Add</button>
          </div>
        </div>
      </div>
    </div>
  )
}
