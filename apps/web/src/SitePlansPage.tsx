/**
 * Site Plans page — lists saved plans with thumbnails, opens viewer on click,
 * and provides a clearly labeled Create button for new plans.
 */

import { useEffect, useState } from 'react'
import { toast } from './toast'
import SitePlanTool from './SitePlanTool'
import { getCustomers } from './customerStore'

interface SavedPlan {
  id: string
  name: string
  address?: string
  createdAt: string
  updatedAt?: string
  customerName?: string
  customerId?: string
  lines?: any[]
  markers?: any[]
  notes?: string
}

function loadPlans(): SavedPlan[] {
  try { const r = localStorage.getItem('fencepro_siteplans'); return r ? JSON.parse(r) : [] } catch { return [] }
}
function savePlans(p: SavedPlan[]) {
  localStorage.setItem('fencepro_siteplans', JSON.stringify(p))
  try { window.dispatchEvent(new CustomEvent('fencepro:siteplans:updated')) } catch {}
}

export default function SitePlansPage() {
  const [plans, setPlans] = useState<SavedPlan[]>(() => loadPlans())
  const [editing, setEditing] = useState<SavedPlan | null>(null)
  const [viewing, setViewing] = useState<SavedPlan | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    const reload = () => setPlans(loadPlans())
    window.addEventListener('fencepro:siteplans:updated', reload)
    window.addEventListener('storage', (e) => {
      if ((e as StorageEvent).key === 'fencepro_siteplans') reload()
    })
    return () => {
      window.removeEventListener('fencepro:siteplans:updated', reload)
    }
  }, [])

  function handleDelete(id: string) {
    const p = plans.find(x => x.id === id)
    if (!p) return
    if (!confirm(`Delete site plan "${p.name}"?`)) return
    const next = plans.filter(x => x.id !== id)
    savePlans(next)
    setPlans(next)
    toast.success('Site plan deleted')
  }

  function handleLinkToCustomer(plan: SavedPlan) {
    try {
      const customers = getCustomers()
      if (customers.length === 0) { toast.warning('No customers yet'); return }
      const options = customers.slice(0, 20).map((c, i) => `${i + 1}. ${c.firstName} ${c.lastName}`).join('\n')
      const pick = prompt(`Link "${plan.name}" to which customer?\n\n${options}\n\nType the number:`)
      if (!pick) return
      const idx = parseInt(pick.trim(), 10) - 1
      const c = customers[idx]
      if (!c) { toast.error('Invalid selection'); return }
      const next = plans.map(p => p.id === plan.id ? { ...p, customerId: c.id, customerName: `${c.firstName} ${c.lastName}`.trim() } : p)
      savePlans(next); setPlans(next)
      // Also mirror into customer files list so it appears in their Files tab
      try {
        const filesRaw = localStorage.getItem('fencepro_files')
        const files = filesRaw ? JSON.parse(filesRaw) : []
        files.unshift({
          id: Math.random().toString(36).slice(2, 10),
          customerId: c.id,
          name: plan.name || 'Site Plan',
          type: 'Site Plan',
          size: `${plan.lines?.length || 0} lines · ${plan.markers?.length || 0} markers`,
          siteplanId: plan.id,
          uploadedAt: new Date().toISOString().slice(0, 10),
          uploadedBy: 'site plan tool',
        })
        localStorage.setItem('fencepro_files', JSON.stringify(files))
      } catch {}
      toast.success(`Linked to ${c.firstName} ${c.lastName}`)
    } catch (err: any) {
      toast.error('Could not link', err?.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Site Plans</h2>
          <p className="text-sm text-gray-400 mt-0.5">{plans.length} saved plan{plans.length === 1 ? '' : 's'} · click a card to open the viewer.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-5 py-2.5 rounded-xl">
          + Create New Site Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-gray-200 rounded-2xl">
          <p className="text-4xl mb-3">🗺</p>
          <p className="text-gray-500 text-lg font-medium">No site plans yet</p>
          <p className="text-gray-400 text-sm mt-1 mb-4">Draw fence lines on satellite imagery for your crew</p>
          <button onClick={() => setShowCreate(true)} className="text-orange-500 hover:underline text-sm font-semibold">
            Create your first site plan
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {plans.slice().sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)).map(p => (
            <div key={p.id} onClick={() => setViewing(p)}
              className="bg-white rounded-2xl border border-gray-200 hover:border-orange-300 cursor-pointer transition-all overflow-hidden group shadow-sm hover:shadow-md">
              {/* Thumbnail — render summary, or future PNG thumbnail */}
              <div className="h-32 bg-gradient-to-br from-emerald-100 via-blue-100 to-gray-100 relative flex items-center justify-center">
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-4xl opacity-40">🗺</span>
                </div>
                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 text-[10px] bg-white/80 backdrop-blur rounded px-2 py-1">
                  <span>{p.lines?.length || 0} lines</span>
                  <span className="text-gray-400">·</span>
                  <span>{p.markers?.length || 0} markers</span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                <p className="text-xs text-gray-400 truncate">{p.address || 'No address'}</p>
                {p.customerName && (
                  <p className="text-[10px] text-blue-600 mt-1">👤 {p.customerName}</p>
                )}
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 text-[11px]">
                  <button onClick={e => { e.stopPropagation(); setEditing(p) }}
                    className="flex-1 text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1">Edit</button>
                  {!p.customerId && (
                    <button onClick={e => { e.stopPropagation(); handleLinkToCustomer(p) }}
                      className="flex-1 text-emerald-600 hover:bg-emerald-50 rounded-md px-2 py-1">Link</button>
                  )}
                  <button onClick={e => { e.stopPropagation(); handleDelete(p.id) }}
                    className="flex-1 text-red-600 hover:bg-red-50 rounded-md px-2 py-1">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Read-only viewer */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto modal-responsive" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{viewing.name}</h3>
                <p className="text-xs text-gray-500">{viewing.address || 'No address'} · {new Date(viewing.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(viewing); setViewing(null) }}
                  className="text-sm bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg">Edit Site Plan</button>
                <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {viewing.customerName && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                  Linked to customer: <strong>{viewing.customerName}</strong>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Lines ({viewing.lines?.length || 0})</p>
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {(viewing.lines || []).map((l: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color || '#6b7280' }} />
                        <span className="text-gray-700">{l.type}{l.utilityKind ? ` · ${l.utilityKind}` : ''}</span>
                        {l.label && <span className="text-gray-400 ml-auto">{l.label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Markers ({viewing.markers?.length || 0})</p>
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {(viewing.markers || []).map((m: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: m.color || '#6b7280' }} />
                        <span className="text-gray-700">{m.type}</span>
                        {m.label && <span className="text-gray-400 ml-auto truncate max-w-[140px]">{m.label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {viewing.notes && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-yellow-800 uppercase">Notes</p>
                  <p className="text-sm text-yellow-900 whitespace-pre-wrap mt-1">{viewing.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editor */}
      {editing && (
        <SitePlanTool onClose={() => { setEditing(null); setPlans(loadPlans()) }} />
      )}
      {showCreate && (
        <SitePlanTool onClose={() => { setShowCreate(false); setPlans(loadPlans()) }} />
      )}
    </div>
  )
}
