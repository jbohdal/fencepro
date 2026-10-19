/**
 * Inventory > Fill in: everything that needs Jonathan's numbers, on one screen.
 *
 *   - Prices: every active item at $0, and every kit part not in Inventory.
 *   - Gate parts: commercial chain link and Industrial Abigail gates came from
 *     the old parts lists with no gate frame or panel.
 *   - Durafence: no parts list at all.
 *
 * A style that is not available for quoting (Settings → Fence Styles;
 * commercial and industrial are on hold) is left out: its gate parts, its
 * Durafence list, and kit parts only it uses. They come back when it is
 * turned back on.
 *
 * Prices save into Inventory (dated today); parts save into the style's
 * material kit (marked filled in), so quotes price with them at once. The
 * Finish setup card ticks this off when nothing is left.
 */

import { styleLabel } from './fenceCatalog'
import { useEffect, useMemo, useState } from 'react'
import { getInventory, saveInventory, getKitSets, saveKitSets, getInventoryUnitCost, INVENTORY_UPDATED_EVENT, type InventoryItem } from './inventoryStore'
import { kitSetFor, KIT_LABEL, type KitSet, type KitKind, type KitPart } from './materialKits'
import { toast } from './toast'
import { getConfig } from './configStore'
import { isQuotable } from './styleAvailability'

