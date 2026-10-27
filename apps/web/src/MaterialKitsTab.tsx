/**
 * Inventory > Material Kits: the parts each style is built from, kit by kit
 * (section, posts, gates, per foot, per job), with costs from Inventory.
 *
 * Changes are a draft until Save. While there is a draft, the open quotes
 * (Draft and Sent) whose parts would change are listed with their material
 * cost now and after, so nothing moves without being seen. Saved quotes keep
 * the price they were saved with either way.
 */

import { styleLabel } from './fenceCatalog'
import { useEffect, useMemo, useState } from 'react'
import { getConfig, getRailOptimizerConfig, type AppConfig } from './configStore'
import { getInventory, getInventoryUnitCost, getKitSets, saveKitSets, INVENTORY_UPDATED_EVENT } from './inventoryStore'
import { allKitSets, kitSetFor, withKitSets, withoutBellStandIns, KIT_KINDS, KIT_LABEL, isAutoKitStyle, type KitSet, type KitKind, type KitPart } from './materialKits'
import { calculateQuote } from './quoteCalc'
import { layoutGateWidths } from './yardLayout'
import { getQuotes } from './quoteStore'
import { toast } from './toast'
import type { SavedQuote } from './QuotesPage'

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const uid = () => `kit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const unitCost = (p: KitPart) => getInventoryUnitCost(p.part) ?? p.fallbackCost
const kitCost = (parts: KitPart[] = []) => parts.reduce((t, p) => t + p.qty * unitCost(p), 0)

/** "1 per 50 ft" reads better than 0.02 for a part bought by the roll. */
function perFootWords(qty: number): string {
  if (qty > 0 && qty < 1) {
    const every = Math.round(1 / qty)
    if (Math.abs(every * qty - 1) < 1e-6) return `1 per ${every} ft`
  }
  return ''
}

/** Material cost and parts for a saved quote, priced with the given kit sets. */
function priceQuote(q: SavedQuote, cfg: AppConfig, sets: KitSet[]) {
  const style = cfg.fenceStyles.find(s => s.name === q.fenceStyle)
  if (!style || !Array.isArray(q.runs) || !q.runs.some(f => f > 0)) return null
  return withKitSets(sets, () => {
    const r = calculateQuote({
      style, runs: q.runs.map((ft, i) => ({ ft, rail: q.runRails?.[i] ?? 'auto' })),
      corners: q.corners || 0, ends: q.ends || 0, walkGates: q.walkGates || 0, dblGates: q.dblGates || 0,
      gateWidths: layoutGateWidths(q.layout),
      ...(q.layout?.teeLinePosts ? { extraLinePosts: q.layout.teeLinePosts } : {}),
      tearOutSections: q.tearOutSections || 0, tearOutGates: q.tearOutGates || 0,
      extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
      pricing: cfg.pricing, overrides: q.pricing, optimizer: getRailOptimizerConfig(cfg),
    })
    const parts = new Map<string, number>()
    for (const i of r.materials.items) parts.set(i.item, Math.round(((parts.get(i.item) ?? 0) + i.qty) * 100) / 100)
    return { cost: r.materialCost, parts }
  })
}

export interface QuoteChange { quote: SavedQuote; before: number; after: number; parts: string[] }

/** Open quotes (Draft, Sent) whose parts differ between the saved kits and the draft. */
export function openQuotesThatChange(saved: KitSet[], draft: KitSet[], cfg: AppConfig = getConfig(), quotes: SavedQuote[] = getQuotes()): QuoteChange[] {
  const out: QuoteChange[] = []
  const differs = new Map<string, boolean>()
  for (const q of quotes) {
    if (q.status !== 'DRAFT' && q.status !== 'SENT') continue
    if (!differs.has(q.fenceStyle)) differs.set(q.fenceStyle, JSON.stringify(kitSetFor(q.fenceStyle, saved)) !== JSON.stringify(kitSetFor(q.fenceStyle, draft)))
    if (!differs.get(q.fenceStyle)) continue
    const a = priceQuote(q, cfg, saved), b = priceQuote(q, cfg, draft)
    if (!a || !b) continue
    const parts = [...new Set([...a.parts.keys(), ...b.parts.keys()])].filter(p => a.parts.get(p) !== b.parts.get(p))
    if (parts.length) out.push({ quote: q, before: a.cost, after: b.cost, parts })
  }
  return out
}

export default function MaterialKitsTab() {
  const cfg = useMemo(() => getConfig(), [])
  const styleNames = useMemo(() => cfg.fenceStyles.filter(s => s.isActive !== false).map(s => s.name), [cfg])
  const [saved, setSaved] = useState<KitSet[]>(() => getKitSets())
  const [draft, setDraft] = useState<KitSet[]>(() => clone(getKitSets()))
  // The style being looked at, and (when there is more than one) which of its sets or copies.
  // ?style= (the Finish setup card's link for the Bell's real cost) opens on that style.
  const [style, setStyle] = useState<string>(() => {
    const asked = new URLSearchParams(window.location.search).get('style')
    return (asked && styleNames.includes(asked) ? asked : null) ?? styleNames.find(n => kitSetFor(n) && kitSetFor(n) !== 'archived') ?? styleNames[0] ?? ''
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [addTo, setAddTo] = useState<KitKind | null>(null)
  const [search, setSearch] = useState('')
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)

  // Another device saved: take it when nothing here is unsaved.
  useEffect(() => {
    const on = () => { const now = getKitSets(); setSaved(now); setDraft(d => (JSON.stringify(d) === JSON.stringify(saved) ? clone(now) : d)) }
    window.addEventListener(INVENTORY_UPDATED_EVENT, on)
    return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, on)
  }, [saved])

  const shown = useMemo(() => allKitSets(styleNames, draft), [styleNames, draft])
  const byStyle = (name: string) => shown.filter(s => s.styleName === name)
  const copies = shown.filter(s => !s.styleName)
  const current: KitSet | undefined = shown.find(s => s.id === selected) ?? byStyle(style).find(s => !s.archived) ?? byStyle(style)[0]
  const changes = useMemo(() => (dirty ? openQuotesThatChange(saved, draft, cfg) : []), [dirty, saved, draft, cfg])

  /** Edit a set; a built in one is saved as Jonathan's own from its first edit. */
  function edit(id: string, fn: (s: KitSet) => KitSet) {
    const set = shown.find(s => s.id === id)
    if (!set) return
    if (draft.some(s => s.id === id)) { setDraft(d => d.map(s => (s.id === id ? fn(clone(s)) : s))); return }
    // A fixed id per style for the first saved copy of a built in set: two screens
    // editing the built in set at once save one set, not two in use.
    const fixed = set.styleName ? `kit-own:${set.styleName}` : ''
    const own: KitSet = { ...clone(set), id: fixed && !draft.some(s => s.id === fixed) ? fixed : uid(), builtIn: false, mismatch: undefined }
    setSelected(own.id)
    setDraft(d => [...d, fn(own)])
  }
  const setQty = (kind: KitKind, part: string, qty: number) =>
    edit(current!.id, s => ({ ...s, kits: { ...s.kits, [kind]: (s.kits[kind] ?? []).map(p => (p.part === part ? { ...p, qty } : p)) } }))
  const removePart = (kind: KitKind, part: string) =>
    edit(current!.id, s => ({ ...s, kits: { ...s.kits, [kind]: (s.kits[kind] ?? []).filter(p => p.part !== part) } }))
  const addPart = (kind: KitKind, part: string) => {
    edit(current!.id, s => ({ ...s, kits: { ...s.kits, [kind]: [...(s.kits[kind] ?? []).filter(p => p.part !== part), { part, qty: 1, fallbackCost: 0 }] } }))
    setAddTo(null); setSearch('')
  }
  const toggleRoundUp = (part: string) =>
    edit(current!.id, s => ({ ...s, roundUp: s.roundUp.includes(part) ? s.roundUp.filter(p => p !== part) : [...s.roundUp, part] }))
  const rename = (name: string) => edit(current!.id, s => ({ ...s, name }))

  function duplicate() {
    if (!current) return
    const copy: KitSet = { ...clone(current), id: uid(), name: `${current.name} (copy)`, styleName: null, archived: false, builtIn: false, mismatch: undefined }
    setDraft(d => [...d, copy])
    setSelected(copy.id)
  }
  function archive(on: boolean) {
    if (!current) return
    const style = current.styleName
    edit(current.id, s => ({ ...s, archived: on }))
    // Only one set per style is in use: restoring one archives the other.
    if (!on && style) setDraft(d => d.map(s => (s.styleName === style && s.id !== current.id && !s.archived ? { ...s, archived: true } : s)))
  }
  function useFor(style: string) {
    if (!current || !style) return
    const id = current.id
    edit(id, s => ({ ...s, styleName: style, archived: false }))
    setDraft(d => d.map(s => (s.styleName === style && s.id !== id && !s.archived ? { ...s, archived: true } : s)))
    setStyle(style)
  }

  function save() {
    const stamped = draft.map(s => (JSON.stringify(s) === JSON.stringify(saved.find(x => x.id === s.id)) ? s : { ...s, updatedAt: new Date().toISOString() }))
    saveKitSets(stamped)
    setSaved(clone(stamped)); setDraft(clone(stamped))
    toast.success('Material kits saved', changes.length ? `${changes.length} open quote${changes.length === 1 ? '' : 's'} will price with the new kits when reopened. Saved prices do not change.` : 'No open quote changes.')
  }

  const status = (s: KitSet) => (s.builtIn ? 'Built in (from the old parts list)' : !s.styleName ? 'Copy, not in use' : s.archived ? 'Archived' : 'In use')
  const inventory = useMemo(() => getInventory(), [])
  const matches = search.trim() ? inventory.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : []

  return (
    <div className="space-y-5" data-material-kits>
      <div>
        <h2 className="text-lg font-bold text-gray-900">Material Kits</h2>
        <p className="text-sm text-gray-500 mt-0.5">What each style is built from. A job takes each kit times how many it has (sections, posts, gates, feet), added up per part. Costs come from the Catalog.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <select data-kit-style className="border border-gray-300 rounded-lg px-3 py-2 text-sm lg:w-80" value={style}
          onChange={e => { setStyle(e.target.value); setSelected(null); setAddTo(null) }}>
          {styleNames.map(n => <option key={n} value={n}>{styleLabel(n)}{byStyle(n).length ? '' : ' (no parts list)'}</option>)}
        </select>
        {(byStyle(style).length > 1 || copies.length > 0) && (
          <select data-kit-set className="border border-gray-300 rounded-lg px-3 py-2 text-sm lg:w-96" value={current?.id ?? ''} onChange={e => setSelected(e.target.value)}>
            {byStyle(style).map(s => <option key={s.id} value={s.id}>{s.name} · {status(s)}</option>)}
            {copies.map(s => <option key={s.id} value={s.id}>{s.name} · {status(s)}</option>)}
          </select>
        )}
      </div>

      {cfg.fenceStyles.find(s => s.name === style)?.needsCostReview && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3" data-kit-cost-review={style}>
          {cfg.fenceStyles.find(s => s.name === style)?.costReviewNote
            ? `Cost to review: ${cfg.fenceStyles.find(s => s.name === style)!.costReviewNote}. Put the right part and its cost in this fence's kits (a color added with Settings → Price List → Vinyl Colors: edit the color there), then save. Saving this style's kits clears the reminder.`
            : "Cost to review: this fence is priced with 6'x6' vinyl privacy section parts for now. Put its real section part in the Section kit and in each gate's section parts (the part's cost is set in the Catalog), then Save kits. Saving this style's kits clears the reminder."}
        </p>
      )}

      {!current ? (
        <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-6">This style has no parts list, so quotes set its price by hand or per foot.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4" data-kit-set-id={current.id}>
          <div className="flex flex-wrap items-center gap-3">
            <input data-kit-name aria-label="Kit name" className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold min-w-[16rem] flex-1"
              value={current.name} onChange={e => rename(e.target.value)} />
            <span className={`text-xs px-2 py-1 rounded-full ${current.archived ? 'bg-gray-100 text-gray-600' : current.builtIn ? 'bg-blue-50 text-blue-800' : !current.styleName ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`} data-kit-status>{status(current)}</span>
            <button className="btn btn-quiet btn-sm" onClick={duplicate} data-kit-duplicate>Duplicate</button>
            {current.archived
              ? <button className="btn btn-quiet btn-sm" onClick={() => archive(false)} data-kit-restore>Restore</button>
              : current.styleName && <button className="btn btn-quiet btn-sm" onClick={() => archive(true)} data-kit-archive>Archive</button>}
            {!current.styleName && (
              <select data-kit-use-for aria-label="Use for style" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" value="" onChange={e => useFor(e.target.value)}>
                <option value="">Use for style…</option>
                {styleNames.filter(n => !isAutoKitStyle(n) || current.kits.section8).map(n => <option key={n} value={n}>{styleLabel(n)}</option>)}
              </select>
            )}
          </div>
          {current.mismatch && <p className="text-xs text-red-700">The built in kits did not match the old parts list ({current.mismatch}), so quotes for this style still use the old list.</p>}

          <div className="grid gap-3 md:grid-cols-2">
            {KIT_KINDS.filter(k => current.kits[k]?.length || addTo === k || ['section', 'corner', 'end', 'line', 'walkGate', 'dblGate'].includes(k)).map(kind => (
              <div key={kind} className="border border-gray-200 rounded-xl" data-kit={kind}>
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-t-xl border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-900">{KIT_LABEL[kind]}</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-900" data-kit-cost>{money(kitCost(withoutBellStandIns(current, current.kits[kind] ?? [])))}</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {(current.kits[kind] ?? []).map(p => (
                    <div key={p.part} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-kit-part={p.part}>
                      <input type="number" step="any" aria-label={`Quantity of ${p.part}`} className="w-16 text-right border border-gray-200 rounded px-1.5 py-1 font-mono"
                        value={p.qty} onChange={e => setQty(kind, p.part, Number(e.target.value))} data-kit-qty />
                      <span className="flex-1 min-w-0 text-gray-800">
                        {p.part.replace(/^\*+/, '')}
                        {perFootWords(p.qty) && kind === 'perFoot' && <span className="text-gray-500"> · {perFootWords(p.qty)}</span>}
                        {p.qty < 0 && <span className="text-amber-700"> · takes away</span>}
                        {!withoutBellStandIns(current, current.kits[kind] ?? []).includes(p) && <span className="text-amber-700" data-kit-not-counted> · not counted ({p.part === "Misc, 6' Section" ? 'no supplier cost yet: priced as a 6x6 privacy section until one is entered' : 'the 6 ft section is counted instead'})</span>}
                      </span>
                      <span className="tabular-nums text-gray-500 w-16 text-right">{money(unitCost(p))}</span>
                      {(kind === 'perFoot' || !Number.isInteger(p.qty) || current.roundUp.includes(p.part)) && (
                        <button className="text-[11px] text-gray-500 hover:text-gray-800 px-1 whitespace-nowrap" title="Round this part's job total up to a whole one"
                          onClick={() => toggleRoundUp(p.part)} data-kit-round>{current.roundUp.includes(p.part) ? 'Rounded up' : 'Round up'}</button>
                      )}
                      <button className="text-gray-300 hover:text-red-500 px-1 text-base" onClick={() => removePart(kind, p.part)} aria-label={`Remove ${p.part}`}>×</button>
                    </div>
                  ))}
                  {!(current.kits[kind]?.length) && <p className="px-3 py-2 text-xs text-gray-400">Nothing</p>}
                </div>
                {addTo === kind ? (
                  <div className="p-2 border-t border-gray-100">
                    <input autoFocus className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs" placeholder="Search the Catalog…" value={search} onChange={e => setSearch(e.target.value)} data-kit-search />
                    {matches.map(i => (
                      <button key={i.id} onClick={() => addPart(kind, i.name)} className="block w-full text-left text-xs px-2 py-1.5 hover:bg-orange-50 rounded">{i.name} · {money(i.unitCost)}</button>
                    ))}
                    <button className="text-xs text-gray-500 mt-1" onClick={() => { setAddTo(null); setSearch('') }}>Cancel</button>
                  </div>
                ) : (
                  <button className="text-xs text-orange-600 px-3 py-2" onClick={() => setAddTo(kind)} data-kit-add>+ Add part</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {dirty && (
        <div className="sticky bottom-0 bg-white border border-amber-200 rounded-2xl p-4 space-y-3 shadow-sm" data-kit-changes>
          <p className="text-sm font-semibold text-gray-900">
            {changes.length ? `${changes.length} open quote${changes.length === 1 ? '' : 's'} would change` : 'No open quote would change'}
          </p>
          {changes.length > 0 && (
            <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 text-xs">
              {changes.map(c => (
                <div key={c.quote.id} className="flex flex-wrap items-center gap-x-3 py-1.5" data-kit-change={c.quote.id}>
                  <span className="font-medium text-gray-900">{c.quote.customerName || 'No name'}</span>
                  <span className="text-gray-500">{styleLabel(c.quote.fenceStyle)} · {c.quote.status === 'DRAFT' ? 'Draft' : 'Sent'}</span>
                  <span className="tabular-nums text-gray-700">materials {money(c.before)} → {money(c.after)}</span>
                  <span className="text-gray-400 truncate">{c.parts.slice(0, 3).map(p => p.replace(/^\*+/, '')).join('; ')}{c.parts.length > 3 ? ` and ${c.parts.length - 3} more` : ''}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500">Saved quotes keep the price they were saved with. These would price with the new kits the next time they are opened and saved.</p>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={save} data-kit-save>Save kits</button>
            <button className="btn btn-quiet btn-sm" onClick={() => { setDraft(clone(saved)); setSelected(null); setAddTo(null) }} data-kit-discard>Discard changes</button>
          </div>
        </div>
      )}
    </div>
  )
}
