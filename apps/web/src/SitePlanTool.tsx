import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { loadMaps, loadPlaces, loadMarker } from './mapsLoader'
import { distanceFeet } from './geoUtils'
import type { LatLng } from './geoUtils'
import { toast } from './toast'
import { getCustomers } from './customerStore'

interface CustomerLite { id: string; firstName: string; lastName: string; phone?: string }
function loadCustomers(): CustomerLite[] {
  return getCustomers().map(c => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone }))
}

interface CustomerFileLite {
  id: string
  customerId: string
  name: string
  type: string
  size: string
  url?: string
  siteplanId?: string
  uploadedAt: string
  uploadedBy?: string
}

function linkSitePlanToCustomerFiles(plan: SitePlan) {
  if (!plan.customerId) return
  try {
    const raw = localStorage.getItem('fencepro_files')
    const files: CustomerFileLite[] = raw ? JSON.parse(raw) : []
    const existingIdx = files.findIndex(f => f.siteplanId === plan.id)
    const entry: CustomerFileLite = {
      id: existingIdx >= 0 ? files[existingIdx].id : Math.random().toString(36).slice(2, 10),
      customerId: plan.customerId,
      name: plan.name || 'Site Plan',
      type: 'Site Plan',
      size: `${plan.lines.length} lines · ${plan.markers.length} markers`,
      siteplanId: plan.id,
      uploadedAt: new Date().toISOString().slice(0, 10),
      uploadedBy: 'site plan tool',
    }
    if (existingIdx >= 0) files[existingIdx] = entry
    else files.unshift(entry)
    localStorage.setItem('fencepro_files', JSON.stringify(files))
  } catch { /* noop */ }
}

/* ───────── types ───────── */

type DrawMode = 'fence' | 'gate_walk' | 'gate_double' | 'property' | 'utility' | 'tearout' | 'text' | 'arrow' | 'select'

interface DrawnLine {
  id: string
  type: 'fence' | 'property' | 'utility' | 'tearout'
  points: LatLng[]
  label?: string
  color?: string        // overrides default LINE_COLORS for this line
  utilityKind?: string  // for utility lines: 'electric' | 'gas' | 'water' | 'sewer' | 'telecom' | 'irrigation' | 'custom'
}

interface DrawnMarker {
  id: string
  type: 'gate_walk' | 'gate_double' | 'text' | 'arrow' | 'access' | 'post_end' | 'post_corner'
  position: LatLng
  label: string
  rotation?: number
  color?: string        // overrides default marker color
}

interface SitePlan {
  id: string
  name: string
  address: string
  coordinates: LatLng
  lines: DrawnLine[]
  markers: DrawnMarker[]
  notes: string
  createdAt: string
  updatedAt: string
  quoteId?: string
  customerId?: string
  customerName?: string
}

const STORAGE_KEY = 'fencepro_siteplans'
const uid = () => Math.random().toString(36).slice(2, 9)

const MODE_CONFIG: Record<DrawMode, { label: string; icon: string; color: string; hint: string }> = {
  select:      { label: 'Select',       icon: '👆', color: '',         hint: 'Click elements to select/drag' },
  fence:       { label: 'Fence Line',   icon: '🏗',  color: '#f97316', hint: 'Click to place fence points. Double-click to finish.' },
  gate_walk:   { label: 'Walk Gate',    icon: '🚪', color: '#16a34a', hint: 'Click to place a walk gate marker' },
  gate_double: { label: 'Double Gate',  icon: '🚗', color: '#2563eb', hint: 'Click to place a double gate marker' },
  property:    { label: 'Property Line',icon: '📐', color: '#6366f1', hint: 'Click to draw property boundary. Double-click to finish.' },
  utility:     { label: 'Utility Line', icon: '⚡', color: '#dc2626', hint: 'Click to mark utility lines. Double-click to finish.' },
  tearout:     { label: 'Tear Out Zone',icon: '🔨', color: '#9333ea', hint: 'Click to outline tear-out area. Double-click to finish.' },
  text:        { label: 'Text Label',   icon: '📝', color: '#374151', hint: 'Click to place a text label' },
  arrow:       { label: 'Arrow / Note', icon: '➡',  color: '#374151', hint: 'Click to place a directional arrow' },
}

