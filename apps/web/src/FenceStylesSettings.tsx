/**
 * Settings → Fence Styles: the fences as a tree, Material > choices, with an
 * "Available for quoting" switch at every level, instead of a table of codes.
 *
 *   Vinyl                                Available
 *     Style: Privacy [Add color] · Bell
 *     Height: 4 ft · 6 ft · 8 ft · + Add height
 *     Color: White (by part) · Tan (by part) · Clay (job lot, waiting for prices)
 *     ...
 *     Fences (15): each by its plain name, with its own switch and its labor
 *     and profit numbers.
 *
 * Add color walks through: the color's name, which color it copies its parts
 * from, priced by part or by piece (job lot: section, post and gate prices
 * and what each includes), quantity overrides and an optional Target Profit
 * %. Adding a height, a vinyl style (Semi privacy), a panel width, a finish
 * or a product works the same way. Nothing here needs a code change.
 *
 * Switches and the numbers in the tables are part of the Settings page and
 * save with Save Changes. Adding, editing, archiving or removing a color or a
 * choice saves at once (it also makes or removes Inventory parts and kits).
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { AppConfig, FenceStyle } from './configStore'
import { overheadPctOf } from './configStore'
import PercentField from './PercentField'
import { sectionWidthForStyle, styleHasPartsList } from './materialCalculator'
import { getInventory, getKitSets, saveInventory, saveKitSets, type InventoryItem } from './inventoryStore'
import { getQuotes } from './quoteStore'
import { getJobs } from './jobStore'
import { isQuotable } from './styleAvailability'
import { toast } from './toast'
import { navigate } from './nav'
import { KIT_LABEL } from './materialKits'
import {
  catalogOf, colorDimOf, colorStatus, colorShape, coverageWarnings, defaultCovers, materialOf, optionOf, piecePartChoices,
  planAddChoice, planAddColor, planRemoveOption, planUpdateOption, previewColorParts, styleChoicesOf, stylesOfOption, madeForTag, partsWaitingForPrice,
  PIECE_LABEL, type AddColorRequest, type CatalogState, type ChoiceDim, type ChoiceOption, type FenceCatalog, type JobLotQuote,
  type MaterialDef, type PiecePrices, type PieceKey, type QtyOverride, type InvItem,
} from './fenceCatalog'

const STYLE_CATEGORIES = ['Vinyl', 'Chainlink', 'Commercial', 'Aluminum', 'Other'] as const
const money = (cents: number | null | undefined) => (typeof cents === 'number' ? (cents / 100).toFixed(2) : '')
const toCents = (text: string): number | null => { const v = parseFloat(text.replace(/[$,\s]/g, '')); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null }
const inputCls = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const small = 'text-xs text-gray-500'

function Switch({ on, onClick, label, ...rest }: { on: boolean; onClick: () => void; label: string } & Record<`data-${string}`, string>) {
  // A 44 px tall tap target around a small track.
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} {...rest}
      className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[52px] bg-transparent">
      <span className={`relative inline-block w-11 h-6 rounded-full transition-colors ${on ? 'bg-orange-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** Settings, Inventory and kits as the changes in fenceCatalog.ts take them. */
function stateOf(config: AppConfig): CatalogState {
  return { fenceStyles: config.fenceStyles, fenceCatalog: catalogOf(config), items: getInventory() as unknown as InvItem[], kits: getKitSets() }
}

/** The internal names saved quotes and jobs carry: a choice in use cannot be removed. */
function inUse(): Set<string> {
  return new Set([...getQuotes().map(q => q.fenceStyle), ...getJobs().map(j => j.fenceStyle)].filter(Boolean) as string[])
}

