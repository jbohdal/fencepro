/**
 * Bundle Manager — admin page for configuring Good/Better/Best bundles.
 *
 * Bundles are pre-configured packages for a fence style that define what is
 * included at each tier. Bundles with the same groupName form a trio/duo.
 */

import { useState, useMemo } from 'react'
import {
  getBundles, getBundleGroups, createBundle, updateBundle, deleteBundle,
  type QuoteBundle, type BundleTier, type PricingMethod, type BundleInclusion, type BundleAddon,
} from './bundleStore'
import { getConfig, type FenceStyle } from './configStore'

const uid = () => Math.random().toString(36).slice(2, 9)
const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100)

const TIER_COLORS: Record<BundleTier, string> = {
  good: 'bg-blue-100 text-blue-700 border-blue-200',
  better: 'bg-purple-100 text-purple-700 border-purple-200',
  best: 'bg-orange-100 text-orange-700 border-orange-200',
  custom: 'bg-gray-100 text-gray-700 border-gray-200',
}

export default function BundlesPage() {
  const [bump, setBump] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<QuoteBundle | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('active')

  const groups = useMemo(() => getBundleGroups(), [bump])
  const allBundles = useMemo(() => {
    const all = getBundles()
    return filter === 'all' ? all : filter === 'active' ? all.filter(b => b.isActive) : all.filter(b => !b.isActive)
  }, [bump, filter])

  function reload() { setBump(b => b + 1) }

  function handleDelete(b: QuoteBundle) {
    if (!confirm(`Delete bundle "${b.name}"?`)) return
    deleteBundle(b.id)
    reload()
  }

  function handleClone(b: QuoteBundle) {
    const { id, createdAt, updatedAt, ...rest } = b
    createBundle({
      ...rest,
      name: b.name + ' (Copy)',
      inclusions: b.inclusions.map(i => ({ ...i, id: uid() })),
      addons: b.addons.map(a => ({ ...a, id: uid() })),
    })
    reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quote Bundles</h1>
          <p className="text-sm text-gray-500 mt-1">Configure Good/Better/Best tiered packages. Bundles with the same group name form a comparison set.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(['all', 'active', 'inactive'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition capitalize ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{f}</button>
            ))}
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true) }}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ New Bundle</button>
        </div>
      </div>

      {/* Groups view */}
      <div className="space-y-6">
        {groups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-gray-500 font-medium">No bundles configured yet</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Create your first Good/Better/Best trio to start presenting tiered options.</p>
            <button onClick={() => { setEditing(null); setShowForm(true) }}
              className="text-orange-500 hover:underline text-sm font-semibold">Create your first bundle</button>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.name} className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{group.name === '(ungrouped)' ? 'Ungrouped Bundles' : group.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{group.bundles.length} tier{group.bundles.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className={`grid gap-4 ${group.bundles.length === 1 ? 'grid-cols-1' : group.bundles.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {group.bundles.map(b => (
                  <BundleCard key={b.id} bundle={b}
                    onEdit={() => { setEditing(b); setShowForm(true) }}
                    onDelete={() => handleDelete(b)}
                    onClone={() => handleClone(b)}
                    onToggleActive={() => { updateBundle(b.id, { isActive: !b.isActive }); reload() }}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Inactive bundles not in any group */}
      {filter !== 'active' && allBundles.filter(b => !b.isActive).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Inactive Bundles</h3>
          <div className="space-y-2">
            {allBundles.filter(b => !b.isActive).map(b => (
              <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div><p className="text-sm font-medium text-gray-700">{b.name}</p><p className="text-xs text-gray-400">{b.tierLabel || b.tier}</p></div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(b); setShowForm(true) }} className="text-blue-600 hover:underline text-xs">Edit</button>
                  <button onClick={() => { updateBundle(b.id, { isActive: true }); reload() }} className="text-green-600 hover:underline text-xs">Activate</button>
                  <button onClick={() => handleDelete(b)} className="text-red-600 hover:underline text-xs">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && <BundleForm initial={editing} onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload() }} />}
    </div>
  )
}

function BundleCard({ bundle, onEdit, onDelete, onClone, onToggleActive }: {
  bundle: QuoteBundle; onEdit: () => void; onDelete: () => void; onClone: () => void; onToggleActive: () => void;
}) {
  const cfg = getConfig()
  const style = cfg.fenceStyles.find(s => s.id === bundle.fenceStyleId)
  return (
    <div className="border border-gray-200 rounded-xl p-4 flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${TIER_COLORS[bundle.tier]}`}>{bundle.tier}</span>
          {bundle.isRecommended && <span className="ml-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">Recommended</span>}
        </div>
        {!bundle.isActive && <span className="text-[10px] uppercase font-bold text-gray-400">Inactive</span>}
      </div>
      <h4 className="font-bold text-gray-900">{bundle.name}</h4>
      {bundle.highlightBadge && <p className="text-xs text-orange-500 font-semibold mt-0.5">{bundle.highlightBadge}</p>}
      <p className="text-xs text-gray-500 mt-1">{style?.name || '(no style)'}</p>
      <p className="text-xs text-gray-400 mt-2 line-clamp-2">{bundle.description}</p>

      <div className="mt-3 text-xs space-y-1">
        <div className="flex justify-between"><span className="text-gray-500">Pricing:</span><span className="text-gray-700">{bundle.pricingMethod.replace(/_/g, ' ')}</span></div>
        {bundle.marginOverride !== undefined && bundle.marginOverride !== null && (
          <div className="flex justify-between"><span className="text-gray-500">Margin:</span><span className="text-gray-700">{(bundle.marginOverride * 100).toFixed(1)}%</span></div>
        )}
        {bundle.pricePerFootOverride && (
          <div className="flex justify-between"><span className="text-gray-500">$/ft:</span><span className="text-gray-700">{fmt(bundle.pricePerFootOverride)}</span></div>
        )}
        <div className="flex justify-between"><span className="text-gray-500">Inclusions:</span><span className="text-gray-700">{bundle.inclusions.length}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Add-ons:</span><span className="text-gray-700">{bundle.addons.length}</span></div>
      </div>

      <div className="mt-auto pt-3 flex gap-2 flex-wrap">
        <button onClick={onEdit} className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg">Edit</button>
        <button onClick={onClone} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg">Clone</button>
        <button onClick={onToggleActive} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg">
          {bundle.isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button onClick={onDelete} className="text-xs text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">Delete</button>
      </div>
    </div>
  )
}

// ── Bundle form modal ──

function BundleForm({ initial, onCancel, onSaved }: { initial: QuoteBundle | null; onCancel: () => void; onSaved: () => void }) {
  const cfg = getConfig()
  const styles = cfg.fenceStyles.filter(s => s.isActive)

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [tier, setTier] = useState<BundleTier>(initial?.tier ?? 'good')
  const [tierLabel, setTierLabel] = useState(initial?.tierLabel ?? '')
  const [fenceStyleId, setFenceStyleId] = useState(initial?.fenceStyleId ?? (styles[0]?.id ?? ''))
  const [groupName, setGroupName] = useState(initial?.groupName ?? '')
  const [pricingMethod, setPricingMethod] = useState<PricingMethod>(initial?.pricingMethod ?? 'calculated')
  const [marginOverride, setMarginOverride] = useState(
    initial?.marginOverride !== undefined && initial?.marginOverride !== null ? (initial.marginOverride * 100).toFixed(1) : ''
  )
  const [laborRateOverride, setLaborRateOverride] = useState(
    initial?.laborRateOverride !== undefined && initial?.laborRateOverride !== null ? String(initial.laborRateOverride) : ''
  )
  const [pricePerFoot, setPricePerFoot] = useState(
    initial?.pricePerFootOverride ? (initial.pricePerFootOverride / 100).toFixed(2) : ''
  )
  const [materialMarkup, setMaterialMarkup] = useState(
    initial?.materialMarkupPercent !== undefined && initial?.materialMarkupPercent !== null ? (initial.materialMarkupPercent * 100).toFixed(1) : ''
  )
  const [highlightBadge, setHighlightBadge] = useState(initial?.highlightBadge ?? '')
  const [isRecommended, setIsRecommended] = useState(initial?.isRecommended ?? false)
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)

  const [inclusions, setInclusions] = useState<BundleInclusion[]>(initial?.inclusions ?? [
    { id: uid(), label: '', description: '', isFeatured: true, sortOrder: 0 }
  ])
  const [addons, setAddons] = useState<BundleAddon[]>(initial?.addons ?? [])

  function addInclusion() { setInclusions(prev => [...prev, { id: uid(), label: '', description: '', isFeatured: true, sortOrder: prev.length }]) }
  function removeInclusion(id: string) { setInclusions(prev => prev.filter(i => i.id !== id)) }
  function updateInclusion(id: string, updates: Partial<BundleInclusion>) {
    setInclusions(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }

  function addAddon() { setAddons(prev => [...prev, { id: uid(), addonName: '', addonPriceCents: 0, isIncludedByDefault: false, sortOrder: prev.length }]) }
  function removeAddon(id: string) { setAddons(prev => prev.filter(a => a.id !== id)) }
  function updateAddon(id: string, updates: Partial<BundleAddon>) {
    setAddons(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a))
  }

  function handleSave() {
    if (!name.trim()) return
    const data = {
      name: name.trim(), description, tier, tierLabel: tierLabel || (tier.charAt(0).toUpperCase() + tier.slice(1)),
      fenceStyleId, groupName: groupName.trim(),
      pricingMethod,
      marginOverride: marginOverride ? parseFloat(marginOverride) / 100 : undefined,
      laborRateOverride: laborRateOverride ? parseFloat(laborRateOverride) : undefined,
      pricePerFootOverride: pricePerFoot ? Math.round(parseFloat(pricePerFoot) * 100) : undefined,
      materialMarkupPercent: materialMarkup ? parseFloat(materialMarkup) / 100 : undefined,
      isActive, sortOrder: initial?.sortOrder ?? 0,
      highlightBadge, isRecommended,
      inclusions: inclusions.filter(i => i.label.trim()),
      addons: addons.filter(a => a.addonName.trim()),
    }
    if (initial) updateBundle(initial.id, data)
    else createBundle(data)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-gray-900">{initial ? 'Edit' : 'New'} Bundle</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bundle Name *">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Privacy Vinyl Starter"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </Field>
            <Field label="Group Name (ties trio/duo together)">
              <input value={groupName} onChange={e => setGroupName(e.target.value)}
                placeholder="e.g. Privacy Vinyl"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </Field>
          </div>
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tier">
              <select value={tier} onChange={e => setTier(e.target.value as BundleTier)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="good">Good</option>
                <option value="better">Better</option>
                <option value="best">Best</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            {tier === 'custom' && (
              <Field label="Custom Label">
                <input value={tierLabel} onChange={e => setTierLabel(e.target.value)}
                  placeholder="e.g. Premium Plus"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </Field>
            )}
            <Field label="Fence Style">
              <select value={fenceStyleId} onChange={e => setFenceStyleId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Pricing</h4>
            <Field label="Pricing Method">
              <select value={pricingMethod} onChange={e => setPricingMethod(e.target.value as PricingMethod)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="calculated">Calculated — use estimating engine with margin override</option>
                <option value="price_per_foot">Price Per Foot — flat $/ft times footage</option>
                <option value="markup_percent">Markup Percent — material markup then calculated</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {(pricingMethod === 'calculated' || pricingMethod === 'markup_percent') && (
                <Field label="Margin Override (%)">
                  <input type="number" step="0.1" value={marginOverride} onChange={e => setMarginOverride(e.target.value)}
                    placeholder="e.g. 64 (default for vinyl)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </Field>
              )}
              {pricingMethod === 'price_per_foot' && (
                <Field label="Price Per Foot ($)">
                  <input type="number" step="0.01" value={pricePerFoot} onChange={e => setPricePerFoot(e.target.value)}
                    placeholder="e.g. 55.00"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </Field>
              )}
              {pricingMethod === 'markup_percent' && (
                <Field label="Material Markup (%)">
                  <input type="number" step="0.1" value={materialMarkup} onChange={e => setMaterialMarkup(e.target.value)}
                    placeholder="e.g. 15"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </Field>
              )}
              <Field label="Labor Rate Override ($/hr)">
                <input type="number" step="0.01" value={laborRateOverride} onChange={e => setLaborRateOverride(e.target.value)}
                  placeholder={`default ${cfg.pricing.manHourRate}`}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </Field>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700">What's Included (customer-facing bullets)</h4>
              <button onClick={addInclusion} className="text-xs text-orange-600 hover:underline">+ Add</button>
            </div>
            <div className="space-y-2">
              {inclusions.map(i => (
                <div key={i.id} className="flex items-center gap-2">
                  <input value={i.label} onChange={e => updateInclusion(i.id, { label: e.target.value })}
                    placeholder="e.g. 6ft White Vinyl Privacy Fence"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input type="checkbox" checked={i.isFeatured} onChange={e => updateInclusion(i.id, { isFeatured: e.target.checked })} />
                    <span>Featured</span>
                  </label>
                  <button onClick={() => removeInclusion(i.id)} className="text-red-500 hover:bg-red-50 rounded px-2 py-1">×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700">Optional Add-Ons</h4>
              <button onClick={addAddon} className="text-xs text-orange-600 hover:underline">+ Add</button>
            </div>
            <div className="space-y-2">
              {addons.map(a => (
                <div key={a.id} className="flex items-center gap-2">
                  <input value={a.addonName} onChange={e => updateAddon(a.id, { addonName: e.target.value })}
                    placeholder="e.g. Additional Walk Gate"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400">$</span>
                    <input type="number" step="0.01" value={(a.addonPriceCents / 100).toFixed(2)}
                      onChange={e => updateAddon(a.id, { addonPriceCents: Math.round(parseFloat(e.target.value) * 100) || 0 })}
                      className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right" />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input type="checkbox" checked={a.isIncludedByDefault} onChange={e => updateAddon(a.id, { isIncludedByDefault: e.target.checked })} />
                    <span>Default</span>
                  </label>
                  <button onClick={() => removeAddon(a.id)} className="text-red-500 hover:bg-red-50 rounded px-2 py-1">×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-3">
            <Field label="Highlight Badge (optional)">
              <input value={highlightBadge} onChange={e => setHighlightBadge(e.target.value)}
                placeholder="e.g. Most Popular"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </Field>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isRecommended} onChange={e => setIsRecommended(e.target.checked)} />
                <span>Mark as Recommended</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                <span>Active</span>
              </label>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">Save Bundle</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">{label}</label>{children}</div>
}
