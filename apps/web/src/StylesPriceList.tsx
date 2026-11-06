/**
 * Settings → Price List → Fence styles (Jonathan, Nov 5 2026): every material
 * (vinyl, chain link, aluminum, wood, farm, other), each listing its styles.
 * Tapping a style shows all its parts and prices on one screen, editable
 * there. + Add style (also on Settings → Fence Styles) adds a style the way a
 * vinyl color is added (styleForm.ts): name it, pick the style it copies; its
 * fences and kits are copied with the same quantities; each part of the copied
 * style is its own part (priced here, $0 until then) or the same part; it
 * turns on by itself when every part is priced. Rename and Archive as for a
 * vinyl color (Archive and Bring back: the owner).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getConfig } from './configStore'
import { BUSINESS_STATE_UPDATED_EVENT } from './businessStateStore'
import { getInventory, getKitSets, INVENTORY_UPDATED_EVENT } from './inventoryStore'
import { catalogOf, materialOf, optionOf, type CatalogState, type InvItem } from './fenceCatalog'
import { KIT_LABEL, type KitKind } from './materialKits'
import { proposedParts, styleDimOf, stylePartRows, stylesOfMaterial, ownPartName, type StyleFormPart, type StyleOption } from './styleForm'
import { addStyle, archiveStyle, restoreStyle, saveStyle, saveStylePrices, styleArchiveCheck } from './styleFormStore'
import { roleCan, signedInRole } from './permissions'
import { toast } from './toast'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const small = 'text-xs text-gray-500'
const dollars = (c: number | null | undefined) => (typeof c === 'number' ? `$${(c / 100).toFixed(2)}` : '$0')
/** "$38.92" → 3892 (integer cents); blank or not a price → null. */
const toCents = (t: string): number | null => { const v = Number(String(t).replace(/[$,\s]/g, '')); return t.trim() && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null }
const centsText = (c: number | null | undefined) => (typeof c === 'number' ? (c / 100).toFixed(2) : '')
const MATERIALS = ['vinyl', 'chain', 'alum', 'wood', 'farm', 'other']

function stateNow(): CatalogState {
  const cfg = getConfig()
  return { fenceStyles: cfg.fenceStyles, fenceCatalog: catalogOf(cfg), items: getInventory() as unknown as InvItem[], kits: getKitSets() }
}

function useTick(): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    const on = () => setT(x => x + 1)
    window.addEventListener(BUSINESS_STATE_UPDATED_EVENT, on)
    window.addEventListener(INVENTORY_UPDATED_EVENT, on)
    return () => { window.removeEventListener(BUSINESS_STATE_UPDATED_EVENT, on); window.removeEventListener(INVENTORY_UPDATED_EVENT, on) }
  }, [])
  return t
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center" role="dialog" aria-modal="true" aria-label={title} data-style-sheet>
      <div className="bg-white w-full md:max-w-2xl md:rounded-2xl md:max-h-[92vh] flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <h2 className="flex-1 min-w-0 text-base font-bold text-gray-900 truncate">{title}</h2>
          <button type="button" className="btn btn-quiet min-h-[44px]" onClick={onClose} data-style-sheet-close>Close</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">{children}</div>
        <div className="border-t border-gray-200 px-4 py-3 flex flex-wrap gap-2 justify-end" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{footer}</div>
      </div>
    </div>
  )
}

const kindWords = (kinds: string[]) => kinds.map(k => KIT_LABEL[k as KitKind] ?? k).join(', ')