export default function FenceStylesSettings({ config, onChange, onCommit }: {
  config: AppConfig
  /** A change to the page's draft (saved with Save Changes). */
  onChange: (c: AppConfig) => void
  /** Save now: Settings with this change (Inventory and kits are saved here). */
  onCommit: (c: AppConfig) => void
}) {
  const catalog = catalogOf(config)
  const [wizard, setWizard] = useState<null | { material: string; under?: { dim: string; key: string }; edit?: string }>(null)
  const [choiceDlg, setChoiceDlg] = useState<null | { material: string; dim: string; edit?: string }>(null)
  const [, setTick] = useState(0)

  /** Save the result of a plan: Settings (with the page's other changes), Inventory items and kits. */
  function commit(st: CatalogState, message?: string) {
    saveInventory(st.items as unknown as InventoryItem[])
    saveKitSets(st.kits)
    onCommit({ ...config, fenceStyles: st.fenceStyles, fenceCatalog: st.fenceCatalog })
    if (message) toast.success('Fence styles saved', message)
    setTick(t => t + 1)
  }
  const setCatalog = (c: FenceCatalog) => onChange({ ...config, fenceCatalog: c })
  const updateStyle = (id: string, patch: Partial<FenceStyle>) => onChange({ ...config, fenceStyles: config.fenceStyles.map(s => (s.id === id ? { ...s, ...patch } : s)) })
  const unmapped = config.fenceStyles.filter(s => { const sc = styleChoicesOf(s); return !sc || !materialOf(catalog, sc.material) })

  return (
    <div className="space-y-5" data-styles-tree>
      <p className="text-sm text-gray-600">Fences are built from choices. Each switch says whether that choice can be quoted; a fence is offered only when every choice above it is on. The old codes stay as hidden internal names, so saved quotes, kits and tiers keep working. Switches and numbers save with Save changes (the bar at the bottom); adding or changing a color or a choice saves at once.</p>
      {catalog.materials.map(m => (
        <MaterialCard key={m.key} m={m} config={config} catalog={catalog}
          onToggleMaterial={() => setCatalog({ ...catalog, materials: catalog.materials.map(x => (x.key === m.key ? { ...x, quotable: x.quotable === false ? undefined : false } : x)) })}
          onToggleOption={(dim, key) => setCatalog({ ...catalog, materials: catalog.materials.map(x => (x.key !== m.key ? x : { ...x, dims: x.dims.map(d => (d.key !== dim ? d : { ...d, options: d.options.map(o => (o.key !== key ? o : { ...o, quotable: o.quotable === false ? undefined : false })) })) })) })}
          // Vinyl colors are added and edited in Settings → Price List → Vinyl Colors (one form, VinylColorsSettings.tsx).
          onAddColor={under => (m.key === 'vinyl' ? navigate('/settings?tab=price_list&add=vinyl-color') : setWizard({ material: m.key, under }))}
          onEditColor={key => (m.key === 'vinyl' && optionOf(m, 'color', key)?.color?.form ? navigate(`/settings?tab=price_list&color=${encodeURIComponent(key)}`) : setWizard({ material: m.key, edit: key }))}
          onAddChoice={dim => setChoiceDlg({ material: m.key, dim })}
          onEditChoice={(dim, key) => setChoiceDlg({ material: m.key, dim, edit: key })}
          updateStyle={updateStyle}
        />
      ))}
      {unmapped.length > 0 && (
        <section className="rounded-2xl border border-gray-200 p-4">
          <h3 className="text-base font-bold text-gray-900">Other styles</h3>
          <p className={small}>Styles not built from choices.</p>
          <StyleTable styles={unmapped} config={config} updateStyle={updateStyle} />
        </section>
      )}
      {wizard && <ColorWizard config={config} catalog={catalog} material={wizard.material} under={wizard.under} edit={wizard.edit}
        onClose={() => setWizard(null)} onDone={(st, msg) => { commit(st, msg); setWizard(null) }} />}
      {choiceDlg && <ChoiceDialog config={config} catalog={catalog} material={choiceDlg.material} dim={choiceDlg.dim} edit={choiceDlg.edit}
        onClose={() => setChoiceDlg(null)} onDone={(st, msg) => { commit(st, msg); setChoiceDlg(null) }} />}
    </div>
  )
}

// ── One material ─────────────────────────────────────────────────────────────

