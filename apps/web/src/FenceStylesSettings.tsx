/**
 * Settings → Fence Styles (owner only): the fences as a tree, Material >
 * choices, with an "Available for quoting" switch at every level, instead of
 * a table of codes.
 *
 *   Vinyl                                Available
 *     Pricing for every Vinyl fence: Target Profit %, sub rates
 *     Style: Privacy [Add color] · Bell
 *     Height: 4 ft · 6 ft · 8 ft · + Add height
 *     Color: White (by part) · Tan (by part) · Clay (job lot, waiting for prices)
 *     ...
 *     Fences (15): each by its plain name, with its own switch, its Target
 *     Profit % (Overhead % next to it, and the Target Margin), its sub rates
 *     and the cost and price of 100 ft. Archived ones in their own part.
 *
 * A switch shows ON only when something under it can be quoted
 * (fenceSettingsView.ts groupSwitch). Target Profit % and sub rates are set
 * on a material or a choice for every fence under it, and on a fence or a
 * color as its own number, marked, with Reset (fenceRates.ts). A change
 * reaches new quotes: a saved quote keeps the cost factor it was priced with,
 * and a sent or signed one is never priced again.
 *
 * Add color walks through: the color's name, which color it copies its parts
 * from, priced by part or by piece (job lot: section, post and gate prices
 * and what each includes), quantity overrides and an optional Target Profit
 * %. Adding a height, a vinyl style (Semi privacy), a section width, a finish
 * or a product works the same way. Nothing here needs a code change.
 *
 * Switches and the numbers here are part of the Settings page and save with
 * Save Changes. Adding, editing, archiving or removing a color or a choice
 * saves at once (it also makes or removes Inventory parts and kits).
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { AppConfig, FenceStyle } from './configStore'
import { getConfig, overheadPctOf } from './configStore'
import PercentField from './PercentField'
import { sectionWidthForStyle, styleHasPartsList } from './materialCalculator'
import { getInventory, getKitSets, saveInventory, saveKitSets, type InventoryItem } from './inventoryStore'
import { getQuotes } from './quoteStore'
import { getJobs } from './jobStore'
import { isQuotable } from './styleAvailability'
import { colorStatusWords, waitForPricesWords, type StatusLine } from './optionStatusWords'
import { toast } from './toast'
import { navigate } from './nav'
import { KIT_LABEL } from './materialKits'
import {
  catalogOf, colorDimOf, colorStatus, colorShape, coverageWarnings, defaultCovers, materialOf, optionOf, piecePartChoices,
  planAddChoice, planAddColor, planRemoveOption, planUpdateOption, previewColorParts, styleChoicesOf, stylesOfOption, madeForTag, partsWaitingForPrice,
  PIECE_LABEL, type AddColorRequest, type CatalogState, type ChoiceDim, type ChoiceOption, type FenceCatalog, type JobLotQuote,
  type MaterialDef, type PiecePrices, type PieceKey, type QtyOverride, type InvItem,
} from './fenceCatalog'
import { RATE_KEYS, withRate, materialRate, optionRate, type RateKey } from './fenceRates'
import { MAX_TARGET_MARGIN_PCT, maxProfitPct } from './targetMargin'
import {
  draftView, categoryChoices, groupSwitch, fenceStatus, archivedBy, dimHeading, fenceName, profitShown, subShown, subUnitWords, example100ft, EXAMPLE_WORDS,
  type Example, type GroupSwitch, type RateShown,
} from './fenceSettingsView'

const money = (cents: number | null | undefined) => (typeof cents === 'number' ? (cents / 100).toFixed(2) : '')
const toCents = (text: string): number | null => { const v = parseFloat(text.replace(/[$,\s]/g, '')); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null }
const inputCls = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const small = 'text-xs text-gray-500'
/** Whole dollars with commas: "$3,880". */
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`
/** A sub rate: "$5" or "$5.25". */
const rateText = (v: number) => `$${Number.isInteger(v) ? v : v.toFixed(2)}`
const pct = (v: number) => `${Math.round(v * 100) / 100}%`
type SubKey = Exclude<RateKey, 'targetProfitPct'>
const SUB_KEYS: SubKey[] = ['subRate', 'subWalkGate', 'subDblGate']

function Switch({ on, onClick, label, disabled, ...rest }: { on: boolean; onClick: () => void; label: string; disabled?: boolean } & Record<`data-${string}`, string>) {
  // A 44 px tall tap target around a small track. Disabled: it cannot be turned on from here (its reason is beside it).
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={disabled ? label : undefined} onClick={onClick} disabled={disabled} {...rest}
      className={`shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[52px] bg-transparent ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
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

/** What the screen reads: the draft as the quote builder would price it, and the saved Settings (for "was"). */
interface Views {
  view: AppConfig; saved: AppConfig; byId: Map<string, FenceStyle>; savedById: Map<string, FenceStyle>
  /** 100 ft of a fence now (this draft), and as saved; worked out once per draft. */
  ex: (id: string) => Example | null
  wasEx: (id: string) => Example | null
}