/** The editor: a new style (material, no key), a style made or copied in Settings (the form), or any style's prices. */
export function StyleSheet({ material: material0, styleKey, onClose, onSaved }: { material?: string; styleKey?: string; onClose: () => void; onSaved?: () => void }) {
  const st = stateNow()
  const may = roleCan(signedInRole(), 'settings.change') && roleCan(signedInRole(), 'prices.change')
  const owner = signedInRole() === 'super_admin'
  const [material, setMaterial] = useState(material0 ?? 'alum')
  const m = materialOf(st.fenceCatalog, material)
  const dim = styleDimOf(m)
  const opt = styleKey ? optionOf(m, dim?.key ?? '', styleKey) as StyleOption | undefined : undefined
  // The form for a new style, one the form made, or one copied before the form (its parts made its own here).
  const formMode = !styleKey || !!opt?.styleForm || !!opt?.copiedFrom
  const sources = (dim?.options ?? []).filter(o => !o.archived && o.key !== styleKey)
  const [label, setLabel] = useState(opt?.label ?? '')
  const [copyFrom, setCopyFrom] = useState(opt?.styleForm?.copiedFrom ?? opt?.copiedFrom ?? sources[0]?.key ?? '')
  const fromLabel = optionOf(m, dim?.key ?? '', copyFrom)?.label ?? 'the copied style'
  const rows = useMemo(() => (styleKey ? stylePartRows(st, material, styleKey) : []), [styleKey, material])  // eslint-disable-line react-hooks/exhaustive-deps
  // The form's parts: as saved; a style copied before the form starts as a new one would.
  const startParts = (): StyleFormPart[] => {
    if (!styleKey) return proposedParts(st, material, copyFrom, label)
    if (opt?.styleForm) return opt.styleForm.parts.map(p => ({ from: p.from, mode: p.mode, ...(p.mode === 'own' ? { name: p.name, cents: rows.find(r => r.part === p.name)?.cents ?? null } : {}) }))
    if (opt?.copiedFrom) return proposedParts(st, material, opt.copiedFrom, opt.label).map(p => ({ ...p, ...(p.mode === 'own' ? { cents: null } : {}) }))
    return []
  }
  const [parts, setParts] = useState<StyleFormPart[]>(startParts)
  const [touched, setTouched] = useState(false)
  const [priceText, setPriceText] = useState<Record<string, string>>(() => Object.fromEntries(parts.filter(p => p.mode === 'own').map(p => [p.from, centsText(p.cents)])))
  // Prices only (a style not made by copying: Emily, Privacy): every part's price.
  const [plain, setPlain] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(r => [r.part, centsText(r.cents)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // A new style: the parts follow the style picked and the name typed, until one is changed by hand.
  useEffect(() => {
    if (styleKey || touched) return
    const p = proposedParts(stateNow(), material, copyFrom, label)
    setParts(p)
    setPriceText(Object.fromEntries(p.filter(x => x.mode === 'own').map(x => [x.from, ''])))
  }, [material, copyFrom, label, styleKey, touched])

  const sharedPrice = (part: string) => stylePartRows(st, material, copyFrom).find(r => r.part === part)?.cents ?? null
  const setPart = (i: number, patch: Partial<StyleFormPart>) => { setTouched(true); setParts(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p))) }

  async function save() {
    setError('')
    if (formMode) {
      const input = {
        material, label: label.trim(), copyFrom,
        parts: parts.map(p => (p.mode === 'own' ? { from: p.from, mode: 'own' as const, name: (p.name ?? '').trim() || ownPartName(p.from, fromLabel, label), cents: toCents(priceText[p.from] ?? '') } : { from: p.from, mode: 'same' as const })),
      }
      if (!input.label) { setError('Type the name of the style.'); return }
      setBusy(true)
      const r = styleKey ? await saveStyle(material, styleKey, input) : await addStyle(input)
      setBusy(false)
      if (!r.ok) { setError(r.error); return }
      toast.success(styleKey ? `${input.label} saved` : `${input.label} added`, r.data.message)
      onSaved?.(); onClose()
      return
    }
    const prices = rows.map(r => ({ part: r.part, cents: toCents(plain[r.part] ?? '') })).filter((p): p is { part: string; cents: number } => p.cents != null && p.cents !== rows.find(r => r.part === p.part)?.cents)
    if (!prices.length) { onClose(); return }
    setBusy(true)
    const r = await saveStylePrices(prices)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    toast.success(`${r.data.priced.length} price${r.data.priced.length === 1 ? '' : 's'} saved`, 'Each is a dated cost; saved quotes keep the prices they were made with.')
    onSaved?.(); onClose()
  }

  async function archive(on: boolean) {
    if (!styleKey || !opt) return
    if (on) {
      const c = await styleArchiveCheck(material, styleKey)
      const used = c.ok ? c.data.usedBy : []
      if (!window.confirm(`Archive ${opt.label}? Its ${c.ok ? c.data.fences : ''} fences are switched off for quoting, with their kits and ${opt.label}'s own parts.${used.length ? ` ${used.map(u => u.what).join(', ')} keep${used.length === 1 ? 's' : ''} its price.` : ''} Bring back turns them on again.`)) return
    }
    setBusy(true)
    const r = on ? await archiveStyle(material, styleKey) : await restoreStyle(material, styleKey)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    toast.success(on ? `${opt.label} archived` : `${opt.label} is back`)
    onSaved?.(); onClose()
  }

  const title = !styleKey ? 'Add style' : `${m?.label ?? ''} ${opt?.label ?? ''}`
  const footer = <>
    {styleKey && owner && opt && !opt.archived && formMode && <button type="button" className="btn btn-quiet min-h-[44px] text-red-700 mr-auto" disabled={busy} onClick={() => void archive(true)} data-style-archive>Archive</button>}
    {styleKey && owner && opt?.archived && <button type="button" className="btn btn-secondary min-h-[44px] mr-auto" disabled={busy} onClick={() => void archive(false)} data-style-restore>Bring back</button>}
    <button type="button" className="btn btn-secondary min-h-[44px]" onClick={onClose} disabled={busy}>Cancel</button>
    {may && !opt?.archived && <button type="button" className="btn btn-primary min-h-[44px]" onClick={() => void save()} disabled={busy} data-style-save>{busy ? 'Saving…' : styleKey ? 'Save' : 'Add style'}</button>}
  </>
  return (
    <Sheet title={title} onClose={onClose} footer={footer}>
      {!styleKey && (
        <label className="block text-xs font-semibold text-gray-600">Material
          <select className={`${inputCls} mt-1`} value={material} onChange={e => { setMaterial(e.target.value); setTouched(false); const mm = materialOf(st.fenceCatalog, e.target.value); setCopyFrom(styleDimOf(mm)?.options.find(o => !o.archived)?.key ?? '') }} data-style-material>
            {MATERIALS.filter(k => styleDimOf(materialOf(st.fenceCatalog, k))).map(k => <option key={k} value={k}>{materialOf(st.fenceCatalog, k)!.label}</option>)}
          </select>
        </label>
      )}
      {formMode && <>
        <label className="block text-xs font-semibold text-gray-600">{styleKey ? 'Name (customers read it; its parts keep their names)' : 'Name of the new style'}
          <input className={`${inputCls} mt-1`} value={label} onChange={e => setLabel(e.target.value)} maxLength={60} placeholder="Picket Top" data-style-label />
        </label>
        {!styleKey
          ? <label className="block text-xs font-semibold text-gray-600">Copies (every fence, height, No dig and Dig set, gates, with the same quantities)
              <select className={`${inputCls} mt-1`} value={copyFrom} onChange={e => { setCopyFrom(e.target.value); setTouched(false) }} data-style-copy-from>
                {sources.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          : <p className={small}>Copied from {fromLabel}, with the same quantities.</p>}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">Parts</p>
          <p className={small}>A part of {label.trim() || 'the new style'}'s own gets a new part named for it, priced here ($0 until then). The same part as {fromLabel} keeps {fromLabel}'s part and price (hinges, latches, screws, concrete). It turns on for quoting by itself when every part has a price.</p>
          {!parts.length && <p className={small}>{fromLabel} has no parts in its material kits.</p>}
          {parts.map((p, i) => {
            const row = stylePartRows(st, material, copyFrom).find(r => r.part === p.from)
            return (
              <div key={p.from} className={`rounded-xl border p-3 space-y-2 ${p.mode === 'own' ? 'border-orange-200 bg-orange-50/40' : 'border-gray-200'}`} data-style-part={p.from}>
                <div>
                  <p className="text-sm text-gray-900">{p.from.replace(/^\*+/, '')}</p>
                  {row && <p className={small}>{kindWords(row.kinds)} · on {row.fences} fence{row.fences === 1 ? '' : 's'}</p>}
                </div>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
                  <button type="button" role="radio" aria-checked={p.mode === 'own'} className={`min-h-[44px] rounded-lg border text-sm px-2 ${p.mode === 'own' ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`} onClick={() => setPart(i, { mode: 'own', name: p.name || ownPartName(p.from, fromLabel, label || 'New style') })} data-style-part-own>Own price</button>
                  <button type="button" role="radio" aria-checked={p.mode === 'same'} className={`min-h-[44px] rounded-lg border text-sm px-2 ${p.mode === 'same' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-300 text-gray-700'}`} onClick={() => setPart(i, { mode: 'same' })} data-style-part-same>Same part as {fromLabel}</button>
                </div>
                {p.mode === 'own' ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                    <label className="text-xs text-gray-600">Its part
                      <input className={`${inputCls} mt-1`} value={p.name ?? ''} onChange={e => setPart(i, { name: e.target.value })} disabled={!!styleKey && !!opt?.styleForm?.parts.find(x => x.from === p.from && x.mode === 'own')} data-style-part-name />
                    </label>
                    <label className="text-xs text-gray-600">Price
                      <input className={`${inputCls} mt-1`} inputMode="decimal" placeholder="0.00" value={priceText[p.from] ?? ''} onChange={e => setPriceText(t => ({ ...t, [p.from]: e.target.value }))} data-style-part-price />
                    </label>
                  </div>
                ) : <p className={small}>{fromLabel}'s part, {dollars(sharedPrice(p.from))}{row?.alsoIn.length ? ` (also on ${row.alsoIn.slice(0, 3).join(', ')}${row.alsoIn.length > 3 ? '…' : ''})` : ''}</p>}
              </div>
            )
          })}
        </div>
      </>}
      {!formMode && <>
        <p className={small}>Every part of {opt?.label}'s fences with its Inventory price. A price saved here is a dated cost; saved quotes keep the prices they were made with. A part shared with other styles changes for them too.</p>
        {!rows.length && <p className={small}>No parts in its material kits.</p>}
        {rows.map(r => (
          <div key={r.part} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 items-end border-b border-gray-100 pb-2" data-style-price-row={r.part}>
            <div className="min-w-0">
              <p className="text-sm text-gray-900 [overflow-wrap:anywhere]">{r.part.replace(/^\*+/, '')}</p>
              <p className={small}>{kindWords(r.kinds)}{r.alsoIn.length ? ` · also on ${r.alsoIn.slice(0, 3).join(', ')}${r.alsoIn.length > 3 ? '…' : ''}` : ''}</p>
            </div>
            <input className={inputCls} inputMode="decimal" placeholder="0.00" value={plain[r.part] ?? ''} onChange={e => setPlain(t => ({ ...t, [r.part]: e.target.value }))} disabled={!may} data-style-price={r.part} aria-label={`${r.part} price`} />
          </div>
        ))}
      </>}
      {error && <p className="text-sm text-red-700" data-style-error>{error}</p>}
    </Sheet>
  )
}

/** The Price List's list: each material and its styles. */
export default function StylesPriceList({ blocked, onServerSaved }: { blocked?: boolean; onServerSaved?: () => void } = {}) {
  useTick()
  const st = stateNow()
  const may = roleCan(signedInRole(), 'settings.change') && roleCan(signedInRole(), 'prices.change')
  const [open, setOpen] = useState<null | { material: string; key?: string }>(null)
  const [showArchived, setShowArchived] = useState(false)
  return (
    <section className="space-y-3 mt-6" data-styles-price-list>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-base font-bold text-gray-900">Fence styles</h3>
        {may && <button type="button" className="btn btn-primary min-h-[44px]" disabled={blocked} onClick={() => setOpen({ material: 'alum' })} data-style-add>+ Add style</button>}
      </div>
      <p className={small}>Tap a style for all its parts and prices on one screen.</p>
      {MATERIALS.map(k => {
        const m = materialOf(st.fenceCatalog, k)
        const list = stylesOfMaterial(st, k).filter(s => showArchived || !s.archived)
        if (!m || !list.length) return null
        return (
          <div key={k} className="rounded-xl border border-gray-200 bg-white" data-style-material-card={k}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
              <p className="flex-1 text-sm font-semibold text-gray-900">{m.label}</p>
              {may && <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" disabled={blocked} onClick={() => setOpen({ material: k })} data-style-add-in={k}>+ Add style</button>}
            </div>
            <ul>
              {list.map(s => {
                const waiting = s.form || s.copied ? stylePartRows(st, k, s.key).filter(r => r.own && r.cents == null).length : 0
                const status = s.archived ? 'Archived' : waiting ? `Waiting for ${waiting} price${waiting === 1 ? '' : 's'}` : s.on ? `${s.on} fence${s.on === 1 ? '' : 's'}` : 'Off'
                return (
                  <li key={s.key}>
                    <button type="button" className={`w-full text-left px-3 py-2 min-h-[48px] flex items-center gap-2 border-b border-gray-50 ${s.archived ? 'opacity-60' : ''}`} disabled={blocked} onClick={() => setOpen({ material: k, key: s.key })} data-style-open={`${k}:${s.key}`}>
                      <span className="flex-1 text-sm text-gray-900">{s.label}</span>
                      <span className={`text-xs ${waiting ? 'text-amber-800' : 'text-gray-500'}`} data-style-status>{status}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      <label className="flex items-center gap-2 text-xs text-gray-600 min-h-[44px]"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived styles</label>
      {blocked && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">Save or discard the other changes on this page first (the bar at the bottom): a style saves at once and reads Settings again.</p>}
      {open && <StyleSheet material={open.material} styleKey={open.key} onClose={() => setOpen(null)} onSaved={() => onServerSaved?.()} />}
    </section>
  )
}
