/**
 * The website instant quote (served at /p/quote, shown on gdfencepro.com in a
 * frame). The customer: 1 types the address (the free US Census lookup finds
 * it and shows the USGS aerial photo), 2 picks the yard shape and types one
 * number per side, the way the quote builder does, 3 picks the fence (style
 * photos from Settings), 4 sees the estimate and sends it. No sign in. The
 * price is always worked out by EZ Biz (the builder's math), never here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import SitePlan from '../SitePlan'
import FtInPad from '../FtInPad'
import { aerialUrl } from '../sitePlanGeometry'
import { layoutForShape, deriveLayout, formatFtIn, GATE_LABEL, GATE_WIDTH_IN, type YardLayout, type YardShape, type GateType } from '../yardLayout'

interface WStyle { id: string; name: string; colors: string[]; panelWidth: number; crm: Record<string, Record<string, string>>; photoUrl: string | null }
interface WMaterial { material: string; label: string; styles: WStyle[] }
interface Estimate { estimate: number; low: number; high: number; sections: number; totalFootage: number }

const API = '/p/quote/api'
const HEIGHTS = ['4ft', '5ft', '6ft', '8ft']
const SHAPES: Array<{ shape: YardShape; label: string; hint: string; path: string }> = [
  { shape: 'backyard', label: 'Backyard', hint: 'From the house, around the back', path: 'M14 30 H6 V6 H42 V30 H34' },
  { shape: 'perimeter', label: 'All the way around', hint: 'The whole yard', path: 'M6 6 H42 V30 H6 Z' },
  { shape: 'front', label: 'Front yard', hint: 'From the house to the street', path: 'M6 6 V30 H42 V6' },
  { shape: 'straight', label: 'One straight line', hint: 'A single run', path: 'M6 18 H42' },
]
const STEPS = ['Address', 'Yard', 'Fence', 'Estimate'] as const
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)))

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw new Error(j.error || 'Something went wrong. Please try again.')
  return j as T
}

const HOLD_KEY = 'commercial-industrial'
/** (352) 789-4314 for a 10 digit number, else as typed in Settings. */
const showPhone = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p }

