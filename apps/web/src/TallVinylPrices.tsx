/**
 * Settings → Price List → 8 ft tall vinyl: each 8 ft tall vinyl fence's
 * section price and post price (Jonathan, Oct 21, 2026). Every color (White,
 * Tan, a color added in Vinyl Colors), no dig and dig set, is priced by the
 * piece, like a job lot: one price per section and one per post (corner, end
 * and line). The section price is all the vinyl in a section and the post
 * price the vinyl post only; those parts show at $0 on the pull sheet. Caps,
 * donuts, pipe, concrete and everything else are priced from Inventory at
 * their own prices (Jonathan, Oct 29, 2026). Gates are priced from their
 * parts. Until both prices are in, the fence is not available for quoting.
 *
 * Prices are integer cents on the fence style (FenceStyle.pieceCents), saved
 * with Settings on the server. A saved quote keeps the prices it was priced
 * with.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppConfig } from './configStore'
import { isTallVinyl, styleChoicesOf, styleLabel, tallPricesMissing } from './fenceCatalog'
import { TALL_VINYL_SECTION } from './materialCalculator'
import { isQuotable } from './styleAvailability'
import { businessDate } from './businessDate'
import { roleCan, signedInRole } from './permissions'
import { useSettingsPageSave } from './settingsPageSave'
import { applyTallPrices, shownCents as shown } from './tallVinylPriceSave'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white placeholder:text-gray-400 placeholder:italic focus:outline-none focus:ring-2 focus:ring-orange-400'

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
    const { fenceStyles: next, bad } = applyTallPrices(config.fenceStyles, styles, typed, businessDate(new Date()), s => s.label || styleLabel(s.name))
    if (bad.length) { setError(`Type our cost in dollars (like 412.50) or leave it blank: ${bad.join('; ')}.`); return }
    onCommit({ ...config, fenceStyles: next })
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 mt-5" data-tall-prices>
      <div>
        <h3 className="text-lg font-bold text-gray-900">8 ft tall vinyl: our cost by the piece</h3>
        <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-tall-cost-note>
          Our cost per section and per post: what we pay for the vinyl, not the customer's price. Overhead and margin are added on top, as for any part.
        </p>
        <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1" data-tall-covers>
          <li><b>Section</b> = our cost for all the vinyl in one section: pickets, rails, mid rail, U channels and inserts.</li>
          <li><b>Post</b> = our cost for the vinyl post only (corner, end or line).</li>
          <li>Caps, donuts, pipe, concrete and everything else come from Inventory at their own prices, and show on the pull sheet with that price.</li>
        </ul>
        <p className="text-xs text-gray-500">
          The section's vinyl and the vinyl post show on the pull sheet at $0, covered by these costs:
          a section is {TALL_VINYL_SECTION[6].rails} rails, {TALL_VINYL_SECTION[6].midRails} mid rail, {TALL_VINYL_SECTION[6].pickets} pickets (4 ft) and {TALL_VINYL_SECTION[6].uChannels} U channels (4 ft) on a 6 ft panel;
          {' '}{TALL_VINYL_SECTION[8].rails} rails, {TALL_VINYL_SECTION[8].midRails} mid rail, {TALL_VINYL_SECTION[8].pickets} pickets, {TALL_VINYL_SECTION[8].uChannels} U channels and {TALL_VINYL_SECTION[8].railInserts} rail inserts on an 8 ft panel.
          Gates are priced from their parts in Inventory, as before.
          A fence is not available for quoting until both costs are in. Saved quotes keep the costs they were priced with.
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
                  {ok ? <span className="block text-xs text-green-700" data-tall-ready>Available for quoting{s.pieceCents?.pricedOn ? ` · costs from ${s.pieceCents.pricedOn}` : ''}</span>
                    : <span className="block text-xs text-amber-700" data-tall-held>Not available for quoting{missing.length ? `: our ${missing.join(' and ')} cost${missing.length === 1 ? ' is' : 's are'} missing${may ? `, type ${missing.length === 1 ? 'it' : 'them'} below and save` : ' (ask Jonathan)'}` : s.held ? `: ${s.held}` : ''}</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['section', 'post'] as const).map(k => (
                    <label key={k} className="block text-xs text-gray-600">{k === 'section' ? 'Our cost per section (all its vinyl)' : 'Our cost per vinyl post (post only)'}
                      <span className="mt-1 flex items-center gap-1"><span className="text-gray-500">$</span>
                        <input className={inputCls} inputMode="decimal" placeholder="Not entered" disabled={!may} value={typed[`${s.name}|${k}`] ?? ''}
                          onChange={e => setTyped(x => ({ ...x, [`${s.name}|${k}`]: e.target.value }))} data-tall-price={`${s.name}|${k}`} />
                      </span>
                      {missing.includes(k) && !(typed[`${s.name}|${k}`] ?? '').trim() && <span className="mt-1 block text-xs text-amber-700" data-tall-missing={`${s.name}|${k}`}>Missing</span>}
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
          <button type="button" className="btn btn-primary min-h-[44px]" disabled={!changed} onClick={save} data-tall-save>Save 8 ft tall costs</button>
        </div>
      )}
    </section>
  )
}