const LINE_COLORS: Record<string, { stroke: string; dash?: number[] }> = {
  fence:    { stroke: '#f97316' },
  property: { stroke: '#6366f1', dash: [10, 6] },
  utility:  { stroke: '#dc2626', dash: [6, 4] },
  tearout:  { stroke: '#9333ea', dash: [4, 4] },
}

// Preset colors for the global palette
const PALETTE_COLORS: { name: string; value: string }[] = [
  { name: 'Black',  value: '#111827' },
  { name: 'White',  value: '#ffffff' },
  { name: 'Red',    value: '#dc2626' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green',  value: '#16a34a' },
  { name: 'Blue',   value: '#2563eb' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Brown',  value: '#78350f' },
  { name: 'Gray',   value: '#6b7280' },
]

// Utility kinds + their default colors
const UTILITY_KINDS: { kind: string; label: string; color: string }[] = [
  { kind: 'electric',   label: 'Electric',         color: '#dc2626' },
  { kind: 'gas',        label: 'Gas',              color: '#eab308' },
  { kind: 'water',      label: 'Water',            color: '#2563eb' },
  { kind: 'sewer',      label: 'Sewer',            color: '#16a34a' },
  { kind: 'telecom',    label: 'Telecommunications', color: '#f97316' },
  { kind: 'irrigation', label: 'Irrigation',       color: '#9333ea' },
  { kind: 'custom',     label: 'Other',            color: '#ffffff' },
]

/* ───────── persistence ───────── */

function loadPlans(): SitePlan[] {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function savePlans(plans: SitePlan[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(plans)) }

/* ───────── Address Search (reused) ───────── */

function AddressInput({ onSelect }: { onSelect: (addr: string, loc: LatLng) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function init() {
      if (!ref.current) return
      await loadPlaces()
      const ac = new google.maps.places.Autocomplete(ref.current, {
        types: ['address'], componentRestrictions: { country: 'us' }, fields: ['formatted_address', 'geometry'],
      })
      ac.addListener('place_changed', () => {
        const p = ac.getPlace()
        if (p.geometry?.location) onSelect(p.formatted_address || '', { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() })
      })
      setReady(true)
    }
    init()
  }, [onSelect])

  return (
    <input ref={ref} type="text" placeholder={ready ? 'Search property address...' : 'Loading...'}
      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
  )
}

/* ═══════════════════════════════════════════════
   SITE PLAN TOOL
   ═══════════════════════════════════════════════ */

export default function SitePlanTool({ onClose }: { onClose: () => void }) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)

  const [mode, setMode] = useState<DrawMode>('fence')
  const [address, setAddress] = useState('')
  const [center, setCenter] = useState<LatLng>({ lat: 29.1872, lng: -82.1401 })
  const [isLoaded, setIsLoaded] = useState(false)

  // Drawing state
  const [lines, setLines] = useState<DrawnLine[]>([])
  const [markers, setMarkers] = useState<DrawnMarker[]>([])
  const [activePoints, setActivePoints] = useState<LatLng[]>([]) // current line being drawn
  const [planName, setPlanName] = useState('Untitled Site Plan')
  const [notes, setNotes] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showPlanList, setShowPlanList] = useState(false)
  const [savedPlans, setSavedPlans] = useState<SitePlan[]>(loadPlans)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const customers = useMemo(() => loadCustomers(), [showSaveModal])
  // Global color palette
  const [paletteColor, setPaletteColor] = useState<string>('')  // '' = use mode default
  // Utility kind (applies only while drawing utility lines)
  const [utilityKind, setUtilityKind] = useState<string>('electric')
  // Element selection + edit popover
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [showEditPopover, setShowEditPopover] = useState(false)

  // Google Maps objects for rendering
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const gmMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const activePolyRef = useRef<google.maps.Polyline | null>(null)
  const activePtsRef = useRef<LatLng[]>([])

  const modeRef = useRef(mode)
  modeRef.current = mode

  // ── Initialize map ──
  useEffect(() => {
    async function init() {
      if (!mapDivRef.current) return
      const { Map } = await loadMaps()
      await loadMarker()

      const map = new Map(mapDivRef.current, {
        center,
        zoom: 19,
        mapTypeId: 'satellite',
        tilt: 0,
        mapId: 'site-plan-tool',
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      })
      mapRef.current = map

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return
        const pt: LatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() }
        handleMapClick(pt)
      })

      map.addListener('dblclick', () => {
        finishActiveLine()
      })

      setIsLoaded(true)
    }
    init()
  }, [])

  // Re-center
  useEffect(() => {
    if (mapRef.current && center.lat !== 0) {
      mapRef.current.panTo(center)
      mapRef.current.setZoom(19)
    }
  }, [center])

  // ── Map click handler ──
  function handleMapClick(pt: LatLng) {
    const m = modeRef.current

    // Line-drawing modes
    if (m === 'fence' || m === 'property' || m === 'utility' || m === 'tearout') {
      activePtsRef.current = [...activePtsRef.current, pt]
      setActivePoints([...activePtsRef.current])
      renderActiveLine()
      return
    }

    // Marker-placement modes
    if (m === 'gate_walk' || m === 'gate_double') {
      const marker: DrawnMarker = {
        id: uid(), type: m, position: pt,
        label: m === 'gate_walk' ? 'Walk Gate' : 'Double Gate',
        color: paletteColor || undefined,
      }
      setMarkers(prev => [...prev, marker])
      renderAllObjects([...lines], [...markers, marker])
      return
    }

    if (m === 'text') {
      const text = prompt('Enter label text:')
      if (!text) return
      const marker: DrawnMarker = { id: uid(), type: 'text', position: pt, label: text, color: paletteColor || undefined }
      setMarkers(prev => [...prev, marker])
      renderAllObjects([...lines], [...markers, marker])
      return
    }

    if (m === 'arrow') {
      const text = prompt('Enter note for arrow:') || ''
      const marker: DrawnMarker = { id: uid(), type: 'arrow', position: pt, label: text || 'Access', color: paletteColor || undefined }
      setMarkers(prev => [...prev, marker])
      renderAllObjects([...lines], [...markers, marker])
      return
    }
  }

  // ── Finish current line ──
  function finishActiveLine() {
    const pts = activePtsRef.current
    if (pts.length < 2) { activePtsRef.current = []; setActivePoints([]); return }

    const m = modeRef.current
    const lineType = (m === 'fence' || m === 'property' || m === 'utility' || m === 'tearout') ? m : 'fence'

    // Calculate total length for label
    let totalFt = 0
    for (let i = 0; i < pts.length - 1; i++) totalFt += distanceFeet(pts[i], pts[i + 1])

    // Resolve color: for utility lines prefer utilityKind color unless user
    // has an explicit palette color override; otherwise use palette or mode default.
    let resolvedColor: string | undefined = paletteColor || undefined
    let resolvedKind: string | undefined
    if (lineType === 'utility') {
      resolvedKind = utilityKind
      if (!resolvedColor) {
        const kd = UTILITY_KINDS.find(k => k.kind === utilityKind)
        if (kd) resolvedColor = kd.color
      }
    }

    const newLine: DrawnLine = {
      id: uid(),
      type: lineType,
      points: [...pts],
      label: `${totalFt.toFixed(1)} ft`,
      color: resolvedColor,
      utilityKind: resolvedKind,
    }

    const updatedLines = [...lines, newLine]
    setLines(updatedLines)
    activePtsRef.current = []
    setActivePoints([])
    if (activePolyRef.current) { activePolyRef.current.setMap(null); activePolyRef.current = null }
    renderAllObjects(updatedLines, markers)
  }

  // ── Render the in-progress line ──
  function renderActiveLine() {
    if (!mapRef.current) return
    const pts = activePtsRef.current
    const m = modeRef.current
    const cfg = LINE_COLORS[m] || LINE_COLORS.fence

    if (activePolyRef.current) activePolyRef.current.setMap(null)
    if (pts.length < 2) return

    activePolyRef.current = new google.maps.Polyline({
      map: mapRef.current,
      path: pts,
      strokeColor: cfg.stroke,
      strokeWeight: 3,
      strokeOpacity: 0.7,
      ...(cfg.dash ? { icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }] } : {}),
    })
  }

  // ── Render all saved lines + markers ──
  const renderAllObjects = useCallback((allLines: DrawnLine[], allMarkers: DrawnMarker[]) => {
    if (!mapRef.current) return
    const map = mapRef.current

    // Clear previous
    polylinesRef.current.forEach(p => p.setMap(null))
    polylinesRef.current = []
    gmMarkersRef.current.forEach(m => { m.map = null })
    gmMarkersRef.current = []

    // Draw lines
    for (const line of allLines) {
      const cfg = LINE_COLORS[line.type] || LINE_COLORS.fence
      const stroke = line.color || cfg.stroke

      const polyline = new google.maps.Polyline({
        map,
        path: line.points,
        strokeColor: stroke,
        strokeWeight: line.type === 'fence' ? 4 : 3,
        strokeOpacity: 0.9,
      })

      // Apply dash pattern via strokePattern for non-fence lines
      if (cfg.dash) {
        polyline.setOptions({
          strokeOpacity: 0,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: stroke, scale: 3 }, offset: '0', repeat: `${cfg.dash[0] + cfg.dash[1]}px` }],
        })
      }

      // Click handler to select this element
      polyline.addListener('click', () => {
        setSelectedLineId(line.id)
        setSelectedMarkerId(null)
        setShowEditPopover(true)
      })

      polylinesRef.current.push(polyline)

      // Measurement labels for fence lines
      if (line.type === 'fence') {
        for (let i = 0; i < line.points.length - 1; i++) {
          const a = line.points[i], b = line.points[i + 1]
          const ft = distanceFeet(a, b)
          const el = document.createElement('div')
          el.style.cssText = `background:${stroke};color:white;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.3);`
          el.textContent = `${ft.toFixed(1)} ft`
          const lm = new google.maps.marker.AdvancedMarkerElement({
            map, position: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, content: el,
          })
          gmMarkersRef.current.push(lm)
        }
      }

      // Line type label at first segment midpoint
      if (line.type !== 'fence' && line.points.length >= 2) {
        const a = line.points[0], b = line.points[1]
        const el = document.createElement('div')
        el.style.cssText = `background:${stroke};color:white;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.3);`
        const kindLabel = line.utilityKind ? UTILITY_KINDS.find(k => k.kind === line.utilityKind)?.label : undefined
        el.textContent = kindLabel || MODE_CONFIG[line.type]?.label || line.type
        const lm = new google.maps.marker.AdvancedMarkerElement({
          map, position: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, content: el,
        })
        gmMarkersRef.current.push(lm)
      }
    }

    // Draw markers
    for (const mk of allMarkers) {
      const el = document.createElement('div')
      el.style.cursor = 'pointer'

      if (mk.type === 'gate_walk' || mk.type === 'gate_double') {
        const bg = mk.color || (mk.type === 'gate_walk' ? '#16a34a' : '#2563eb')
        el.style.cssText = `background:${bg};color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3);border:2px solid white;cursor:pointer;`
        el.textContent = mk.type === 'gate_walk' ? '🚪 Walk Gate' : '🚗 Dbl Gate'
      } else if (mk.type === 'text') {
        const bg = mk.color || 'white'
        const fg = bg === 'white' || /^#(fff|ffffff|eee|eeeeee)$/i.test(bg) ? '#111' : 'white'
        el.style.cssText = `background:${bg};color:${fg};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.2);border:1px solid #ddd;white-space:nowrap;cursor:pointer;`
        el.textContent = mk.label
      } else if (mk.type === 'arrow') {
        const bg = mk.color || '#374151'
        el.style.cssText = `background:${bg};color:white;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.3);white-space:nowrap;cursor:pointer;`
        el.textContent = `➡ ${mk.label}`
      }

      const gm = new google.maps.marker.AdvancedMarkerElement({
        map, position: mk.position, content: el,
      })
      gm.addListener('click', () => {
        setSelectedMarkerId(mk.id)
        setSelectedLineId(null)
        setShowEditPopover(true)
      })
      gmMarkersRef.current.push(gm)
    }
  }, [])

  // Re-render when lines/markers change
  useEffect(() => {
    renderAllObjects(lines, markers)
  }, [lines, markers, renderAllObjects])

  // ── Undo ──
  function handleUndo() {
    if (activePtsRef.current.length > 0) {
      activePtsRef.current = activePtsRef.current.slice(0, -1)
      setActivePoints([...activePtsRef.current])
      renderActiveLine()
      return
    }
    // Remove last drawn object (line or marker)
    if (markers.length > 0 && (lines.length === 0 || markers[markers.length - 1].id > lines[lines.length - 1].id)) {
      setMarkers(prev => prev.slice(0, -1))
    } else if (lines.length > 0) {
      setLines(prev => prev.slice(0, -1))
    }
  }

  // ── Clear all ──
  function handleClearAll() {
    if (!confirm('Clear the entire site plan?')) return
    setLines([])
    setMarkers([])
    activePtsRef.current = []
    setActivePoints([])
    if (activePolyRef.current) { activePolyRef.current.setMap(null); activePolyRef.current = null }
    polylinesRef.current.forEach(p => p.setMap(null))
    polylinesRef.current = []
    gmMarkersRef.current.forEach(m => { m.map = null })
    gmMarkersRef.current = []
  }

  // ── Save plan ──
  function handleSave() {
    try {
      const customer = customers.find(c => c.id === selectedCustomerId)
      const customerName = customer ? `${customer.firstName} ${customer.lastName}`.trim() : undefined
      const existingPlan = editingPlanId ? savedPlans.find(p => p.id === editingPlanId) : null

      const plan: SitePlan = {
        id: existingPlan?.id || uid(),
        name: planName,
        address,
        coordinates: center,
        lines,
        markers,
        notes,
        createdAt: existingPlan?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        customerId: selectedCustomerId || existingPlan?.customerId,
        customerName: customerName || existingPlan?.customerName,
      }
      const updated = existingPlan
        ? savedPlans.map(p => p.id === plan.id ? plan : p)
        : [...savedPlans, plan]
      savePlans(updated)
      setSavedPlans(updated)
      setEditingPlanId(plan.id)
      linkSitePlanToCustomerFiles(plan)
      setShowSaveModal(false)
      toast.success('Site plan saved', plan.customerId ? 'Also linked to customer Files tab.' : 'Tip: link to a customer to show on their Files tab.')
    } catch (err: any) {
      toast.error('Could not save site plan', err?.message || 'Unknown error.')
    }
  }

  // ── Load plan ──
  function loadPlan(plan: SitePlan) {
    setAddress(plan.address)
    setCenter(plan.coordinates)
    setLines(plan.lines)
    setMarkers(plan.markers)
    setPlanName(plan.name)
    setNotes(plan.notes)
    setSelectedCustomerId(plan.customerId || '')
    setEditingPlanId(plan.id)
    setShowPlanList(false)
    activePtsRef.current = []
    setActivePoints([])
  }

  // ── Delete plan ──
  function deletePlan(id: string) {
    const updated = savedPlans.filter(p => p.id !== id)
    savePlans(updated)
    setSavedPlans(updated)
  }

  // ── Print / PDF ──
  function handlePrint() {
    // Capture current map bounds and generate a printable view
    const printWin = window.open('', '_blank')
    if (!printWin) return

    const linesSummary = lines.filter(l => l.type === 'fence').map((l, i) => {
      let total = 0
      for (let j = 0; j < l.points.length - 1; j++) total += distanceFeet(l.points[j], l.points[j + 1])
      return `<tr><td style="padding:4px 8px;">Fence Line ${i + 1}</td><td style="padding:4px 8px;text-align:right;font-weight:700;">${total.toFixed(1)} ft</td></tr>`
    }).join('')

    const gatesSummary = markers.filter(m => m.type === 'gate_walk' || m.type === 'gate_double').map(m =>
      `<tr><td style="padding:4px 8px;">${m.type === 'gate_walk' ? 'Walk Gate' : 'Double Gate'}</td><td style="padding:4px 8px;">${m.label}</td></tr>`
    ).join('')

    const totalFence = lines.filter(l => l.type === 'fence').reduce((sum, l) => {
      for (let j = 0; j < l.points.length - 1; j++) sum += distanceFeet(l.points[j], l.points[j + 1])
      return sum
    }, 0)

    const html = `<!DOCTYPE html><html><head><title>Site Plan — ${planName}</title>
<style>
@page{size:letter;margin:0.5in}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#111}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #f97316;padding-bottom:12px;margin-bottom:16px}
.title{font-size:20px;font-weight:800}
.meta{font-size:10px;color:#666}
table{width:100%;border-collapse:collapse;margin:8px 0}
th{background:#111;color:#fff;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase}
td{border-bottom:1px solid #eee;font-size:11px}
.notes{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin-top:12px;font-size:11px}
.legend{display:flex;gap:16px;margin:12px 0}
.legend-item{display:flex;align-items:center;gap:4px;font-size:10px}
.swatch{width:16px;height:3px;border-radius:2px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="header">
  <div><div class="title">${planName}</div><div class="meta">${address || 'No address'}<br>${new Date().toLocaleDateString()}</div></div>
  <div style="text-align:right"><div style="font-size:10px;color:#999">SITE PLAN</div></div>
</div>
<p style="font-size:11px;color:#666;margin-bottom:8px">Print this page or save as PDF for field reference. Map screenshot not included — refer to the app for satellite view.</p>
<div class="legend">
  <div class="legend-item"><div class="swatch" style="background:#f97316"></div> Fence Line</div>
  <div class="legend-item"><div class="swatch" style="background:#6366f1;border-style:dashed"></div> Property</div>
  <div class="legend-item"><div class="swatch" style="background:#dc2626"></div> Utility</div>
  <div class="legend-item"><div class="swatch" style="background:#9333ea"></div> Tear Out</div>
</div>
${linesSummary ? `<table><thead><tr><th>Fence Runs</th><th style="text-align:right">Length</th></tr></thead><tbody>${linesSummary}
<tr style="font-weight:800;border-top:2px solid #111"><td style="padding:6px 8px">Total Fence</td><td style="padding:6px 8px;text-align:right">${totalFence.toFixed(1)} ft</td></tr>
</tbody></table>` : ''}
${gatesSummary ? `<table><thead><tr><th>Gates</th><th>Type</th></tr></thead><tbody>${gatesSummary}</tbody></table>` : ''}
${markers.filter(m => m.type === 'text').length > 0 ? `<table><thead><tr><th colspan="2">Annotations</th></tr></thead><tbody>${markers.filter(m => m.type === 'text' || m.type === 'arrow').map(m => `<tr><td style="padding:4px 8px">${m.type === 'arrow' ? '➡' : '📝'} ${m.label}</td></tr>`).join('')}</tbody></table>` : ''}
${notes ? `<div class="notes"><strong>Notes:</strong><br>${notes.replace(/\n/g, '<br>')}</div>` : ''}
</body></html>`

    printWin.document.write(html)
    printWin.document.close()
    setTimeout(() => printWin.print(), 300)
  }

  // ── Fence stats ──
  const fenceLines = lines.filter(l => l.type === 'fence')
  const totalFenceFt = fenceLines.reduce((sum, l) => {
    for (let j = 0; j < l.points.length - 1; j++) sum += distanceFeet(l.points[j], l.points[j + 1])
    return sum
  }, 0)
  const walkGates = markers.filter(m => m.type === 'gate_walk').length
  const dblGates = markers.filter(m => m.type === 'gate_double').length

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/80 flex flex-col">
      {/* ── Top bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Site Plan</h2>
          <div className="w-56">
            <AddressInput onSelect={(addr, loc) => { setAddress(addr); setCenter(loc) }} />
          </div>
          {address && <span className="text-xs text-gray-400 truncate max-w-64">{address}</span>}
        </div>
        <div className="flex items-center gap-2">
          {totalFenceFt > 0 && (
            <span className="text-xs text-gray-500">
              {totalFenceFt.toFixed(0)} ft · {fenceLines.length} lines · {walkGates} WG · {dblGates} DG
            </span>
          )}
          <button onClick={() => setShowPlanList(true)} className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">Open</button>
          <button onClick={() => setShowSaveModal(true)} className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">Save</button>
          <button onClick={handlePrint} className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800">Print / PDF</button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ── Toolbox sidebar ── */}
        <div className="w-48 bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Drawing Tools</p>
            <div className="space-y-1">
              {(Object.entries(MODE_CONFIG) as [DrawMode, typeof MODE_CONFIG[DrawMode]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { if (activePoints.length > 0) finishActiveLine(); setMode(key as DrawMode) }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    mode === key ? 'bg-orange-500 text-white font-semibold' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span>{cfg.icon}</span>
                  <span>{cfg.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color palette */}
          <div className="p-3 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Color</p>
            <div className="grid grid-cols-5 gap-1.5">
              <button onClick={() => setPaletteColor('')}
                className={`h-7 rounded-lg border-2 transition-all flex items-center justify-center text-[10px] font-bold ${paletteColor === '' ? 'border-orange-500 ring-2 ring-orange-200' : 'border-gray-200'}`}
                title="Use tool default color">
                <span className="text-gray-400">auto</span>
              </button>
              {PALETTE_COLORS.map(c => (
                <button key={c.value} onClick={() => setPaletteColor(c.value)}
                  title={c.name}
                  style={{ backgroundColor: c.value }}
                  className={`h-7 rounded-lg border-2 transition-all ${paletteColor === c.value ? 'border-orange-500 ring-2 ring-orange-200' : c.value === '#ffffff' ? 'border-gray-300' : 'border-white'}`} />
              ))}
              <label className="h-7 rounded-lg border-2 border-gray-200 flex items-center justify-center cursor-pointer relative overflow-hidden bg-gradient-to-br from-pink-400 via-yellow-400 to-blue-500">
                <input type="color" value={paletteColor || '#000000'}
                  onChange={e => setPaletteColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>
            {mode === 'utility' && (
              <div className="mt-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Utility Type</p>
                <div className="grid grid-cols-2 gap-1">
                  {UTILITY_KINDS.map(k => (
                    <button key={k.kind} onClick={() => { setUtilityKind(k.kind); setPaletteColor('') }}
                      title={k.label}
                      className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[10px] transition-colors ${utilityKind === k.kind ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                      <span className="w-2.5 h-2.5 rounded-full border border-white/50" style={{ backgroundColor: k.color }} />
                      <span className="truncate">{k.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-3 border-b border-gray-100 space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Actions</p>
            <button onClick={() => finishActiveLine()} disabled={activePoints.length < 2}
              className="w-full text-xs text-left px-2.5 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30">
              ✓ Finish Line
            </button>
            <button onClick={handleUndo} className="w-full text-xs text-left px-2.5 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100">
              ↩ Undo
            </button>
            <button onClick={handleClearAll} className="w-full text-xs text-left px-2.5 py-1.5 rounded-lg text-red-500 hover:bg-red-50">
              ✕ Clear All
            </button>
          </div>

          {/* Notes */}
          <div className="p-3 flex-1 flex flex-col">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Notes</p>
            <textarea
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-orange-400"
              placeholder="Job notes, special instructions..."
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* ── Map canvas ── */}
        <div className="flex-1 relative">
          <div ref={mapDivRef} className="w-full h-full" />

          {/* Mode hint */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur rounded-lg px-4 py-2 shadow-lg">
            <p className="text-xs text-gray-600">
              <span className="font-semibold">{MODE_CONFIG[mode].icon} {MODE_CONFIG[mode].label}:</span>{' '}
              {MODE_CONFIG[mode].hint}
            </p>
          </div>

          {/* Element edit popover */}
          {showEditPopover && (selectedLineId || selectedMarkerId) && (
            <div className="absolute top-3 right-3 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 w-64 z-50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-widest">Edit Element</p>
                <button onClick={() => { setShowEditPopover(false); setSelectedLineId(null); setSelectedMarkerId(null) }}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Change Color</p>
              <div className="grid grid-cols-5 gap-1 mb-2">
                {PALETTE_COLORS.map(c => (
                  <button key={c.value} onClick={() => {
                    if (selectedLineId) setLines(prev => prev.map(l => l.id === selectedLineId ? { ...l, color: c.value } : l))
                    if (selectedMarkerId) setMarkers(prev => prev.map(m => m.id === selectedMarkerId ? { ...m, color: c.value } : m))
                  }}
                    title={c.name}
                    style={{ backgroundColor: c.value }}
                    className={`h-6 rounded border ${c.value === '#ffffff' ? 'border-gray-300' : 'border-white'}`} />
                ))}
              </div>
              <button onClick={() => {
                if (selectedLineId) setLines(prev => prev.filter(l => l.id !== selectedLineId))
                if (selectedMarkerId) setMarkers(prev => prev.filter(m => m.id !== selectedMarkerId))
                setShowEditPopover(false); setSelectedLineId(null); setSelectedMarkerId(null)
              }} className="w-full text-xs text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-left">✕ Delete</button>
            </div>
          )}

          {/* Active drawing indicator */}
          {activePoints.length > 0 && (
            <div className="absolute top-3 left-3 bg-orange-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow">
              Drawing: {activePoints.length} points · double-click to finish
            </div>
          )}

          {!isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-gray-500">Loading map...</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Save modal ── */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSaveModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[90vh] overflow-y-auto p-6 space-y-4 modal-responsive" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900">{editingPlanId ? 'Update' : 'Save'} Site Plan</h3>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Plan Name</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={planName} onChange={e => setPlanName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Link to Customer (optional — adds to their Files tab)</label>
              <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                <option value="">— Not linked to a customer —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.phone ? ` · ${c.phone}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowSaveModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm">Cancel</button>
              <button onClick={handleSave} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-xl text-sm">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Plan list modal ── */}
      {showPlanList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPlanList(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[60vh] overflow-hidden mx-4 lg:mx-0 modal-responsive" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Saved Site Plans</h3>
              <button onClick={() => setShowPlanList(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="overflow-y-auto max-h-[50vh]">
              {savedPlans.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-400 text-sm">No saved plans</div>
              ) : savedPlans.map(plan => (
                <div key={plan.id} className="px-6 py-3 border-b border-gray-50 flex items-center justify-between hover:bg-gray-50 cursor-pointer group"
                  onClick={() => loadPlan(plan)}>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{plan.name}</p>
                    <p className="text-xs text-gray-400">{plan.address || 'No address'} · {new Date(plan.createdAt).toLocaleDateString()}</p>
                    <p className="text-xs text-gray-400">{plan.lines.length} lines · {plan.markers.length} markers</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deletePlan(plan.id) }}
                    className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