export default function WidgetApp() {
  const [step, setStep] = useState(0)
  const [materials, setMaterials] = useState<WMaterial[]>([])
  // Commercial and industrial are not quoted here (pricing on hold): a choice that says to call.
  const [onHold, setOnHold] = useState<{ label: string; message: string; phone: string } | null>(null)
  const [loadError, setLoadError] = useState('')
  // 1 Address
  const [address, setAddress] = useState('')
  // Addresses suggested as they are typed (the county's property list on the Mac, then the Census lookup).
  const [sugg, setSugg] = useState<Array<{ formatted: string; line1: string; city: string; zip: string }>>([])
  const typedAddress = useRef(false)
  useEffect(() => {
    const q = address.trim()
    if (!typedAddress.current || q.length < 3 || !/^\d/.test(q)) { setSugg([]); return }
    const t = setTimeout(() => {
      fetch(`${API}/suggest?q=${encodeURIComponent(q)}`).then(r => r.json()).then(j => setSugg(Array.isArray(j?.data) ? j.data : [])).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [address])
  const [place, setPlace] = useState<{ lat: number; lng: number } | null>(null)
  const [placeMsg, setPlaceMsg] = useState('')
  // The USGS photo can take a while; it says so, and steps aside if it never comes.
  const [aerial, setAerial] = useState<'loading' | 'ok' | 'failed'>('loading')
  // 2 Yard
  const [yard, setYard] = useState<YardLayout | null>(null)
  const [pad, setPad] = useState<string | null>(null)
  // 3 Fence
  const [materialKey, setMaterialKey] = useState('')
  const [styleId, setStyleId] = useState('')
  const [height, setHeight] = useState('')
  const [color, setColor] = useState('')
  // 4 Estimate and send
  const [est, setEst] = useState<Estimate | null>(null)
  const [estError, setEstError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [wantsVisit, setWantsVisit] = useState(true)
  const [photos, setPhotos] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sent, setSent] = useState<number | null>(null)
  const [submissionId] = useState(newId)

  useEffect(() => {
    getJson<{ materials: WMaterial[]; onHold?: { label: string; message: string; phone: string } | null }>(`${API}/config`)
      .then(j => { setMaterials(j.materials); setOnHold(j.onHold ?? null) }).catch(e => setLoadError(String(e.message || e)))
  }, [])

  const result = useMemo(() => (yard ? deriveLayout(yard) : null), [yard])
  const material = materials.find(m => m.material === materialKey) ?? null
  const style = material?.styles.find(s => s.id === styleId) ?? null
  const heights = style ? HEIGHTS.filter(h => style.crm[h]) : []
  const fenceStyle = style && height ? (style.crm[height]?.[color] ?? Object.values(style.crm[height] ?? {})[0] ?? null) : null
  const sides = yard?.sides.filter(s => s.on) ?? []
  const yardDone = sides.length > 0 && sides.every(s => s.lengthIn > 0)
  const job = result && fenceStyle && result.runs.length > 0
    ? { fenceStyle, runs: result.runs.map(r => r.ft), corners: result.corners, ends: result.ends, walkGates: result.walkGates, dblGates: result.dblGates }
    : null

  // The estimate, from EZ Biz, whenever the yard or the fence changes.
  useEffect(() => {
    if (!job) { setEst(null); return }
    let live = true
    setEstError('')
    const t = setTimeout(() => {
      getJson<Estimate>(`${API}/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job) })
        .then(e => { if (live) setEst(e) }).catch(e => { if (live) setEstError(String(e.message || e)) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [JSON.stringify(job)])  // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing a style: its first height and color.
  useEffect(() => {
    if (!style) return
    if (!style.crm[height]) setHeight(HEIGHTS.find(h => style.crm[h]) ?? '')
    if (!style.colors.includes(color)) setColor(style.colors[0] ?? '')
  }, [styleId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function findPlace() {
    setPlaceMsg('Finding the address…')
    setAerial('loading')
    try {
      const j = await getJson<{ data: { lat: number; lng: number } | null }>(`${API}/place?address=${encodeURIComponent(address)}`)
      setPlace(j.data)
      setPlaceMsg(j.data ? '' : 'We could not find that address on the map. Check it, or carry on: we only need it to come out.')
      if (j.data) setStep(1)
    } catch (e: any) { setPlaceMsg(String(e.message || e)) }
  }

  function setSide(id: string, patch: Partial<YardLayout['sides'][number]>) {
    setYard(y => (y ? { ...y, sides: y.sides.map(s => (s.id === id ? { ...s, ...patch } : s)) } : y))
  }

  async function addPhoto(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const j = await getJson<{ url: string }>(`${API}/photo`, { method: 'POST', body: fd })
      setPhotos(p => [...p, j.url])
    } catch (e: any) { setSendError(String(e.message || e)) }
  }

  async function send() {
    if (!job || !style) return
    setSending(true); setSendError('')
    try {
      const choice = [material?.label, style.name, height, color].filter(Boolean).join(', ')
      const j = await getJson<{ estimate: number }>(`${API}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...job, submissionId, name, phone, email, address, choice, yard, wantsVisit, notes: notes || undefined, photos }),
      })
      setSent(j.estimate)
    } catch (e: any) { setSendError(String(e.message || e)) }
    finally { setSending(false) }
  }

  if (sent !== null) {
    return (
      <Shell>
        <div className="text-center py-10 space-y-3" data-w-sent>
          <p className="text-2xl font-bold text-gray-900">Thank you, {name.split(' ')[0]}!</p>
          <p className="text-gray-700">Your estimate of about <span className="font-semibold">{money(sent)}</span> is on its way to us. We will call you at {phone} to set up a free visit and confirm the price.</p>
        </div>
      </Shell>
    )
  }

  const canNext = [address.trim().length >= 6, yardDone, !!fenceStyle][step] ?? false
  return (
    <Shell>
      <ol className="flex gap-1 mb-4" data-w-steps>
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button type="button" disabled={i > step && !(i === step + 1 && canNext)} onClick={() => setStep(i)}
              className={`w-full text-center text-xs font-semibold pb-2 border-b-[3px] ${i === step ? 'border-orange-500 text-gray-900' : i < step ? 'border-orange-200 text-gray-700' : 'border-gray-200 text-gray-400'}`}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      {loadError && <p className="text-sm text-red-700 mb-3">{loadError}</p>}

      {step === 0 && (
        <section className="space-y-3" data-w-step="address">
          <h1 className="text-xl font-bold text-gray-900">Get an instant fence estimate</h1>
          <p className="text-sm text-gray-600">Where is the fence going?</p>
          <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Street address, city, ZIP" autoComplete="street-address"
            value={address} onChange={e => { typedAddress.current = true; setAddress(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter' && address.trim().length >= 6) findPlace() }} data-w-address />
          {sugg.length > 0 && (
            <ul className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden" data-w-suggestions>
              {sugg.map(s => (
                <li key={s.formatted}>
                  <button type="button" className="w-full text-left px-4 min-h-[48px] py-2" onClick={() => { typedAddress.current = false; setAddress(s.formatted); setSugg([]) }} data-w-suggestion>
                    <span className="block font-medium text-gray-900">{s.line1}</span>
                    <span className="block text-xs text-gray-500">{s.city}, FL {s.zip}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {placeMsg && <p className="text-sm text-gray-700">{placeMsg}</p>}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={address.trim().length < 6} onClick={() => (placeMsg && !place ? setStep(1) : findPlace())} data-w-next>
            {placeMsg && !place ? 'Carry on' : 'Next: your yard'}
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-3" data-w-step="yard">
          {place && aerial !== 'failed' && (
            <figure className="rounded-xl overflow-hidden border border-gray-200 relative" data-w-aerial={aerial}>
              <img src={aerialUrl(place.lat, place.lng, 60, 640)} alt="Your property from above" className="w-full h-44 object-cover bg-gray-100"
                onLoad={() => setAerial('ok')} onError={() => setAerial('failed')} />
              {aerial === 'loading' && <p className="absolute inset-x-0 top-16 text-center text-sm text-gray-600">Loading the photo of your property…</p>}
              <figcaption className="text-[11px] text-gray-500 px-2 py-1">Your property from above (USGS aerial photo). Use it to picture where the fence goes.</figcaption>
            </figure>
          )}
          {!yard ? (
            <>
              <p className="text-sm text-gray-700 font-semibold">What shape is the fence?</p>
              <div className="grid grid-cols-2 gap-2">
                {SHAPES.map(s => (
                  <button key={s.shape} type="button" onClick={() => setYard(layoutForShape(s.shape))} data-w-shape={s.shape}
                    className="rounded-xl border-2 border-gray-200 hover:border-orange-500 bg-white p-3 text-left flex flex-col gap-1">
                    <svg viewBox="0 0 48 36" className="w-12 h-9" aria-hidden="true">
                      {(s.shape === 'backyard' || s.shape === 'front') && <rect x="14" y={s.shape === 'front' ? 0 : 26} width="20" height="10" rx="1" className="fill-gray-300" />}
                      <path d={s.path} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-orange-500" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-900">{s.label}</span>
                    <span className="text-xs text-gray-600">{s.hint}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <SitePlan layout={yard} result={result ?? undefined} runSections={[]} widthFt={8} onSideTap={id => setPad(id)} />
              <p className="text-xs text-gray-600">Tap a side to type its length. A tape measure or a good guess both work.</p>
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
                {yard.sides.map(s => (
                  <div key={s.id} className="p-3 space-y-2" data-w-side={s.name}>
                    <div className="flex items-center gap-2">
                      <span className={`flex-1 font-semibold ${s.on ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{s.name}</span>
                      {s.on && (
                        <button type="button" className={`h-11 min-w-[110px] rounded-lg border-2 px-3 text-right tabular-nums font-semibold ${s.lengthIn > 0 ? 'border-gray-300' : 'border-orange-400 bg-orange-50 text-orange-700'}`}
                          onClick={() => setPad(s.id)} data-w-length>{s.lengthIn > 0 ? formatFtIn(s.lengthIn) : 'Length'}</button>
                      )}
                    </div>
                    {s.on && (
                      <div className="grid grid-cols-3 gap-1 bg-gray-100 rounded-lg p-1" data-w-gate>
                        {([null, 'walk', 'double'] as Array<GateType | null>).map(t => (
                          <button key={t ?? 'none'} type="button" onClick={() => setSide(s.id, { gate: t ? { type: t, widthIn: GATE_WIDTH_IN[t], position: 'middle' } : null })}
                            className={`h-10 rounded-md text-xs font-semibold ${(s.gate?.type ?? null) === t ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600'}`}>
                            {t ? GATE_LABEL[t] : 'No gate'}
                          </button>
                        ))}
                      </div>
                    )}
                    <button type="button" className="text-xs text-gray-600 underline" onClick={() => setSide(s.id, { on: !s.on })} data-w-side-toggle>
                      {s.on ? 'No fence on this side' : 'Put a fence on this side'}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="text-gray-600 underline" onClick={() => setYard(null)}>Change the shape</button>
                <span className="tabular-nums text-gray-700">{result ? `${formatFtIn(result.totalIn)} of fence` : ''}</span>
              </div>
            </>
          )}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={!yardDone} onClick={() => setStep(2)} data-w-next>Next: the fence</button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4" data-w-step="fence">
          <p className="text-sm font-semibold text-gray-700">Material</p>
          <div className="grid grid-cols-2 gap-2">
            {materials.map(m => (
              <button key={m.material} type="button" onClick={() => { setMaterialKey(m.material); setStyleId(m.styles[0]?.id ?? '') }} data-w-material={m.material}
                className={`rounded-xl border-2 p-3 text-left text-sm font-semibold ${materialKey === m.material ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200 text-gray-900'}`}>
                {m.label}
              </button>
            ))}
            {onHold && (
              <button type="button" onClick={() => { setMaterialKey(HOLD_KEY); setStyleId('') }} data-w-material={HOLD_KEY}
                className={`rounded-xl border-2 p-3 text-left text-sm font-semibold ${materialKey === HOLD_KEY ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200 text-gray-900'}`}>
                {onHold.label}
              </button>
            )}
          </div>
          {onHold && materialKey === HOLD_KEY && (
            <p className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-base text-gray-900" data-w-on-hold>
              {onHold.message}{onHold.phone ? <>: <a className="font-semibold text-orange-700 underline" href={`tel:${onHold.phone.replace(/[^\d+]/g, '')}`}>{showPhone(onHold.phone)}</a></> : '.'}
            </p>
          )}
          {material && (
            <>
              <p className="text-sm font-semibold text-gray-700">Style</p>
              <div className="grid grid-cols-2 gap-2">
                {material.styles.map(s => (
                  <button key={s.id} type="button" onClick={() => setStyleId(s.id)} data-w-style={s.name}
                    className={`rounded-xl border-2 overflow-hidden text-left ${styleId === s.id ? 'border-orange-500' : 'border-gray-200'}`}>
                    <div className="aspect-[4/3] bg-gray-100">
                      {s.photoUrl ? <img src={s.photoUrl} alt={s.name} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-xs text-gray-500">Photo coming soon</div>}
                    </div>
                    <p className={`p-2 text-sm font-semibold ${styleId === s.id ? 'text-orange-800' : 'text-gray-900'}`}>{s.name}</p>
                  </button>
                ))}
              </div>
            </>
          )}
          {style && (
            <>
              <p className="text-sm font-semibold text-gray-700">Height</p>
              <div className="grid grid-cols-4 gap-2">
                {HEIGHTS.map(h => (
                  <button key={h} type="button" disabled={!style.crm[h]} onClick={() => setHeight(h)} data-w-height={h}
                    className={`h-11 rounded-lg border-2 text-sm font-semibold disabled:opacity-30 ${height === h ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200'}`}>{h.replace('ft', ' ft')}</button>
                ))}
              </div>
              {style.colors.length > 1 && (
                <>
                  <p className="text-sm font-semibold text-gray-700">Color</p>
                  <div className="flex gap-2">
                    {style.colors.map(c => (
                      <button key={c} type="button" disabled={!style.crm[height]?.[c]} onClick={() => setColor(c)} data-w-color={c}
                        className={`h-11 px-4 rounded-lg border-2 text-sm font-semibold disabled:opacity-30 ${color === c ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200'}`}>{c}</button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={!fenceStyle} onClick={() => setStep(3)} data-w-next>See my estimate</button>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" data-w-step="estimate">
          <div className="rounded-2xl bg-orange-500 text-white p-5 text-center" data-w-estimate={est?.estimate ?? ''}>
            <p className="text-sm opacity-90">Your estimated price</p>
            {est ? <p className="text-3xl font-bold tabular-nums mt-1">{money(est.low)} to {money(est.high)}</p> : <p className="text-lg mt-1">{estError || 'Working it out…'}</p>}
            {est && <p className="text-xs opacity-90 mt-2">{est.totalFootage} ft of {[style?.name, height.replace('ft', ' ft'), color].filter(Boolean).join(', ').toLowerCase()}, installed. Our estimate: {money(est.estimate)}.</p>}
          </div>
          <p className="text-xs text-gray-600">An estimate from your measurements. We confirm the exact price at a free visit.</p>

          <div className="space-y-2">
            <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Your name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} data-w-name />
            <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} data-w-phone />
            <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Email (optional)" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} data-w-email />
            <textarea className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base" rows={2} placeholder="Anything we should know? (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={wantsVisit} onChange={e => setWantsVisit(e.target.checked)} /> I would like a free visit to confirm the price
            </label>
            <label className="btn btn-secondary w-full cursor-pointer" data-w-photo>
              Add photos of the yard (optional){photos.length ? ` · ${photos.length} added` : ''}
              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.target.value = '' }} />
            </label>
          </div>
          {sendError && <p className="text-sm text-red-700" role="alert">{sendError}</p>}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={sending || !est || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10} onClick={send} data-w-send>
            {sending ? 'Sending…' : 'Send me this estimate'}
          </button>
        </section>
      )}

      {step < 3 && step > 0 && <button type="button" className="mt-3 text-sm text-gray-600 underline" onClick={() => setStep(s => s - 1)}>Back</button>}

      {pad && yard && (() => {
        const s = yard.sides.find(x => x.id === pad)
        if (!s) return null
        const i = yard.sides.indexOf(s)
        const next = yard.sides.slice(i + 1).find(x => x.on)
        return (
          <FtInPad key={pad} history={false} title={`${s.name} length`} valueIn={s.lengthIn}
            nextLabel={next ? `Next: ${next.name}` : undefined}
            onClose={() => setPad(null)}
            onDone={(inches, goNext) => { setSide(s.id, { lengthIn: inches }); setPad(goNext && next ? next.id : null) }} />
        )
      })()}
    </Shell>
  )
}

/** No outer header: the widget sits inside the website's own page. */
function Shell({ children }: { children: React.ReactNode }) {
  return <main className="max-w-lg mx-auto px-4 py-4 text-gray-900">{children}</main>
}