function makeViews(config: AppConfig): Views {
  const view = draftView(config, overheadPctOf(config))
  const saved = getConfig()
  const byId = new Map(view.fenceStyles.map(s => [s.id, s]))
  const savedById = new Map(saved.fenceStyles.map(s => [s.id, s]))
  const memo = (cfg: AppConfig, of: Map<string, FenceStyle>) => {
    const cache = new Map<string, Example | null>()
    return (id: string) => { if (!cache.has(id)) cache.set(id, example100ft(of.get(id), cfg)); return cache.get(id)! }
  }
  return { view, saved, byId, savedById, ex: memo(view, byId), wasEx: memo(saved, savedById) }
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
  const [tick, setTick] = useState(0)
  const views = useMemo(() => makeViews(config), [config, tick])  // eslint-disable-line react-hooks/exhaustive-deps

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
  /**
   * A Target Profit % or sub rate set (or cleared) on a material or a choice.
   * Only that number is saved: every fence follows it by the order in
   * fenceRates.ts, and clearing it gives each fence back what it had.
   */
  function setLevelRate(material: string, dim: string | null, optKey: string | null, key: RateKey, v: number | undefined) {
    const materials = catalog.materials.map(m => {
      if (m.key !== material) return m
      if (!dim) return { ...m, rateDefaults: withRate(m.rateDefaults, key, v) }
      return {
        ...m, dims: m.dims.map(d => (d.key !== dim ? d : {
          ...d, options: d.options.map(o => {
            if (o.key !== optKey) return o
            // A color's Target Profit is the one on the color (the Add color steps and Vinyl Colors read it there).
            if (key === 'targetProfitPct' && o.color) {
              const color = { ...o.color }
              if (typeof v === 'number') color.targetProfitPct = v; else delete color.targetProfitPct
              return { ...o, color }
            }
            return { ...o, rateDefaults: withRate(o.rateDefaults, key, v) }
          }),
        })),
      }
    })
    onChange({ ...config, fenceCatalog: { ...catalog, materials } })
  }
  const unmapped = views.view.fenceStyles.filter(s => { const sc = styleChoicesOf(s); return !sc || !materialOf(catalog, sc.material) })

  return (
    <div className="space-y-5" data-styles-tree>
      <p className="text-sm text-gray-600">Fences are built from choices. A switch is on only when something under it can be quoted; a fence is offered only when every choice above it is on. Target Profit % and sub rates set on a material or a choice apply to every fence under it; a fence can have its own number, marked, with Reset. A change applies to new quotes; a saved quote keeps the Target Margin it was priced with, and a sent or signed quote never changes. Switches and numbers save with Save changes (the bar at the bottom); adding or changing a color or a choice saves at once.</p>
      {catalog.materials.map(m => (
        <MaterialCard key={m.key} m={m} config={config} views={views}
          onToggleMaterial={() => setCatalog({ ...catalog, materials: catalog.materials.map(x => (x.key === m.key ? { ...x, quotable: x.quotable === false ? undefined : false } : x)) })}
          onToggleOption={(dim, key) => setCatalog({ ...catalog, materials: catalog.materials.map(x => (x.key !== m.key ? x : { ...x, dims: x.dims.map(d => (d.key !== dim ? d : { ...d, options: d.options.map(o => (o.key !== key ? o : { ...o, quotable: o.quotable === false ? undefined : false })) })) })) })}
          // Vinyl colors are added and edited in Settings → Price List → Vinyl Colors (one form, VinylColorsSettings.tsx).
          onAddColor={under => (m.key === 'vinyl' ? navigate('/settings?tab=price_list&add=vinyl-color') : setWizard({ material: m.key, under }))}
          onEditColor={key => (m.key === 'vinyl' && optionOf(m, 'color', key)?.color?.form ? navigate(`/settings?tab=price_list&color=${encodeURIComponent(key)}`) : setWizard({ material: m.key, edit: key }))}
          onAddChoice={dim => setChoiceDlg({ material: m.key, dim })}
          onEditChoice={(dim, key) => setChoiceDlg({ material: m.key, dim, edit: key })}
          onLevelRate={(dim, key, rate, v) => setLevelRate(m.key, dim, key, rate, v)}
          updateStyle={updateStyle}
        />
      ))}
      {unmapped.length > 0 && (
        <section className="rounded-2xl border border-gray-200 p-4">
          <h3 className="text-base font-bold text-gray-900">Other styles</h3>
          <p className={small}>Styles not built from choices.</p>
          <div className="mt-2 space-y-2">
            {unmapped.map(s => <FenceRow key={s.id} s={s} m={undefined} config={config} views={views} updateStyle={updateStyle} />)}
          </div>
          <LaborTable styles={unmapped} views={views} updateStyle={updateStyle} />
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

function MaterialCard({ m, config, views, onToggleMaterial, onToggleOption, onAddColor, onEditColor, onAddChoice, onEditChoice, onLevelRate, updateStyle }: {
  m: MaterialDef; config: AppConfig; views: Views
  onToggleMaterial: () => void
  onToggleOption: (dim: string, key: string) => void
  onAddColor: (under?: { dim: string; key: string }) => void
  onEditColor: (key: string) => void
  onAddChoice: (dim: string) => void
  onEditChoice: (dim: string, key: string) => void
  onLevelRate: (dim: string | null, key: string | null, rate: RateKey, v: number | undefined) => void
  updateStyle: (id: string, patch: Partial<FenceStyle>) => void
}) {
  const styles = views.view.fenceStyles.filter(s => styleChoicesOf(s)?.material === m.key)
  const colorDim = colorDimOf(m)
  const byStyle = !!colorDim && m.dims.some(x => x.key === 'style')
  const [laborOpen, setLaborOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const under = (dim: string, key: string) => styles.filter(s => styleChoicesOf(s)!.choices[dim] === key)
  const sw = groupSwitch(m.quotable !== false, styles, m.label)
  const archived = styles.filter(s => archivedBy(s).length > 0)
  const live = styles.filter(s => archivedBy(s).length === 0)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4" data-tree-material={m.key}>
      <div>
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-lg font-bold text-gray-900">{m.label}</h3>
          <span className={small}>Available for quoting</span>
          <Switch on={sw.on} onClick={onToggleMaterial} label={`${m.label} available for quoting`} data-tree-switch={`material:${m.key}`} />
        </div>
        <SwitchWords sw={sw} name={`material:${m.key}`} offText={`Switched off: no ${m.label.toLowerCase()} fence is quoted.`} />
      </div>
      <LevelRates m={m} dim={null} config={config} views={views} fences={live} onSet={(rate, v) => onLevelRate(null, null, rate, v)} />
      {m.dims.map(d => (
        <div key={d.key} className="space-y-2" data-tree-dim={`${m.key}:${d.key}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{dimHeading(d)}</p>
          <div className="space-y-2">
            {d.options.filter(o => !o.archived).map(o => (
              <OptionRow key={o.key} m={m} d={d} o={o} config={config} views={views} fences={under(d.key, o.key)}
                onToggle={() => onToggleOption(d.key, o.key)}
                onEdit={() => (d.isColor ? onEditColor(o.key) : onEditChoice(d.key, o.key))}
                onRate={(rate, v) => onLevelRate(d.key, o.key, rate, v)}
                addColor={byStyle && d.key === 'style' && under(d.key, o.key).length > 0 ? () => onAddColor({ dim: d.key, key: o.key }) : undefined} />
            ))}
            {d.options.some(o => o.archived) && (
              <p className={small} data-tree-archived={`${m.key}:${d.key}`}>Archived: {d.options.filter(o => o.archived).map(o => (
                <button key={o.key} type="button" className="underline mr-2 min-h-[44px]" onClick={() => (d.isColor ? onEditColor(o.key) : onEditChoice(d.key, o.key))}>{o.label}</button>))}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {d.isColor
              // Vinyl: a color is added to one style (Privacy > Add color); elsewhere to the whole material.
              ? (byStyle ? <p className={small}>Add a color from its style above (Privacy → + Add color), or in Settings → Price List → Vinyl Colors.</p>
                : <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => onAddColor(undefined)} data-add-color={m.key}>+ Add {dimHeading(d).toLowerCase()}</button>)
              : <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => onAddChoice(d.key)} data-add-choice={`${m.key}:${d.key}`}>+ Add {dimHeading(d).toLowerCase()}</button>}
          </div>
        </div>
      ))}
      <div className="border-t border-gray-100 pt-3 space-y-2" data-tree-fences={m.key}>
        <p className="text-sm font-semibold text-gray-800">Fences ({live.length}): switch, Target Profit, sub rates</p>
        {live.map(s => <FenceRow key={s.id} s={s} m={m} config={config} views={views} updateStyle={updateStyle} />)}
        {archived.length > 0 && (
          <div className="rounded-xl border border-gray-200" data-fences-archived={m.key}>
            <button type="button" className="w-full flex items-center justify-between min-h-[44px] px-3 text-sm font-semibold text-gray-700" onClick={() => setArchivedOpen(o => !o)} aria-expanded={archivedOpen} data-fences-archived-toggle={m.key}>
              <span>Archived ({archived.length})</span><span aria-hidden>{archivedOpen ? '▴' : '▾'}</span>
            </button>
            {archivedOpen && (
              <div className="px-2 pb-2 space-y-2">
                <p className={small}>Not offered for quoting: a choice they are made with is archived. Saved quotes on them keep working.</p>
                {archived.map(s => <FenceRow key={s.id} s={s} m={m} config={config} views={views} updateStyle={updateStyle} />)}
              </div>
            )}
          </div>
        )}
        <button type="button" className="w-full flex items-center justify-between min-h-[44px] text-sm font-semibold text-gray-700" onClick={() => setLaborOpen(o => !o)} aria-expanded={laborOpen} data-tree-labor={m.key}>
          <span>Labor numbers: sections per man hour, gates, $ per foot</span><span aria-hidden>{laborOpen ? '▴' : '▾'}</span>
        </button>
        {laborOpen && <LaborTable styles={styles} views={views} updateStyle={updateStyle} />}
      </div>
    </section>
  )
}

/** The words under a material's or a choice's switch: switched off, or on but nothing under it can be quoted. */
function SwitchWords({ sw, name, offText }: { sw: GroupSwitch; name: string; offText: string | null }) {
  const text = sw.offWhy ?? (!sw.ownOn ? offText : null)
  if (!text) return null
  return <span className="block text-xs text-amber-700" data-option-status={name} data-tone="off" {...(sw.offWhy ? { 'data-switch-off-why': name } : {})}>{text}</span>
}

function OptionRow({ m, d, o, config, views, fences, onToggle, onEdit, onRate, addColor }: {
  m: MaterialDef; d: ChoiceDim; o: ChoiceOption; config: AppConfig; views: Views; fences: FenceStyle[]
  onToggle: () => void; onEdit: () => void; onRate: (rate: RateKey, v: number | undefined) => void; addColor?: () => void
}) {
  const [pricingOpen, setPricingOpen] = useState(false)
  const status = d.isColor && o.color && o.copiedFrom ? colorStatus(config.fenceStyles, m, o) : null
  const ownOn = o.quotable !== false
  const sw = groupSwitch(ownOn && m.quotable !== false, fences, o.label)
  const shownSw: GroupSwitch = { ...sw, ownOn, offWhy: sw.offWhy ?? (ownOn && m.quotable === false ? `Off: ${m.label} is switched off.` : null) }
  // A choice that waits for prices (chain link Dig set): fence by fence, which wait and which are quotable now.
  const waitFences = o.waitForPrices
    ? fences.filter(s => !!s.madeFrom).map(s => {
      const reasons = (s.held ?? '').split('; ').filter(r => r && !r.startsWith(`${o.label} is waiting for prices`))
      return {
        label: fenceName(s).split(', ').filter(x => x !== o.label).join(', '),
        unpriced: partsWaitingForPrice(s.name).length,
        switchedOff: s.isActive === false || s.quotable === false || reasons.some(r => / is (turned off|archived)$/.test(r)),
      }
    })
    : null
  const lines: StatusLine[] = waitFences
    ? waitForPricesWords(ownOn, waitFences)
    : status
      ? colorStatusWords(ownOn, status.ready ? null : o.color!.pricing === 'piece'
        ? `${status.missingPieces.length} piece price${status.missingPieces.length === 1 ? '' : 's'}`
        : `prices on ${status.unpricedParts.length} part${status.unpricedParts.length === 1 ? '' : 's'} in Inventory`)
      : []
  // "Fully priced: available for quoting" is only said when a fence under it can be quoted.
  const shownLines = lines.filter(l => !(l.tone === 'ok' && !sw.on))
  const live = fences.filter(s => archivedBy(s).length === 0)
  let note = `${live.length} fence${live.length === 1 ? '' : 's'}`
  if (d.isColor && o.color) note += o.color.form ? ` · ${o.color.form.mode === 'section' ? 'per section (kit)' : 'per piece'}, made in Price List → Vinyl Colors` : o.color.pricing === 'piece' ? ` · job lot${o.color.jobLot?.supplier ? ` (${o.color.jobLot.supplier})` : ''}` : ' · priced by part'
  const set = RATE_KEYS.filter(k => optionRate(o, k) !== undefined)
  const unit = subUnitWords(config.pricing)
  const summary = set.map(k => (k === 'targetProfitPct' ? `${pct(optionRate(o, k)!)} profit` : `${k === 'subRate' ? 'sub' : k === 'subWalkGate' ? 'walk gate' : 'double gate'} ${rateText(optionRate(o, k)!)}${k === 'subRate' ? `/${unit.short}` : ''}`)).join(', ')
  return (
    <div className="rounded-xl border border-gray-200" data-tree-option={`${m.key}:${d.key}:${o.key}`}>
      <div className="flex items-center gap-1 pl-3 pr-1 py-1">
        <span className="flex-1 min-w-0 py-1">
          <span className={`block text-sm font-semibold ${sw.on ? 'text-gray-900' : 'text-gray-400'}`}>{o.label}</span>
          <span className="block text-xs text-gray-500">{note}{summary ? ` · ${summary}` : ''}</span>
          <SwitchWords sw={shownSw} name={`${m.key}:${d.key}:${o.key}`} offText={`Switched off: no fence with ${o.label} is quoted.`} />
          {shownLines.map((l, i) => (
            <span key={i} className={`block text-xs ${l.tone === 'ok' ? 'text-green-700' : 'text-amber-700'}`}
              data-option-status={`${m.key}:${d.key}:${o.key}`} data-tone={l.tone}
              {...(status && l.tone !== 'ok' ? { 'data-color-waiting': o.key } : {})}
              {...(status && l.tone === 'ok' ? { 'data-color-ready': o.key } : {})}
              {...(waitFences && l.tone === 'wait' ? { 'data-option-waiting': `${m.key}:${d.key}:${o.key}` } : {})}
              {...(waitFences && l.tone === 'ok' && ownOn && waitFences.every(f => f.unpriced === 0) ? { 'data-option-ready': `${m.key}:${d.key}:${o.key}` } : {})}>
              {l.text}
            </span>
          ))}
          {addColor && <button type="button" className="btn btn-secondary btn-sm min-h-[44px] mt-1" onClick={addColor} data-add-color-under={`${m.key}:${d.key}:${o.key}`}>+ Add color</button>}
        </span>
        <button type="button" className="btn btn-quiet btn-sm min-h-[44px] shrink-0" onClick={() => setPricingOpen(p => !p)} aria-expanded={pricingOpen} data-option-pricing={`${m.key}:${d.key}:${o.key}`}>Pricing</button>
        <button type="button" className="btn btn-quiet btn-sm min-h-[44px] shrink-0" onClick={onEdit} data-edit-option={`${m.key}:${d.key}:${o.key}`}>Edit</button>
        <Switch on={sw.on} onClick={onToggle} label={`${o.label} available for quoting`} data-tree-switch={`${m.key}:${d.key}:${o.key}`} />
      </div>
      {pricingOpen && (
        <div className="border-t border-gray-100 px-3 py-2">
          <LevelRates m={m} dim={d} opt={o} config={config} views={views} fences={live} onSet={onRate} />
        </div>
      )}
    </div>
  )
}

// ── Target Profit % and sub rates for every fence under a material or a choice ──

/** The most Target Profit allowed at this overhead, in words, and when a typed one is over it. */
function profitLimitWords(overhead: number): string {
  return `Up to ${pct(maxProfitPct(overhead))}: Overhead ${pct(overhead)} + Target Profit can be at most ${MAX_TARGET_MARGIN_PCT}%.`
}

/** The 100 ft example in words (or why the fence cannot be quoted). */
function exampleText(ex: Example | null, was: Example | null): ReactNode {
  if (!ex) return null
  if ('cannot' in ex) return <>Can’t be quoted: {ex.cannot}</>
  const wasPrice = was && !('cannot' in was) && was.priceCents !== ex.priceCents ? was.priceCents : null
  return <>{EXAMPLE_WORDS}: cost {dollars(ex.costCents)}, price {dollars(ex.priceCents)}{wasPrice !== null ? <span className="font-semibold text-orange-800"> (was {dollars(wasPrice)}; new quotes only)</span> : null}</>
}

function LevelRates({ m, dim, opt, config, views, fences, onSet }: {
  m: MaterialDef; dim: ChoiceDim | null; opt?: ChoiceOption; config: AppConfig; views: Views; fences: FenceStyle[]
  onSet: (rate: RateKey, v: number | undefined) => void
}) {
  const overhead = overheadPctOf(config)
  const unit = subUnitWords(config.pricing)
  const [tooHigh, setTooHigh] = useState<'letters' | 'range' | null>(null)
  const name = opt ? opt.label : m.label
  const where = opt ? `${m.key}:${dim!.key}:${opt.key}` : m.key
  const own = (k: RateKey) => (opt ? optionRate(opt, k) : materialRate(m, k))
  const profit = own('targetProfitPct')
  // What blank means here: the material's number (for a choice), else each fence's own, else Settings → Pricing.
  const blankProfit = opt && materialRate(m, 'targetProfitPct') !== undefined ? `${m.label}: ${pct(materialRate(m, 'targetProfitPct')!)}` : 'Each fence keeps its own'
  const blankSub = (k: SubKey) => {
    const mat = opt ? materialRate(m, k) : undefined
    if (mat !== undefined) return `${m.label}: ${rateText(mat)}`
    const p = config.pricing
    const v = k === 'subRate' ? (p.subRateByCategory?.[m.category] || p.subRateDefault) : k === 'subWalkGate' ? p.subWalkGate : p.subDblGate
    return v > 0 ? `Settings: ${rateText(v)}` : 'Not set'
  }
  // The fences whose Target Margin or 100 ft price this draft changes (not saved yet).
  const priceOf = (e: Example | null) => (e && !('cannot' in e) ? e.priceCents : null)
  const changed = fences.filter(s => { const was = views.savedById.get(s.id); return !!was && (was.margin !== s.margin || priceOf(views.wasEx(s.id)) !== priceOf(views.ex(s.id))) })
  const sample = fences.find(isQuotable)
  const isWood = m.key === 'wood'
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 space-y-2" data-level-rates={where}>
      <p className="text-xs font-semibold text-gray-700">{opt ? `Pricing for every fence with ${name}` : `Pricing for every ${name} fence`}</p>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="block text-xs text-gray-600">Target Profit
          <PercentField value={profit} min={0} max={maxProfitPct(overhead)} placeholder={blankProfit} data-level-profit={where} onBad={setTooHigh}
            className="mt-1 block w-44 border border-gray-300 rounded-lg px-2 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
            onChange={v => onSet('targetProfitPct', v)} />
        </label>
        {profit !== undefined && <p className="text-xs text-gray-700 pb-3" data-level-margin={where}>+ Overhead {pct(overhead)} = Target Margin {pct(overhead + profit)}</p>}
      </div>
      {tooHigh && <p className="text-xs font-semibold text-red-700" role="alert" data-level-profit-too-high={where}>{tooHigh === 'letters' ? 'Type a percent, like 14.' : profitLimitWords(overhead)} Not changed.</p>}
      {!isWood && (
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {SUB_KEYS.map(k => (
            <MoneyRate key={k} label={k === 'subRate' ? `Sub, ${unit.long}` : k === 'subWalkGate' ? 'Sub, per walk gate' : 'Sub, per double gate'}
              value={own(k)} placeholder={blankSub(k)} attr={`${where}:${k}`} onSet={v => onSet(k, v)} />
          ))}
        </div>
      )}
      <p className={small}>Blank: {opt ? `follows ${m.label}` : isWood ? 'each fence keeps its own Target Profit' : 'each fence keeps its own Target Profit, and sub rates come from Settings → Pricing'}. A fence with its own number keeps it.{isWood ? ' Wood sub labor is its White Vinyl fence’s labor × the Wood factor (Settings → Moves and Repairs).' : ''}</p>
      {sample && (
        <p className="text-xs text-gray-700" data-level-example={where}>Example, {fenceName(sample)}: {exampleText(views.ex(sample.id), views.wasEx(sample.id))}.</p>
      )}
      {changed.length > 0 && (
        <p className="text-xs font-semibold text-orange-800" data-level-changed={where}>Not saved yet: {changed.length} fence{changed.length === 1 ? '' : 's'} change price for new quotes. Each shows its new price below.</p>
      )}
    </div>
  )
}

/** A dollar rate typed as people say it ("5", "$5.25"); blank clears it. Anything else (1e3, 0.004) is refused, and says so. */
function MoneyRate({ label, value, placeholder, attr, onSet, marked, muted }: { label: string; value: number | undefined; placeholder?: string; attr: string; onSet: (v: number | undefined) => void; marked?: boolean; muted?: boolean }) {
  const [bad, setBad] = useState(false)
  return (
    <label className="block text-xs text-gray-600">{label}
      <span className="mt-1 flex items-center gap-1"><span className="text-gray-500">$</span>
        <input key={value ?? 'blank'} inputMode="decimal" defaultValue={value === undefined ? '' : String(value)} placeholder={placeholder} data-rate={attr}
          aria-invalid={bad || undefined}
          className={`w-28 border rounded-lg px-2 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 ${muted ? 'text-gray-500' : 'text-gray-900'} ${marked ? 'border-orange-400' : 'border-gray-300'} ${bad ? 'ring-2 ring-red-200 border-red-400' : ''}`}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          onBlur={e => {
            const t = e.target.value.replace(/[$,\s]/g, '')
            if (!t) { setBad(false); onSet(undefined); return }
            const n = /^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(t) ? Number(t) : NaN
            if (!(n >= 0.01 && n <= 10000)) { setBad(true); return }
            setBad(false); onSet(n)
          }} />
      </span>
      {bad && <span className="block mt-0.5 text-[11px] font-semibold text-red-700" role="alert" data-rate-bad={attr}>Type dollars and cents, like 5 or 5.25 (at least $0.01). Not changed.</span>}
    </label>
  )
}

// ── One fence: switch, Target Profit, sub rates, the 100 ft example ──────────

function FenceRow({ s, m, config, views, updateStyle }: { s: FenceStyle; m: MaterialDef | undefined; config: AppConfig; views: Views; updateStyle: (id: string, patch: Partial<FenceStyle>) => void }) {
  const overhead = overheadPctOf(config)
  const unit = subUnitWords(config.pricing)
  const [open, setOpen] = useState(false)
  const [tooHigh, setTooHigh] = useState<'letters' | 'range' | null>(null)
  const status = fenceStatus(s)
  const profit = profitShown(s, m)
  const was = views.savedById.get(s.id)
  const wasProfit = was ? profitShown(was, materialOf(catalogOf(views.saved), m?.key)) : null
  const ex = views.ex(s.id)
  const wasEx = views.wasEx(s.id)
  const wood = s.woodBase
  const raw = config.fenceStyles.find(x => x.id === s.id) ?? s
  const tm = Math.round((1 - s.margin) * 10000) / 100
  const subs = SUB_KEYS.map(k => ({ k, shown: subShown(s, m, config.pricing, k) }))
  // Held back by something else (prices not in, a choice off): its own switch cannot make it quotable, so it is not offered.
  const blocked = !!s.held && raw.quotable !== false && raw.isActive !== false
  /** A Target Profit typed on the fence: its own number, unless it is the one it would have anyway. */
  function setProfit(v: number | undefined) {
    if (v === undefined || (profit.reset && v === profit.reset.value) || (!profit.own && v === profit.value)) { updateStyle(s.id, { ownProfitPct: undefined }); return }
    updateStyle(s.id, { ownProfitPct: v })
  }
  function setSub(k: SubKey, shown: RateShown, v: number | undefined) {
    updateStyle(s.id, { [k]: v === undefined || (shown.reset && v === shown.reset.value) ? undefined : v })
  }
  const exText = exampleText(ex, wasEx)
  return (
    <div className={`rounded-xl border px-3 py-2 ${isQuotable(s) ? 'border-gray-200' : 'border-gray-200 bg-gray-50'}`} data-fence-row={s.name}>
      <div className="flex items-start gap-2">
        <button type="button" className="flex-1 min-w-0 text-left md:cursor-default" onClick={() => setOpen(o => !o)} aria-expanded={open} data-fence-row-toggle={s.name}>
          <span className={`block text-sm font-semibold ${isQuotable(s) ? 'text-gray-900' : 'text-gray-500'}`}>{fenceName(s)}</span>
          {status && <span className="block text-xs text-amber-700" data-fence-row-status={s.name}>{status}{blocked ? ' Its switch turns on by itself once that is fixed.' : ''}</span>}
          {/* A phone: one line of numbers; tap to edit. */}
          <span className="md:hidden block text-xs text-gray-600" data-fence-row-summary={s.name}>
            {pct(profit.value)} profit · {pct(tm)} margin{wood ? '' : ` · sub ${rateText(subs[0].shown.value)}/${unit.short}`}{ex && !('cannot' in ex) ? ` · 100 ft ${dollars(ex.priceCents)}` : ''}
            {profit.own || subs.some(x => x.shown.own) ? ' · own numbers' : ''} <span className="underline text-gray-800">{open ? 'Close' : 'Edit'}</span>
          </span>
        </button>
        {s.needsCostReview && <CostReviewBadge name={s.name} note={s.costReviewNote} />}
        <Switch on={isQuotable(s)} disabled={blocked} onClick={() => updateStyle(s.id, { quotable: raw.quotable === false })}
          label={blocked ? `${fenceName(s)} cannot be quoted: ${s.held}` : `${fenceName(s)} available for quoting`} data-style-quotable={s.name} />
      </div>
      <div className={`${open ? '' : 'hidden'} md:block`} data-fence-row-edit={s.name}>
        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="text-xs text-gray-600">
            <span className="block">Target Profit</span>
            <PercentField key={`${profit.value}|${profit.own}`} value={profit.value} min={0} max={maxProfitPct(overhead)} data-style-profit={s.name} onBad={setTooHigh}
              className={`mt-1 block w-24 border rounded-lg px-2 min-h-[44px] text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 ${profit.own ? 'border-orange-400 text-gray-900' : 'border-gray-300 text-gray-500'}`}
              onChange={setProfit} />
          </div>
          <p className="text-xs text-gray-700 pb-3">+ Overhead {pct(overhead)} = <span className="font-semibold" data-style-target-margin={s.name}>{pct(tm)}</span> Target Margin</p>
          <RateSource shown={profit} name={s.name} attr="profit" fmt={pct} onReset={() => setProfit(undefined)} wasText={wasProfit && wasProfit.value !== profit.value ? `was ${pct(wasProfit.value)}` : null} />
        </div>
        {tooHigh && <p className="text-xs font-semibold text-red-700" role="alert" data-fence-profit-too-high={s.name}>{tooHigh === 'letters' ? 'Type a percent, like 14.' : profitLimitWords(overhead)} Not changed.</p>}
        {wood ? (
          <p className="mt-1 text-xs text-gray-600" data-fence-sub={s.name}>
            Sub labor: {fenceName(wood)}’s labor × {Math.round((s.woodFactor ?? 1.15) * 1000) / 10}% (sub {rateText(subShown(wood, materialOf(catalogOf(config), styleChoicesOf(wood)?.material), config.pricing, 'subRate').value)}/{unit.short} there).
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
            {subs.map(({ k, shown }) => (
              <div key={k} className="space-y-0.5">
                <MoneyRate label={k === 'subRate' ? `Sub, ${unit.long}` : k === 'subWalkGate' ? 'Per walk gate' : 'Per double gate'}
                  value={shown.value > 0 ? shown.value : undefined} placeholder="Not set" attr={`${s.name}:${k}`} marked={shown.own} muted={!shown.own} onSet={v => setSub(k, shown, v)} />
                <RateSource shown={shown} name={s.name} attr={k} fmt={rateText} onReset={() => setSub(k, shown, undefined)} />
              </div>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-gray-700" data-fence-example={s.name}>{exText}</p>
      </div>
    </div>
  )
}

/** Where a fence's number comes from, or "Own number" with Reset. */
function RateSource({ shown, name, attr, fmt, onReset, wasText }: { shown: RateShown; name: string; attr: string; fmt: (v: number) => string; onReset: () => void; wasText?: string | null }) {
  return (
    <span className="block text-[11px] leading-tight pb-1" data-rate-source={`${name}:${attr}`} data-own={shown.own ? 'yes' : 'no'}>
      {shown.own
        ? <>
            <span className="inline-block font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">Own number</span>
            {shown.reset && <button type="button" className="ml-1 underline text-gray-700 min-h-[32px]" onClick={onReset} data-rate-reset={`${name}:${attr}`}>Reset to {fmt(shown.reset.value)} ({shown.reset.from})</button>}
          </>
        : <span className="text-gray-500">{shown.from === 'Saved on this fence' ? shown.from : `From ${shown.from}`}</span>}
      {wasText && <span className="ml-1 font-semibold text-orange-800">({wasText})</span>}
    </span>
  )
}


// ── Labor numbers per fence ──────────────────────────────────────────────────

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

/** A fence's labor numbers as a card, for a phone (the table needs a computer's width). */
function LaborCard({ style, updateStyle }: { style: FenceStyle; updateStyle: (id: string, patch: Partial<FenceStyle>) => void }) {
  const field = 'mt-1 block w-24 border border-gray-300 rounded-lg px-2 min-h-[44px] text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
  const dec = (v: string, min: number) => { const n = parseFloat(v); return !isNaN(n) && n >= min ? Math.round(n * 10) / 10 : null }
  return (
    <div className={`rounded-xl border border-gray-200 px-3 py-2 ${!style.isActive ? 'opacity-60' : ''}`} data-labor-card={style.name}>
      <div className="flex items-start gap-2">
        <span className="flex-1 min-w-0 text-sm font-semibold text-gray-900">{fenceName(style)}</span>
        <Switch on={style.isActive !== false} onClick={() => updateStyle(style.id, { isActive: style.isActive === false })} label={`${fenceName(style)} turned on`} data-style-active={style.name} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2">
        <label className="block text-xs text-gray-600">Category
          <select className={field.replace('w-24', 'w-full')} value={style.category} onChange={e => updateStyle(style.id, { category: e.target.value as FenceStyle['category'] })} data-style-category={style.name}>
            {categoryChoices(style.category).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs text-gray-600">Sections per man hour
          <input type="number" inputMode="decimal" step="0.1" min="0.1" max="20" className={field} value={style.sectionsPerMH} onChange={e => { const v = dec(e.target.value, 0.1); if (v) updateStyle(style.id, { sectionsPerMH: v }) }} />
        </label>
        <label className="block text-xs text-gray-600">Walk gate man hours
          <input type="number" inputMode="decimal" step="0.1" min="0" max="20" className={field} value={style.mhPerWalkGate} onChange={e => { const v = dec(e.target.value, 0); if (v !== null) updateStyle(style.id, { mhPerWalkGate: v }) }} />
        </label>
        <label className="block text-xs text-gray-600">Double gate man hours
          <input type="number" inputMode="decimal" step="0.1" min="0" max="20" className={field} value={style.mhPerDblGate} onChange={e => { const v = dec(e.target.value, 0); if (v !== null) updateStyle(style.id, { mhPerDblGate: v }) }} />
        </label>
        <div className="text-xs text-gray-600">Section width
          <span className="mt-1 block">{style.autoRailMix ? '6 or 8 ft (chosen per run)' : styleHasPartsList(style.name) || style.madeFrom ? `${sectionWidthForStyle(style.name, style.panelWidth)} ft (set by its parts)` : (
            <input type="number" inputMode="numeric" step="1" min="1" className={field} value={style.panelWidth} onChange={e => updateStyle(style.id, { panelWidth: parseInt(e.target.value) || 6 })} />)}</span>
        </div>
        <label className="block text-xs text-gray-600">$ per foot (per foot pricing)
          <input type="number" inputMode="decimal" step="0.25" min="0" placeholder="Not set" className={field} value={style.pricePerFoot ?? ''} onChange={e => { const v = parseFloat(e.target.value); updateStyle(style.id, { pricePerFoot: e.target.value === '' || isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100 }) }} />
        </label>
      </div>
    </div>
  )
}

function LaborTable({ styles, views, updateStyle }: { styles: FenceStyle[]; views: Views; updateStyle: (id: string, patch: Partial<FenceStyle>) => void }) {
  const num = 'w-16 text-right border border-gray-200 rounded px-1 min-h-[36px] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400'
  return (<>
    <div className="md:hidden space-y-2" data-labor-cards>
      {styles.map(shown => { const style = views.byId.get(shown.id) ?? shown; return <LaborCard key={style.id} style={style} updateStyle={updateStyle} /> })}
    </div>
    <div className="hidden md:block border border-gray-200 rounded-xl overflow-x-auto" data-labor-table>
      <table className="w-full text-sm min-w-[760px]">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500">Fence</th>
            <th className="text-left px-2 py-3 text-xs font-semibold text-gray-500 w-28">Category</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20" title="Sections one person installs in an hour">Sections per man hour</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20">Section width</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20">Walk gate man hours</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20">Double gate man hours</th>
            <th className="text-right px-2 py-3 text-xs font-semibold text-gray-500 w-20" title="Customer price per foot, used when a quote is priced per foot">$ / Ft</th>
            <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 w-14">Turned on</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {styles.map(shown => {
            const style = views.byId.get(shown.id) ?? shown
            return (
              <tr key={style.id} className={!style.isActive ? 'opacity-50' : ''}>
                <td className="px-3 py-2.5">
                  <span className="block font-medium text-gray-900">{fenceName(style)}</span>
                  <span className="block text-[11px] text-gray-400" title="Internal name: what saved quotes, kits and tiers use">{style.name}</span>
                </td>
                <td className="px-2 py-2.5">
                  <select className="border border-gray-200 rounded px-1 min-h-[36px] text-xs" value={style.category} onChange={e => updateStyle(style.id, { category: e.target.value as FenceStyle['category'] })}>
                    {categoryChoices(style.category).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
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
                  <input type="number" step="0.25" min="0" placeholder="—" className={num} value={style.pricePerFoot ?? ''} onChange={e => { const v = parseFloat(e.target.value); updateStyle(style.id, { pricePerFoot: e.target.value === '' || isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100 }) }} />
                </td>
                <td className="px-2 py-2.5 text-center">
                  <Switch on={style.isActive !== false} onClick={() => updateStyle(style.id, { isActive: style.isActive === false })} label={`${fenceName(style)} turned on`} data-style-active={style.name} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  </>)
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
          <p className={small}>Plain names come from it, like “{label.trim() || 'Clay'} {m.label === 'Chain link' ? 'Chain Link, 4 ft, Residential' : `${m.label} ${underLabel ?? ''}, 6 ft tall, 8 ft sections, No dig`.replace(/\s+,/, ',')}”.</p>
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
          <p className="text-sm text-gray-700">{label.trim()}’s color parts with the quantities copied from {optionOf(m, dim.key, edit ? existing?.copiedFrom : copyFrom)?.label ?? 'its source'}. Change one only where {label.trim()} is built differently (Tan uses 16 pickets per 8 ft section where White uses 15).</p>
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
  const word = dimHeading(d).toLowerCase()
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
        <label className="block text-sm font-semibold text-gray-900">{dimHeading(d)}
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
