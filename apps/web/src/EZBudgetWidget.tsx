/**
 * EZ Budget Widget — Embeddable Customer-Facing Quote Builder
 *
 * This component is designed to be embedded on client websites via iframe.
 * It fetches services and settings from the CRM API, lets customers
 * configure their fence, and submits quotes back to the CRM.
 *
 * API Base: configured via props or window.__EZ_BUDGET_API__
 */

import { useState, useEffect, useCallback, useMemo } from 'react'

// ── Types ──

interface Service {
  id: string
  name: string
  description: string | null
  category: string | null
  unitLabel: string
  basePriceCents: number
  imageUrl: string | null
  active: boolean
  metadata: Record<string, any> | null
}

interface QuoteRange {
  lowPercent: number
  highPercent: number
  label: string
}

interface WidgetConfig {
  companyName: string
  primaryColor: string
  taxRate: number
  quoteExpiryDays: number
}

interface LineItem {
  serviceId: string
  label: string
  quantity: number
  unitPriceCents: number
  totalCents: number
}

type Step = 'material' | 'configure' | 'contact' | 'submitted'

// ── Helpers ──

function cents(n: number) {
  return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── Component ──

interface EZBudgetWidgetProps {
  apiBase?: string
}

export default function EZBudgetWidget({ apiBase }: EZBudgetWidgetProps) {
  const api = apiBase || (window as any).__EZ_BUDGET_API__ || 'http://localhost:4000/api/ez-budget'

  const [services, setServices] = useState<Service[]>([])
  const [config, setConfig] = useState<WidgetConfig>({ companyName: 'EZ Budget', primaryColor: '#16a34a', taxRate: 0, quoteExpiryDays: 30 })
  const [quoteRange, setQuoteRange] = useState<QuoteRange>({ lowPercent: -5, highPercent: 15, label: 'Estimated Budget Range' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Step state
  const [step, setStep] = useState<Step>('material')

  // Selections
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [height, setHeight] = useState('6ft')
  const [extras, setExtras] = useState<{ walkGates: number; doubleGates: number }>({ walkGates: 0, doubleGates: 0 })

  // Contact
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [requestOnSite, setRequestOnSite] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Load config
  useEffect(() => {
    fetch(`${api}/widget/config`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setServices(d.data.services || [])
          const s = d.data.settings || {}
          if (s.widgetConfig) setConfig(s.widgetConfig)
          if (s.quoteRange) setQuoteRange(s.quoteRange)
        }
      })
      .catch(() => setError('Unable to load. Please try again later.'))
      .finally(() => setLoading(false))
  }, [api])

  const categories = useMemo(() => [...new Set(services.map(s => s.category || 'Other'))], [services])
  const filteredServices = useMemo(() =>
    selectedCategory ? services.filter(s => (s.category || 'Other') === selectedCategory) : services
  , [services, selectedCategory])

  // Build line items from selections
  const lineItems = useMemo<LineItem[]>(() => {
    if (!selectedService) return []
    const items: LineItem[] = []
    const meta = selectedService.metadata || {}
    const heightPrices = meta.heightPrices as Record<string, number> | undefined

    // Main fence
    const unitPrice = heightPrices?.[height] || selectedService.basePriceCents
    items.push({
      serviceId: selectedService.id,
      label: `${selectedService.name} — ${height}`,
      quantity,
      unitPriceCents: unitPrice,
      totalCents: unitPrice * quantity,
    })

    // Walk gates
    const walkGatePrice = (meta.walkGateCents as number) || 25000
    if (extras.walkGates > 0) {
      items.push({
        serviceId: selectedService.id,
        label: 'Walk-Through Gate',
        quantity: extras.walkGates,
        unitPriceCents: walkGatePrice,
        totalCents: walkGatePrice * extras.walkGates,
      })
    }

    // Double gates
    const doubleGatePrice = (meta.doubleGateCents as number) || 80000
    if (extras.doubleGates > 0) {
      items.push({
        serviceId: selectedService.id,
        label: 'Double Drive Gate',
        quantity: extras.doubleGates,
        unitPriceCents: doubleGatePrice,
        totalCents: doubleGatePrice * extras.doubleGates,
      })
    }

    return items
  }, [selectedService, quantity, height, extras])

  const subtotal = lineItems.reduce((s, li) => s + li.totalCents, 0)
  const lowPrice = Math.round(subtotal * (1 + quoteRange.lowPercent / 100))
  const highPrice = Math.round(subtotal * (1 + quoteRange.highPercent / 100))

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await fetch(`${api}/widget/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name,
          customerEmail: email || undefined,
          customerPhone: phone || undefined,
          customerAddress: address || undefined,
          material: selectedCategory,
          style: selectedService?.name,
          height,
          linearFeet: quantity,
          requestOnSite,
          lineItems,
        }),
      })
      setStep('submitted')
    } catch {
      alert('Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [api, name, email, phone, address, selectedCategory, selectedService, height, quantity, requestOnSite, lineItems])

  // CSS var for primary color
  const primary = config.primaryColor

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">Loading quote tool...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-gray-500 mb-2">{error}</p>
          <button onClick={() => window.location.reload()} className="text-sm underline" style={{ color: primary }}>Retry</button>
        </div>
      </div>
    )
  }

  // ── SUBMITTED ──
  if (step === 'submitted') {
    return (
      <div className="max-w-lg mx-auto py-16 text-center px-4">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: primary + '20' }}>
          <svg className="w-8 h-8" style={{ color: primary }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Quote Submitted!</h2>
        <p className="text-gray-500 mb-6">
          Thank you, {name}! We'll reach out shortly{requestOnSite ? ' to schedule your free on-site estimate' : ''}.
        </p>
        <div className="mb-6">
          <p className="text-xs text-gray-400 mb-1">{quoteRange.label}</p>
          <p className="text-3xl font-bold" style={{ color: primary }}>
            {cents(lowPrice)} — {cents(highPrice)}
          </p>
        </div>
        <button onClick={() => { setStep('material'); setSelectedService(null); setQuantity(1); setExtras({ walkGates: 0, doubleGates: 0 }) }}
          className="font-semibold rounded-xl px-6 py-3 text-white transition hover:opacity-90" style={{ backgroundColor: primary }}>
          Get Another Quote
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{config.companyName}</h1>
        <p className="text-gray-500">Get your instant fence estimate</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {(['material', 'configure', 'contact'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step === s ? 'text-white' : i < ['material', 'configure', 'contact'].indexOf(step) ? 'text-white opacity-60' : 'bg-gray-200 text-gray-500'
            }`} style={step === s || i < ['material', 'configure', 'contact'].indexOf(step) ? { backgroundColor: primary } : undefined}>
              {i + 1}
            </div>
            {i < 2 && <div className="w-12 h-0.5 bg-gray-200" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: form */}
        <div className="lg:col-span-2">
          {/* STEP 1: Material */}
          {step === 'material' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Choose Your Fence Material</h2>

              {/* Category pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button onClick={() => setSelectedCategory('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${!selectedCategory ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
                  style={!selectedCategory ? { backgroundColor: primary } : undefined}>All</button>
                {categories.map(c => (
                  <button key={c} onClick={() => setSelectedCategory(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${selectedCategory === c ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
                    style={selectedCategory === c ? { backgroundColor: primary } : undefined}>{c}</button>
                ))}
              </div>

              {/* Service cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredServices.map(s => (
                  <button key={s.id} onClick={() => { setSelectedService(s); setSelectedCategory(s.category || ''); setStep('configure') }}
                    className={`relative text-left rounded-xl border-2 overflow-hidden transition hover:shadow-md ${
                      selectedService?.id === s.id ? 'shadow-md' : 'border-gray-200'
                    }`}
                    style={selectedService?.id === s.id ? { borderColor: primary } : undefined}>
                    {s.imageUrl && (
                      <div className="aspect-[4/3] bg-gray-100"><img src={s.imageUrl} alt={s.name} className="w-full h-full object-cover" /></div>
                    )}
                    <div className="p-3">
                      <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.category} • {cents(s.basePriceCents)} {s.unitLabel}</p>
                      {s.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{s.description}</p>}
                    </div>
                    {selectedService?.id === s.id && (
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: primary }}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Configure */}
          {step === 'configure' && selectedService && (
            <div className="space-y-6">
              <button onClick={() => setStep('material')} className="text-sm text-gray-500 hover:text-gray-700">← Back to materials</button>

              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
                <h2 className="text-lg font-semibold text-gray-900">Configure: {selectedService.name}</h2>

                {/* Height */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Height</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['4ft', '5ft', '6ft', '8ft'].map(h => (
                      <button key={h} onClick={() => setHeight(h)}
                        className={`py-3 rounded-xl border-2 text-sm font-semibold transition ${height === h ? 'text-white' : 'border-gray-200 hover:border-gray-300'}`}
                        style={height === h ? { backgroundColor: primary, borderColor: primary } : undefined}>{h}</button>
                    ))}
                  </div>
                </div>

                {/* Quantity (sections or linear feet) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Quantity ({selectedService.unitLabel})</label>
                  <input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 outline-none" style={{ '--tw-ring-color': primary } as any} />
                </div>

                {/* Gates */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Gates (optional)</label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-sm text-gray-600 mb-2">Walk-Through</p>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setExtras(e => ({ ...e, walkGates: Math.max(0, e.walkGates - 1) }))}
                          className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-lg">-</button>
                        <span className="text-xl font-bold w-6 text-center">{extras.walkGates}</span>
                        <button onClick={() => setExtras(e => ({ ...e, walkGates: e.walkGates + 1 }))}
                          className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-lg">+</button>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-sm text-gray-600 mb-2">Double Drive</p>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setExtras(e => ({ ...e, doubleGates: Math.max(0, e.doubleGates - 1) }))}
                          className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-lg">-</button>
                        <span className="text-xl font-bold w-6 text-center">{extras.doubleGates}</span>
                        <button onClick={() => setExtras(e => ({ ...e, doubleGates: e.doubleGates + 1 }))}
                          className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-lg">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                <button onClick={() => setStep('contact')}
                  className="w-full text-white font-semibold rounded-xl py-3.5 text-lg transition hover:opacity-90"
                  style={{ backgroundColor: primary }}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Contact */}
          {step === 'contact' && (
            <div className="space-y-6">
              <button onClick={() => setStep('configure')} className="text-sm text-gray-500 hover:text-gray-700">← Back to configuration</button>

              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900">Your Information</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm" placeholder="John Doe" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm" placeholder="(555) 123-4567" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm" placeholder="you@example.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Property Address</label>
                    <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm" placeholder="123 Main St" />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={requestOnSite} onChange={e => setRequestOnSite(e.target.checked)}
                    className="rounded w-4 h-4" style={{ accentColor: primary }} />
                  <span className="text-sm text-gray-700">I'd like a free on-site estimate</span>
                </label>

                <button onClick={handleSubmit} disabled={submitting || !name.trim()}
                  className="w-full text-white font-semibold rounded-xl py-3.5 text-lg transition hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: primary }}>
                  {submitting ? 'Submitting...' : 'Submit Quote Request'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: live price */}
        <div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-6">
            <div className="px-6 py-6 text-center text-white" style={{ backgroundColor: primary }}>
              <p className="text-sm opacity-80 mb-1">{quoteRange.label}</p>
              {subtotal > 0 ? (
                <p className="text-3xl font-bold">{cents(lowPrice)} — {cents(highPrice)}</p>
              ) : (
                <p className="text-2xl font-bold">$0</p>
              )}
              {subtotal > 0 && <p className="text-xs opacity-70 mt-1">Materials + labor + installation</p>}
            </div>

            <div className="p-5 space-y-3">
              {selectedService ? (
                <>
                  <div className="text-sm space-y-1.5">
                    <div className="flex justify-between"><span className="text-gray-500">Material</span><span className="font-medium">{selectedCategory}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Style</span><span className="font-medium">{selectedService.name}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Height</span><span className="font-medium">{height}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Quantity</span><span className="font-medium">{quantity} {selectedService.unitLabel}</span></div>
                    {extras.walkGates > 0 && <div className="flex justify-between"><span className="text-gray-500">Walk Gates</span><span className="font-medium">{extras.walkGates}</span></div>}
                    {extras.doubleGates > 0 && <div className="flex justify-between"><span className="text-gray-500">Double Gates</span><span className="font-medium">{extras.doubleGates}</span></div>}
                  </div>

                  {lineItems.length > 0 && (
                    <div className="border-t border-gray-100 pt-3 space-y-1">
                      {lineItems.map((li, i) => (
                        <div key={i} className="flex justify-between text-xs text-gray-500">
                          <span>{li.label} x{li.quantity}</span>
                          <span>{cents(li.totalCents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-sm text-center py-4">Select a material to see pricing</p>
              )}

              <p className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100">
                Estimate based on standard conditions. Final pricing confirmed after site visit.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
