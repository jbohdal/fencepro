/**
 * Offer Options Panel — embedded in QuoteBuilder, lets the salesperson
 * generate Good/Better/Best tiers from a bundle group for the current job inputs.
 */

import { useState, useMemo } from 'react'
import {
  getBundleGroups, getOptionsForQuote, createOption, clearOptionsForQuote,
  updateOption, ensureShareTokenForQuote, deleteOption,
  type QuoteOption,
} from './bundleStore'
import { calculateBundleOption } from './bundleEngine'
import { fireTrigger } from './automationTrigger'
import type { QuotePricingOverrides } from './pricingEngine'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(c / 100)

const fmt2 = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100)

export interface JobInputsForOptions {
  quoteId: string
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  adjLaborHrs: number
  hasSalesman: boolean
  priceAdjust: number
  fenceStyleId?: string  // override fence style per-tier; otherwise each bundle's own style
  /** Labor choices from the quote (hourly vs subcontractor, rates). */
  pricing?: QuotePricingOverrides
}

export default function QuoteOptionsPanel({ inputs }: { inputs: JobInputsForOptions }) {
  const [bump, setBump] = useState(0)
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [showPresentation, setShowPresentation] = useState(false)
  const [sharedLink, setSharedLink] = useState<string | null>(null)

  const groups = useMemo(() => getBundleGroups(), [])
  const existingOptions = useMemo(() => getOptionsForQuote(inputs.quoteId), [inputs.quoteId, bump])

  function reload() { setBump(b => b + 1) }

  function handleGenerate() {
    if (!selectedGroup) return
    const group = groups.find(g => g.name === selectedGroup)
    if (!group) return

    clearOptionsForQuote(inputs.quoteId)

    group.bundles.forEach((bundle, idx) => {
      const opt = calculateBundleOption(bundle, {
        quoteId: inputs.quoteId,
        fenceStyleId: inputs.fenceStyleId || bundle.fenceStyleId,
        runs: inputs.runs, corners: inputs.corners, ends: inputs.ends,
        walkGates: inputs.walkGates, dblGates: inputs.dblGates,
        tearOutSections: inputs.tearOutSections, tearOutGates: inputs.tearOutGates,
        adjLaborHrs: inputs.adjLaborHrs, hasSalesman: inputs.hasSalesman,
        priceAdjust: inputs.priceAdjust, presentationOrder: idx,
        pricing: inputs.pricing,
      })
      createOption(opt)
    })
    reload()
  }

  function handleAdjustPrice(opt: QuoteOption, newPrice: number) {
    const footage = opt.footage
    updateOption(opt.id, {
      quotePriceCents: newPrice,
      netProfitCents: newPrice - opt.materialCostCents - opt.laborCostCents - opt.commissionCents,
      marginPercent: newPrice > 0 ? (newPrice - opt.materialCostCents - opt.laborCostCents - opt.commissionCents) / newPrice : 0,
      pricePerFootCents: footage > 0 ? Math.round(newPrice / footage) : 0,
    })
    reload()
  }

  function toggleRecommended(opt: QuoteOption) {
    // Ensure only one recommended at a time
    const all = getOptionsForQuote(inputs.quoteId)
    for (const o of all) updateOption(o.id, { isRecommended: false })
    if (!opt.isRecommended) updateOption(opt.id, { isRecommended: true })
    reload()
  }

  function handleShare() {
    const token = ensureShareTokenForQuote(inputs.quoteId)
    if (!token) return
    const url = `${window.location.origin}/#/present/${token}`
    setSharedLink(url)
    navigator.clipboard?.writeText(url).catch(() => {})
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Offer Options (Good / Better / Best)</h3>
          <p className="text-xs text-gray-500 mt-0.5">Generate multiple tiers to present side-by-side.</p>
        </div>
        {existingOptions.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => setShowPresentation(true)}
              className="text-sm bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg">Customer View</button>
            <button onClick={handleShare}
              className="text-sm bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg">Share Link</button>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          No bundle groups configured yet. Set up bundles in Admin → Bundles first.
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Select a bundle group...</option>
            {groups.map(g => <option key={g.name} value={g.name}>{g.name} ({g.bundles.length} tier{g.bundles.length === 1 ? '' : 's'})</option>)}
          </select>
          <button onClick={handleGenerate} disabled={!selectedGroup || inputs.runs.length === 0}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-lg">
            Generate Options
          </button>
        </div>
      )}

      {sharedLink && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-blue-900 font-semibold">Share link copied to clipboard</p>
            <p className="text-xs text-blue-700 truncate font-mono">{sharedLink}</p>
          </div>
          <button onClick={() => setSharedLink(null)} className="text-blue-600 hover:bg-blue-100 rounded px-2 py-1 text-xs">Close</button>
        </div>
      )}

      {existingOptions.length > 0 && (
        <div className={`grid gap-3 ${existingOptions.length === 1 ? 'grid-cols-1' : existingOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {existingOptions.map(opt => (
            <OptionEditCard key={opt.id} option={opt}
              onAdjustPrice={(p) => handleAdjustPrice(opt, p)}
              onToggleRecommended={() => toggleRecommended(opt)}
              onDelete={() => { deleteOption(opt.id); reload() }}
            />
          ))}
        </div>
      )}

      {showPresentation && (
        <CustomerPresentationModal quoteId={inputs.quoteId} onClose={() => setShowPresentation(false)} />
      )}
    </div>
  )
}

function OptionEditCard({ option, onAdjustPrice, onToggleRecommended, onDelete }: {
  option: QuoteOption;
  onAdjustPrice: (cents: number) => void;
  onToggleRecommended: () => void;
  onDelete: () => void;
}) {
  const [priceEdit, setPriceEdit] = useState((option.quotePriceCents / 100).toFixed(2))
  const [editing, setEditing] = useState(false)

  const statusLabels: Record<string, string> = {
    accepted: '✓ Accepted', declined: 'Declined', presented: 'Presented', draft: 'Draft',
  }

  return (
    <div className={`border rounded-xl p-4 relative ${option.isRecommended ? 'border-orange-400 ring-2 ring-orange-200' : 'border-gray-200'}`}>
      {option.isRecommended && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[10px] uppercase font-bold px-3 py-0.5 rounded-full">Recommended</div>
      )}
      {option.badgeLabel && !option.isRecommended && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] uppercase font-bold px-3 py-0.5 rounded-full">{option.badgeLabel}</div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">{option.tierLabel}</span>
        {option.status !== 'draft' && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
            option.status === 'accepted' ? 'bg-green-100 text-green-700' :
            option.status === 'declined' ? 'bg-red-100 text-red-700' :
            'bg-blue-100 text-blue-700'
          }`}>{statusLabels[option.status]}</span>
        )}
      </div>

      <div className="mb-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input type="number" step="0.01" value={priceEdit} onChange={e => setPriceEdit(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-lg font-bold" />
            <button onClick={() => { onAdjustPrice(Math.round(parseFloat(priceEdit) * 100)); setEditing(false) }}
              className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded">✓</button>
            <button onClick={() => { setPriceEdit((option.quotePriceCents / 100).toFixed(2)); setEditing(false) }}
              className="text-xs text-gray-500 px-1">×</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-2xl font-bold text-gray-900 hover:text-orange-600 transition-colors text-left">
            {fmt(option.quotePriceCents)}
          </button>
        )}
        <p className="text-xs text-gray-500">{fmt2(option.pricePerFootCents)} per foot · {option.footage.toFixed(0)} ft</p>
      </div>

      <div className="space-y-1 text-xs text-gray-600">
        <div className="flex justify-between"><span>Material</span><span>{fmt(option.materialCostCents)}</span></div>
        <div className="flex justify-between"><span>Labor</span><span>{fmt(option.laborCostCents)}</span></div>
        <div className="flex justify-between"><span>Commission</span><span>{fmt(option.commissionCents)}</span></div>
        <div className="flex justify-between pt-1 border-t border-gray-100 font-semibold text-gray-900">
          <span>Net Profit</span><span>{fmt(option.netProfitCents)} ({(option.marginPercent * 100).toFixed(1)}%)</span>
        </div>
      </div>

      {option.inclusionSnapshot.length > 0 && (
        <ul className="mt-3 space-y-1">
          {option.inclusionSnapshot.slice(0, 5).map(i => (
            <li key={i.id} className="text-xs text-gray-600 flex items-start gap-1"><span className="text-green-500">✓</span><span>{i.label}</span></li>
          ))}
          {option.inclusionSnapshot.length > 5 && <li className="text-xs text-gray-400 italic">+ {option.inclusionSnapshot.length - 5} more</li>}
        </ul>
      )}

      <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
        <button onClick={onToggleRecommended} className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg">
          {option.isRecommended ? '★ Recommended' : 'Mark Recommended'}
        </button>
        <button onClick={onDelete} className="text-xs text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">Remove</button>
      </div>
    </div>
  )
}

