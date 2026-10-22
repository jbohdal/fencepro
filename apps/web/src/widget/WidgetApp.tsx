/**
 * The website quote (served at /p/quote, shown on gdfencepro.com in a frame;
 * Jonathan calls it the EZ Budget). No sign in, $0 to run:
 *
 *   1 Address   the county's property list suggests it as it is typed; the
 *               aerial photo (Esri, or USGS NAIP) starts loading the moment
 *               an address is picked, and opens on the house
 *   2 Draw      tap the fence on the photo (DrawMap.tsx); lengths are true
 *               ground distance, any side can be typed; gates on a side
 *   3 Fence     material (with a picture), color, height
 *   4 Price     the quote builder's options for it (Good Better Best, Dig set
 *               / No dig), each priced for the drawn yard by EZ Biz. Settings
 *               decide whether the name and phone come before the prices
 *               (the default) or after.
 *
 * Progress is kept on the server (a draft with no name, phone or email),
 * found again by an httpOnly cookie and by ?draft= in the page address. The
 * page never prices anything and never sees a cost. ?test=1: nothing is
 * saved or sent (Jonathan's tests).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import StylePicture from './StylePicture'
import DrawMap from './DrawMap'
import { totalFt, toYardLayout, type LatLng, type WidgetDrawing } from '../widgetDraw'
import { photoBackdrop } from '../sitePlanPhoto'
import { bakePhoto } from '../aerialBake'
import { aerialConfig, prefetchAerial } from '../aerialTiles'
import { AerialCredit } from '../freeMap'
import { TEXT_CONSENT_WORDING, TEXT_CONSENT_TERMS_URL } from '../../../portal/src/server/lib/textConsentModel'

/** The end of the checkbox words, shown as the link to the terms. */
const TERMS_TEXT = 'gdfencepro.com/terms.cfm'

interface Material { material: 'vinyl' | 'chain' | 'alum' | 'wood'; label: string; photoUrl: string | null; colors: Array<{ key: string; label: string }>; heights: Array<{ key: string; height: string; kind: string; label: string; colors: string[] }> }
interface Pick { material: Material['material']; color: string; height: string; kind: string }
interface Option { key: string; name: string; text: string; popular: boolean; fenceStyle: string; styleLabel: string; price: number; perFoot: number }
interface DraftData { step: number; address: string; at: LatLng | null; atSource?: string; drawing: WidgetDrawing | null; pick: Pick | null; fenceStyle?: string | null; snap?: boolean }

const API = '/p/quote/api'
const STEPS = ['Address', 'Draw', 'Fence', 'Price'] as const
const WORDING = 'Instant estimate based on your drawing. We confirm every measurement on site before you sign.'
const PARCELS = 'https://gis.ocalafl.org/arcgis/rest/services/Public/Parcels/FeatureServer/0/query'
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
// Prices are whole dollars (the quote builder rounds them down, Oct 21 2026): the customer never sees cents.
const params = new URLSearchParams(window.location.search)
const TEST = params.get('test') === '1'

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', ...init })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || 'Something went wrong. Please try again.'), { body: j })
  return j as T
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** (352) 789-4314 for a 10 digit number, else as typed in Settings. */
const showPhone = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p }

