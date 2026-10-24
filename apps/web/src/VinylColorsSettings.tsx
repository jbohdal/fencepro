/**
 * Settings → Price List → Vinyl Colors: every vinyl color, and Add Color.
 *
 * Add Color is one form with only what differs by color (vinylColorForm.ts):
 * the name, per piece or per section, the section sizes, what a section kit
 * costs and includes, the post, cap and gate upright costs, and ND / DS. The
 * server makes the catalog items, dated costs, fences, material kits and the
 * quote builder choice in one go and says what it made; Undo takes it all
 * away for 24 hours. Edit opens the same form filled in; a changed cost is a
 * new dated cost and never changes a saved quote. Remove archives the color.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getConfig, type AppConfig } from './configStore'
import { BUSINESS_STATE_UPDATED_EVENT } from './businessStateStore'
import { getInventory, getKitSets, INVENTORY_UPDATED_EVENT } from './inventoryStore'
import { catalogOf, colorDimOf, colorStatus, materialOf, stylesOfOption, type CatalogState, type ChoiceOption, type InvItem } from './fenceCatalog'
import {
  formProblems, inputFromColor, POST_TYPES, SET_METHOD_LABEL, SIZE_KEYS, WHITE_SECTION,
  type SetMethod, type SizeKey, type VinylColorInput,
} from './vinylColorForm'
import { TALL_VINYL_SECTION } from './materialCalculator'
import { addVinylColor, loadColorRecords, removeVinylColor, restoreVinylColor, saveVinylColor, undoVinylColor, type ColorRecord } from './vinylColorsStore'
import { navigate, useNav } from './nav'
import { toast } from './toast'
import { roleCan, signedInRole } from './permissions'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const small = 'text-xs text-gray-500'
const dollars = (c: number | null | undefined) => (typeof c === 'number' ? `$${(c / 100).toFixed(2)}` : '')
/** "$38.92" → 3892 (integer cents); blank or not a price → null. */
const toCents = (t: string): number | null => { const v = Number(String(t).replace(/[$,\s]/g, '')); return t.trim() && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null }
const toWhole = (t: string): number | null => { const v = Number(t); return t.trim() !== '' && Number.isInteger(v) && v >= 0 ? v : null }
const POST_LABEL: Record<string, string> = { all: 'Post', corner: 'Corner post', end: 'End post', line: 'Line post', blank: 'Blank post (double gate center)' }

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

function Sheet({ title, onClose, children, footer, data }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; data: string }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center" role="dialog" aria-modal="true" aria-label={title} data-sheet={data}>
      <div className="bg-white w-full md:max-w-2xl md:rounded-2xl md:max-h-[92vh] flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <h2 className="flex-1 min-w-0 text-base font-bold text-gray-900 truncate">{title}</h2>
          <button type="button" className="btn btn-quiet min-h-[44px]" onClick={onClose} data-sheet-close>Close</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">{children}</div>
        <div className="border-t border-gray-200 px-4 py-3 flex flex-wrap gap-2 justify-end" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{footer}</div>
      </div>
    </div>
  )
}