// ── Customer Presentation Modal ──

export function CustomerPresentationModal({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const options = useMemo(() => getOptionsForQuote(quoteId), [quoteId])
  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Fence Options</h2>
          <p className="text-xs text-gray-500 mt-0.5">Choose the option that's right for your home.</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-gray-50 to-white px-8 py-10">
        <CustomerPresentationContent options={options} quoteId={quoteId} />
      </div>
    </div>
  )
}

export function CustomerPresentationContent({ options, quoteId, readOnly }: { options: QuoteOption[]; quoteId: string; readOnly?: boolean }) {
  const [bump, setBump] = useState(0)

  function handleAccept(opt: QuoteOption, signedName: string) {
    updateOption(opt.id, {
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      acceptedBy: signedName || 'customer',
    })
    // Also mark any previously-accepted sibling as declined to keep a single selection
    for (const o of getOptionsForQuote(quoteId)) {
      if (o.id !== opt.id && o.status === 'accepted') updateOption(o.id, { status: 'declined' })
    }
    // Fire automation trigger (Sold) — background, non-blocking
    try {
      fireTrigger('sales_stage_change', {
        jobId: quoteId,
        jobName: `Option ${opt.tierLabel}`,
        fromStage: 'SENT',
        toStage: 'SOLD',
        contractValue: opt.quotePriceCents / 100,
        quotePrice: opt.quotePriceCents / 100,
        extraData: { tier: opt.tierLabel, optionId: opt.id, acceptedBy: signedName },
      })
      const evt = new CustomEvent('fencepro:option-accepted', { detail: { quoteId, optionId: opt.id, tier: opt.tierLabel } })
      window.dispatchEvent(evt)
    } catch {}
    setBump(b => b + 1)
  }

  const current = useMemo(() => readOnly ? options : getOptionsForQuote(quoteId), [options, quoteId, bump, readOnly])

  if (current.length === 0) {
    return <div className="text-center py-20 text-gray-400">No options generated yet.</div>
  }

  return (
    <div className={`max-w-6xl mx-auto grid gap-6 grid-cols-1 ${current.length === 2 ? 'lg:grid-cols-2' : current.length >= 3 ? 'md:grid-cols-2 lg:grid-cols-3' : ''}`}>
      {current.map(opt => (
        <CustomerCard key={opt.id} option={opt} onAccept={handleAccept} readOnly={readOnly} />
      ))}
    </div>
  )
}