/** The county's lot lines around a point (free, public), or null. */
async function parcelAt(p: LatLng): Promise<LatLng[] | null> {
  const q = new URLSearchParams({ geometry: `${p.lng},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'parcel', returnGeometry: 'true', outSR: '4326', f: 'json' })
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const j = await (await fetch(`${PARCELS}?${q}`, { signal: ctl.signal })).json()
    const rings: number[][][] = j?.features?.[0]?.geometry?.rings ?? []
    const ring = rings.sort((a, b) => b.length - a.length)[0]
    return ring && ring.length >= 4 ? ring.map(([lng, lat]) => ({ lat, lng })) : null
  } catch { return null } finally { clearTimeout(t) }
}

export default function WidgetApp() {
  const [step, setStep] = useState(0)
  const [materials, setMaterials] = useState<Material[]>([])
  const [onHold, setOnHold] = useState<{ label: string; message: string; phone: string } | null>(null)
  const [priceFirst, setPriceFirst] = useState(false)
  const [loadError, setLoadError] = useState('')
  // 1 Address
  const [address, setAddress] = useState('')
  const [sugg, setSugg] = useState<Array<{ formatted: string; line1: string; city: string; zip: string; lat: number; lng: number; source?: string }>>([])
  const typedAddress = useRef(false)
  const [noSugg, setNoSugg] = useState(false)
  const [placeMsg, setPlaceMsg] = useState('')
  const [at, setAt] = useState<LatLng | null>(null)
  const [atSource, setAtSource] = useState('')
  // 2 Draw
  const [drawing, setDrawing] = useState<WidgetDrawing | null>(null)
  const [snap, setSnap] = useState(true)
  const [parcel, setParcel] = useState<LatLng[] | null>(null)
  const [stillDrawing, setStillDrawing] = useState(false)
  // 3 Fence
  const [pick, setPick] = useState<Pick | null>(null)
  const [onHoldPicked, setOnHoldPicked] = useState(false)
  // 4 Price and contact
  const [options, setOptions] = useState<Option[] | null>(null)
  const [fenceStyle, setFenceStyle] = useState<string | null>(null)
  const [priceMsg, setPriceMsg] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [website, setWebsite] = useState('')
  const [wantsVisit, setWantsVisit] = useState(true)
  const [textOk, setTextOk] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sent, setSent] = useState(false)
  // The draft
  const [draftId, setDraftId] = useState<string | null>(null)
  const [resumed, setResumed] = useState(false)
  const loaded = useRef(false)
  const snapshot = useRef<Promise<string | null> | null>(null)

  // Settings, materials, and a draft to pick up again (?draft= first, else the cookie).
  useEffect(() => {
    void aerialConfig()  // which photo source comes first, known before an address is picked
    getJson<{ materials: Material[]; onHold?: { label: string; message: string; phone: string } | null; settings?: { showPriceBeforeContact?: boolean } }>(`${API}/config`)
      .then(j => { setMaterials(j.materials); setOnHold(j.onHold ?? null); setPriceFirst(!!j.settings?.showPriceBeforeContact) })
      .catch(e => setLoadError(String(e.message || e)))
    const want = params.get('draft')
    getJson<{ data: (DraftData & { id: string; sent: boolean }) | null }>(`${API}/draft?${new URLSearchParams({ ...(want ? { id: want } : {}), ...(TEST ? { test: '1' } : {}) })}`)
      .then(({ data }) => {
        if (!data) return
        setDraftId(data.id)
        setAddress(data.address || '')
        setAt(data.at); setAtSource(data.atSource || '')
        setDrawing(data.drawing); setPick(data.pick); setFenceStyle(data.fenceStyle ?? null)
        setSnap(data.snap !== false)
        setSent(!!data.sent)
        setStep(data.sent ? 3 : Math.min(data.step, data.drawing ? 3 : data.at ? 1 : 0))
        setResumed(data.step > 0 || !!data.sent)
      })
      .catch(() => {})
      .finally(() => { loaded.current = true })
  }, [])

  // The draft id in the page address too (some phones keep no cookie inside a website's frame).
  useEffect(() => {
    if (!draftId) return
    const u = new URL(window.location.href)
    if (u.searchParams.get('draft') === draftId) return
    u.searchParams.set('draft', draftId)
    window.history.replaceState(window.history.state, '', u.toString())
  }, [draftId])

  // Saved on the server as they go (no name, phone or email in it).
  const draftData: DraftData = { step, address, at, atSource, drawing, pick, fenceStyle, snap }
  const draftKey = JSON.stringify(draftData)
  useEffect(() => {
    if (!loaded.current || TEST || !at) return
    const t = setTimeout(() => {
      getJson<{ id: string }>(`${API}/draft`, jsonInit('PUT', { id: draftId, data: draftData }))
        .then(j => { if (j.id && j.id !== draftId) setDraftId(j.id) }).catch(() => {})
    }, 700)
    return () => clearTimeout(t)
  }, [draftKey])  // eslint-disable-line react-hooks/exhaustive-deps

  // Suggestions as the address is typed (the county's property list on the Mac, then the Census lookup).
  useEffect(() => {
    const q = address.trim()
    if (!typedAddress.current || q.length < 3) { setSugg([]); setNoSugg(false); return }
    let stale = false
    const ctl = new AbortController()
    const t = setTimeout(() => {
      if (!/^\d/.test(q)) { setSugg([]); setNoSugg(true); return }
      const late = setTimeout(() => ctl.abort(), 8000)
      fetch(`${API}/suggest?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then(r => r.json())
        .then(j => Array.isArray(j?.data) ? j.data : [], () => [])
        .then(list => { if (!stale) { setSugg(list); setNoSugg(list.length === 0) } })
        .finally(() => clearTimeout(late))
    }, 250)
    return () => { stale = true; clearTimeout(t); ctl.abort() }
  }, [address])

  // The lot lines for the photo.
  useEffect(() => {
    if (!at) { setParcel(null); return }
    let live = true
    parcelAt(at).then(r => { if (live) setParcel(r) })
    return () => { live = false }
  }, [at?.lat, at?.lng])  // eslint-disable-line react-hooks/exhaustive-deps

  function goTo(p: LatLng, source: string, addr: string) {
    // The photo starts now: the soft tiles first, then the sharp ones for the drawing view.
    prefetchAerial(p.lat, p.lng, { w: Math.min(window.innerWidth, 560), h: Math.min(Math.max(window.innerHeight * 0.58, 320), 560) })
    setAt(p); setAtSource(source)
    setDrawing(d => (d && d.address === addr ? { ...d, at: p } : { v: 1, address: addr, at: p, runs: [] }))
    setPlaceMsg(''); setStep(1)
  }
  async function findPlace() {
    setPlaceMsg('Finding the address…')
    try {
      const j = await getJson<{ data: { lat: number; lng: number; source?: string } | null }>(`${API}/place?address=${encodeURIComponent(address)}`)
      if (j.data) goTo({ lat: j.data.lat, lng: j.data.lng }, j.data.source || '', address.trim())
      else setPlaceMsg('We could not find that address on the map. Pick it from the list as you type, or add the city and ZIP.')
    } catch (e: any) { setPlaceMsg(String(e.message || e)) }
  }

  const material = materials.find(m => m.material === pick?.material) ?? null
  const heightsForColor = material ? material.heights.filter(h => !material.colors.length || h.colors.includes(pick?.color ?? '')) : []
  const pickReady = !!pick && !!material && material.heights.some(h => h.height === pick.height && h.kind === pick.kind && (!material.colors.length || h.colors.includes(pick.color)))
  const runsDrawn = (drawing?.runs ?? []).filter(r => r.pts.length >= 2)
  const feet = drawing ? totalFt(drawing) : 0
  const drawn = runsDrawn.length > 0 && !stillDrawing
  const drawPayload = drawing ? { ...drawing, runs: runsDrawn } : null

  function choose(m: Material) {
    const color = m.colors[0]?.key ?? ''
    const h = m.heights.find(x => !m.colors.length || x.colors.includes(color)) ?? m.heights[0]
    setOnHoldPicked(false)
    setPick({ material: m.material, color, height: h?.height ?? '', kind: h?.kind ?? '' })
    setOptions(null)
  }

  // The drawing on the photo, for the salesman: made while the customer picks the fence.
  useEffect(() => {
    if (step < 2 || !drawPayload || TEST) return
    const yard = toYardLayout(drawPayload)
    const b = photoBackdrop(yard)
    if (!b) return
    snapshot.current = bakePhoto(b, 640).then(url => (url ? drawOnSnapshot(url, yard, b) : null)).catch(() => null)
  }, [step, JSON.stringify(drawPayload)])  // eslint-disable-line react-hooks/exhaustive-deps

  // Prices before contact (when Settings say so), or after the quote is sent.
  useEffect(() => {
    if (step !== 3 || !drawPayload || !pickReady) return
    if (!priceFirst && !sent) return
    let live = true
    setPriceMsg('')
    getJson<{ options: Option[] }>(`${API}/price`, jsonInit('POST', { drawing: drawPayload, pick, draftId, test: TEST || undefined }))
      .then(j => { if (!live) return; setOptions(j.options); if (!fenceStyle || !j.options.some(o => o.fenceStyle === fenceStyle)) setFenceStyle((j.options.find(o => o.popular) ?? j.options[0])?.fenceStyle ?? null) })
      .catch(e => { if (live && !e.body?.contactFirst) setPriceMsg(String(e.message || e)) })
    return () => { live = false }
  }, [step, priceFirst, sent, JSON.stringify(pick), JSON.stringify(drawPayload)])  // eslint-disable-line react-hooks/exhaustive-deps

  async function addPhoto(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const j = await getJson<{ url: string | null }>(`${API}/photo${TEST ? '?test=1' : ''}`, { method: 'POST', body: fd })
      if (j.url) setPhotos(p => [...p, j.url!])
    } catch (e: any) { setSendError(String(e.message || e)) }
  }

  /** Send (or, once sent, change the option picked: the same quote is updated, never a second one). */
  async function send(style: string | null = fenceStyle) {
    if (!drawPayload || !pick) return
    setSending(true); setSendError('')
    try {
      // The draft id is the quote's key; a test run makes one up (nothing is saved).
      let id = draftId
      if (!id) {
        const j = await getJson<{ id: string | null }>(`${API}/draft`, jsonInit('PUT', { id: null, data: draftData, test: TEST || undefined }))
        id = j.id ?? `test-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, '').padEnd(24, '0')
        if (j.id) setDraftId(j.id)
      }
      const snap = !sent && snapshot.current ? await Promise.race([snapshot.current, new Promise<null>(r => setTimeout(() => r(null), 4000))]) : null
      const j = await getJson<{ options: Option[]; chosen: Option; test?: boolean }>(`${API}/submit`, jsonInit('POST', {
        draftId: id, name, phone, email, address, drawing: drawPayload, pick, fenceStyle: style, wantsVisit, textConsent: textOk,
        notes: notes || undefined, photos, snapshot: snap, website, test: TEST || undefined,
      }))
      setOptions(j.options); setFenceStyle(j.chosen.fenceStyle); setSent(true)
    } catch (e: any) { setSendError(String(e.message || e)) }
    finally { setSending(false) }
  }

  const canNext = [!!at, drawn, pickReady][step] ?? false
  const contactOk = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10 && (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
  const chosen = options?.find(o => o.fenceStyle === fenceStyle) ?? null
  const showPrices = (priceFirst || sent) && !!options

  return (
    <main className="max-w-lg mx-auto px-4 py-4 text-gray-900" data-w-app>
      {TEST && <p className="mb-3 rounded-lg bg-amber-100 border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900" data-w-test-banner>Test mode: nothing is saved or sent.</p>}
      <ol className="flex gap-1 mb-4" data-w-steps>
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button type="button" disabled={i > step && !(i === step + 1 && canNext)} onClick={() => setStep(i)}
              className={`w-full min-h-[40px] text-center text-xs font-semibold pb-2 border-b-[3px] ${i === step ? 'border-orange-500 text-gray-900' : i < step ? 'border-orange-200 text-gray-700' : 'border-gray-200 text-gray-400'}`}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      {loadError && <p className="text-sm text-red-700 mb-3">{loadError}</p>}
      {resumed && step > 0 && !sent && <p className="mb-3 text-sm text-gray-700" data-w-resumed>Welcome back. Your drawing was saved; carry on where you left off.</p>}

      {step === 0 && (
        <section className="space-y-3" data-w-step="address">
          <h1 className="text-xl font-bold text-gray-900">Get an instant fence estimate</h1>
          <p className="text-sm text-gray-600">Type your address. The photo of your property opens next, and you draw the fence on it.</p>
          <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Street address, city, ZIP" autoComplete="street-address"
            value={address} onChange={e => { typedAddress.current = true; setAddress(e.target.value); setPlaceMsg('') }} onKeyDown={e => { if (e.key === 'Enter' && address.trim().length >= 6) findPlace() }} data-w-address />
          {sugg.length > 0 && (
            <ul className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden" data-w-suggestions>
              {sugg.map(s => (
                <li key={s.formatted}>
                  <button type="button" className="w-full text-left px-4 min-h-[52px] py-2" data-w-suggestion
                    onPointerDown={() => { if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) prefetchAerial(s.lat, s.lng, { w: Math.min(window.innerWidth, 560), h: Math.min(Math.max(window.innerHeight * 0.58, 320), 560) }) }}
                    onClick={() => { typedAddress.current = false; setAddress(s.formatted); setSugg([]); setNoSugg(false); if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) goTo({ lat: s.lat, lng: s.lng }, s.source || '', s.formatted) }}>
                    <span className="block font-medium text-gray-900">{s.line1}</span>
                    <span className="block text-xs text-gray-500">{s.city}, FL {s.zip}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {noSugg && sugg.length === 0 && !placeMsg && <p className="text-sm text-gray-600" role="status" data-w-address-message>No suggestions, type the full address</p>}
          {placeMsg && <p className="text-sm text-gray-700" role="status">{placeMsg}</p>}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={address.trim().length < 6} onClick={findPlace} data-w-next>Show my property</button>
        </section>
      )}

      {step === 1 && at && drawing && (
        <section className="space-y-3" data-w-step="draw">
          <DrawMap at={at} drawing={drawing} onChange={setDrawing} snap={snap} onSnap={setSnap} parcel={parcel}
            houseAt={atSource === 'county' ? at : null} onActiveChange={setStillDrawing} />
          <AerialCredit className="text-xs text-gray-500" extra="Lot lines: Marion County, shown as a guide." />
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={!drawn} onClick={() => setStep(2)} data-w-next>
            {stillDrawing ? 'Tap Done when the fence is drawn' : runsDrawn.length ? `Next: the fence (${feet.toLocaleString('en-US')} ft)` : 'Draw the fence first'}
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4" data-w-step="fence">
          <p className="text-sm font-semibold text-gray-700">Material</p>
          <div className="grid grid-cols-2 gap-2">
            {materials.map(m => (
              <button key={m.material} type="button" onClick={() => choose(m)} data-w-material={m.material}
                className={`rounded-xl border-2 overflow-hidden text-left ${pick?.material === m.material && !onHoldPicked ? 'border-orange-500' : 'border-gray-200'}`}>
                <div className="aspect-[4/3] bg-gray-100">
                  {m.photoUrl ? <img src={m.photoUrl} alt={m.label} className="w-full h-full object-cover" /> : <StylePicture material={m.material === 'alum' ? 'aluminum' : m.material} family="privacy" colors={m.colors.map(c => c.key)} />}
                </div>
                <p className={`p-2 text-sm font-semibold ${pick?.material === m.material && !onHoldPicked ? 'text-orange-800' : 'text-gray-900'}`}>{m.label}</p>
              </button>
            ))}
            {onHold && (
              <button type="button" onClick={() => { setOnHoldPicked(true); setPick(null) }} data-w-material="commercial-industrial"
                className={`rounded-xl border-2 p-3 text-left text-sm font-semibold ${onHoldPicked ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200 text-gray-900'}`}>
                {onHold.label}
              </button>
            )}
          </div>
          {onHold && onHoldPicked && (
            <p className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-base text-gray-900" data-w-on-hold>
              {onHold.message}{onHold.phone ? <>: <a className="font-semibold text-orange-700 underline" href={`tel:${onHold.phone.replace(/[^\d+]/g, '')}`}>{showPhone(onHold.phone)}</a></> : '.'}
            </p>
          )}
          {material && pick && (
            <>
              {material.colors.length > 1 && (
                <>
                  <p className="text-sm font-semibold text-gray-700">Color</p>
                  <div className="flex flex-wrap gap-2">
                    {material.colors.map(c => (
                      <button key={c.key} type="button" onClick={() => {
                        const ok = material.heights.find(h => h.height === pick.height && h.kind === pick.kind && h.colors.includes(c.key)) ?? material.heights.find(h => h.colors.includes(c.key))
                        setPick({ ...pick, color: c.key, height: ok?.height ?? pick.height, kind: ok?.kind ?? pick.kind }); setOptions(null)
                      }} data-w-color={c.key}
                        className={`min-h-[48px] px-4 rounded-lg border-2 text-sm font-semibold ${pick.color === c.key ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200'}`}>{c.label}</button>
                    ))}
                  </div>
                </>
              )}
              <p className="text-sm font-semibold text-gray-700">Height</p>
              <div className="grid grid-cols-3 gap-2">
                {heightsForColor.map(h => (
                  <button key={h.key} type="button" onClick={() => { setPick({ ...pick, height: h.height, kind: h.kind }); setOptions(null) }} data-w-height={h.key}
                    className={`min-h-[48px] rounded-lg border-2 text-sm font-semibold px-2 ${pick.height === h.height && pick.kind === h.kind ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-gray-200'}`}>{h.label}</button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={!pickReady} onClick={() => setStep(3)} data-w-next>{priceFirst ? 'See my prices' : 'Next'}</button>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" data-w-step="price">
          {sent && (
            <div className="rounded-2xl bg-green-50 border border-green-200 p-4" data-w-sent>
              <p className="text-lg font-bold text-gray-900">{name ? `Thank you, ${name.trim().split(' ')[0]}!` : 'Thank you!'}</p>
              <p className="text-sm text-gray-800">We have your drawing{chosen ? ` and your estimate of ${money(chosen.price)}` : ''}. We will call you{phone ? ` at ${phone}` : ''} to set up a free visit and confirm the price.</p>
            </div>
          )}

          {(!priceFirst || sent) && !sent && (
            <ContactForm {...{ name, setName, phone, setPhone, email, setEmail, notes, setNotes, website, setWebsite, wantsVisit, setWantsVisit, textOk, setTextOk, photos, addPhoto }}
              title="Where should we send your prices?" />
          )}

          {showPrices && (
            <div className="space-y-2" data-w-options>
              <p className="text-sm text-gray-700" data-w-wording>{WORDING}</p>
              {options!.map(o => (
                <button key={o.fenceStyle} type="button" onClick={() => { setFenceStyle(o.fenceStyle); if (sent && o.fenceStyle !== fenceStyle) void send(o.fenceStyle) }}
                  className={`w-full text-left rounded-2xl border-2 p-4 ${fenceStyle === o.fenceStyle ? 'border-orange-500 bg-orange-50' : 'border-gray-200 bg-white'}`} data-w-option={o.fenceStyle} data-w-price={o.price.toFixed(2)}>
                  <span className="flex items-center gap-2">
                    <span className="text-lg font-bold text-gray-900">{o.name}</span>
                    {o.popular && <span className="text-xs font-semibold text-white bg-orange-600 rounded-full px-2 py-0.5" data-w-popular>Most popular</span>}
                    <span className="flex-1" />
                    <span className="text-xl font-bold tabular-nums text-gray-900" data-w-price-text>{money(o.price)}</span>
                  </span>
                  <span className="flex items-center justify-between text-sm text-gray-700 mt-1">
                    <span className="min-w-0">{o.styleLabel}</span>
                    <span className="shrink-0 tabular-nums" data-w-per-foot>about {money(o.perFoot)}/ft</span>
                  </span>
                  {o.text && <span className="block text-sm text-gray-600 mt-1">{o.text}</span>}
                </button>
              ))}
            </div>
          )}
          {priceMsg && <p className="text-sm text-red-700" role="alert">{priceMsg}</p>}

          {priceFirst && !sent && (
            <ContactForm {...{ name, setName, phone, setPhone, email, setEmail, notes, setNotes, website, setWebsite, wantsVisit, setWantsVisit, textOk, setTextOk, photos, addPhoto }}
              title="Send me this estimate" />
          )}
          {!(priceFirst || sent) && <p className="text-xs text-gray-600">{WORDING} No obligation.</p>}
          {sendError && <p className="text-sm text-red-700" role="alert">{sendError}</p>}
          {!sent && (
            <button type="button" className="btn btn-primary btn-lg w-full" disabled={sending || !contactOk || !pickReady || (priceFirst && !fenceStyle)} onClick={() => send()} data-w-send>
              {sending ? 'Sending…' : priceFirst ? 'Send me this estimate' : 'Show my prices'}
            </button>
          )}
          {sent && sending && <p className="text-sm text-gray-600">Saving your choice…</p>}
        </section>
      )}

      {step > 0 && step < 3 && <button type="button" className="mt-3 text-sm text-gray-600 underline min-h-[44px]" onClick={() => setStep(s => s - 1)} data-w-back>Back</button>}
      {step === 3 && !sent && <button type="button" className="mt-3 text-sm text-gray-600 underline min-h-[44px]" onClick={() => setStep(2)} data-w-back>Back</button>}
    </main>
  )
}

function ContactForm(p: {
  title: string; name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void; email: string; setEmail: (v: string) => void
  notes: string; setNotes: (v: string) => void; website: string; setWebsite: (v: string) => void; wantsVisit: boolean; setWantsVisit: (v: boolean) => void
  textOk: boolean; setTextOk: (v: boolean) => void
  photos: string[]; addPhoto: (f: File) => void
}) {
  return (
    <div className="space-y-2" data-w-contact>
      <p className="text-base font-semibold text-gray-900">{p.title}</p>
      <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Your name" autoComplete="name" value={p.name} onChange={e => p.setName(e.target.value)} data-w-name />
      <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Phone" type="tel" autoComplete="tel" value={p.phone} onChange={e => p.setPhone(e.target.value)} data-w-phone />
      <input className="w-full border border-gray-300 rounded-xl px-4 h-12 text-base" placeholder="Email" type="email" autoComplete="email" value={p.email} onChange={e => p.setEmail(e.target.value)} data-w-email />
      {/* Left empty by people (hidden); form robots fill it in. */}
      <input className="absolute -left-[9999px] w-px h-px opacity-0" tabIndex={-1} autoComplete="off" aria-hidden="true" value={p.website} onChange={e => p.setWebsite(e.target.value)} name="website" />
      <textarea className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base" rows={2} placeholder="Anything we should know? (optional)" value={p.notes} onChange={e => p.setNotes(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-gray-800 min-h-[44px]">
        <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={p.wantsVisit} onChange={e => p.setWantsVisit(e.target.checked)} /> I would like a free visit to confirm the price
      </label>
      {/* Texting consent: unchecked unless the customer checks it; the words are stored with a yes. */}
      <label className="flex items-start gap-2 text-sm text-gray-800 min-h-[44px] py-1" data-w-text-consent>
        <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0 accent-orange-500" checked={p.textOk} onChange={e => p.setTextOk(e.target.checked)} data-w-text-consent-box />
        <span>{TEXT_CONSENT_WORDING.slice(0, TEXT_CONSENT_WORDING.indexOf(TERMS_TEXT))}<a href={TEXT_CONSENT_TERMS_URL} target="_blank" rel="noopener noreferrer" className="underline text-orange-700" data-w-terms>{TERMS_TEXT}</a></span>
      </label>
      <label className="btn btn-secondary w-full cursor-pointer" data-w-photo>
        Add photos of the yard (optional){p.photos.length ? ` · ${p.photos.length} added` : ''}
        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) p.addPhoto(f); e.target.value = '' }} />
      </label>
    </div>
  )
}

