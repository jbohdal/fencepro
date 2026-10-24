import PercentField from './PercentField'
import OptionListSettings from './OptionListSettings'
import PipelineStagesSettings from './PipelineStagesSettings'
import { liveOverhead, overheadMoved } from './liveOverhead'
import { businessDate } from './businessDate'
import { DEFAULT_PRICE_STALE_MONTHS } from './priceAge'
import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import {
  getConfig, saveConfig, getDefaultConfig, overheadPctOf, DEFAULT_OVERHEAD_PCT,
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
import WarrantySettings from './WarrantySettings'
import VoiceSettings from './VoiceSettings'
import { toast } from './toast'
import { useNav, useLeaveGuard, useLeaveWarning, navigate, goBack, openedFrom } from './nav'
import { SettingsPageSaveContext, type PageSave } from './settingsPageSave'
import { SETTINGS_GROUPS, settingsPage, searchSettings, type SettingsTab, type SettingsHit } from './settingsMenu'
import PhoneInput from './PhoneInput'
import { sectionWidthForStyle, styleHasPartsList } from './materialCalculator'
import CalendarSyncSettings from './CalendarSyncSettings'
import FenceStylesSettings from './FenceStylesSettings'
import VinylColorsSettings from './VinylColorsSettings'
import TallVinylPrices from './TallVinylPrices'
import MoveRepairSettings from './MoveRepairSettings'
import { AppointmentSettingsTab } from './AppointmentWidgets'
import AppointmentMessagesSettings from './AppointmentMessagesSettings'
import FollowUpSettings from './FollowUpSettings'
import SettingsChangeLog from './SettingsChangeLog'
import DeletedRecords from './DeletedRecords'
import { signedInRole, roleCan } from './permissions'

export const SETTINGS_UPDATED_EVENT = 'fencepro:settings:updated'

const STYLE_CATEGORIES = ['Vinyl', 'Chainlink', 'Commercial', 'Aluminum', 'Other'] as const

const uid = () => Math.random().toString(36).slice(2, 9)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

// ── Look of the pages ────────────────────────────────────────────────────────

/** One column of cards: every direct child div of a page is a card. */
const CARDS = 'space-y-4 [&>div]:bg-white [&>div]:rounded-2xl [&>div]:border [&>div]:border-gray-200 [&>div]:p-4 lg:[&>div]:p-6'
const TITLE = 'text-base font-semibold text-gray-900 mb-1'
const HELP = 'text-sm text-gray-500 mb-4'
const LABEL = 'text-sm font-medium text-gray-700 mb-1 block'
const FIELD = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

// ── Company Tab ──────────────────────────────────────────────────────────────

function CompanyTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const co = config.company

  function set(field: keyof CompanyInfo, value: string) {
    onChange({ ...config, company: { ...co, [field]: value } })
  }

  // Printed on contracts and receipts: say so when a part is empty.
  const missing = [['street address', co.address], ['city', co.city], ['ZIP', co.zip]].filter(([, v]) => !String(v ?? '').trim()).map(([n]) => n)

  return (
    <div className={CARDS}>
      <div>
        <h3 className={TITLE}>Company Details</h3>
        <p className={HELP}>Printed on proposals, contracts and receipts.</p>
        {missing.length > 0 && (
          <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert" data-company-address-warning>
            The {missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`} {missing.length === 1 ? 'is' : 'are'} empty. The company address prints on contracts and receipts.
          </p>
        )}
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Company Name</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Phone</label>
              <PhoneInput className={FIELD} placeholder="(352) 555 0100" value={co.phone} onChange={v => set('phone', v)} data-company-phone />
            </div>
            <div>
              <label className={LABEL}>Email</label>
              <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="info@company.com" value={co.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Street Address</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={LABEL}>City</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>State</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>ZIP</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.zip} onChange={e => set('zip', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Legal Name (for contracts)</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Acme Fence Company, LLC" value={co.legalName ?? ''} onChange={e => set('legalName', e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Photos and video</h3>
        <p className={HELP}>To save space on the Mac: this many days after a job is Complete, each video keeps only its small viewing copy and photos are made 2400 px on the long side. Marked up photos are never changed.</p>
        <label className={LABEL}>Make smaller after (days)</label>
        <input type="number" min={30} max={3650} step={1} data-media-shrink-days
          className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          value={config.media?.shrinkAfterDays ?? 90}
          onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 30 && n <= 3650) onChange({ ...config, media: { ...(config.media ?? {}), shrinkAfterDays: n } }) }} />
      </div>

      <div>
        <h3 className={TITLE}>Branding</h3>
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Logo URL</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="https://yourdomain.com/logo.png" value={co.logoUrl ?? ''} onChange={e => set('logoUrl', e.target.value)} />
            {co.logoUrl && <img src={co.logoUrl} alt="Logo preview" className="mt-2 h-10 object-contain rounded border border-gray-200 p-1" />}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Primary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-10 h-9 border border-gray-300 rounded cursor-pointer" value={co.primaryColor ?? '#f97316'} onChange={e => set('primaryColor', e.target.value)} />
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="#f97316" value={co.primaryColor ?? ''} onChange={e => set('primaryColor', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Secondary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-10 h-9 border border-gray-300 rounded cursor-pointer" value={co.secondaryColor ?? '#ea580c'} onChange={e => set('secondaryColor', e.target.value)} />
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="#ea580c" value={co.secondaryColor ?? ''} onChange={e => set('secondaryColor', e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Customer Support Contact</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Support Email</label>
            <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="support@company.com" value={co.supportEmail ?? ''} onChange={e => set('supportEmail', e.target.value)} />
          </div>
          <div>
            <label className={LABEL}>Support Phone</label>
            <PhoneInput className={FIELD} placeholder="(352) 555 0100" value={co.supportPhone ?? ''} onChange={v => set('supportPhone', v)} data-company-support-phone />
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-3">Shown to customers in the portal footer and public-facing pages. Defaults to the main phone/email above if not set.</p>
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
      <label className={LABEL}>{label}</label>
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
    <div className={CARDS}>
      <div data-overhead>
        <h3 className={TITLE}>Overhead and Target Margin</h3>
        <p className={HELP}>Target Margin = Overhead % + each style's Target Profit % (set on the Styles tab). Price = (materials + labor) ÷ (100% − Target Margin).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <label className="block">
            <span className={LABEL}>Overhead % (typed)</span>
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
        <h3 className={TITLE}>How jobs are priced</h3>
        <p className={HELP}>These are the defaults for a new quote. Every quote can switch labor and price method on its own, and a saved quote keeps the choices it was saved with.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={LABEL}>Install labor</label>
            <select className={inputCls} value={p.laborMode ?? 'hourly'} onChange={e => setP('laborMode', e.target.value as PricingConfig['laborMode'])}>
              <option value="hourly">Hourly crew (man hours × rate)</option>
              <option value="subcontractor">Subcontractor (rate per unit)</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Customer price</label>
            <select className={inputCls} value={p.priceMethod ?? 'cost_factor'} onChange={e => setP('priceMethod', e.target.value as PricingConfig['priceMethod'])}>
              <option value="cost_factor">Priced from cost (Target Margin)</option>
              <option value="per_foot">Per foot price (set per style)</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Commission</label>
            <select className={inputCls} value={p.commissionMode ?? 'included'} onChange={e => setP('commissionMode', e.target.value as PricingConfig['commissionMode'])}>
              <option value="included">Taken out of the price</option>
              <option value="added">Added on top of the price</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Material prices</h3>
        <p className={HELP}>A quote warns (it never stops you) when a part's price in Inventory is older than this, or was imported and never confirmed.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={LABEL}>Price is old after (months)</label>
            <input type="number" min={1} max={36} step={1} className={inputCls} data-price-stale-months
              value={p.priceStaleMonths ?? DEFAULT_PRICE_STALE_MONTHS}
              onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 36) setP('priceStaleMonths', n) }} />
          </div>
          <div>
            <label className={LABEL}>Invoice price change waits for my OK above (%)</label>
            <input type="number" min={1} max={500} step={1} className={inputCls} data-invoice-jump-pct
              value={p.invoiceJumpPct ?? 20}
              onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 500) setP('invoiceJumpPct', n) }} />
          </div>
        </div>
      </div>

      <div data-settings-focus="sub-rates" className="scroll-mt-4">
        <h3 className={TITLE}>Subcontractor rates</h3>
        <p className={HELP}>Used when a quote's labor is set to Subcontractor. A rate on the style (Fence Styles tab) wins, then the category rate here, then the default.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={LABEL}>Rates are paid per</label>
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
              <label className={LABEL}>{cat}</label>
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
        <h3 className={TITLE}>Hourly labor</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Man-Hour Rate</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="500" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.manHourRate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 500) setP('manHourRate', Math.round(v * 100) / 100) }} />
              <span className="text-gray-400 text-sm ml-2 whitespace-nowrap">/ hr</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Crew time</h3>
        <p className={HELP}>Quotes show man hours and crew time on hourly and subcontractor jobs, for scheduling.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Men on a crew</label>
            <input type="number" step="1" min="1" max="20" className={inputCls} value={p.crewSize ?? 3} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setP('crewSize', v) }} />
          </div>
          <div>
            <label className={LABEL}>Hours in a crew day</label>
            <input type="number" step="0.5" min="1" max="24" className={inputCls} value={p.crewHoursPerDay ?? 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 1) setP('crewHoursPerDay', v) }} />
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Commission</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Salesman Commission</label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(p.commissionSalesman * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setP('commissionSalesman', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%</span>
            </div>
          </div>
          <div>
            <label className={LABEL}>Non-Salesman Commission</label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(p.commissionNonSalesman * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setP('commissionNonSalesman', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Tear-Out Costs</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Per Fence Section</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="200" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.tearOutFence} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setP('tearOutFence', Math.round(v * 100) / 100) }} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Per Gate</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="200" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.tearOutGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setP('tearOutGate', Math.round(v * 100) / 100) }} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className={TITLE}>Margin Thresholds</h3>
        <p className={HELP}>Controls color coding on quotes and dashboard</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={`${LABEL} flex items-center gap-2`}>
              Good <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
            </label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(m.good * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setM('good', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%+</span>
            </div>
          </div>
          <div>
            <label className={`${LABEL} flex items-center gap-2`}>
              Warning <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
            </label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(m.warning * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setM('warning', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%+</span>
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-3">Below {fmtPct(m.warning)} shows as <span className="text-red-500 font-medium">danger</span></p>
      </div>
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
    <div className={CARDS}>
      <div>
        <h3 className={TITLE}>Smart Rail Optimization</h3>
        <p className={HELP}>
          Picks 6 ft or 8 ft panels for each side to give the lowest price. The pull sheet follows the same choice.
        </p>

        <div className="space-y-5">
          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable smart rail optimization</p>
              <p className="text-sm text-gray-500 mt-0.5">When off, every side uses 6 ft panels.</p>
            </div>
            <input type="checkbox" checked={opt.enabled} onChange={e => set('enabled', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Short-run cutoff (feet)</label>
            <p className="text-sm text-gray-500 mb-2">Runs at or below this footage are always 6ft. Useful for short runs beside gates or houses.</p>
            <input
              type="number" min={1} max={12}
              value={opt.shortRunCutoffFt}
              onChange={e => set('shortRunCutoffFt', Math.max(1, Math.min(12, Number(e.target.value) || 0)))}
              data-opt-short-run
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-sm text-gray-500 mt-1">Range: 1–12 ft. Default: 6 ft.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cost preference threshold (%)</label>
            <p className="text-sm text-gray-500 mb-2">When 8ft cost is within this % of 6ft cost, prefer 8ft for the productivity gain (fewer sections).</p>
            <input
              type="number" min={0} max={10} step={0.5}
              value={(opt.costPreferenceThreshold * 100).toFixed(1)}
              onChange={e => set('costPreferenceThreshold', Math.max(0, Math.min(10, Number(e.target.value) || 0)) / 100)}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-sm text-gray-500 mt-1">Range: 0–10 %. Default: 2 %.</p>
          </div>

          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Show optimization details in quote builder</p>
              <p className="text-sm text-gray-500 mt-0.5">Show the 6 ft / 8 ft choice for each side, with the savings and the reason.</p>
            </div>
            <input type="checkbox" checked={opt.showDetailsInBuilder} onChange={e => set('showDetailsInBuilder', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>

          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Allow estimator overrides</p>
              <p className="text-sm text-gray-500 mt-0.5">When on, the estimator can manually choose 6ft or 8ft per run.</p>
            </div>
            <input type="checkbox" checked={opt.allowOverrides} onChange={e => set('allowOverrides', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>
        </div>
      </div>
    </div>
  )
}

// ── Main Admin Settings Page ─────────────────────────────────────────────────

/**
 * What "Reset to defaults" on a page puts back: the settings each page edits.
 * The starting values go into the page's draft; nothing is saved until Save.
 * (Company and Fence Styles have no reset: their starting values are not a
 * sensible fallback. Email and Contract Templates reset each template or
 * section on their own.)
 */
const RESET_KEYS: Partial<Record<SettingsTab, string[]>> = {
  pricing: ['pricing', 'margins'],
  optimizer: ['railOptimizer'],
  moves: ['moveRepair'],
  proposals: ['proposal'],
  warranties: ['warranties'],
  voice: ['voice'],
  walkthrough: ['walkthroughTemplates', 'walkthroughWarranty'],
}

/** Pages drawn as cards on the gray page; the others sit in one white card. */
const OWN_CARDS = new Set<SettingsTab>(['company', 'pricing', 'optimizer'])

const WIDE = '(min-width: 1024px)'
const onWideChange = (f: () => void) => { const mq = window.matchMedia(WIDE); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }
const isWide = () => window.matchMedia(WIDE).matches
function useWide(): boolean { return useSyncExternalStore(onWideChange, isWide) }

const LEAVE_MESSAGE = 'Leave without saving?\n\nThe changes on this page have not been saved.'

export default function AdminSettingsPage() {
  const wide = useWide()
  const role = signedInRole()
  const allowed = (key: SettingsTab) => (key !== 'change_log' || role === 'super_admin') && (key !== 'deleted' || roleCan(role, 'records.delete'))

  // The page is in the address: /settings?tab=pricing (links from Finish setup,
  // the quote, tests), or the older ?settings=calendar Google sends back with.
  // No page named: the list on a phone, Company on a computer.
  const navParams = useNav().params
  const want = navParams.get('tab') || navParams.get('settings')
  const urlTab = settingsPage(want) && allowed(want as SettingsTab) ? want as SettingsTab : null
  const tab: SettingsTab | null = urlTab ?? (wide ? 'company' : null)
  const info = settingsPage(tab)
  const group = SETTINGS_GROUPS.find(g => g.pages.some(p => p.key === tab))

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
      flash(el)
    }, 100)
    return () => clearInterval(t)
  }, [focus, tab])

  // The shared settings: the draft the pages edit, and what was last saved.
  const [config, setConfig] = useState<AppConfig>(getConfig)
  const [savedConfig, setSavedConfig] = useState<AppConfig>(getConfig)
  const configDirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig])
  // A page with its own draft (lists, tiers, messages) reports it here.
  const [pageSave, setPageSave] = useState<PageSave | null>(null)
  const dirty = configDirty || !!pageSave?.dirty
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  /** Save the shared settings (or `next`: a change Settings → Fence styles saves at once, with the page's other changes). */
  function saveShared(next?: AppConfig): boolean {
    const config_ = next ?? config
    try {
      // The Appointments and Messages tabs save on their own; keep what they saved.
      saveConfig({ ...config_, appointments: getConfig().appointments, appointmentMessages: getConfig().appointmentMessages })
      // Read back: plain names and what the choice tree says are worked out on read.
      const back = getConfig()
      setConfig(back)
      setSavedConfig(back)
      try { window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: config_ })) } catch {}
      toast.success('Settings saved', 'Live pages will update immediately.')
      return true
    } catch (err: any) {
      toast.error('Could not save settings', err?.message || 'Unknown error.')
      return false
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      let ok = true
      if (configDirty) ok = saveShared()
      if (ok && pageSave?.dirty) await pageSave.save()
      if (ok) { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }
    } finally { setSaving(false) }
  }

  function discardAll() {
    setConfig(savedConfig)
    pageSave?.discard()
  }

  function handleReset() {
    const keys = tab ? RESET_KEYS[tab] : undefined
    if (!keys || !info) return
    if (!window.confirm(`Reset ${info.label} to the starting values?\n\nNothing is saved until you press Save. Discard puts your values back.`)) return
    const defaults = getDefaultConfig() as unknown as Record<string, unknown>
    setConfig(c => {
      const next = { ...c } as unknown as Record<string, unknown>
      for (const k of keys) next[k] = defaults[k] === undefined ? undefined : JSON.parse(JSON.stringify(defaults[k]))
      return next as unknown as AppConfig
    })
  }

  // Leaving the page with unsaved changes asks first: the menu, a link, Back,
  // Forward (useLeaveGuard), a reload or closing the tab (useLeaveWarning).
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const tabRef = useRef(tab)
  tabRef.current = tab
  const discardRef = useRef(discardAll)
  discardRef.current = discardAll
  useLeaveGuard(to => {
    if (!dirtyRef.current) return true
    const u = new URL(to, window.location.origin)
    if (u.pathname === '/settings') {
      const t = u.searchParams.get('tab') || u.searchParams.get('settings')
      const goes = settingsPage(t) ? t : (isWide() ? 'company' : null)
      if (goes === tabRef.current) return true
    }
    if (!window.confirm(LEAVE_MESSAGE)) return false
    discardRef.current()
    return true
  })
  useLeaveWarning(() => dirtyRef.current)

  function openTab(key: SettingsTab) { navigate(`/settings?tab=${key}`, { from: 'Settings' }) }
  function backToList() {
    if (openedFrom() === 'Settings') goBack('/settings')
    else navigate('/settings', { replace: true })
  }

  // ── Search ──
  const [query, setQuery] = useState('')
  const hits = useMemo(() => searchSettings(query, allowed), [query, role])  // eslint-disable-line react-hooks/exhaustive-deps
  const [findField, setFindField] = useState<{ field: string; n: number } | null>(null)
  function pick(hit: SettingsHit) {
    setQuery('')
    if (hit.field) setFindField({ field: hit.field, n: Date.now() })
    if (hit.page.key !== tab) openTab(hit.page.key)
  }
  // After a search pick: scroll to the field on the page, outline it, and put the cursor in it.
  useEffect(() => {
    if (!findField) return
    let tries = 0
    const t = setInterval(() => {
      const el = findOnPage(findField.field)
      if (!el && ++tries < 30) return
      clearInterval(t)
      setFindField(null)
      if (!el) return
      el.scrollIntoView({ block: 'center' })
      flash(el)
      const input = el.matches('input, select, textarea') ? el
        : (el.closest('label')?.querySelector<HTMLElement>('input, select, textarea') ?? el.parentElement?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea'))
      input?.focus({ preventScroll: true })
    }, 100)
    return () => clearInterval(t)
  }, [findField, tab])

  const visibleGroups = SETTINGS_GROUPS.map(g => ({ ...g, pages: g.pages.filter(p => allowed(p.key)) })).filter(g => g.pages.length)
  // A phone shows the list, or one page; a computer shows both.
  const showList = wide || !tab

  return (
    <SettingsPageSaveContext.Provider value={setPageSave}>
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto lg:px-4 py-2 lg:py-4">
        <div className={`${showList ? '' : 'hidden'} lg:block mb-5`}>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">Pricing, fence styles and how the business runs.</p>
        </div>

        <div className="lg:flex lg:gap-8 lg:items-start">
          <nav aria-label="Settings" className={`${showList ? '' : 'hidden'} lg:block lg:w-72 lg:shrink-0 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pb-4 lg:pr-1`} data-settings-menu>
            <div className="relative mb-4">
              <Search aria-hidden className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings"
                aria-label="Search settings" data-settings-search
                onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0]) } if (e.key === 'Escape') setQuery('') }}
                className="w-full bg-white border border-gray-300 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            {query.trim() ? (
              <div className="bg-white border border-gray-200 rounded-2xl p-1" data-settings-results>
                {hits.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No setting matches “{query.trim()}”.</p>}
                {hits.map(h => (
                  <button key={`${h.page.key}:${h.field ?? ''}`} type="button" onClick={() => pick(h)} data-settings-hit={h.page.key}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-50 min-h-[48px]">
                    <span className="block text-sm font-medium text-gray-900">{h.field ?? h.page.label}</span>
                    <span className="block text-xs text-gray-500">{h.field ? `${h.page.label} · ${h.group}` : `${h.group} · ${h.page.description}`}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {visibleGroups.map(g => (
                  <div key={g.name}>
                    <h2 className="px-3 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.name}</h2>
                    <div className="bg-white border border-gray-200 rounded-2xl p-1 lg:bg-transparent lg:border-0 lg:p-0">
                      {g.pages.map(p => {
                        const on = tab === p.key
                        return (
                          <button key={p.key} type="button" onClick={() => openTab(p.key)} data-settings-tab={p.key} aria-pressed={on} aria-current={on ? 'page' : undefined}
                            className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl transition-colors min-h-[48px] ${on ? 'bg-white shadow-sm ring-1 ring-orange-300' : 'hover:bg-gray-100'}`}>
                            <span className="flex-1 min-w-0">
                              <span className={`block text-sm font-medium ${on ? 'text-orange-700' : 'text-gray-900'}`}>{p.label}</span>
                              <span className="block text-xs text-gray-500 truncate">{p.description}</span>
                            </span>
                            <ChevronRight aria-hidden className="w-4 h-4 text-gray-400 lg:hidden" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </nav>

          {tab && info && (
            <main className="flex-1 min-w-0 max-w-3xl [&_[data-settings-dup-title]]:hidden" data-settings-page={tab}>
              <button type="button" onClick={backToList} className="lg:hidden btn btn-quiet -ml-3 mb-1" data-settings-back>
                <ChevronLeft aria-hidden className="w-5 h-5" /> Settings
              </button>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  {group && <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{group.name}</p>}
                  <h2 className="text-xl font-bold text-gray-900">{info.label}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{info.description}</p>
                </div>
                {RESET_KEYS[tab] && (
                  <button type="button" onClick={handleReset} className="btn btn-quiet btn-sm shrink-0" data-settings-reset>Reset to defaults</button>
                )}
              </div>

              <div className={OWN_CARDS.has(tab) ? '' : 'bg-white rounded-2xl border border-gray-200 p-4 lg:p-6'}>
                {tab === 'company' && <CompanyTab config={config} onChange={setConfig} />}
                {tab === 'pricing' && <PricingTab config={config} onChange={setConfig} />}
                {tab === 'price_list' && <>
                  <VinylColorsSettings blocked={configDirty} onServerSaved={() => { const c = getConfig(); setConfig(c); setSavedConfig(c) }} />
                  <TallVinylPrices config={config} onCommit={next => { saveShared(next) }} />
                </>}
                {tab === 'styles' && <FenceStylesSettings config={config} onChange={setConfig} onCommit={next => { saveShared(next) }} />}
                {tab === 'leads' && <OptionListSettings kind="leadSources" />}
                {tab === 'tags' && <OptionListSettings kind="customerTags" />}
                {tab === 'pipeline' && <PipelineStagesSettings />}
                {tab === 'moves' && <MoveRepairSettings config={config} onChange={setConfig} />}
                {tab === 'optimizer' && <OptimizerTab config={config} onChange={setConfig} />}
                {tab === 'ops_stages' && <OperationsStagesSettings />}
                {tab === 'email_templates' && <EmailTemplatesSettings />}
                {tab === 'contract_templates' && <ContractTemplatesSettings />}
                {tab === 'portal_quote' && <PortalQuoteSettings />}
                {tab === 'proposals' && <ProposalSettings config={config} onChange={setConfig} onOpenTiers={() => openTab('tiers')} />}
                {tab === 'warranties' && <WarrantySettings config={config} onChange={setConfig} />}
                {tab === 'tiers' && <TierSettings />}
                {tab === 'voice' && <VoiceSettings config={config} onChange={setConfig} />}
                {tab === 'calendar' && <CalendarSyncSettings />}
                {tab === 'appointments' && <AppointmentSettingsTab />}
                {tab === 'messages' && <AppointmentMessagesSettings />}
                {tab === 'follow_ups' && <FollowUpSettings />}
                {tab === 'walkthrough' && <WalkthroughSettings config={config} onChange={setConfig} />}
                {tab === 'change_log' && <SettingsChangeLog />}
                {tab === 'deleted' && <DeletedRecords />}
              </div>

              {/* The page's save bar: only while something on this page changed. */}
              {(dirty || justSaved) && (
                <div className="sticky z-20 bottom-0 mt-4" data-settings-savebar>
                  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl shadow-lg px-4 py-2" role="status">
                    <span className={`flex-1 text-sm leading-tight font-semibold ${dirty ? 'text-gray-900' : 'text-green-700'}`}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
                    {dirty && <>
                      <button type="button" className="btn btn-secondary" onClick={discardAll} disabled={saving} data-settings-discard>Discard</button>
                      <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving} data-settings-save>{saving ? 'Saving…' : 'Save changes'}</button>
                    </>}
                  </div>
                </div>
              )}
            </main>
          )}
        </div>
      </div>
    </div>
    </SettingsPageSaveContext.Provider>
  )
}

/** Outline an element for a moment (a search pick, a ?focus= link). */
function flash(el: HTMLElement) {
  el.classList.add('ring-2', 'ring-orange-400', 'rounded-xl')
  setTimeout(() => el.classList.remove('ring-2', 'ring-orange-400', 'rounded-xl'), 2500)
}

/** The smallest heading, label or line on the open page whose words hold `field`. */
function findOnPage(field: string): HTMLElement | null {
  const page = document.querySelector('[data-settings-page]')
  if (!page) return null
  const want = field.toLowerCase().replace(/\s+/g, ' ').trim()
  let best: HTMLElement | null = null
  let bestLen = Infinity
  for (const el of page.querySelectorAll<HTMLElement>('label, h2, h3, h4, h5, legend, th, summary, p, span, button')) {
    const text = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (!text.includes(want) || el.offsetParent === null) continue
    if (text.length < bestLen) { best = el; bestLen = text.length }
  }
  return best
}