function CustomerCard({ option, onAccept, readOnly }: { option: QuoteOption; onAccept: (opt: QuoteOption, signedName: string) => void; readOnly?: boolean }) {
  const [accepting, setAccepting] = useState(false)
  const [signedName, setSignedName] = useState('')

  const isRecommended = option.isRecommended
  const isAccepted = option.status === 'accepted'
  const cardBg = isRecommended ? 'bg-gradient-to-b from-orange-50 to-white border-orange-300 shadow-xl ring-2 ring-orange-200' : 'bg-white border-gray-200 shadow-md'

  return (
    <div className={`relative border rounded-3xl p-5 lg:p-8 flex flex-col transition-transform ${isRecommended ? 'lg:-translate-y-2' : ''} ${cardBg}`}>
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs uppercase font-bold tracking-widest px-4 py-1 rounded-full shadow">
          ★ Recommended
        </div>
      )}
      {option.badgeLabel && !isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs uppercase font-bold tracking-widest px-4 py-1 rounded-full shadow">
          {option.badgeLabel}
        </div>
      )}

      <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">{option.tierLabel}</p>

      <div className="mt-4 pb-5 border-b border-gray-100">
        <p className="text-5xl font-black text-gray-900">{fmt(option.quotePriceCents)}</p>
        <p className="text-sm text-gray-500 mt-1">{fmt2(option.pricePerFootCents)} per linear foot</p>
        <p className="text-xs text-gray-400 mt-0.5">{option.footage.toFixed(0)} feet total</p>
      </div>

      <ul className="mt-5 space-y-2.5 flex-1">
        {option.inclusionSnapshot.filter(i => i.isFeatured).map(i => (
          <li key={i.id} className="flex items-start gap-2">
            <span className="text-green-500 mt-0.5">✓</span>
            <span className="text-sm text-gray-700">{i.label}</span>
          </li>
        ))}
      </ul>

      {option.addonSnapshot.filter(a => a.isIncludedByDefault).length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs uppercase font-bold text-gray-400 tracking-wider mb-2">Included Add-Ons</p>
          <ul className="space-y-1.5">
            {option.addonSnapshot.filter(a => a.isIncludedByDefault).map(a => (
              <li key={a.id} className="text-sm text-gray-700 flex justify-between"><span>{a.addonName}</span><span className="text-gray-400">Included</span></li>
            ))}
          </ul>
        </div>
      )}

      {option.addonSnapshot.filter(a => !a.isIncludedByDefault).length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs uppercase font-bold text-gray-400 tracking-wider mb-2">Optional Add-Ons</p>
          <ul className="space-y-1.5">
            {option.addonSnapshot.filter(a => !a.isIncludedByDefault).map(a => (
              <li key={a.id} className="text-sm text-gray-500 flex justify-between"><span>{a.addonName}</span><span>+{fmt(a.addonPriceCents)}</span></li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 pt-4">
        {isAccepted ? (
          <div className="text-center py-3 bg-green-100 text-green-800 rounded-xl font-bold">
            ✓ Selected {option.acceptedBy && `by ${option.acceptedBy}`}
          </div>
        ) : accepting ? (
          <div className="space-y-2">
            <input type="text" value={signedName} onChange={e => setSignedName(e.target.value)}
              placeholder="Type your full name to sign"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setAccepting(false)} className="flex-1 text-sm text-gray-600 border border-gray-200 rounded-lg py-2">Cancel</button>
              <button onClick={() => { onAccept(option, signedName); setAccepting(false) }}
                disabled={!signedName.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-bold py-2 rounded-lg">Confirm</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAccepting(true)} disabled={readOnly}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${isRecommended ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-900 hover:bg-gray-800 text-white'}`}>
            Select This Option
          </button>
        )}
      </div>
    </div>
  )
}
