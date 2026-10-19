import PercentField from './PercentField'
import { liveOverhead, overheadMoved } from './liveOverhead'
import { businessDate } from './businessDate'
import { DEFAULT_PRICE_STALE_MONTHS } from './priceAge'
import { useState, useEffect } from 'react'
import {
  getConfig, saveConfig, resetConfig, getDefaultConfig, overheadPctOf, DEFAULT_OVERHEAD_PCT,
  type AppConfig, type FenceStyle, type CompanyInfo, type PricingConfig, type MarginThresholds,
  type RailOptimizerConfig,
} from './configStore'
import OperationsStagesSettings from './OperationsStagesSettings'
import EmailTemplatesSettings from './EmailTemplatesSettings'
import ContractTemplatesSettings from './ContractTemplatesSettings'
import PortalQuoteSettings from './PortalQuoteSettings'
import ProposalSettings from './ProposalSettings'
import TierSettings from './TierSettings'
import WalkthroughSettings from './WalkthroughSettings'
import VoiceSettings from './VoiceSettings'
import { toast } from './toast'
import { useNav } from './nav'
import { sectionWidthForStyle, styleHasPartsList } from './materialCalculator'
import CalendarSyncSettings from './CalendarSyncSettings'
import FenceStylesSettings from './FenceStylesSettings'
import MoveRepairSettings from './MoveRepairSettings'
import { AppointmentSettingsTab } from './AppointmentWidgets'

type AdminTab = 'company' | 'pricing' | 'styles' | 'leads' | 'tags' | 'pipeline' | 'ops_stages' | 'email_templates' | 'contract_templates' | 'portal_quote' | 'optimizer' | 'calendar' | 'appointments' | 'proposals' | 'tiers' | 'voice' | 'walkthrough' | 'moves'

export const SETTINGS_UPDATED_EVENT = 'fencepro:settings:updated'

const STYLE_CATEGORIES = ['Vinyl', 'Chainlink', 'Commercial', 'Aluminum', 'Other'] as const

const uid = () => Math.random().toString(36).slice(2, 9)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

// ── Company Tab ──────────────────────────────────────────────────────────────

function CompanyTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const co = config.company

  function set(field: keyof CompanyInfo, value: string) {
    onChange({ ...config, company: { ...co, [field]: value } })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Company Details</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Company Name</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Phone</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(352) 555-0100" value={co.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email</label>
              <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="info@company.com" value={co.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Street Address</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">City</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">State</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ZIP</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.zip} onChange={e => set('zip', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Legal Name (for contracts)</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Acme Fence Company, LLC" value={co.legalName ?? ''} onChange={e => set('legalName', e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-1">Photos and video</h3>
        <p className="text-xs text-gray-400 mb-4">To save space on the Mac: this many days after a job is Complete, each video keeps only its small viewing copy and photos are made 2400 px on the long side. Marked up photos are never changed.</p>
        <label className="text-xs text-gray-500 mb-1 block">Make smaller after (days)</label>
        <input type="number" min={30} max={3650} step={1} data-media-shrink-days
          className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          value={config.media?.shrinkAfterDays ?? 90}
          onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 30 && n <= 3650) onChange({ ...config, media: { ...(config.media ?? {}), shrinkAfterDays: n } }) }} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Branding</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Logo URL</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="https://yourdomain.com/logo.png" value={co.logoUrl ?? ''} onChange={e => set('logoUrl', e.target.value)} />
            {co.logoUrl && <img src={co.logoUrl} alt="Logo preview" className="mt-2 h-10 object-contain rounded border border-gray-200 p-1" />}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Primary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-10 h-9 border border-gray-300 rounded cursor-pointer" value={co.primaryColor ?? '#f97316'} onChange={e => set('primaryColor', e.target.value)} />
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="#f97316" value={co.primaryColor ?? ''} onChange={e => set('primaryColor', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Secondary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-10 h-9 border border-gray-300 rounded cursor-pointer" value={co.secondaryColor ?? '#ea580c'} onChange={e => set('secondaryColor', e.target.value)} />
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="#ea580c" value={co.secondaryColor ?? ''} onChange={e => set('secondaryColor', e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Customer Support Contact</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Support Email</label>
            <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="support@company.com" value={co.supportEmail ?? ''} onChange={e => set('supportEmail', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Support Phone</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(555) 123-4567" value={co.supportPhone ?? ''} onChange={e => set('supportPhone', e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">Shown to customers in the portal footer and public-facing pages. Defaults to the main phone/email above if not set.</p>
      </div>
    </div>
  )
}

// ── Pricing Tab ──────────────────────────────────────────────────────────────

function PricingTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const p = config.pricing
  const m = config.margins

  function setP<K extends keyof PricingConfig>(field: K, value: PricingConfig[K]) {
    onChange({ ...config, pricing: { ...p, [field]: value } })
  }

  function setCategoryRate(category: string, value: number | undefined) {
    const next = { ...(p.subRateByCategory ?? {}) }
    if (value === undefined) delete next[category]
    else next[category] = value
    onChange({ ...config, pricing: { ...p, subRateByCategory: next } })
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400'
  const unitLabel = p.subUnit === 'section' ? 'section' : 'foot'
  const moneyField = (label: string, field: 'subRateDefault' | 'subWalkGate' | 'subDblGate' | 'subTearOutSection' | 'subTearOutGate', suffix?: string) => (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <div className="flex items-center">
        <span className="text-gray-400 mr-1">$</span>
        <input type="number" step="0.25" min="0" max="10000" className={inputCls} value={p[field] ?? 0} onChange={e => { const v = parseFloat(e.target.value); setP(field, !isNaN(v) && v >= 0 ? Math.round(v * 100) / 100 : 0) }} />
        {suffix && <span className="text-gray-400 text-sm ml-2 whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  )

  function setM(field: keyof MarginThresholds, value: number) {
    onChange({ ...config, margins: { ...m, [field]: value } })
  }

  // Overhead: typed, or live from the budget.
  const typedOverhead = p.overheadPct ?? DEFAULT_OVERHEAD_PCT
  const liveOn = !!p.liveOverhead?.on
  const basis = p.liveOverhead?.basis ?? 'last12'
  const live = liveOn ? liveOverhead(basis) : null
  const moved = live ? overheadMoved(config, live) : null
  const inUse = overheadPctOf(config)
  function setLive(on: boolean, b = basis) {
    const now = on ? liveOverhead(b) : null
    // Keep this month's live number, for the "moved more than 3 points" warning.
    const month = businessDate(new Date()).slice(0, 7)
    const history = now ? [...(p.overheadHistory ?? []).filter(h => h.month !== month), { month, pct: now.pct }].slice(-24) : p.overheadHistory
    onChange({ ...config, pricing: { ...p, liveOverhead: { on, basis: b }, overheadHistory: history } })
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div data-overhead>
        <h3 className="text-xs font-semibold text-gray-500 mb-1">Overhead and Target Margin</h3>
        <p className="text-xs text-gray-500 mb-4">Target Margin = Overhead % + each style's Target Profit % (set on the Styles tab). Price = (materials + labor) ÷ (100% − Target Margin).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Overhead % (typed)</span>
            <PercentField value={typedOverhead} min={0} max={90} className={inputCls} data-overhead-typed
              onChange={v => setP('overheadPct', v ?? DEFAULT_OVERHEAD_PCT)} />
          </label>
          <div>
            <label className="flex items-center gap-3 min-h-[48px] cursor-pointer">
              <input type="checkbox" className="w-6 h-6 accent-orange-500" checked={liveOn} onChange={e => setLive(e.target.checked)} data-overhead-live />
              <span className="text-sm text-gray-800">Use live overhead from my budget</span>
            </label>
            {liveOn && (
              <select className={inputCls} value={basis} onChange={e => setLive(true, e.target.value as 'last12' | 'projection')} data-overhead-basis>
                <option value="last12">Installed in the last 12 months</option>
                <option value="projection">This year's projection</option>
              </select>
            )}
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-sm" data-overhead-in-use>
          <p className="font-semibold text-gray-900">Overhead in use: {Math.round(inUse * 10) / 10}%</p>
          {liveOn && live && <p className="text-gray-700 mt-1">Live: {live.pct}% = {live.how}.</p>}
          {liveOn && !live && <p className="text-amber-900 mt-1">The budget has no overhead filled in yet (or no installed revenue for that time), so the typed {typedOverhead}% is used until it does.</p>}
          {moved && <p className="text-red-800 mt-1 font-semibold" data-overhead-moved>Live overhead moved from {moved.from}% ({moved.month}) to {live!.pct}%: more than 3 points in a month. Check the budget, and whether prices should follow.</p>}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-1">How jobs are priced</h3>
        <p className="text-xs text-gray-400 mb-4">These are the defaults for a new quote. Every quote can switch labor and price method on its own, and a saved quote keeps the choices it was saved with.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Install labor</label>
            <select className={inputCls} value={p.laborMode ?? 'hourly'} onChange={e => setP('laborMode', e.target.value as PricingConfig['laborMode'])}>
              <option value="hourly">Hourly crew (man hours × rate)</option>
              <option value="subcontractor">Subcontractor (rate per unit)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Customer price</label>
            <select className={inputCls} value={p.priceMethod ?? 'cost_factor'} onChange={e => setP('priceMethod', e.target.value as PricingConfig['priceMethod'])}>
              <option value="cost_factor">Priced from cost (Target Margin)</option>
              <option value="per_foot">Per foot price (set per style)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Commission</label>
            <select className={inputCls} value={p.commissionMode ?? 'included'} onChange={e => setP('commissionMode', e.target.value as PricingConfig['commissionMode'])}>
              <option value="included">Taken out of the price</option>
              <option value="added">Added on top of the price</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-1">Material prices</h3>
        <p className="text-xs text-gray-400 mb-4">A quote warns (it never stops you) when a part's price in Inventory is older than this, or was imported and never confirmed.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Price is old after (months)</label>
            <input type="number" min={1} max={36} step={1} className={inputCls} data-price-stale-months
              value={p.priceStaleMonths ?? DEFAULT_PRICE_STALE_MONTHS}
              onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 36) setP('priceStaleMonths', n) }} />
          </div>
        </div>
      </div>

      <div data-settings-focus="sub-rates" className="scroll-mt-4">
        <h3 className="text-xs font-semibold text-gray-500 mb-1">Subcontractor rates</h3>
        <p className="text-xs text-gray-400 mb-4">Used when a quote's labor is set to Subcontractor. A rate on the style (Fence Styles tab) wins, then the category rate here, then the default.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Rates are paid per</label>
            <select className={inputCls} value={p.subUnit ?? 'foot'} onChange={e => setP('subUnit', e.target.value as PricingConfig['subUnit'])}>
              <option value="foot">Foot</option>
              <option value="section">Section</option>
            </select>
          </div>
          {moneyField('Default rate', 'subRateDefault', `/ ${unitLabel}`)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {STYLE_CATEGORIES.map(cat => (
            <div key={cat}>
              <label className="text-xs text-gray-500 mb-1 block">{cat}</label>
              <input type="number" step="0.25" min="0" className={inputCls} placeholder="Default" value={p.subRateByCategory?.[cat] ?? ''} onChange={e => { const v = parseFloat(e.target.value); setCategoryRate(cat, e.target.value === '' || isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100) }} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {moneyField('Per walk gate', 'subWalkGate')}
          {moneyField('Per double gate', 'subDblGate')}
          {moneyField('Tear out, per section', 'subTearOutSection')}
          {moneyField('Tear out, per gate', 'subTearOutGate')}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Hourly labor</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Man-Hour Rate</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="500" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.manHourRate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 500) setP('manHourRate', Math.round(v * 100) / 100) }} />
              <span className="text-gray-400 text-sm ml-2 whitespace-nowrap">/ hr</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-1">Crew time</h3>
        <p className="text-xs text-gray-500 mb-4">Quotes show man hours and crew time on hourly and subcontractor jobs, for scheduling.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Men on a crew</label>
            <input type="number" step="1" min="1" max="20" className={inputCls} value={p.crewSize ?? 3} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setP('crewSize', v) }} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Hours in a crew day</label>
            <input type="number" step="0.5" min="1" max="24" className={inputCls} value={p.crewHoursPerDay ?? 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 1) setP('crewHoursPerDay', v) }} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Commission</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Salesman Commission</label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(p.commissionSalesman * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setP('commissionSalesman', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Non-Salesman Commission</label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(p.commissionNonSalesman * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setP('commissionNonSalesman', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Tear-Out Costs</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Per Fence Section</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="200" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.tearOutFence} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setP('tearOutFence', Math.round(v * 100) / 100) }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Per Gate</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="200" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.tearOutGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setP('tearOutGate', Math.round(v * 100) / 100) }} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-4">Margin Thresholds</h3>
        <p className="text-xs text-gray-400 mb-3">Controls color coding on quotes and dashboard</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block flex items-center gap-2">
              Good <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
            </label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(m.good * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setM('good', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%+</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block flex items-center gap-2">
              Warning <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
            </label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(m.warning * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setM('warning', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%+</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">Below {fmtPct(m.warning)} shows as <span className="text-red-500 font-medium">danger</span></p>
      </div>
    </div>
  )
}

// ── Editable List (Lead Sources, Tags, Pipeline) ─────────────────────────────

function EditableListTab({
  title, description, items, onChange, placeholder,
}: {
  title: string
  description: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
}) {
  const [newItem, setNewItem] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  function add() {
    const trimmed = newItem.trim()
    if (!trimmed || items.includes(trimmed)) return
    onChange([...items, trimmed])
    setNewItem('')
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function rename(idx: number, value: string) {
    onChange(items.map((item, i) => i === idx ? value : item))
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    const next = [...items]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    onChange(next)
  }

  function moveDown(idx: number) {
    if (idx === items.length - 1) return
    const next = [...items]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    onChange(next)
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{description}</p>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder={placeholder}
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!newItem.trim()} className="btn btn-primary">Add</button>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 last:border-b-0 group hover:bg-gray-50">
            <div className="flex flex-col gap-0.5 mr-1">
              <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 text-xs leading-none">&uarr;</button>
              <button onClick={() => moveDown(idx)} disabled={idx === items.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 text-xs leading-none">&darr;</button>
            </div>
            <span className="text-xs text-gray-300 font-mono w-6">{idx + 1}</span>
            {editingIdx === idx ? (
              <input
                autoFocus
                className="flex-1 border border-orange-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={item}
                onChange={e => rename(idx, e.target.value)}
                onBlur={() => setEditingIdx(null)}
                onKeyDown={e => e.key === 'Enter' && setEditingIdx(null)}
              />
            ) : (
              <span className="flex-1 text-sm text-gray-800 cursor-pointer hover:text-orange-600" onClick={() => setEditingIdx(idx)}>{item}</span>
            )}
            <button onClick={() => remove(idx)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">&times;</button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No items yet</div>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">{items.length} items</p>
    </div>
  )
}

// ── Quote Optimizer Tab ──────────────────────────────────────────────────────

const DEFAULT_OPTIMIZER: RailOptimizerConfig = {
  enabled: true,
  shortRunCutoffFt: 6,
  costPreferenceThreshold: 0.02,
  showDetailsInBuilder: true,
  allowOverrides: true,
}

function OptimizerTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const opt = config.railOptimizer ?? DEFAULT_OPTIMIZER

  function set<K extends keyof RailOptimizerConfig>(field: K, value: RailOptimizerConfig[K]) {
    onChange({ ...config, railOptimizer: { ...opt, [field]: value } })
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 mb-2">Smart Rail Optimization</h3>
        <p className="text-sm text-gray-500 mb-6">
          For vinyl jobs, recommends 6ft or 8ft rails per run to minimize material cost and maximize productivity.
          Recommendation only — does not yet drive the pull-sheet quantities (Milestone B will land that).
        </p>

        <div className="space-y-5">
          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable smart rail optimization</p>
              <p className="text-xs text-gray-500 mt-0.5">When off, the optimizer recommendation is hidden and 6ft is the default.</p>
            </div>
            <input type="checkbox" checked={opt.enabled} onChange={e => set('enabled', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Short-run cutoff (feet)</label>
            <p className="text-xs text-gray-500 mb-2">Runs at or below this footage are always 6ft. Useful for short runs beside gates or houses.</p>
            <input
              type="number" min={1} max={12}
              value={opt.shortRunCutoffFt}
              onChange={e => set('shortRunCutoffFt', Math.max(1, Math.min(12, Number(e.target.value) || 0)))}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-xs text-gray-400 mt-1">Range: 1–12 ft. Default: 6 ft.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cost preference threshold (%)</label>
            <p className="text-xs text-gray-500 mb-2">When 8ft cost is within this % of 6ft cost, prefer 8ft for the productivity gain (fewer sections).</p>
            <input
              type="number" min={0} max={10} step={0.5}
              value={(opt.costPreferenceThreshold * 100).toFixed(1)}
              onChange={e => set('costPreferenceThreshold', Math.max(0, Math.min(10, Number(e.target.value) || 0)) / 100)}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-xs text-gray-400 mt-1">Range: 0–10 %. Default: 2 %.</p>
          </div>

          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Show optimization details in quote builder</p>
              <p className="text-xs text-gray-500 mt-0.5">Per-run recommendation table with savings and reasoning.</p>
            </div>
            <input type="checkbox" checked={opt.showDetailsInBuilder} onChange={e => set('showDetailsInBuilder', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>

          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Allow estimator overrides</p>
              <p className="text-xs text-gray-500 mt-0.5">When on, the estimator can manually choose 6ft or 8ft per run.</p>
            </div>
            <input type="checkbox" checked={opt.allowOverrides} onChange={e => set('allowOverrides', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>
        </div>
      </div>
    </div>
  )
}

// ── Main Admin Settings Page ─────────────────────────────────────────────────

const TABS: { key: AdminTab; label: string }[] = [
  { key: 'company',         label: 'Company' },
  { key: 'pricing',         label: 'Pricing' },
  { key: 'styles',          label: 'Fence Styles' },
  { key: 'moves',           label: 'Moves and Repairs' },
  { key: 'optimizer',       label: 'Quote Optimizer' },
  { key: 'leads',           label: 'Lead Sources' },
  { key: 'tags',            label: 'Tags' },
  { key: 'pipeline',        label: 'Pipeline Stages' },
  { key: 'ops_stages',         label: 'Operations Stages' },
  { key: 'email_templates',    label: 'Email Templates' },
  { key: 'contract_templates', label: 'Contract Templates' },
  { key: 'portal_quote',       label: 'Portal & Quotes' },
  { key: 'proposals',          label: 'Proposals' },
  { key: 'tiers',              label: 'Good Better Best' },
  { key: 'voice',              label: 'Voice' },
  { key: 'appointments',       label: 'Appointments' },
  { key: 'walkthrough',        label: 'Final Walkthrough' },
  { key: 'calendar',           label: 'Google Calendar' },
]

export default function AdminSettingsPage() {
  // ?settings=calendar opens this tab: Google sends the browser back with it after connecting.
  // ?tab=pricing (links from the Finish setup card) or the older ?settings=calendar.
  const [tab, setTab] = useState<AdminTab>(() => {
    const q = new URLSearchParams(window.location.search)
    const want = q.get('tab') || q.get('settings')
    return (TABS.some(t => t.key === want) ? want : 'company') as AdminTab
  })
  // A link to /settings?tab=... while Settings is already open switches the tab.
  const navParams = useNav().params
  const wantTab = navParams.get('tab')
  useEffect(() => { if (wantTab && TABS.some(t => t.key === wantTab)) setTab(wantTab as AdminTab) }, [wantTab])
  // ?focus=sub-rates (or voice-check): scroll to that part of the tab and outline it for a moment.
  const focus = navParams.get('focus')
  useEffect(() => {
    if (!focus) return
    let tries = 0
    const t = setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-settings-focus="${CSS.escape(focus)}"]`)
      if (!el && ++tries < 20) return
      clearInterval(t)
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      el.classList.add('ring-2', 'ring-orange-400', 'rounded-xl')
      setTimeout(() => el.classList.remove('ring-2', 'ring-orange-400', 'rounded-xl'), 2500)
    }, 100)
    return () => clearInterval(t)
  }, [focus, tab])
  const [config, setConfig] = useState<AppConfig>(getConfig)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setConfig(getConfig())
  }, [])

  function handleChange(next: AppConfig) {
    setConfig(next)
    setDirty(true)
  }

  /** Save the page (or `next`: a change Settings → Fence styles saves at once, with the page's other changes). */
  function handleSave(next?: AppConfig) {
    if (next) setConfig(next)
    const config_ = next ?? config
    try {
      // The Appointments tab saves on its own; keep what it saved.
      saveConfig({ ...config_, appointments: getConfig().appointments })
      // Read back: plain names and what the choice tree says are worked out on read.
      if (next) setConfig(getConfig())
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 2000)
      try { window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: config_ })) } catch {}
      toast.success('Settings saved', 'Live pages will update immediately.')
    } catch (err: any) {
      toast.error('Could not save settings', err?.message || 'Unknown error.')
    }
  }

  function handleReset() {
    if (!confirm('Reset all settings to factory defaults? This cannot be undone.')) return
    resetConfig()
    setConfig(getDefaultConfig())
    setDirty(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-6 lg:mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-400 mt-1">Configure pricing, fence styles, and business rules</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {dirty && <span className="text-xs text-orange-500 font-medium">Unsaved changes</span>}
            <button onClick={handleReset} className="text-xs text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">Reset to defaults</button>
            <button onClick={() => handleSave()} className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${saved ? 'bg-green-500 text-white' : dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {saved ? 'Saved' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 bg-white border border-gray-200 rounded-xl p-1 lg:w-fit mb-6 lg:mb-8 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} data-settings-tab={t.key} aria-pressed={tab === t.key} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 lg:p-8">
          {tab === 'company' && <CompanyTab config={config} onChange={handleChange} />}
          {tab === 'pricing' && <PricingTab config={config} onChange={handleChange} />}
          {tab === 'styles' && <FenceStylesSettings config={config} onChange={handleChange} onCommit={next => handleSave(next)} />}
          {tab === 'leads' && (
            <EditableListTab
              title="Lead Sources"
              description="Where customers hear about you. Used in customer forms and quote builder."
              items={config.leadSources}
              onChange={items => handleChange({ ...config, leadSources: items })}
              placeholder="e.g. Billboard, Trade Show..."
            />
          )}
          {tab === 'tags' && (
            <EditableListTab
              title="Customer Tags"
              description="Categorize customers. Used on customer profiles for filtering and segmentation."
              items={config.customerTags}
              onChange={items => handleChange({ ...config, customerTags: items })}
              placeholder="e.g. Priority, Government..."
            />
          )}
          {tab === 'pipeline' && (
            <EditableListTab
              title="Pipeline Stages"
              description="Sales pipeline stages from first contact through close. Order matters — drag to reorder."
              items={config.pipelineStages}
              onChange={items => handleChange({ ...config, pipelineStages: items })}
              placeholder="e.g. Follow-up Call..."
            />
          )}
          {tab === 'moves' && <MoveRepairSettings config={config} onChange={handleChange} />}
          {tab === 'optimizer' && <OptimizerTab config={config} onChange={handleChange} />}
          {tab === 'ops_stages' && <OperationsStagesSettings />}
          {tab === 'email_templates' && <EmailTemplatesSettings />}
          {tab === 'contract_templates' && <ContractTemplatesSettings />}
          {tab === 'portal_quote' && <PortalQuoteSettings />}
          {tab === 'proposals' && <ProposalSettings config={config} onChange={handleChange} onOpenTiers={() => setTab('tiers')} />}
          {tab === 'tiers' && <TierSettings />}
          {tab === 'voice' && <VoiceSettings config={config} onChange={handleChange} />}
          {tab === 'calendar' && <CalendarSyncSettings />}
          {tab === 'appointments' && <AppointmentSettingsTab />}
          {tab === 'walkthrough' && <WalkthroughSettings config={config} onChange={handleChange} />}
        </div>
      </div>
    </div>
  )
}