export default function VinylColorsSettings({ blocked, onServerSaved }: {
  /** Settings has unsaved changes on another tab: saving a color would read Settings again over them. */
  blocked?: boolean
  /** The server changed Settings: the page reads them again. */
  onServerSaved: () => void
}) {
  const tick = useTick()
  const nav = useNav()
  const may = roleCan(signedInRole(), 'settings.change') && roleCan(signedInRole(), 'prices.change')
  const [records, setRecords] = useState<ColorRecord[]>([])
  const [form, setForm] = useState<null | { key?: string }>(null)
  const [done, setDone] = useState<null | { record: ColorRecord; message: string; edit: boolean }>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reload = async () => { const r = await loadColorRecords(); if (r.ok) setRecords(r.data.records) }
  useEffect(() => { void reload() }, [tick])
  // Settings → Fence Styles → + Add color (vinyl) and Edit come here.
  const want = nav.params.get('add'), wantColor = nav.params.get('color')
  useEffect(() => { if (want === 'vinyl-color') setForm({}); else if (wantColor) setForm({ key: wantColor }) }, [want, wantColor])

  const cfg: AppConfig = useMemo(() => getConfig(), [tick])  // eslint-disable-line react-hooks/exhaustive-deps
  const m = materialOf(catalogOf(cfg), 'vinyl')
  const dim = colorDimOf(m)
  const colors = dim?.options ?? []
  const recordOf = (key: string) => records.find(r => r.key === key)

  async function act(kind: 'undo' | 'remove' | 'restore', o: ChoiceOption) {
    setErr('')
    if (kind === 'undo' && !window.confirm(`Undo adding ${o.label}? Its fences, material kits, catalog items and costs are taken away.`)) return
    if (kind === 'remove' && !window.confirm(`Remove ${o.label}? It is archived: no longer offered for quoting; quotes already saved keep their prices.`)) return
    setBusy(true)
    const r = kind === 'undo' ? await undoVinylColor(o.key) : kind === 'remove' ? await removeVinylColor(o.key) : await restoreVinylColor(o.key)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onServerSaved()
    setDone(null)
    toast.success(kind === 'undo' ? `${o.label} undone` : kind === 'remove' ? `${o.label} removed (archived)` : `${o.label} is back`, kind === 'undo' ? 'Everything adding it made was taken away.' : '')
    await reload()
  }

  return (
    <div className="space-y-5" data-price-list>
      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3" data-vinyl-colors>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900">Vinyl Colors</h3>
            <p className={small}>A new color is one form: what differs by color. Concrete, donuts, pipe, screws, rivets, hex bolts, gate hardware, H beam, P channel, hinges, latches and handles come from the White vinyl rules.</p>
          </div>
          {may && <button type="button" className="btn btn-primary min-h-[44px]" disabled={busy || blocked} onClick={() => setForm({})} data-vc-add>+ Add Color</button>}
        </div>
        {blocked && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-vc-blocked>Save or discard the other changes on this page first (the bar at the bottom): adding a color reads Settings again.</p>}
        <ul className="divide-y divide-gray-100">
          {colors.map(o => {
            const f = o.color?.form
            const rec = recordOf(o.key)
            const fences = stylesOfOption(cfg.fenceStyles, 'vinyl', dim!.key, o.key)
            const status = f ? colorStatus(cfg.fenceStyles, m!, o) : null
            const canUndo = !!rec && Date.parse(rec.undoUntil) > Date.now()
            return (
              <li key={o.key} className="py-3 flex flex-wrap items-center gap-2" data-vc-color-row={o.key}>
                <span className="flex-1 min-w-[12rem]">
                  <span className={`block text-sm font-semibold ${o.archived ? 'text-gray-400' : 'text-gray-900'}`}>{o.label}{o.archived ? ' (archived)' : ''}</span>
                  <span className="block text-xs text-gray-500">
                    {f ? `${f.mode === 'section' ? 'Per section (kit)' : 'Per piece'} · ${f.sizes.join(', ')} · ${f.methods.map(x => x.toUpperCase()).join(' and ')} · ${fences.filter(s => s.isActive !== false).length} fences`
                      : o.copiedFrom ? `Added with the Add color steps · ${fences.length} fences · edit it in Fence Styles`
                        : `Built in · per piece: each part's cost is in Inventory · ${fences.length} fences`}
                  </span>
                  {status && !o.archived && (status.ready
                    ? <span className="block text-xs text-green-700" data-vc-ready={o.key}>Fully priced: available for quoting</span>
                    : <span className="block text-xs text-amber-700">Not available for quoting: {[...status.unpricedParts, ...status.missingPieces].length} cost{[...status.unpricedParts, ...status.missingPieces].length === 1 ? '' : 's'} missing</span>)}
                </span>
                {may && f && !o.archived && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy || blocked} onClick={() => setForm({ key: o.key })} data-vc-edit={o.key}>Edit</button>}
                {may && f && canUndo && !o.archived && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy || blocked} onClick={() => act('undo', o)} data-vc-undo={o.key}>Undo</button>}
                {may && f && !o.archived && <button type="button" className="btn btn-quiet btn-sm min-h-[44px] text-red-700" disabled={busy || blocked} onClick={() => act('remove', o)} data-vc-remove={o.key}>Remove</button>}
                {may && f && o.archived && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy || blocked} onClick={() => act('restore', o)} data-vc-restore={o.key}>Bring back</button>}
                {!f && o.copiedFrom && <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => navigate('/settings?tab=styles')}>Fence Styles</button>}
              </li>
            )
          })}
        </ul>
        {err && <p className="text-sm text-red-700" role="alert" data-vc-list-error>{err}</p>}
      </section>

      {form && <ColorForm editKey={form.key} onClose={() => { setForm(null); if (want || wantColor) navigate('/settings?tab=price_list') }}
        onSaved={(record, message) => { onServerSaved(); setForm(null); setDone({ record, message, edit: !!form.key }); void reload(); if (want || wantColor) navigate('/settings?tab=price_list') }} />}
      {done && <Created record={done.record} message={done.message} edit={done.edit} busy={busy} onClose={() => setDone(null)}
        onUndo={() => { const o = colors.find(x => x.key === done.record.key); if (o) void act('undo', o) }} />}
    </div>
  )
}

