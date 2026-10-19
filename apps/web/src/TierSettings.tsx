/**
 * Settings → Good Better Best (/settings?tab=tiers). One tier set per fence
 * category, up to three tiers each: name, install method, section width,
 * color, an optional specific style, an optional price adjustment, the words
 * for the proposal, a photo and the "Most popular" badge. Each set saves on
 * its own, to the server (/api/tier-sets). A preview prices every tier for a
 * sample yard with the quote builder's own math.
 *
 * New quotes use a change at once; proposals already sent keep their prices.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Copy, Plus, Trash2 } from 'lucide-react'
import { getConfig, getRailOptimizerConfig, type FenceStyle } from './configStore'
import { newId } from './recordSync'
import { toast } from './toast'
import { useTierSets, createTierSet, updateTierSet, deleteTierSet } from './tierSetsApi'
import { listStylePhotos, uploadStylePhoto, deleteStylePhoto, stylePhotoUrl, type StylePhoto } from './stylePhotosApi'
import {
  MAX_TIERS, INSTALL_LABEL, WIDTH_LABEL, COLOR_LABEL, SAMPLE_YARDS, styleParts, resolveTiers, sampleInput, tierPhotoName,
  type TierSet, type TierSpec, type TierInstall, type TierWidth, type TierColor,
} from './tiers'
import { optionLabel } from './proposal'
import { isQuotable } from './styleAvailability'

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const inputCls = 'w-full border border-gray-300 rounded-lg px-3 h-11 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const newKey = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** What the styles in a category let a tier change. */
function choicesFor(styles: FenceStyle[]) {
  const parts = styles.map(s => styleParts(s.name)).filter(Boolean)
  const colors = [...new Set(parts.map(p => p!.color).filter(Boolean))] as TierColor[]
  const installs = [...new Set(parts.map(p => p!.install).filter(Boolean))] as TierInstall[]
  const widths = parts.some(p => typeof p!.width === 'number')
  return {
    colors: ['same', ...colors] as TierColor[],
    installs: ['same', ...installs] as TierInstall[],
    widths: (widths ? ['same', 'cheapest', '6', '8'] : ['same']) as TierWidth[],
  }
}