export const GATE_STYLES = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail']
export const DURAFENCE = 'Durafence'
const GATE_KINDS: KitKind[] = ['walkGate', 'dblGate']
const DURA_KINDS: KitKind[] = ['section', 'line', 'corner', 'end', 'walkGate', 'dblGate']

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const uid = () => `kit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const isActive = (i: InventoryItem) => i.status !== 'inactive' && i.status !== 'discontinued'

/** Kit parts that name nothing in Inventory, with the styles that use them. */
export function missingKitParts(sets: KitSet[], has: (name: string) => boolean): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of sets) {
    if (s.archived || !s.styleName) continue
    for (const parts of Object.values(s.kits)) for (const p of parts ?? []) {
      if (has(p.part)) continue
      out.set(p.part, [...new Set([...(out.get(p.part) ?? []), s.styleName])])
    }
  }
  return out
}

/** One kit (e.g. a walk gate): quantities, remove, add from Inventory or as a new part with its price. */
function KitEditor({ kind, parts, onChange, items, onNewItem }: {
  kind: KitKind; parts: KitPart[]; onChange: (p: KitPart[]) => void
  items: InventoryItem[]; onNewItem: (name: string, price: number) => void
}) {
  const [q, setQ] = useState('')
  const [price, setPrice] = useState('')
  const found = q.trim().length >= 2 ? items.filter(i => isActive(i) && i.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
  const exact = found.some(i => i.name.toLowerCase() === q.trim().toLowerCase())
  const add = (name: string) => { onChange([...parts.filter(p => p.part !== name), { part: name, qty: 1, fallbackCost: 0 }]); setQ(''); setPrice('') }
  const cost = parts.reduce((t, p) => t + p.qty * (getInventoryUnitCost(p.part) ?? 0), 0)
  return (
    <div className="border border-gray-200 rounded-xl" data-fill-kit={kind}>
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-t-xl border-b border-gray-200">
        <p className="text-sm font-semibold text-gray-900">{KIT_LABEL[kind]}</p>
        <p className="text-sm font-semibold tabular-nums text-gray-900" data-fill-kit-cost>{money(cost)}</p>
      </div>
      <div className="divide-y divide-gray-100">
        {parts.map(p => (
          <div key={p.part} className="flex items-center gap-2 px-3 py-2 text-sm" data-fill-part={p.part}>
            <input type="number" step="any" min={0} inputMode="decimal" aria-label={`Quantity of ${p.part}`} className="w-16 h-11 text-right border border-gray-300 rounded-lg px-2 font-mono"
              value={p.qty} onChange={e => onChange(parts.map(x => (x.part === p.part ? { ...x, qty: Number(e.target.value) } : x)))} data-fill-qty />
            <span className="flex-1 min-w-0 text-gray-800">{p.part.replace(/^\*+/, '')}</span>
            <span className="tabular-nums text-gray-500 text-xs">{money(getInventoryUnitCost(p.part) ?? 0)}</span>
            <button type="button" className="min-w-[44px] min-h-[44px] text-gray-400 hover:text-red-600 text-lg" aria-label={`Remove ${p.part}`} onClick={() => onChange(parts.filter(x => x.part !== p.part))}>×</button>
          </div>
        ))}
        {!parts.length && <p className="px-3 py-2 text-xs text-gray-500">No parts yet.</p>}
      </div>
      <div className="p-2 border-t border-gray-100 space-y-2">
        <input className="w-full h-11 border border-gray-300 rounded-lg px-3 text-sm" placeholder="Add a part: search Inventory or type a new one" value={q} onChange={e => setQ(e.target.value)} data-fill-search />
        {found.map(i => (
          <button key={i.id} type="button" className="block w-full text-left text-sm px-3 min-h-[44px] rounded-lg hover:bg-orange-50" onClick={() => add(i.name)} data-fill-found>{i.name} · {money(i.unitCost)}</button>
        ))}
        {q.trim().length >= 2 && !exact && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-xs text-gray-600">New part "{q.trim()}" at</span>
            <input type="number" min={0} step="0.01" inputMode="decimal" className="w-24 h-11 border border-gray-300 rounded-lg px-2 text-sm" placeholder="$ each" value={price} onChange={e => setPrice(e.target.value)} data-fill-new-price />
            <button type="button" className="btn btn-secondary btn-sm" disabled={!(Number(price) > 0)}
              onClick={() => { onNewItem(q.trim(), Number(price)); add(q.trim()) }} data-fill-new-add>Add to Inventory and this kit</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function FillInTab() {
  const [tick, setTick] = useState(0)
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener(INVENTORY_UPDATED_EVENT, h); return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, h) }, [])
  const items = useMemo(() => getInventory(), [tick])
  const zero = items.filter(i => isActive(i) && !(i.unitCost > 0))
  // Styles on hold (not available for quoting) are left out until they are turned back on.
  const quotable = useMemo(() => { const st = getConfig().fenceStyles; return (name: string) => { const f = st.find(x => x.name === name); return !f || isQuotable(f) } }, [])
  const gateStyles = GATE_STYLES.filter(quotable)
  const showDura = quotable(DURAFENCE)
  const missing = useMemo(() => missingKitParts(getKitSets().filter(k => !k.styleName || quotable(k.styleName)), n => getInventoryUnitCost(n) !== undefined), [tick, quotable])
  const [prices, setPrices] = useState<Record<string, string>>({})

  // The kits being filled in: the style's kit as quotes use it now.
  const startSet = (style: string): KitSet => {
    const s = kitSetFor(style, getKitSets())
    if (s && s !== 'archived') return clone(s)
    return { id: uid(), name: style, styleName: style, kits: {}, roundUp: [] }
  }
  const [drafts, setDrafts] = useState<Record<string, KitSet>>(() => Object.fromEntries([...GATE_STYLES, DURAFENCE].map(s => [s, startSet(s)])))
  const setParts = (style: string, kind: KitKind, parts: KitPart[]) => setDrafts(d => ({ ...d, [style]: { ...d[style], kits: { ...d[style].kits, [kind]: parts } } }))

  function newItem(name: string, price: number) {
    if (getInventoryUnitCost(name) !== undefined) return
    saveInventory([...getInventory(), { id: `item_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, unitCost: price, category: 'Added in Fill in', status: 'active' }])
  }

  function savePrices() {
    const typed = Object.entries(prices).filter(([, v]) => Number(v) > 0)
    if (!typed.length) { toast.info('Nothing to save', 'Type a price first.'); return }
    const byId = new Map(typed.filter(([k]) => !k.startsWith('new:')).map(([k, v]) => [k, Number(v)]))
    const added: InventoryItem[] = typed.filter(([k]) => k.startsWith('new:')).map(([k, v]) => ({ id: `item_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: k.slice(4), unitCost: Number(v), category: 'Added in Fill in', status: 'active' }))
    saveInventory([...getInventory().map(i => (byId.has(i.id) ? { ...i, unitCost: byId.get(i.id)!, priceImported: false } : i)), ...added])
    setPrices({})
    toast.success('Prices saved', `${typed.length} price${typed.length === 1 ? '' : 's'} saved to Inventory. Quotes use them from now on.`)
  }

  function saveKits(styles: string[]) {
    const now = new Date().toISOString()
    let sets = getKitSets()
    for (const style of styles) {
      const d = drafts[style]
      const own: KitSet = { ...d, id: d.builtIn ? uid() : d.id, builtIn: false, mismatch: undefined, styleName: style, archived: false, updatedAt: now, filledInAt: now }
      // One set in use per style: this one.
      sets = [...sets.filter(s => s.id !== own.id).map(s => (s.styleName === style && !s.archived ? { ...s, archived: true } : s)), own]
    }
    saveKitSets(sets)
    setDrafts(d => ({ ...d, ...Object.fromEntries(styles.map(s => [s, clone(sets.find(x => x.styleName === s && !x.archived)!)])) }))
    toast.success('Kits saved', 'Quotes for these styles price with these parts from now on.')
  }

  const filled = (style: string) => !!getKitSets().find(s => s.styleName === style && !s.archived && s.filledInAt)

  return (
    <div className="space-y-6" data-fill-in>
      <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 space-y-3" data-fill-prices>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-gray-900">Prices</h2>
          <span className="text-sm text-gray-600">{zero.length + missing.size ? `${zero.length + missing.size} to fill in` : 'All set'}</span>
        </div>
        <p className="text-sm text-gray-600">A part at $0 adds nothing to a quote. Type what each one costs you.</p>
        <div className="divide-y divide-gray-100">
          {[...missing].map(([name, styles]) => (
            <label key={`new:${name}`} className="flex flex-wrap items-center gap-2 py-2" data-fill-price-row={name}>
              <span className="flex-1 min-w-[200px] text-sm text-gray-900">{name.replace(/^\*+/, '')}<span className="block text-xs text-amber-700">Not in Inventory. Used by {styles.map(styleLabel).join(', ')}</span></span>
              <input type="number" min={0} step="0.01" inputMode="decimal" className="w-28 h-11 border border-gray-300 rounded-lg px-2 text-sm" placeholder="$ each"
                value={prices[`new:${name}`] ?? ''} onChange={e => setPrices(p => ({ ...p, [`new:${name}`]: e.target.value }))} data-fill-price />
            </label>
          ))}
          {zero.map(i => (
            <label key={i.id} className="flex flex-wrap items-center gap-2 py-2" data-fill-price-row={i.name}>
              <span className="flex-1 min-w-[200px] text-sm text-gray-900">{i.name}<span className="block text-xs text-gray-500">{i.category} · now $0</span></span>
              <input type="number" min={0} step="0.01" inputMode="decimal" className="w-28 h-11 border border-gray-300 rounded-lg px-2 text-sm" placeholder="$ each"
                value={prices[i.id] ?? ''} onChange={e => setPrices(p => ({ ...p, [i.id]: e.target.value }))} data-fill-price />
            </label>
          ))}
          {!zero.length && !missing.size && <p className="py-2 text-sm text-green-700">Every part has a price.</p>}
        </div>
        {(zero.length > 0 || missing.size > 0) && <button type="button" className="btn btn-primary" onClick={savePrices} data-fill-save-prices>Save prices</button>}
      </section>

      {gateStyles.length > 0 && <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 space-y-4" data-fill-gates>
        <h2 className="text-base font-bold text-gray-900">Gate parts</h2>
        <p className="text-sm text-gray-600">These gates came over from the old parts lists without the gate itself (commercial chain link: bolts and a drop rod only; Industrial Abigail: screws only). Add what one gate takes.</p>
        {gateStyles.map(style => (
          <div key={style} className="space-y-2" data-fill-style={style}>
            <p className="text-sm font-semibold text-gray-900">{styleLabel(style)} {filled(style) && <span className="text-green-700 font-normal">· filled in</span>}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {GATE_KINDS.map(kind => <KitEditor key={kind} kind={kind} parts={drafts[style].kits[kind] ?? []} items={items} onNewItem={newItem} onChange={p => setParts(style, kind, p)} />)}
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-primary" onClick={() => saveKits(gateStyles)} data-fill-save-gates>Save gate parts</button>
      </section>}

      {showDura && <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 space-y-4" data-fill-durafence>
        <h2 className="text-base font-bold text-gray-900">Durafence parts list {filled(DURAFENCE) && <span className="text-green-700 font-normal text-sm">· filled in</span>}</h2>
        <p className="text-sm text-gray-600">Durafence has no parts list, so its quotes carry no material. What does one section, each post and each gate take?</p>
        <div className="grid gap-3 md:grid-cols-2">
          {DURA_KINDS.map(kind => <KitEditor key={kind} kind={kind} parts={drafts[DURAFENCE].kits[kind] ?? []} items={items} onNewItem={newItem} onChange={p => setParts(DURAFENCE, kind, p)} />)}
        </div>
        <button type="button" className="btn btn-primary" disabled={!(drafts[DURAFENCE].kits.section ?? []).length} onClick={() => saveKits([DURAFENCE])} data-fill-save-durafence>Save Durafence parts</button>
      </section>}
    </div>
  )
}
