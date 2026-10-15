/**
 * Settings → Proposals: what the customer's proposal says beyond the quote
 * itself (what's included, deposit, financing), whether customers can open
 * proposal links yet, and a photo for each fence style.
 */

import { useEffect, useState } from 'react'
import type { AppConfig } from './configStore'
import type { ProposalSettings as PS } from './proposal'
import { monthlyPayment } from './proposal'
import { DEFAULT_TIERS, DEFAULT_POPULAR, type TierSpec } from './tiers'
import { listStylePhotos, uploadStylePhoto, deleteStylePhoto, stylePhotoUrl, type StylePhoto } from './stylePhotosApi'
import { toast } from './toast'

export default function ProposalSettings({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const p: PS = config.proposal ?? {}
  const set = (patch: Partial<PS>) => onChange({ ...config, proposal: { ...p, ...patch } })
  const fin = p.financing ?? {}
  const setFin = (patch: Partial<NonNullable<PS['financing']>>) => set({ financing: { ...fin, ...patch } })
  const [photos, setPhotos] = useState<StylePhoto[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { listStylePhotos().then(setPhotos) }, [])

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 h-11 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, parseFloat(v) || 0))
  const tiers: TierSpec[] = p.tiers?.length ? p.tiers : DEFAULT_TIERS
  const popular = p.popular ?? DEFAULT_POPULAR
  const setTier = (i: number, patch: Partial<TierSpec>) => set({ tiers: tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)) })
  const example = (fin.months ?? 0) > 0 ? monthlyPayment(10000, fin.apr ?? 0, fin.months!) : 0

  async function upload(styleName: string, file: File | undefined) {
    if (!file) return
    setBusy(styleName)
    const saved = await uploadStylePhoto(styleName, file)
    setBusy(null)
    if (!saved) { toast.error('The photo did not upload. Use a JPG, PNG or WebP under 8 MB.'); return }
    setPhotos(list => [...list.filter(x => x.styleName !== styleName), saved])
  }

  return (
    <div className="space-y-8" data-proposal-settings>
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Customer links</h3>
        <p className="text-sm text-gray-600 mb-3">
          Proposals open at a private link. Customers can only open it once the public door for proposals is on (one Tailscale command; see the notes from setup). Until then, send the PDF.
        </p>
        <label className="block text-xs text-gray-600 mb-3 max-w-xs">Links work for this many days after they are sent
          <input type="number" min={1} max={365} className={inputCls + ' mt-1'} value={p.linkDays ?? 30} onChange={e => set({ linkDays: Math.max(1, parseInt(e.target.value) || 30) })} data-link-days />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={!!p.publicLinks} onChange={e => set({ publicLinks: e.target.checked })} data-public-links />
          The public door for proposals is on: customers can open proposal links
        </label>
      </div>

      <div data-tier-settings>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Good, Better, Best</h3>
        <p className="text-sm text-gray-600 mb-3">Shown on every vinyl quote and proposal. Each tier uses whichever section width (6 or 8 ft) prices lower for the yard.</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {tiers.map((t, i) => (
            <div key={t.key} className="rounded-xl border border-gray-200 p-3 space-y-2" data-tier-setting={t.key}>
              <input className={inputCls} value={t.label} onChange={e => setTier(i, { label: e.target.value })} aria-label="Tier name" />
              <div className="grid grid-cols-3 gap-2">
                <select className={inputCls} value={t.color} onChange={e => setTier(i, { color: e.target.value as TierSpec['color'] })} aria-label="Color">
                  <option value="white">White</option><option value="tan">Tan</option>
                </select>
                <select className={inputCls} value={t.install} onChange={e => setTier(i, { install: e.target.value as TierSpec['install'] })} aria-label="Install">
                  <option value="no-dig">No dig</option><option value="dig-set">Dig set</option>
                </select>
                <select className={inputCls} value={t.heightFt} onChange={e => setTier(i, { heightFt: Number(e.target.value) as 6 | 8 })} aria-label="Height">
                  <option value={6}>6 ft tall</option><option value={8}>8 ft tall</option>
                </select>
              </div>
              <textarea rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={t.blurb} onChange={e => setTier(i, { blurb: e.target.value })} aria-label="What makes it better" />
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="popular" className="w-5 h-5 accent-orange-500" checked={popular === t.key} onChange={() => set({ popular: t.key })} /> Most popular</label>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">What's included</h3>
        <p className="text-sm text-gray-600 mb-2">Shown under the facts from each quote (footage, posts, gates, tear out). One item per line.</p>
        <textarea rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={p.included ?? ''} onChange={e => set({ included: e.target.value })}
          placeholder={'Sunshine 811 utility locates\nCleanup and haul away of job debris'} data-included />
        <p className="text-xs text-gray-500 mt-1">The warranty on proposals comes from Contract Templates → Warranty.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Deposit</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-xs text-gray-600">Deposit to schedule (% of the price; blank = not shown)
            <input type="number" min={0} max={100} step={5} className={inputCls + ' mt-1'} value={p.depositPct ?? ''} onChange={e => set({ depositPct: num(e.target.value) })} data-deposit-pct />
          </label>
          <label className="block text-xs text-gray-600">How the deposit is paid
            <input className={inputCls + ' mt-1'} value={p.depositNote ?? ''} onChange={e => set({ depositNote: e.target.value })} placeholder="Check, cash or card when we schedule" />
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Financing</h3>
        <p className="text-sm text-gray-600 mb-3">Fill in a term to show "As low as $X/month" on each option. Leave the term blank to hide it.</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <label className="block text-xs text-gray-600 sm:col-span-2">Lender or program name
            <input className={inputCls + ' mt-1'} value={fin.provider ?? ''} onChange={e => setFin({ provider: e.target.value })} />
          </label>
          <label className="block text-xs text-gray-600">APR %
            <input type="number" min={0} step={0.01} className={inputCls + ' mt-1'} value={fin.apr ?? ''} onChange={e => setFin({ apr: num(e.target.value) })} data-fin-apr />
          </label>
          <label className="block text-xs text-gray-600">Months
            <input type="number" min={0} step={1} className={inputCls + ' mt-1'} value={fin.months ?? ''} onChange={e => setFin({ months: num(e.target.value) })} data-fin-months />
          </label>
        </div>
        {example > 0 && <p className="text-sm text-gray-700 mt-2">A $10,000 fence shows as ${example.toFixed(2)}/month.</p>}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Style photos</h3>
        <p className="text-sm text-gray-600 mb-3">One photo per style, shown on each option in the proposal.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {config.fenceStyles.filter(s => s.isActive !== false).map(s => {
            const photo = photos.find(x => x.styleName === s.name)
            return (
              <div key={s.id} className="rounded-xl border border-gray-200 p-2" data-style-photo={s.name}>
                <div className="aspect-[4/3] rounded-lg bg-gray-100 overflow-hidden grid place-items-center">
                  {photo ? <img src={`${stylePhotoUrl(photo.id)}?v=${encodeURIComponent(photo.updatedAt)}`} alt={s.name} className="w-full h-full object-cover" />
                    : <span className="text-xs text-gray-500">No photo</span>}
                </div>
                <p className="text-xs font-semibold text-gray-800 mt-2 truncate" title={s.name}>{s.name}</p>
                <div className="flex gap-1 mt-1">
                  <label className="btn btn-secondary btn-sm flex-1 cursor-pointer">
                    {busy === s.name ? 'Uploading…' : photo ? 'Replace' : 'Add photo'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => upload(s.name, e.target.files?.[0])} />
                  </label>
                  {photo && <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { if (await deleteStylePhoto(photo.id)) setPhotos(l => l.filter(x => x.id !== photo.id)) }}>Remove</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
