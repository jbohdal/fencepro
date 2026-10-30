/**
 * Settings → Price List → 8 ft tall vinyl: each 8 ft tall vinyl fence's
 * section price and post price (Jonathan, Oct 21, 2026). Every color (White,
 * Tan, a color added in Vinyl Colors), no dig and dig set, is priced by the
 * piece, like a job lot: one price per section and one per post (corner, end
 * and line). The pull sheet still lists every part of a section and a post at
 * $0 so the crew loads the right material; gates are priced from their parts.
 * Until both prices are in, the fence is not available for quoting.
 *
 * Prices are integer cents on the fence style (FenceStyle.pieceCents), saved
 * with Settings on the server. A saved quote keeps the prices it was priced
 * with.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, FenceStyle } from './configStore'
import { isTallVinyl, styleChoicesOf, styleLabel, tallPricesMissing } from './fenceCatalog'
import { TALL_VINYL_SECTION } from './materialCalculator'
import { isQuotable } from './styleAvailability'
import { businessDate } from './businessDate'
import { roleCan, signedInRole } from './permissions'
import { useSettingsPageSave } from './settingsPageSave'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const shown = (c: number | null | undefined) => (typeof c === 'number' && c > 0 ? (c / 100).toFixed(2) : '')
/** "$412.50" → 41250 (integer cents); blank → null; anything else → NaN. */
const toCents = (t: string): number | null => {
  const s = String(t).replace(/[$,\s]/g, '')
  if (!s) return null
  const v = Number(s)
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : NaN
}

export default function TallVinylPrices({ config, onCommit }: {
  config: AppConfig
  /** Save Settings now, with this change (and the page's other changes). */
  onCommit: (next: AppConfig) => void
}) {
  const may = roleCan(signedInRole(), 'settings.change') && roleCan(signedInRole(), 'prices.change')
  const styles = useMemo(() => config.fenceStyles.filter(s => s.isActive !== false && isTallVinyl(styleChoicesOf(s))), [config.fenceStyles])
  const start = () => Object.fromEntries(styles.flatMap(s => [[`${s.name}|section`, shown(s.pieceCents?.section)], [`${s.name}|post`, shown(s.pieceCents?.post)]]))
  const [typed, setTyped] = useState<Record<string, string>>(start)
  const [error, setError] = useState('')
  // Settings read again (saved here or elsewhere): show what is saved.
  useEffect(() => { setTyped(start()) }, [styles])  // eslint-disable-line react-hooks/exhaustive-deps

  const changed = styles.some(s => (['section', 'post'] as const).some(k => (typed[`${s.name}|${k}`] ?? '') !== shown(s.pieceCents?.[k])))

  useSettingsPageSave(changed, () => save(), () => { setTyped(start()); setError('') })

  function save() {
    setError('')
    const bad: string[] = []
    const today = businessDate(new Date())
    const next: FenceStyle[] = config.fenceStyles.map(s => {
      if (!styles.includes(s)) return s
      const sec = toCents(typed[`${s.name}|section`] ?? ''), post = toCents(typed[`${s.name}|post`] ?? '')
      if (Number.isNaN(sec) || Number.isNaN(post)) { bad.push(s.label || styleLabel(s.name)); return s }
      const was = s.pieceCents ?? {}
      if ((was.section ?? null) === sec && (was.post ?? null) === post) return s
      const out: FenceStyle = { ...s }
      if (sec === null && post === null) delete out.pieceCents
      else out.pieceCents = { section: sec, post, pricedOn: today }
      return out
    })
    if (bad.length) { setError(`Type a price in dollars (like 412.50) or leave it blank: ${bad.join('; ')}.`); return }
    onCommit({ ...config, fenceStyles: next })
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 mt-5" data-tall-prices>
      <div>
        <h3 className="text-lg font-bold text-gray-900">8 ft tall vinyl: price by the piece</h3>
        <p className="text-xs text-gray-500">
          One price per section and one per post (corner, end and line), for each 8 ft tall fence. The pull sheet still lists every part at $0:
          a section is {TALL_VINYL_SECTION[6].rails} rails, {TALL_VINYL_SECTION[6].midRails} mid rail, {TALL_VINYL_SECTION[6].pickets} pickets (4 ft) and {TALL_VINYL_SECTION[6].uChannels} U channels (4 ft) on a 6 ft panel;
          {' '}{TALL_VINYL_SECTION[8].rails} rails, {TALL_VINYL_SECTION[8].midRails} mid rail, {TALL_VINYL_SECTION[8].pickets} pickets, {TALL_VINYL_SECTION[8].uChannels} U channels and {TALL_VINYL_SECTION[8].railInserts} rail inserts on an 8 ft panel.
          A post price covers the post, its cap and its donuts and pipe or concrete. Gates are priced from their parts, as before.
          A fence is not available for quoting until both prices are in. Saved quotes keep the prices they were priced with.
        </p>
      </div>
      {styles.length === 0 ? <p className="text-sm text-gray-500">There is no 8 ft tall vinyl fence turned on.</p> : (
        <ul className="divide-y divide-gray-100">
          {styles.map(s => {
            const missing = tallPricesMissing(s)
            const ok = isQuotable(s)
            return (
              <li key={s.name} className="py-3 space-y-2" data-tall-row={s.name}>
                <div>
                  <span className="block text-sm font-semibold text-gray-900">{s.label || styleLabel(s.name)}</span>
                  {ok ? <span className="block text-xs text-green-700" data-tall-ready>Available for quoting{s.pieceCents?.pricedOn ? ` · prices from ${s.pieceCents.pricedOn}` : ''}</span>
                    : <span className="block text-xs text-amber-700" data-tall-held>Not available for quoting{missing.length ? `: enter the ${missing.join(' and ')} price${missing.length === 1 ? '' : 's'}` : s.held ? `: ${s.held}` : ''}</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['section', 'post'] as const).map(k => (
                    <label key={k} className="block text-xs text-gray-600">{k === 'section' ? 'Section price' : 'Post price'}
                      <span className="mt-1 flex items-center gap-1"><span className="text-gray-500">$</span>
                        <input className={inputCls} inputMode="decimal" placeholder="0.00" disabled={!may} value={typed[`${s.name}|${k}`] ?? ''}
                          onChange={e => setTyped(x => ({ ...x, [`${s.name}|${k}`]: e.target.value }))} data-tall-price={`${s.name}|${k}`} />
                      </span>
                    </label>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="text-sm text-red-700" role="alert" data-tall-error>{error}</p>}
      {may && styles.length > 0 && (
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary min-h-[44px]" disabled={!changed} onClick={save} data-tall-save>Save 8 ft tall prices</button>
        </div>
      )}
    </section>
  )
}