function MaterialCard({ m, config, catalog, onToggleMaterial, onToggleOption, onAddColor, onEditColor, onAddChoice, onEditChoice, updateStyle }: {
  m: MaterialDef; config: AppConfig; catalog: FenceCatalog
  onToggleMaterial: () => void
  onToggleOption: (dim: string, key: string) => void
  onAddColor: (under?: { dim: string; key: string }) => void
  onEditColor: (key: string) => void
  onAddChoice: (dim: string) => void
  onEditChoice: (dim: string, key: string) => void
  updateStyle: (id: string, patch: Partial<FenceStyle>) => void
}) {
  const styles = config.fenceStyles.filter(s => styleChoicesOf(s)?.material === m.key)
  const colorDim = colorDimOf(m)
  const byStyle = !!colorDim && m.dims.some(x => x.key === 'style')
  const [open, setOpen] = useState(false)
  const count = (dim: string, key: string) => styles.filter(s => styleChoicesOf(s)!.choices[dim] === key).length
  const on = m.quotable !== false
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4" data-tree-material={m.key}>
      <div className="flex items-center gap-3">
        <h3 className="flex-1 text-lg font-bold text-gray-900">{m.label}</h3>
        <span className={small}>Available for quoting</span>
        <Switch on={on} onClick={onToggleMaterial} label={`${m.label} available for quoting`} data-tree-switch={`material:${m.key}`} />
      </div>
      {m.dims.map(d => (
        <div key={d.key} className="space-y-2" data-tree-dim={`${m.key}:${d.key}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{d.label}</p>
          <div className="space-y-2">
            {d.options.filter(o => !o.archived).map(o => (
              <OptionRow key={o.key} m={m} d={d} o={o} config={config} count={count(d.key, o.key)}
                onToggle={() => onToggleOption(d.key, o.key)}
                onEdit={() => (d.isColor ? onEditColor(o.key) : onEditChoice(d.key, o.key))}
                addColor={byStyle && d.key === 'style' && count(d.key, o.key) > 0 ? () => onAddColor({ dim: d.key, key: o.key }) : undefined} />
            ))}
            {d.options.some(o => o.archived) && (
              <p className={small} data-tree-archived={`${m.key}:${d.key}`}>Archived: {d.options.filter(o => o.archived).map(o => (
                <button key={o.key} type="button" className="underline mr-2" onClick={() => (d.isColor ? onEditColor(o.key) : onEditChoice(d.key, o.key))}>{o.label}</button>))}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {d.isColor
              // Vinyl: a color is added to one style (Privacy > Add color); elsewhere to the whole material.
              ? (byStyle ? <p className={small}>Add a color from its style above (Privacy → + Add color), or in Settings → Price List → Vinyl Colors.</p>
                : <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => onAddColor(undefined)} data-add-color={m.key}>+ Add {d.label.toLowerCase()}</button>)
              : <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => onAddChoice(d.key)} data-add-choice={`${m.key}:${d.key}`}>+ Add {d.label.toLowerCase()}</button>}
          </div>
        </div>
      ))}
      <div className="border-t border-gray-100 pt-3">
        <button type="button" className="w-full flex items-center justify-between min-h-[44px] text-sm font-semibold text-gray-800" onClick={() => setOpen(o => !o)} aria-expanded={open} data-tree-fences={m.key}>
          <span>Fences ({styles.length}): switches, labor and profit</span><span aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        <div className={open ? 'mt-2 space-y-2' : 'hidden'}>
          <StyleTable styles={styles} config={config} updateStyle={updateStyle} />
        </div>
        {!open && (
          <ul className="mt-1 space-y-1">
            {styles.map(s => (
              <li key={s.id} className="flex items-center gap-3 min-h-[44px]" data-fence-row={s.name}>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm ${isQuotable(s) ? 'text-gray-900' : 'text-gray-400'}`}>{s.label || s.name}</span>
                  {!isQuotable(s) && <span className="block text-xs text-amber-700">Not available for quoting{s.held ? `: ${s.held}` : ''}</span>}
                  {s.needsCostReview && <CostReviewBadge name={s.name} note={s.costReviewNote} />}
                </span>
                <Switch on={s.quotable !== false} onClick={() => updateStyle(s.id, { quotable: s.quotable === false })} label={`${s.label || s.name} available for quoting`} data-style-quotable={s.name} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function OptionRow({ m, d, o, config, count, onToggle, onEdit, addColor }: {
  m: MaterialDef; d: ChoiceDim; o: ChoiceOption; config: AppConfig; count: number
  onToggle: () => void; onEdit: () => void; addColor?: () => void
}) {
  const status = d.isColor && o.color && o.copiedFrom ? colorStatus(config.fenceStyles, m, o) : null
  const on = o.quotable !== false
  // A choice that waits for prices (chain link Dig set): how many of its parts still have none.
  const waiting = o.waitForPrices
    ? [...new Set(config.fenceStyles.filter(s => { const sc = styleChoicesOf(s); return !!s.madeFrom && sc?.material === m.key && sc.choices[d.key] === o.key }).flatMap(s => partsWaitingForPrice(s.name)))]
    : null
  let note = `${count} fence${count === 1 ? '' : 's'}`
  if (d.isColor && o.color) note += o.color.form ? ` · ${o.color.form.mode === 'section' ? 'per section (kit)' : 'per piece'}, made in Price List → Vinyl Colors` : o.color.pricing === 'piece' ? ` · job lot${o.color.jobLot?.supplier ? ` (${o.color.jobLot.supplier})` : ''}` : ' · priced by part'
  if (d.isColor && typeof o.color?.targetProfitPct === 'number') note += ` · ${o.color.targetProfitPct}% profit`
  return (
    <div className="flex items-center gap-1 rounded-xl border border-gray-200 pl-3 pr-1 py-1" data-tree-option={`${m.key}:${d.key}:${o.key}`}>
      <span className="flex-1 min-w-0 py-1">
        <span className={`block text-sm font-semibold ${on ? 'text-gray-900' : 'text-gray-400'}`}>{o.label}</span>
        <span className="block text-xs text-gray-500">{note}</span>
        {status && !status.ready && (
          <span className="block text-xs text-amber-700" data-color-waiting={o.key}>
            Not available for quoting: {o.color!.pricing === 'piece'
              ? `waiting for ${status.missingPieces.length} piece price${status.missingPieces.length === 1 ? '' : 's'}`
              : `waiting for prices on ${status.unpricedParts.length} part${status.unpricedParts.length === 1 ? '' : 's'} in Inventory`}
          </span>
        )}
        {status?.ready && on && <span className="block text-xs text-green-700" data-color-ready={o.key}>Fully priced: available for quoting</span>}
        {waiting && waiting.length > 0 && (
          <span className="block text-xs text-amber-700" data-option-waiting={`${m.key}:${d.key}:${o.key}`}>
            Not available for quoting: waiting for prices on {waiting.length} part{waiting.length === 1 ? '' : 's'} in Inventory. It switches on by itself once they are in.
          </span>
        )}
        {waiting && waiting.length === 0 && on && <span className="block text-xs text-green-700" data-option-ready={`${m.key}:${d.key}:${o.key}`}>Fully priced: available for quoting</span>}
        {addColor && <button type="button" className="btn btn-secondary btn-sm min-h-[44px] mt-1" onClick={addColor} data-add-color-under={`${m.key}:${d.key}:${o.key}`}>+ Add color</button>}
      </span>
      <button type="button" className="btn btn-quiet btn-sm min-h-[44px] shrink-0" onClick={onEdit} data-edit-option={`${m.key}:${d.key}:${o.key}`}>Edit</button>
      <Switch on={on} onClick={onToggle} label={`${o.label} available for quoting`} data-tree-switch={`${m.key}:${d.key}:${o.key}`} />
    </div>
  )
}

// ── Labor and profit per fence ───────────────────────────────────────────────

/** A style priced with stand-in parts until the real supplier cost is entered (the Bell); clears when its kits are saved. */
function CostReviewBadge({ name, note }: { name: string; note?: string }) {
  return (
    <button type="button" onClick={() => navigate(`/inventory?tab=kits&style=${encodeURIComponent(name)}`)} data-style-cost-review={name}
      className="inline-block mt-0.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 underline-offset-2 hover:underline"
      title={note ? `Cost to review: ${note}.` : "Priced as a 6'x6' vinyl privacy section for now. Enter the real supplier cost in Inventory > Material Kits."}>
      {note ? `Cost to review: ${note}` : 'Cost to review'}
    </button>
  )
}

function StyleTable({ styles, config, updateStyle }: { styles: FenceStyle[]; config: AppConfig; updateStyle: (id: string, patch: Partial<FenceStyle>) => void }) {
  const num = 'w-16 text-right border border-gray-200 rounded px-1 min-h-[36px] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400'
  return (
    <div className="border border-gray-200 rounded-xl overflow-x-auto">
      <table className="w-full text-sm min-w-[980px]">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500">Fence</th>
            <th className="text-left px-2 py-3 text-xs font-semibold text-gray-500 w-28">Category</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-24" title="Target Margin = Overhead % + this">Target Profit</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-24" title="Overhead % + Target Profit %">Target Margin</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20">Sec/MH</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-16">Panel</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20">Walk Gate</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20">Dbl Gate</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20" title="Subcontractor pay per foot or section for this fence">Sub Rate</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20" title="Customer price per foot, used when a quote is priced per foot">$ / Ft</th>
            <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 w-14">Active</th>
            <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 w-24">Available for quoting</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {styles.map(style => {
            const profit = typeof style.colorTargetProfitPct === 'number' ? style.colorTargetProfitPct : style.targetProfitPct
            return (
              <tr key={style.id} className={!style.isActive ? 'opacity-50' : ''}>
                <td className="px-3 py-2.5">
                  <span className="block font-medium text-gray-900">{style.label || style.name}</span>
                  <span className="block text-[11px] text-gray-400" title="Internal name: what saved quotes, kits and tiers use">{style.name}</span>
                  {!isQuotable(style) && <span className="block text-xs text-amber-700" data-style-on-hold>Not available for quoting{style.held ? `: ${style.held}` : ''}</span>}
                  {style.needsCostReview && <CostReviewBadge name={style.name} note={style.costReviewNote} />}
                </td>
                <td className="px-2 py-2.5">
                  <select className="border border-gray-200 rounded px-1 min-h-[36px] text-xs" value={style.category} onChange={e => updateStyle(style.id, { category: e.target.value as FenceStyle['category'] })}>
                    {STYLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <PercentField value={style.targetProfitPct} min={0} max={80} data-style-profit={style.name}
                    className="w-20 text-right border border-gray-200 rounded px-1 min-h-[36px] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                    onChange={v => { if (v != null) updateStyle(style.id, { targetProfitPct: v }) }} />
                  {typeof style.colorTargetProfitPct === 'number' && <span className="block text-[11px] text-gray-500">Color: {style.colorTargetProfitPct}%</span>}
                </td>
                <td className="px-2 py-2.5 text-right text-xs font-mono text-gray-700" data-style-target-margin={style.name}>
                  {Math.round((overheadPctOf(config) + (profit ?? 0)) * 100) / 100}%
                </td>
                <td className="px-2 py-2.5 text-right">
                  <input type="number" step="0.1" min="0.1" max="20" className={num} value={style.sectionsPerMH} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) updateStyle(style.id, { sectionsPerMH: Math.round(v * 10) / 10 }) }} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  {style.autoRailMix ? <span className="text-xs font-mono text-gray-600" title="Chosen per run: 6 ft or 8 ft wide">6 or 8</span>
                    : styleHasPartsList(style.name) || style.madeFrom ? <span className="text-xs font-mono text-gray-600" title="Set by this fence's parts">{sectionWidthForStyle(style.name, style.panelWidth)}</span>
                      : <input type="number" step="1" min="1" className={num} value={style.panelWidth} onChange={e => updateStyle(style.id, { panelWidth: parseInt(e.target.value) || 6 })} />}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <input type="number" step="0.1" min="0" max="20" className={num} value={style.mhPerWalkGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) updateStyle(style.id, { mhPerWalkGate: Math.round(v * 10) / 10 }) }} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <input type="number" step="0.1" min="0" max="20" className={num} value={style.mhPerDblGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) updateStyle(style.id, { mhPerDblGate: Math.round(v * 10) / 10 }) }} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <input type="number" step="0.25" min="0" placeholder="—" className={num} value={style.subRate ?? ''} onChange={e => { const v = parseFloat(e.target.value); updateStyle(style.id, { subRate: e.target.value === '' || isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100 }) }} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <input type="number" step="0.25" min="0" placeholder="—" className={num} value={style.pricePerFoot ?? ''} onChange={e => { const v = parseFloat(e.target.value); updateStyle(style.id, { pricePerFoot: e.target.value === '' || isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100 }) }} />
                </td>
                <td className="px-2 py-2.5 text-center">
                  <Switch on={style.isActive !== false} onClick={() => updateStyle(style.id, { isActive: style.isActive === false })} label={`${style.label || style.name} turned on`} data-style-active={style.name} />
                </td>
                <td className="px-2 py-2.5 text-center">
                  <Switch on={style.quotable !== false} onClick={() => updateStyle(style.id, { quotable: style.quotable === false })} label={`${style.label || style.name} available for quoting`} data-style-quotable-table={style.name} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── A full screen sheet (phone) / dialog (computer) ──────────────────────────

function Sheet({ title, step, onClose, children, footer }: { title: string; step?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center" role="dialog" aria-modal="true" aria-label={title} data-sheet>
      <div className="bg-white w-full md:max-w-2xl md:rounded-2xl md:max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{title}</h2>
            {step && <p className={small} data-sheet-step>{step}</p>}
          </div>
          <button type="button" className="btn btn-quiet min-h-[44px]" onClick={onClose} data-sheet-close>Close</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">{children}</div>
        <div className="border-t border-gray-200 px-4 py-3 flex gap-2 justify-end" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{footer}</div>
      </div>
    </div>
  )
}

// ── Add color / edit color ───────────────────────────────────────────────────

type WizStep = 'name' | 'copy' | 'pricing' | 'coverage' | 'overrides'

function ColorWizard({ config, catalog, material, under, edit, onClose, onDone }: {
  config: AppConfig; catalog: FenceCatalog; material: string; under?: { dim: string; key: string }; edit?: string
  onClose: () => void; onDone: (st: CatalogState, message: string) => void
}) {
  const m = materialOf(catalog, material)!
  const dim = colorDimOf(m)!
  const existing = edit ? optionOf(m, dim.key, edit) : undefined
  const made = !!existing?.copiedFrom
  const word = dim.label.toLowerCase()
  const sources = dim.options.filter(o => !o.archived && o.key !== edit && o.color && stylesOfOption(config.fenceStyles, m.key, dim.key, o.key).some(s => !under || styleChoicesOf(s)!.choices[under.dim] === under.key))
  const underLabel = under ? optionOf(m, under.dim, under.key)?.label : undefined

  const [step, setStep] = useState<WizStep>('name')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [copyFrom, setCopyFrom] = useState(existing?.color?.copiedFrom ?? sources[0]?.key ?? '')
  const [pricing, setPricing] = useState<'part' | 'piece'>(existing?.color?.pricing ?? 'part')
  const [supplier, setSupplier] = useState(existing?.color?.jobLot?.supplier ?? '')
  const [quotedOn, setQuotedOn] = useState(existing?.color?.jobLot?.quotedOn ?? '')
  const [prices, setPrices] = useState<Record<string, PiecePrices>>(existing?.color?.jobLot?.byHeight ?? {})
  const [covers, setCovers] = useState<Record<PieceKey, string[]> | null>(existing?.color?.jobLot?.covers ?? null)
  const [overrides, setOverrides] = useState<QtyOverride[]>(existing?.color?.overrides ?? [])
  const [profit, setProfit] = useState<number | undefined>(typeof existing?.color?.targetProfitPct === 'number' ? existing.color.targetProfitPct : undefined)
  const [error, setError] = useState('')

  const st = useMemo(() => stateOf(config), [config])
  const req = { material, under: edit ? undefined : under, label: label.trim() || 'New', copyFrom }
  // For an edit, what the color's own kits say; for a new color, what it would be made with.
  const shape = useMemo(() => colorShape(st, edit ? { material, copyFrom: edit } : req), [st, material, copyFrom, edit, under])  // eslint-disable-line react-hooks/exhaustive-deps
  const partChoices = useMemo(() => (edit ? piecePartChoices(st, { material, label: existing!.label, copyFrom: edit }) : piecePartChoices(st, req)), [st, copyFrom, label, edit])  // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (edit ? previewColorParts(st, { material, label: existing!.label, copyFrom: edit }) : previewColorParts(st, req)), [st, copyFrom, label, edit])  // eslint-disable-line react-hooks/exhaustive-deps
  const cov = covers ?? defaultCovers(partChoices)
  const jobLot: JobLotQuote = { supplier: supplier.trim(), quotedOn, byHeight: prices, covers: cov }
  const myKits = useMemo(() => {
    if (edit) return st.kits.filter(k => k.madeFor === madeForTag(material, dim.key, edit) && !k.archived)
    try { return planAddColor(st, { ...req, pricing: 'piece', jobLot, overrides } as AddColorRequest).state.kits.filter(k => k.madeFor?.startsWith(`${material}:${dim.key}:`) && !st.kits.includes(k)) } catch { return [] }
  }, [st, copyFrom, label, edit, overrides])  // eslint-disable-line react-hooks/exhaustive-deps
  const warnings = useMemo(() => (pricing === 'piece' ? coverageWarnings(cov, myKits, edit ? existing!.color!.words : [label.trim() || 'New']) : []), [pricing, cov, myKits])  // eslint-disable-line react-hooks/exhaustive-deps

  const steps: WizStep[] = edit && !made
    ? ['name']
    : pricing === 'piece' ? ['name', ...(edit ? [] : ['copy' as WizStep]), 'pricing', 'coverage', 'overrides'] : ['name', ...(edit ? [] : ['copy' as WizStep]), 'pricing', 'overrides']
  const at = steps.indexOf(step)
  const stepNames: Record<WizStep, string> = { name: `${dim.label} name`, copy: 'Copies parts from', pricing: 'How it is priced', coverage: 'What each price includes', overrides: 'Quantities and profit' }

  function next() {
    setError('')
    if (step === 'name' && !label.trim()) { setError(`Type the ${word} name.`); return }
    if (step === 'name' && dim.options.some(o => o.key !== edit && !o.archived && o.label.trim().toLowerCase() === label.trim().toLowerCase())) { setError(`There is already a ${word} called ${label.trim()}.`); return }
    if (step === 'copy' && !copyFrom) { setError(`Pick the ${word} it copies its parts from.`); return }
    setStep(steps[at + 1])
  }

  function finish() {
    setError('')
    try {
      if (!edit) {
        const r = planAddColor(st, { material, under, label: label.trim(), copyFrom, pricing, jobLot: pricing === 'piece' ? jobLot : undefined, overrides, targetProfitPct: profit ?? null })
        onDone(r.state, r.message)
      } else {
        const next = planUpdateOption(st, material, dim.key, edit, {
          label: label.trim(), ...(made ? { pricing, jobLot: pricing === 'piece' ? jobLot : undefined, overrides } : {}), targetProfitPct: profit ?? null,
        })
        onDone(next, `${label.trim()} saved.`)
      }
    } catch (e) { setError((e as Error).message) }
  }

  function act(kind: 'pause' | 'resume' | 'archive' | 'restore' | 'remove') {
    setError('')
    try {
      if (kind === 'remove') {
        if (!window.confirm(`Remove ${existing!.label} and every fence, kit and Inventory part made for it?`)) return
        const r = planRemoveOption(st, material, dim.key, edit!, inUse())
        onDone(r.state, r.message)
        return
      }
      const patch = kind === 'pause' ? { quotable: false } : kind === 'resume' ? { quotable: true } : kind === 'archive' ? { archived: true } : { archived: false }
      onDone(planUpdateOption(st, material, dim.key, edit!, patch), `${existing!.label} ${kind === 'pause' ? 'paused: not available for quoting' : kind === 'resume' ? 'turned back on' : kind === 'archive' ? 'archived' : 'restored'}.`)
    } catch (e) { setError((e as Error).message) }
  }

  const setPrice = (h: string, patch: Partial<PiecePrices>) => setPrices(p => ({ ...p, [h]: { ...(p[h] ?? {}), ...patch } }))
  const priceInput = (h: string, label: string, value: number | null | undefined, set: (c: number | null) => void, attr: string) => (
    <label className="block text-xs text-gray-600">{label}
      <span className="mt-1 flex items-center gap-1"><span className="text-gray-500">$</span>
        <input className={inputCls} inputMode="decimal" defaultValue={money(value)} placeholder="0.00" onBlur={e => set(toCents(e.target.value))} data-piece-price={`${h}:${attr}`} />
      </span>
    </label>
  )

  const footer = (
    <>
      {at > 0 && <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => { setError(''); setStep(steps[at - 1]) }} data-wiz-back>Back</button>}
      {at < steps.length - 1
        ? <button type="button" className="btn btn-primary min-h-[44px]" onClick={next} data-wiz-next>Next</button>
        : <button type="button" className="btn btn-primary min-h-[44px]" onClick={finish} data-wiz-finish>{edit ? 'Save' : `Add ${word}`}</button>}
    </>
  )

  return (
    <Sheet title={edit ? `Edit ${existing?.label}` : `Add ${word}${underLabel ? ` to ${m.label} ${underLabel}` : ` to ${m.label}`}`} step={`Step ${at + 1} of ${steps.length}: ${stepNames[step]}`} onClose={onClose} footer={footer}>
      <div data-wiz-step={step} className="space-y-4">
        {step === 'name' && (<>
          <label className="block text-sm font-semibold text-gray-900">{dim.label} name
            <input className={inputCls + ' mt-1'} value={label} onChange={e => setLabel(e.target.value)} placeholder={dim.key === 'finish' ? 'Green' : 'Clay'} autoFocus data-color-name />
          </label>
          <p className={small}>Plain names come from it, like “{label.trim() || 'Clay'} {m.label === 'Chain link' ? 'Chain Link, 4 ft, Residential' : `${m.label} ${underLabel ?? ''}, 6 ft tall, 8 ft panels, No dig`.replace(/\s+,/, ',')}”.</p>
          {edit && (
            <div className="rounded-xl border border-gray-200 p-3 space-y-2">
              <p className="text-sm font-semibold text-gray-900">{existing!.quotable === false ? 'Paused: not available for quoting' : existing!.archived ? 'Archived' : 'In use'}</p>
              <div className="flex flex-wrap gap-2">
                {existing!.quotable === false
                  ? <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('resume')} data-color-resume>Turn back on</button>
                  : <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('pause')} data-color-pause>Pause (not available for quoting)</button>}
                {existing!.archived
                  ? <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('restore')} data-color-restore>Restore</button>
                  : <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('archive')} data-color-archive>Archive</button>}
                {made && <button type="button" className="btn btn-secondary min-h-[44px] text-red-700" onClick={() => act('remove')} data-color-remove>Remove</button>}
              </div>
              <p className={small}>Archive hides it from quoting and keeps every saved quote on it working. Remove takes away everything made for it, and only works when no saved quote or job uses it.</p>
            </div>
          )}
          {edit && !made && (
            <label className="block text-sm font-semibold text-gray-900">Target Profit % for {existing!.label} (optional)
              <PercentField value={profit} min={0} max={80} placeholder="Same as each fence" className={inputCls + ' mt-1'} onChange={setProfit} data-color-profit />
            </label>
          )}
        </>)}

        {step === 'copy' && (<>
          <p className="text-sm text-gray-700">Which {word} has the same parts? {label.trim()} gets its own copy of that {word}’s color parts (quantities copied, no prices) for every fence it comes in{underLabel ? ` under ${underLabel}` : ''}.</p>
          <div className="space-y-2">
            {sources.map(o => (
              <label key={o.key} className={`flex items-center gap-3 rounded-xl border px-3 min-h-[52px] ${copyFrom === o.key ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                <input type="radio" name="copyFrom" className="w-5 h-5 accent-orange-500" checked={copyFrom === o.key} onChange={() => setCopyFrom(o.key)} data-copy-from={o.key} />
                <span className="text-sm font-semibold text-gray-900">{o.label}</span>
                <span className={small}>{stylesOfOption(config.fenceStyles, m.key, dim.key, o.key).filter(s => !under || styleChoicesOf(s)!.choices[under.dim] === under.key).length} fences</span>
              </label>
            ))}
          </div>
        </>)}

        {step === 'pricing' && (<>
          <div className="space-y-2">
            {(['part', 'piece'] as const).map(p => (
              <label key={p} className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${pricing === p ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                <input type="radio" name="pricing" className="mt-0.5 w-5 h-5 accent-orange-500" checked={pricing === p} onChange={() => setPricing(p)} data-pricing={p} />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">{p === 'part' ? 'Priced by part' : 'Priced by piece (job lot)'}</span>
                  <span className={small}>{p === 'part' ? 'Like White and Tan: each part’s cost comes from Inventory.' : 'Special order: a section, post and gate price from your supplier’s job lot quote.'}</span>
                </span>
              </label>
            ))}
          </div>
          {pricing === 'piece' && (<>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs text-gray-600">Supplier
                <input className={inputCls + ' mt-1'} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier name" data-job-lot-supplier />
              </label>
              <label className="block text-xs text-gray-600">Quote date
                <input type="date" className={inputCls + ' mt-1'} value={quotedOn} onChange={e => setQuotedOn(e.target.value)} data-job-lot-date />
              </label>
            </div>
            {shape.map(h => {
              const p = prices[h.height] ?? {}
              return (
                <div key={h.height} className="rounded-xl border border-gray-200 p-3 space-y-3" data-piece-height={h.height}>
                  {h.label && <p className="text-sm font-semibold text-gray-900">{h.label} tall</p>}
                  <div className="grid grid-cols-2 gap-3">
                    {h.widths.map(w => <div key={w}>{priceInput(h.height, `Section, ${w} ft wide`, p.sectionCents?.[w], c => setPrice(h.height, { sectionCents: { ...(p.sectionCents ?? {}), [w]: c } }), `section${w}`)}</div>)}
                  </div>
                  <label className="flex items-center gap-3 min-h-[44px] text-sm text-gray-800">
                    <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={!!p.separatePosts} onChange={e => setPrice(h.height, { separatePosts: e.target.checked })} data-separate-posts={h.height} />
                    Separate corner, end, line and gate post prices
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {p.separatePosts ? (<>
                      {priceInput(h.height, 'Corner post', p.cornerCents, c => setPrice(h.height, { cornerCents: c }), 'corner')}
                      {priceInput(h.height, 'End post', p.endCents, c => setPrice(h.height, { endCents: c }), 'end')}
                      {priceInput(h.height, 'Line post', p.lineCents, c => setPrice(h.height, { lineCents: c }), 'line')}
                      {priceInput(h.height, 'Gate post (double gate center)', p.gatePostCents, c => setPrice(h.height, { gatePostCents: c }), 'gatePost')}
                    </>) : priceInput(h.height, 'Post', p.postCents, c => setPrice(h.height, { postCents: c }), 'post')}
                    {priceInput(h.height, 'Walk gate', p.walkGateCents, c => setPrice(h.height, { walkGateCents: c }), 'walkGate')}
                    {priceInput(h.height, 'Double gate', p.dblGateCents, c => setPrice(h.height, { dblGateCents: c }), 'dblGate')}
                  </div>
                </div>
              )
            })}
            <p className={small}>You can leave prices blank and enter them later (Edit). The {word} is not available for quoting until every price is in.</p>
          </>)}
          {pricing === 'part' && <p className={small}>The {word}’s parts are added to Inventory with no price. It is not available for quoting until each of them has a price.</p>}
        </>)}

        {step === 'coverage' && (<>
          <p className="text-sm text-gray-700">Tick the parts each price includes. Ticked parts stay on the pull sheet, order list and install packet at $0; everything not ticked (pipe, donuts, concrete, screws, anything you supply) is still priced from Inventory.</p>
          {(Object.keys(PIECE_LABEL) as PieceKey[]).map(piece => (
            <div key={piece} className="rounded-xl border border-gray-200 p-3" data-coverage={piece}>
              <p className="text-sm font-semibold text-gray-900 mb-1">{PIECE_LABEL[piece]} price includes</p>
              {partChoices[piece].length === 0 && <p className={small}>No parts.</p>}
              {partChoices[piece].map(({ part, color }) => {
                const on = cov[piece].includes(part)
                return (
                  <label key={part} className="flex items-center gap-3 min-h-[44px] text-sm text-gray-800">
                    <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={on} data-cover={`${piece}:${part}`}
                      onChange={e => setCovers({ ...cov, [piece]: e.target.checked ? [...cov[piece], part] : cov[piece].filter(x => x !== part) })} />
                    <span className={color ? 'font-medium' : 'text-gray-600'}>{part.replace(/^\*+/, '')}</span>
                  </label>
                )
              })}
            </div>
          ))}
          {warnings.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-1" data-coverage-warnings>
              {warnings.map((w, i) => <p key={i} className="text-xs text-amber-900">{w}</p>)}
            </div>
          )}
        </>)}

        {step === 'overrides' && (<>
          <p className="text-sm text-gray-700">{label.trim()}’s color parts with the quantities copied from {optionOf(m, dim.key, edit ? existing?.copiedFrom : copyFrom)?.label ?? 'its source'}. Change one only where {label.trim()} is built differently (Tan uses 16 pickets per 8 ft panel where White uses 15).</p>
          {rows.length === 0 && <p className={small}>No color parts to set.</p>}
          {rows.map(r => {
            const ov = overrides.find(o => o.height === r.height && o.width === r.width && o.kit === r.kit && o.part === r.part)
            const where = `${r.height ? `${optionOf(m, 'height', r.height)?.label ?? r.height} tall, ` : ''}${r.kit === 'section' ? `section ${r.width} ft wide` : KIT_LABEL[r.kit].toLowerCase()}`
            return (
              <label key={`${r.height}|${r.width}|${r.kit}|${r.part}`} className="flex items-center gap-3 min-h-[52px] border-b border-gray-100" data-override-row={`${r.height}|${r.width}|${r.kit}|${r.part}`}>
                <span className="flex-1 min-w-0 text-sm text-gray-800">{r.part.replace(/^\*+/, '')}<span className="block text-xs text-gray-500">{where} · {optionOf(m, dim.key, edit ? existing?.copiedFrom : copyFrom)?.label ?? 'source'}: {r.qty}</span></span>
                <input className="w-20 border border-gray-300 rounded-lg px-2 min-h-[44px] text-sm text-right" inputMode="decimal" defaultValue={ov ? String(ov.qty) : String(r.qty)}
                  data-override={`${r.height}|${r.width}|${r.kit}|${r.part}`}
                  onBlur={e => {
                    const v = parseFloat(e.target.value)
                    const rest = overrides.filter(o => !(o.height === r.height && o.width === r.width && o.kit === r.kit && o.part === r.part))
                    setOverrides(Number.isFinite(v) && v >= 0 && v !== r.qty ? [...rest, { height: r.height, width: r.width, kit: r.kit, part: r.part, qty: v }] : rest)
                  }} />
              </label>
            )
          })}
          <label className="block text-sm font-semibold text-gray-900">Target Profit % for {label.trim()} (optional)
            <PercentField value={profit} min={0} max={80} placeholder="Blank: same as each fence" className={inputCls + ' mt-1'} onChange={setProfit} data-color-profit />
          </label>
          <p className={small}>A premium {word} can earn more. Blank uses each fence’s own Target Profit %.</p>
        </>)}
        {error && <p className="text-sm text-red-700" role="alert" data-wiz-error>{error}</p>}
      </div>
    </Sheet>
  )
}

// ── Add or edit a choice that is not a color ─────────────────────────────────

function ChoiceDialog({ config, catalog, material, dim: dimKey, edit, onClose, onDone }: {
  config: AppConfig; catalog: FenceCatalog; material: string; dim: string; edit?: string
  onClose: () => void; onDone: (st: CatalogState, message: string) => void
}) {
  const m = materialOf(catalog, material)!
  const d = m.dims.find(x => x.key === dimKey)!
  const existing = edit ? optionOf(m, d.key, edit) : undefined
  const word = d.label.toLowerCase()
  const [label, setLabel] = useState(existing?.label ?? '')
  const [nameText, setNameText] = useState(existing?.nameText ?? '')
  const withFences = d.options.filter(o => !o.archived && stylesOfOption(config.fenceStyles, m.key, d.key, o.key).length > 0)
  const [copyFrom, setCopyFrom] = useState(withFences[0]?.key ?? '')
  const [error, setError] = useState('')
  const st = useMemo(() => stateOf(config), [config])
  const made = !!existing?.copiedFrom

  function save() {
    setError('')
    try {
      if (!edit) {
        const r = planAddChoice(st, { material, dim: d.key, label, nameText: nameText || (d.key === 'width' ? `${label.trim()} panels` : ''), copyFrom })
        onDone(r.state, r.message)
      } else {
        onDone(planUpdateOption(st, material, d.key, edit, { label, nameText }), `${label.trim()} saved.`)
      }
    } catch (e) { setError((e as Error).message) }
  }
  function act(kind: 'pause' | 'resume' | 'archive' | 'restore' | 'remove') {
    setError('')
    try {
      if (kind === 'remove') {
        if (!window.confirm(`Remove ${existing!.label} and every fence and kit made for it?`)) return
        const r = planRemoveOption(st, material, d.key, edit!, inUse())
        onDone(r.state, r.message); return
      }
      const patch = kind === 'pause' ? { quotable: false } : kind === 'resume' ? { quotable: true } : kind === 'archive' ? { archived: true } : { archived: false }
      onDone(planUpdateOption(st, material, d.key, edit!, patch), `${existing!.label} saved.`)
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <Sheet title={edit ? `Edit ${existing?.label}` : `Add ${word} to ${m.label}`} onClose={onClose}
      footer={<button type="button" className="btn btn-primary min-h-[44px]" onClick={save} data-choice-save>{edit ? 'Save' : `Add ${word}`}</button>}>
      <div className="space-y-4" data-choice-dialog={`${m.key}:${d.key}`}>
        <label className="block text-sm font-semibold text-gray-900">{d.label}
          <input className={inputCls + ' mt-1'} value={label} onChange={e => setLabel(e.target.value)} placeholder={d.key === 'height' ? '7 ft' : d.key === 'style' ? 'Semi privacy' : d.key === 'width' ? '10 ft' : ''} autoFocus data-choice-label />
        </label>
        <label className="block text-xs text-gray-600">How it reads in the fence’s name (optional)
          <input className={inputCls + ' mt-1'} value={nameText} onChange={e => setNameText(e.target.value)} placeholder={d.key === 'width' ? `${label.trim() || '10 ft'} panels` : label.trim() || 'Same as above'} data-choice-name-text />
        </label>
        {!edit && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">Copy the fences and parts of</p>
            {withFences.map(o => (
              <label key={o.key} className={`flex items-center gap-3 rounded-xl border px-3 min-h-[52px] ${copyFrom === o.key ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                <input type="radio" name="choiceCopy" className="w-5 h-5 accent-orange-500" checked={copyFrom === o.key} onChange={() => setCopyFrom(o.key)} data-choice-copy={o.key} />
                <span className="text-sm font-semibold text-gray-900">{o.label}</span>
                <span className={small}>{stylesOfOption(config.fenceStyles, m.key, d.key, o.key).length} fences</span>
              </label>
            ))}
            <p className={small}>The new {word} starts with the same parts and numbers, turned off. Change its parts in Inventory → Material Kits, then switch it on here.</p>
          </div>
        )}
        {edit && (
          <div className="flex flex-wrap gap-2">
            {existing!.quotable === false
              ? <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('resume')}>Turn on</button>
              : <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('pause')}>Pause</button>}
            {existing!.archived
              ? <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('restore')}>Restore</button>
              : <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => act('archive')}>Archive</button>}
            {made && <button type="button" className="btn btn-secondary min-h-[44px] text-red-700" onClick={() => act('remove')} data-choice-remove>Remove</button>}
          </div>
        )}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}