export default function TierSettings() {
  const cfg = useMemo(() => getConfig(), [])
  const { sets, error } = useTierSets()
  const [selId, setSelId] = useState<string | null>(null)
  // The open set's edits, until saved.
  const [draft, setDraft] = useState<TierSet | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [photos, setPhotos] = useState<StylePhoto[]>([])
  const [busyPhoto, setBusyPhoto] = useState<string | null>(null)
  useEffect(() => { listStylePhotos().then(setPhotos) }, [])

  const ordered = useMemo(() => (sets ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.category.localeCompare(b.category)), [sets])
  const sel = ordered.find(s => s.id === selId) ?? ordered[0] ?? null
  // A different set opened, or the server's copy changed with nothing typed: show it.
  useEffect(() => {
    if (!sel) { setDraft(null); return }
    setDraft(d => (d && d.id === sel.id && JSON.stringify(d) !== JSON.stringify(sel) && d.version === sel.version ? d : structuredClone(sel)))
  }, [sel?.id, sel?.version])  // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && !!sel && draft.id === sel.id && JSON.stringify({ t: draft.tiers, p: draft.popular }) !== JSON.stringify({ t: sel.tiers, p: sel.popular })

  const categories = useMemo(() => [...new Set(cfg.fenceStyles.map(s => s.category).filter(Boolean))], [cfg])
  const freeCats = categories.filter(c => !ordered.some(s => s.category.toLowerCase() === String(c).toLowerCase()))
  const catStyles = useMemo(() => (draft ? cfg.fenceStyles.filter(s => isQuotable(s) && s.category.toLowerCase() === draft.category.toLowerCase()) : []), [cfg, draft?.category])  // eslint-disable-line react-hooks/exhaustive-deps
  const choices = useMemo(() => choicesFor(catStyles), [catStyles])

  // Preview: a sample yard and a sample style from this category.
  const [yardKey, setYardKey] = useState(SAMPLE_YARDS[1].key)
  const [sampleName, setSampleName] = useState('')
  const sampleStyle = catStyles.find(s => s.name === sampleName) ?? catStyles.find(s => styleParts(s.name) && !s.autoRailMix) ?? catStyles[0]
  const preview = useMemo(() => {
    if (!draft || !sampleStyle) return []
    const input = sampleInput(yardKey, sampleStyle, cfg.pricing, getRailOptimizerConfig(cfg))
    return resolveTiers(input, cfg.fenceStyles, draft)
  }, [draft, sampleStyle, yardKey, cfg])

  function choose(id: string) {
    if (dirty && !window.confirm('This set has changes that are not saved. Leave them?')) return
    setSelId(id); setDraft(null)
  }
  const setTier = (i: number, patch: Partial<TierSpec>) => setDraft(d => d && { ...d, tiers: d.tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)) })
  const move = (i: number, by: number) => setDraft(d => {
    if (!d) return d
    const j = i + by
    if (j < 0 || j >= d.tiers.length) return d
    const tiers = d.tiers.slice(); [tiers[i], tiers[j]] = [tiers[j], tiers[i]]
    return { ...d, tiers }
  })
  const addTier = () => setDraft(d => d && d.tiers.length < MAX_TIERS
    ? { ...d, tiers: [...d.tiers, { key: newKey(), name: ['Good', 'Better', 'Best'][d.tiers.length] ?? 'Tier', install: 'same', width: 'same', color: 'same', style: null, priceAdjustPct: null, text: '' }] } : d)
  const duplicate = (i: number) => setDraft(d => d && d.tiers.length < MAX_TIERS
    ? { ...d, tiers: [...d.tiers.slice(0, i + 1), { ...d.tiers[i], key: newKey(), name: `${d.tiers[i].name} copy`.slice(0, 40) }, ...d.tiers.slice(i + 1)] } : d)
  const remove = (i: number) => {
    if (!draft || !window.confirm(`Remove the ${draft.tiers[i].name} tier from ${draft.category}?`)) return
    setDraft(d => d && { ...d, tiers: d.tiers.filter((_, k) => k !== i), popular: d.popular === d.tiers[i].key ? null : d.popular })
  }

  async function save() {
    if (!draft || saving) return
    if (draft.tiers.some(t => !t.name.trim())) { toast.error('Every tier needs a name'); return }
    setSaving(true)
    try {
      const row = await updateTierSet(draft)
      setDraft(structuredClone(row))
      toast.success('Tiers saved', 'New quotes use them now. Proposals already sent keep their prices.')
    } catch (e: any) {
      toast.error('Could not save the tiers', e?.message)
      if (e?.status === 409) setDraft(null)
    } finally { setSaving(false) }
  }

  // The new set's id is chosen when the form opens: tapped twice, one set.
  const [newSetId, setNewSetId] = useState(() => newId())
  async function addSet() {
    const category = newCat || freeCats[0]
    if (!category || adding) return
    setAdding(true)
    try {
      const row = await createTierSet({ id: newSetId, category: String(category), tiers: [], popular: null })
      setNewSetId(newId()); setNewCat('')
      setSelId(row.id); setDraft(structuredClone(row))
    } catch (e: any) {
      toast.error('Could not add the set', e?.message)
    } finally { setAdding(false) }
  }

  async function removeSet() {
    if (!draft || !window.confirm(`Delete the ${draft.category} tier set? Quotes for ${draft.category} will show no Good, Better, Best until a set is added again.`)) return
    try { await deleteTierSet(draft.id); setSelId(null); setDraft(null) } catch (e: any) { toast.error('Could not delete the set', e?.message) }
  }

  async function upload(t: TierSpec, file: File | undefined) {
    if (!file || !draft) return
    const name = tierPhotoName(draft.category, t.key)
    setBusyPhoto(t.key)
    const saved = await uploadStylePhoto(name, file)
    setBusyPhoto(null)
    if (!saved) { toast.error('The photo did not upload. Use a JPG, PNG or WebP under 8 MB.'); return }
    setPhotos(list => [...list.filter(x => x.styleName !== name), saved])
  }

  if (error && !sets) return <p className="text-sm text-red-700" data-tiers-error>Could not load the tiers: {error}</p>
  if (!sets) return <p className="text-sm text-gray-600">Loading the tiers…</p>

  return (
    <div className="space-y-6" data-tier-settings>
      <div>
        <h3 className="text-lg font-bold text-gray-900">Good, Better, Best</h3>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Each fence category has its own set of up to {MAX_TIERS} tiers. On a quote, each tier is the quote's own style changed the way you set here
          (install method, section width, color, or one specific style), priced with the same math as the quote. New quotes use a change at once;
          proposals already sent keep the prices they were sent with. Each set saves on its own.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-tier-sets>
        {ordered.map(s => (
          <button key={s.id} type="button" onClick={() => choose(s.id)} data-tier-set={s.category}
            className={`px-4 h-11 rounded-lg text-sm font-semibold border ${sel?.id === s.id ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}>
            {s.category} <span className="font-normal opacity-80">· {s.tiers.length} tier{s.tiers.length === 1 ? '' : 's'}</span>
          </button>
        ))}
        {freeCats.length > 0 && (
          <span className="flex items-center gap-2 ml-auto">
            <select className={inputCls + ' w-auto'} value={newCat || freeCats[0]} onChange={e => setNewCat(e.target.value)} aria-label="Category for a new set" data-new-set-category>
              {freeCats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" onClick={addSet} disabled={adding} data-add-set><Plus size={16} aria-hidden="true" /> {adding ? 'Adding…' : 'Add a set'}</button>
          </span>
        )}
      </div>

      {!draft ? (
        sel ? null : <p className="text-sm text-gray-600">No tier sets yet. Pick a category and tap Add a set.</p>
      ) : (
        <div className="space-y-6" data-tier-set-open={draft.category}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-bold text-gray-900 mr-auto">{draft.category}</h4>
            {dirty && <span className="text-xs font-semibold text-orange-700">Not saved yet</span>}
            <button type="button" className="btn btn-quiet text-red-700" onClick={removeSet} data-delete-set><Trash2 size={16} aria-hidden="true" /> Delete set</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving} data-save-tiers>{saving ? 'Saving…' : 'Save tiers'}</button>
          </div>

          {draft.tiers.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-300 p-6 text-center" data-tiers-empty>
              <p className="text-sm text-gray-700 mb-3">No tiers for {draft.category} yet. Quotes for {draft.category} show no Good, Better, Best until you add some.</p>
              <button type="button" className="btn btn-primary" onClick={addTier} data-add-tier><Plus size={16} aria-hidden="true" /> Add tiers</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {draft.tiers.map((t, i) => {
                const photo = photos.find(p => p.styleName === tierPhotoName(draft.category, t.key))
                const keep = <T extends string>(list: T[], v: T) => (list.includes(v) ? list : [...list, v])
                return (
                  <div key={t.key} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2" data-tier-setting={t.key}>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-gray-500 mr-auto">Tier {i + 1}</span>
                      <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label="Move left" disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft size={16} aria-hidden="true" /></button>
                      <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label="Move right" disabled={i === draft.tiers.length - 1} onClick={() => move(i, 1)}><ArrowRight size={16} aria-hidden="true" /></button>
                      <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label="Duplicate" disabled={draft.tiers.length >= MAX_TIERS} onClick={() => duplicate(i)} data-duplicate-tier><Copy size={16} aria-hidden="true" /></button>
                      <button type="button" className="btn btn-quiet btn-icon btn-sm text-red-700" aria-label="Remove" onClick={() => remove(i)} data-remove-tier><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                    <label className="block text-xs text-gray-600">Name
                      <input className={inputCls + ' mt-1 font-semibold'} value={t.name} maxLength={40} onChange={e => setTier(i, { name: e.target.value })} data-tier-name />
                    </label>
                    <label className="block text-xs text-gray-600">Install
                      <select className={inputCls + ' mt-1'} value={t.install} disabled={!!t.style} onChange={e => setTier(i, { install: e.target.value as TierInstall })} data-tier-install>
                        {keep(choices.installs, t.install).map(v => <option key={v} value={v}>{INSTALL_LABEL[v]}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs text-gray-600">Section width
                      <select className={inputCls + ' mt-1'} value={t.width} disabled={!!t.style} onChange={e => setTier(i, { width: e.target.value as TierWidth })} data-tier-width>
                        {keep(choices.widths, t.width).map(v => <option key={v} value={v}>{WIDTH_LABEL[v]}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs text-gray-600">Color
                      <select className={inputCls + ' mt-1'} value={t.color} disabled={!!t.style} onChange={e => setTier(i, { color: e.target.value as TierColor })} data-tier-color>
                        {keep(choices.colors, t.color).map(v => <option key={v} value={v}>{COLOR_LABEL[v]}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs text-gray-600">Specific style (optional, wins over the three above)
                      <select className={inputCls + ' mt-1'} value={t.style ?? ''} onChange={e => setTier(i, { style: e.target.value || null })} data-tier-style>
                        <option value="">None: built from the quote's style</option>
                        {catStyles.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        {t.style && !catStyles.some(s => s.name === t.style) && <option value={t.style}>{t.style} (not turned on)</option>}
                      </select>
                    </label>
                    <label className="block text-xs text-gray-600">Price adjustment % (optional)
                      <input type="number" step={1} min={-50} max={100} className={inputCls + ' mt-1'} value={t.priceAdjustPct ?? ''} placeholder="0"
                        onChange={e => { const v = e.target.value.trim(); setTier(i, { priceAdjustPct: v === '' ? null : Math.max(-50, Math.min(100, Number(v) || 0)) }) }} data-tier-adjust />
                    </label>
                    <label className="block text-xs text-gray-600">Why it's better (on the proposal)
                      <textarea rows={2} maxLength={400} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" value={t.text} onChange={e => setTier(i, { text: e.target.value })} data-tier-text />
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-12 rounded-lg bg-gray-100 overflow-hidden grid place-items-center shrink-0">
                        {photo ? <img src={`${stylePhotoUrl(photo.id)}?v=${encodeURIComponent(photo.updatedAt)}`} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-gray-500 text-center leading-tight">Style photo</span>}
                      </div>
                      <label className="btn btn-secondary btn-sm cursor-pointer">
                        {busyPhoto === t.key ? 'Uploading…' : photo ? 'Replace photo' : 'Add photo'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => upload(t, e.target.files?.[0])} />
                      </label>
                      {photo && <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { if (await deleteStylePhoto(photo.id)) setPhotos(l => l.filter(x => x.id !== photo.id)) }}>Remove</button>}
                    </div>
                    <label className="flex items-center gap-2 text-sm min-h-[44px]">
                      <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={draft.popular === t.key}
                        onChange={e => setDraft(d => d && { ...d, popular: e.target.checked ? t.key : null })} data-tier-popular /> Most popular
                    </label>
                  </div>
                )
              })}
              {draft.tiers.length < MAX_TIERS && (
                <button type="button" onClick={addTier} className="rounded-xl border-2 border-dashed border-gray-300 min-h-[120px] text-sm font-semibold text-gray-600 hover:border-orange-400 hover:text-orange-700 flex items-center justify-center gap-2" data-add-tier>
                  <Plus size={18} aria-hidden="true" /> Add a tier
                </button>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3" data-tier-preview>
            <h4 className="text-sm font-bold text-gray-900">Preview {dirty && <span className="font-normal text-orange-700">(with the changes not saved yet)</span>}</h4>
            {catStyles.length === 0 ? <p className="text-sm text-gray-600">No {draft.category} styles are turned on in Settings → Fence Styles.</p> : (<>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs text-gray-600">Sample yard
                  <select className={inputCls + ' mt-1'} value={yardKey} onChange={e => setYardKey(e.target.value)} data-preview-yard>
                    {SAMPLE_YARDS.map(y => <option key={y.key} value={y.key}>{y.label}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-gray-600">The quote's style
                  <select className={inputCls + ' mt-1'} value={sampleStyle?.name ?? ''} onChange={e => setSampleName(e.target.value)} data-preview-style>
                    {catStyles.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </label>
              </div>
              {preview.length === 0 ? <p className="text-sm text-gray-600">Add tiers to see them priced.</p> : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {preview.map(t => (
                    <div key={t.spec.key} className={`rounded-xl border bg-white p-3 ${t.popular ? 'border-orange-500' : 'border-gray-200'}`} data-preview-tier={t.spec.key}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-gray-900" data-preview-name>{t.spec.name}</p>
                        {t.popular && <span className="text-[11px] font-semibold bg-orange-500 text-white rounded-full px-2 py-0.5">Most popular</span>}
                      </div>
                      {t.option && t.style ? (<>
                        <p className="text-2xl font-bold tabular-nums mt-1" data-preview-price>{fmt(t.option.finalPrice)}</p>
                        <p className="text-xs text-gray-600 tabular-nums">{fmt(t.option.perFoot)}/ft · {t.option.sections} sections</p>
                        <p className="text-xs text-gray-800 mt-1">{optionLabel(t.style.name)}</p>
                        {t.sameAs && <p className="text-xs text-amber-800 mt-1">Same fence as {t.sameAs} for this yard.</p>}
                      </>) : <p className="text-sm text-amber-800 mt-1" data-preview-reason>{t.reason}</p>}
                      {t.spec.text && <p className="text-sm text-gray-700 mt-2" data-preview-text>{t.spec.text}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}