// ── The form ─────────────────────────────────────────────────────────────────

type Money = Record<string, string>
type Counts = Record<string, string>

function ColorForm({ editKey, onClose, onSaved }: { editKey?: string; onClose: () => void; onSaved: (r: ColorRecord, message: string) => void }) {
  const start = useMemo(() => (editKey ? inputFromColor(stateNow(), editKey) : null), [editKey])
  const c = (v: number | null | undefined) => (typeof v === 'number' ? (v / 100).toFixed(2) : '')
  const [name, setName] = useState(start?.name ?? '')
  const [mode, setMode] = useState<'piece' | 'section'>(start?.mode ?? 'section')
  const [sizes, setSizes] = useState<SizeKey[]>(start?.sizes ?? [])
  const [methods, setMethods] = useState<SetMethod[]>(start?.methods ?? ['nd', 'ds'])
  const [same, setSame] = useState(start?.samePostPrice ?? true)
  const [rivetColor, setRivetColor] = useState(start?.rivets?.color ?? '')
  const [money, setMoney] = useState<Money>(() => {
    const out: Money = {}
    if (!start) return out
    for (const [h, p] of Object.entries(start.posts)) { out[`post:${h}:all`] = c(p?.allCents); for (const t of POST_TYPES) out[`post:${h}:${t}`] = c(p?.[`${t}Cents` as const]) }
    out.rivet = c(start.rivets?.cents); out.cap = c(start.capCents); out.upright = c(start.uprightCents); out.gate8 = c(start.gate8Cents)
    for (const [s, v] of Object.entries(start.sections)) out[`section:${s}`] = c(v?.costCents)
    out['piece:picket'] = c(start.pieces?.picketCents); out['piece:rail6'] = c(start.pieces?.rail6Cents); out['piece:rail8'] = c(start.pieces?.rail8Cents); out['piece:uTrim'] = c(start.pieces?.uTrimCents)
    return out
  })
  const [counts, setCounts] = useState<Counts>(() => {
    const out: Counts = {}
    for (const s of SIZE_KEYS) {
      const v = start?.sections[s] ?? WHITE_SECTION[s] ?? null
      for (const k of ['pickets', 'rails', 'railFt', 'picketStiffeners', 'railStiffeners', 'uChannels'] as const) out[`${s}:${k}`] = v && typeof (v as any)[k] === 'number' ? String((v as any)[k]) : ''
    }
    return out
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const heights = [...new Set(sizes.map(s => s.split('x')[0]))].sort()

  const input = (): VinylColorInput => {
    const posts: VinylColorInput['posts'] = {}
    // 8 ft tall: one post price (priced by the piece).
    for (const h of heights) posts[h] = same || h === '8' ? { allCents: toCents(money[`post:${h}:all`] ?? '') } : Object.fromEntries(POST_TYPES.map(t => [`${t}Cents`, toCents(money[`post:${h}:${t}`] ?? '')]))
    const sections: VinylColorInput['sections'] = {}
    for (const s of sizes) {
      const n = (k: string) => toWhole(counts[`${s}:${k}`] ?? '')
      sections[s] = { costCents: toCents(money[`section:${s}`] ?? ''), ...(mode === 'section' && s.startsWith('6') ? { pickets: n('pickets')!, rails: n('rails')!, railFt: n('railFt')!, picketStiffeners: n('picketStiffeners')!, railStiffeners: n('railStiffeners')!, uChannels: n('uChannels')! } : {}) }
    }
    return {
      name: name.trim(), mode, sizes: SIZE_KEYS.filter(s => sizes.includes(s)), methods, samePostPrice: same, posts, sections,
      rivets: rivetColor.trim() ? { color: rivetColor.trim(), cents: toCents(money.rivet ?? '') } : null,
      capCents: toCents(money.cap ?? ''), uprightCents: toCents(money.upright ?? ''), gate8Cents: toCents(money.gate8 ?? ''),
      ...(mode === 'piece' ? { pieces: { picketCents: toCents(money['piece:picket'] ?? ''), rail6Cents: toCents(money['piece:rail6'] ?? ''), rail8Cents: toCents(money['piece:rail8'] ?? ''), uTrimCents: toCents(money['piece:uTrim'] ?? '') } } : {}),
    }
  }

  async function save() {
    setError('')
    const i = input()
    const taken = (colorDimOf(materialOf(catalogOf(getConfig()), 'vinyl'))?.options ?? []).filter(o => !o.archived && o.key !== editKey).map(o => o.label)
    const problems = formProblems(i, { taken: editKey ? [] : taken })
    if (problems.length) { setError(problems.join(' ')); return }
    setSaving(true)
    const r = editKey ? await saveVinylColor(editKey, i) : await addVinylColor(i)
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    onSaved(r.data.record, r.data.message)
  }

  const moneyField = (key: string, label: string, hint?: string) => (
    <label className="block text-xs text-gray-600">{label}
      <span className="mt-1 flex items-center gap-1"><span className="text-gray-500">$</span>
        <input className={inputCls} inputMode="decimal" value={money[key] ?? ''} placeholder="0.00" onChange={e => setMoney(x => ({ ...x, [key]: e.target.value }))} data-vc-money={key} />
      </span>
      {hint && <span className="block mt-0.5 text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
  const countField = (size: string, k: string, label: string) => (
    <label className="block text-xs text-gray-600">{label}
      <input className={inputCls + ' mt-1'} inputMode="numeric" value={counts[`${size}:${k}`] ?? ''} onChange={e => setCounts(x => ({ ...x, [`${size}:${k}`]: e.target.value }))} data-vc-count={`${size}:${k}`} />
    </label>
  )
  const tick = <T extends string,>(list: T[], set: (v: T[]) => void, v: T, on: boolean) => set(on ? [...list, v] : list.filter(x => x !== v))

  return (
    <Sheet data="vinyl-color-form" title={editKey ? `Edit ${start?.name ?? 'color'}` : 'Add Color: vinyl'} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary min-h-[44px]" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary min-h-[44px]" disabled={saving} onClick={save} data-vc-save>{saving ? 'Saving…' : editKey ? 'Save' : `Add ${name.trim() || 'color'}`}</button>
      </>}>
      <div className="space-y-5" data-vc-form>
        <label className="block text-sm font-semibold text-gray-900">Color name
          <input className={inputCls + ' mt-1'} value={name} onChange={e => setName(e.target.value)} placeholder="Chai Gray" disabled={!!editKey} autoFocus={!editKey} data-vc-name />
          {name.trim() && <span className="block mt-1 text-xs font-normal text-gray-500">Fences will read like “{name.trim()} Vinyl Privacy, 6 ft tall, 8 ft panels, No dig”.</span>}
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-gray-900 mb-1">Pricing mode</legend>
          {(['piece', 'section'] as const).map(p => (
            <label key={p} className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${mode === p ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
              <input type="radio" name="vc-mode" className="mt-0.5 w-5 h-5 accent-orange-500" checked={mode === p} onChange={() => setMode(p)} data-vc-mode={p} />
              <span>
                <span className="block text-sm font-semibold text-gray-900">{p === 'piece' ? 'Per piece' : 'Per section'}</span>
                <span className={small}>{p === 'piece' ? 'Pickets, rails and U trim priced separately, like White and Tan today.' : 'The supplier sells the section as a kit. The kit’s parts are listed on the pull sheet at $0; the section cost is carried once.'}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-gray-900 mb-1">Section sizes offered</legend>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SIZE_KEYS.map(s => (
              <label key={s} className={`flex items-center gap-2 rounded-xl border px-3 min-h-[48px] text-sm ${sizes.includes(s) ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={sizes.includes(s)} onChange={e => tick(sizes, setSizes, s, e.target.checked)} data-vc-size={s} />
                {s.replace('x', ' × ')} <span className="text-[11px] text-gray-500">{s.split('x')[0]} ft tall</span>
              </label>
            ))}
          </div>
        </fieldset>

        {sizes.length > 0 && SIZE_KEYS.filter(s => sizes.includes(s)).map(s => {
          const tall8 = s.startsWith('8')
          if (mode === 'piece' && !tall8) return null
          return (
            <div key={s} className="rounded-xl border border-gray-200 p-3 space-y-3" data-vc-size-card={s}>
              <p className="text-sm font-semibold text-gray-900">{s.replace('x', ' × ')} section{tall8 ? ' (8 ft tall: priced by the piece, as every color)' : ''}</p>
              <div className="grid grid-cols-2 gap-3">
                {moneyField(`section:${s}`, tall8 ? 'Section price' : 'Section cost', tall8 ? 'Also in Price List → 8 ft tall vinyl' : undefined)}
              </div>
              {tall8 && (() => { const c = TALL_VINYL_SECTION[s === '8x8' ? 8 : 6]; return (
                <p className="text-[11px] text-gray-500" data-vc-tall-contents={s}>
                  The section price covers {c.rails} rails ({s.split('x')[1]} ft), {c.midRails} mid rail, {c.pickets} pickets (4 ft), {c.uChannels} U channels (4 ft){c.railInserts ? ` and ${c.railInserts} rail inserts (White’s, shared)` : ''}: listed on the pull sheet at $0, the same for every color.
                </p>) })()}
              {mode === 'section' && !tall8 && (<>
                <p className="text-xs font-semibold text-gray-700">What the section includes</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {countField(s, 'pickets', 'Pickets')}
                  {countField(s, 'rails', 'Rails')}
                  {countField(s, 'railFt', 'Rail length (ft)')}
                  {countField(s, 'picketStiffeners', 'Picket stiffeners')}
                  {countField(s, 'railStiffeners', 'Rail stiffeners')}
                  {countField(s, 'uChannels', 'U channels')}
                </div>
                <p className="text-[11px] text-gray-500">Listed on the pull sheet at $0 so the crew loads the right pieces. A gate leaf takes one section kit{sizes.includes('6x6') && s.startsWith('6') ? ' (a 6 × 6)' : ''}.</p>
              </>)}
            </div>
          )
        })}

        {mode === 'piece' && heights.includes('6') && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-3" data-vc-pieces>
            <p className="text-sm font-semibold text-gray-900">Pieces (6 ft tall)</p>
            <div className="grid grid-cols-2 gap-3">
              {moneyField('piece:picket', 'Picket')}
              {moneyField('piece:uTrim', 'U trim')}
              {moneyField('piece:rail6', 'Rail, 6 ft', 'Also every gate leaf')}
              {sizes.includes('6x8') && moneyField('piece:rail8', 'Rail, 8 ft')}
            </div>
          </div>
        )}

        {heights.length > 0 && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-3" data-vc-posts>
            <p className="text-sm font-semibold text-gray-900">Posts</p>
            <label className="flex items-center gap-3 min-h-[44px] text-sm text-gray-800">
              <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={same} onChange={e => setSame(e.target.checked)} data-vc-same-post />
              Same price for all post types (corner, end, line and blank)
            </label>
            {heights.map(h => (
              <div key={h} className="space-y-2">
                {heights.length > 1 && <p className="text-xs font-semibold text-gray-700">{h} ft tall</p>}
                <div className="grid grid-cols-2 gap-3">
                  {h === '8' ? moneyField(`post:${h}:all`, 'Post price', 'Every 8 ft tall post (corner, end, line); covers its cap and setting material')
                    : same ? moneyField(`post:${h}:all`, 'Post', '78" for ND, 102" for DS, as White')
                    : POST_TYPES.filter(t => !(h === '8' && t === 'blank')).map(t => <div key={t}>{moneyField(`post:${h}:${t}`, POST_LABEL[t])}</div>)}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {moneyField('cap', 'Post cap', 'Also the gate caps')}
              {heights.includes('6') && moneyField('upright', 'Gate upright')}
              {heights.includes('8') && moneyField('gate8', 'Walk gate, 8 ft tall', 'Bought whole, as White’s')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-gray-600">Rivets
                <select className={inputCls + ' mt-1'} value={rivetColor ? 'other' : 'white'} onChange={e => setRivetColor(e.target.value === 'white' ? '' : 'Black')} data-vc-rivets>
                  <option value="white">White (shared)</option>
                  <option value="other">Another color</option>
                </select>
              </label>
              {rivetColor !== '' && (
                <label className="block text-xs text-gray-600">Rivet color
                  <input className={inputCls + ' mt-1'} value={rivetColor} onChange={e => setRivetColor(e.target.value)} onBlur={e => { if (!e.target.value.trim()) setRivetColor('Black') }} data-vc-rivet-color />
                </label>
              )}
              {rivetColor !== '' && moneyField('rivet', 'Rivet, each')}
            </div>
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-semibold text-gray-900 mb-1">Set methods offered</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['nd', 'ds'] as const).map(x => (
              <label key={x} className={`flex items-center gap-2 rounded-xl border px-3 min-h-[48px] text-sm ${methods.includes(x) ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={methods.includes(x)} onChange={e => tick(methods, setMethods, x, e.target.checked)} data-vc-method={x} />
                {x.toUpperCase()} <span className="text-[11px] text-gray-500">{SET_METHOD_LABEL[x]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className={small}>Everything else (concrete, donuts, pipe, screws, rivets, hex bolts, gate hardware, H beam, P channel, hinges, latches, handles) comes from the White vinyl rules, and labor and profit from the White fence of the same size and set method.{editKey ? ' A changed cost is saved as a new dated cost; saved quotes keep the prices they were priced with.' : ''}</p>
        {error && <p className="text-sm text-red-700" role="alert" data-vc-error>{error}</p>}
      </div>
    </Sheet>
  )
}

// ── What it made ─────────────────────────────────────────────────────────────

const KIT_WORD: Record<string, string> = { corner: 'corner', end: 'end', line: 'line', blank: 'blank', section: 'section', section8: 'section (8 ft rail)', walkGate: 'walk gate', dblGate: 'double gate', perFoot: 'per foot', perJob: 'per job' }

function Created({ record, message, edit, busy, onClose, onUndo }: { record: ColorRecord; message: string; edit: boolean; busy: boolean; onClose: () => void; onUndo: () => void }) {
  const last = edit ? record.edits?.[record.edits.length - 1] : undefined
  const open = Date.parse(record.undoUntil) > Date.now()
  const until = new Date(record.undoUntil).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <Sheet data="vinyl-color-created" title={edit ? `${record.label} saved` : `${record.label} added`} onClose={onClose}
      footer={<>
        {open && !edit && <button type="button" className="btn btn-secondary min-h-[44px]" disabled={busy} onClick={onUndo} data-vc-created-undo>Undo (until {until})</button>}
        <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => navigate('/quotes?quote=new')} data-vc-open-quote>Open the quote builder</button>
        <button type="button" className="btn btn-primary min-h-[44px]" onClick={onClose} data-vc-created-done>Done</button>
      </>}>
      <div className="space-y-4 text-sm" data-vc-created={record.key}>
        <p className="text-gray-800">{message}</p>
        {edit && last && (
          <div>
            <p className="font-semibold text-gray-900">Costs changed ({last.priced.length})</p>
            <ul className="mt-1 space-y-0.5">{last.priced.map(p => <li key={p.name} className="text-gray-700" data-vc-created-item>{p.name.replace(/^\*+/, '')}: {p.prevCents == null ? 'none' : dollars(p.prevCents)} → {dollars(p.cents)}</li>)}</ul>
            {(last.added.length > 0 || last.archived.length > 0) && <p className={small}>{last.added.length ? `Fences added: ${last.added.join(', ')}. ` : ''}{last.archived.length ? `Fences switched off: ${last.archived.join(', ')}.` : ''}</p>}
          </div>
        )}
        {!edit && (<>
          <div>
            <p className="font-semibold text-gray-900">Catalog items ({record.created.items.length})</p>
            <ul className="mt-1 space-y-0.5">
              {record.created.items.map(i => (
                <li key={i.id} className="flex gap-2 text-gray-700" data-vc-created-item>
                  <span className="flex-1 min-w-0 break-words">{i.name.replace(/^\*+/, '')}</span>
                  <span className="shrink-0 font-mono">{i.cents == null ? '$0 (in the section kit)' : dollars(i.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Dated costs ({record.created.priceHistoryIds.length})</p>
            <p className={small}>One price history row per priced item, effective {record.createdAt.slice(0, 10)}, source color_form.</p>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Fences ({record.created.styles.length})</p>
            <ul className="mt-1 space-y-1">{record.created.styles.map(s => (
              <li key={s.name} data-vc-created-style={s.name}><span className="block text-gray-800">{s.label}</span><span className="block text-[11px] text-gray-400">{s.name} · labor and profit from {s.madeFrom}</span></li>
            ))}</ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Material kits ({record.created.kits.length})</p>
            <ul className="mt-1 space-y-1">{record.created.kits.map(k => (
              <li key={k.id} className="text-gray-700" data-vc-created-kit={k.styleName}><span className="block text-[11px] text-gray-400">{k.styleName}</span>{Object.entries(k.lines).map(([kind, n]) => `${KIT_WORD[kind] ?? kind} ${n}`).join(' · ')} lines</li>
            ))}</ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Quote builder</p>
            <p className="text-gray-700">Vinyl → Color → {record.created.option.label}: offered now.</p>
          </div>
          <p className={small}>Undo takes all of this away until {until}, as long as no quote uses it yet.</p>
        </>)}
      </div>
    </Sheet>
  )
}
