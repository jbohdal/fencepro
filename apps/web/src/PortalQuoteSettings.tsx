/**
 * Portal + Quote settings panel — sits inside AdminSettingsPage.
 * All fields persist to fencepro_config.{portal, quote, notifications}.
 */

import { useEffect, useState } from 'react'
import { TEMPLATES, type TemplateKey } from './quoteTemplatesStore'
import { toast } from './toast'
import { getConfig, saveConfig } from './configStore'

type AllSettings = {
  portal: {
    welcomeMessage: string
    supportEmail: string
    supportPhone: string
    accentColor: string
    allowCustomerUploads: boolean
    allowCustomerMessages: boolean
    showInvoiceAmounts: boolean
    showProjectPhotos: boolean
  }
  quote: {
    defaultTemplate: TemplateKey
    defaultValidityDays: number
    defaultIntroText: string
    footerText: string
    showPricePerFoot: boolean
    showLineItemBreakdown: boolean
  }
  notifications: {
    notifyRepOnQuoteView: boolean
    notifyRepOnQuoteAccept: boolean
    notifyCustomerOnSchedule: boolean
    notifyCustomerOnComplete: boolean
  }
}

const DEFAULTS: AllSettings = {
  portal: {
    welcomeMessage: 'Log in to view your quotes, track your project, and message our team.',
    supportEmail: '', supportPhone: '', accentColor: '#f97316',
    allowCustomerUploads: true, allowCustomerMessages: true,
    showInvoiceAmounts: true, showProjectPhotos: true,
  },
  quote: {
    defaultTemplate: 'premium',
    defaultValidityDays: 30,
    defaultIntroText: `Hi {{customer_first_name}}, thank you for choosing {{company_name}}. Below is your personalized proposal for {{fence_style}}. Please review the details and let us know if you have any questions.`,
    footerText: 'Thank you for considering {{company_name}} for your project.',
    showPricePerFoot: true,
    showLineItemBreakdown: true,
  },
  notifications: {
    notifyRepOnQuoteView: true,
    notifyRepOnQuoteAccept: true,
    notifyCustomerOnSchedule: true,
    notifyCustomerOnComplete: true,
  },
}

function load(): AllSettings {
  const cfg = getConfig() as any
  return {
    portal: { ...DEFAULTS.portal, ...(cfg.portal || {}) },
    quote: { ...DEFAULTS.quote, ...(cfg.quote || {}) },
    notifications: { ...DEFAULTS.notifications, ...(cfg.notifications || {}) },
  }
}

function save(s: AllSettings) {
  const cfg = getConfig() as any
  saveConfig({ ...cfg, portal: s.portal, quote: s.quote, notifications: s.notifications })
  try { window.dispatchEvent(new CustomEvent('fencepro:settings:updated')) } catch {}
}

export default function PortalQuoteSettings() {
  const [s, setS] = useState<AllSettings>(() => load())
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const onExt = () => setS(load())
    window.addEventListener('fencepro:settings:updated', onExt)
    return () => window.removeEventListener('fencepro:settings:updated', onExt)
  }, [])

  function update<K extends keyof AllSettings>(k: K, patch: Partial<AllSettings[K]>) {
    setS(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }))
    setDirty(true)
  }

  function handleSave() {
    save(s); setDirty(false); toast.success('Settings saved')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Portal &amp; Quote Settings</h3>
          <p className="text-sm text-gray-500 mt-0.5">Controls the customer portal experience and quote presentation defaults.</p>
        </div>
        <button onClick={handleSave} disabled={!dirty}
          className={`text-sm font-semibold px-4 py-2 rounded-lg ${dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
          {dirty ? 'Save Changes' : 'Saved'}
        </button>
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h4 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Portal Branding</h4>
        <Field label="Portal Welcome Message">
          <textarea value={s.portal.welcomeMessage} onChange={e => update('portal', { welcomeMessage: e.target.value })} rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Support Email"><input value={s.portal.supportEmail} onChange={e => update('portal', { supportEmail: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <Field label="Support Phone"><input value={s.portal.supportPhone} onChange={e => update('portal', { supportPhone: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <Field label="Accent Color"><input type="color" value={s.portal.accentColor} onChange={e => update('portal', { accentColor: e.target.value })} className="w-full h-10 border border-gray-200 rounded-lg" /></Field>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
        <h4 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Portal Permissions</h4>
        <Toggle label="Allow customers to upload documents" checked={s.portal.allowCustomerUploads} onChange={v => update('portal', { allowCustomerUploads: v })} />
        <Toggle label="Allow customers to send messages" checked={s.portal.allowCustomerMessages} onChange={v => update('portal', { allowCustomerMessages: v })} />
        <Toggle label="Show invoice amounts to customers" checked={s.portal.showInvoiceAmounts} onChange={v => update('portal', { showInvoiceAmounts: v })} />
        <Toggle label="Show project photos to customers" checked={s.portal.showProjectPhotos} onChange={v => update('portal', { showProjectPhotos: v })} />
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h4 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Quote Defaults</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Default Template">
            <select value={s.quote.defaultTemplate} onChange={e => update('quote', { defaultTemplate: e.target.value as TemplateKey })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {(Object.keys(TEMPLATES) as TemplateKey[]).map(k => (
                <option key={k} value={k}>{TEMPLATES[k].name}</option>
              ))}
            </select>
          </Field>
          <Field label="Default Validity (days)">
            <input type="number" min={1} value={s.quote.defaultValidityDays} onChange={e => update('quote', { defaultValidityDays: Number(e.target.value) || 30 })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
        </div>
        <Field label="Default Intro Text (supports merge tags like {{customer_first_name}}, {{fence_style}}, {{company_name}})">
          <textarea value={s.quote.defaultIntroText} onChange={e => update('quote', { defaultIntroText: e.target.value })} rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </Field>
        <Field label="Footer Text">
          <input value={s.quote.footerText} onChange={e => update('quote', { footerText: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </Field>
        <Toggle label="Show price per linear foot on quotes" checked={s.quote.showPricePerFoot} onChange={v => update('quote', { showPricePerFoot: v })} />
        <Toggle label="Show line item breakdown (otherwise show total only)" checked={s.quote.showLineItemBreakdown} onChange={v => update('quote', { showLineItemBreakdown: v })} />
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
        <h4 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Notifications</h4>
        <Toggle label="Notify rep when a customer views a quote" checked={s.notifications.notifyRepOnQuoteView} onChange={v => update('notifications', { notifyRepOnQuoteView: v })} />
        <Toggle label="Notify rep when a customer accepts a quote" checked={s.notifications.notifyRepOnQuoteAccept} onChange={v => update('notifications', { notifyRepOnQuoteAccept: v })} />
        <Toggle label="Notify customer when project is scheduled" checked={s.notifications.notifyCustomerOnSchedule} onChange={v => update('notifications', { notifyCustomerOnSchedule: v })} />
        <Toggle label="Notify customer when job is complete" checked={s.notifications.notifyCustomerOnComplete} onChange={v => update('notifications', { notifyCustomerOnComplete: v })} />
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>{children}</div>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 py-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-orange-500" />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}