/** The fence drawn over the baked photo, as the customer drew it (for the salesman). */
async function drawOnSnapshot(photoUrl: string, yard: ReturnType<typeof toYardLayout>, b: NonNullable<ReturnType<typeof photoBackdrop>>): Promise<string | null> {
  const img = new Image()
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('photo')); img.src = photoUrl })
  const out = img.width
  const c = document.createElement('canvas')
  c.width = out; c.height = out
  const g = c.getContext('2d')
  if (!g) return null
  g.drawImage(img, 0, 0)
  const k = out / b.sizePx
  const pts = yard.plan?.points ?? []
  const shift = b.shiftFt ?? { x: 0, y: 0 }
  const P = (i: number) => [(b.sizePx / 2 + (pts[i].x + shift.x) / b.ftPerPx) * k, (b.sizePx / 2 - (pts[i].y + shift.y) / b.ftPerPx) * k] as const
  g.lineCap = 'round'
  yard.sides.forEach((s, i) => {
    if (!s.on || !pts[i] || !pts[(i + 1) % pts.length]) return
    const [x0, y0] = P(i), [x1, y1] = P((i + 1) % pts.length)
    g.strokeStyle = 'rgba(17,24,39,0.6)'; g.lineWidth = 7; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
    g.strokeStyle = '#f97316'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
    if (s.gate && s.lengthIn > 0) {
      const a = (s.gate.distanceIn ?? 0) / s.lengthIn, z = a + s.gate.widthIn / s.lengthIn
      g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.beginPath(); g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a); g.lineTo(x0 + (x1 - x0) * z, y0 + (y1 - y0) * z); g.stroke()
    }
    g.fillStyle = '#111827'; g.font = 'bold 15px sans-serif'
    const label = `${Math.round(s.lengthIn / 12)} ft`
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, w = g.measureText(label).width + 10
    g.fillRect(mx - w / 2, my - 10, w, 20); g.fillStyle = '#ffffff'; g.fillText(label, mx - w / 2 + 5, my + 5)
  })
  return c.toDataURL('image/jpeg', 0.82)
}
