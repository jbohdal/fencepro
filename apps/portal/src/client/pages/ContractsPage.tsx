import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import type { ContractView } from '../../types/index'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<ContractView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<ContractView[]>('/contracts').then(setContracts).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-center py-16 text-gray-400">Loading contracts...</div>

  return contracts.length === 0 ? (
    <div className="text-center py-16 text-gray-400">No contracts found</div>
  ) : (
    <div className="space-y-4">
      {contracts.map(c => (
        <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900">{c.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[c.status] || 'bg-gray-100'}`}>
              {c.status}
            </span>
          </div>
          {c.description && <p className="text-sm text-gray-600 mb-3">{c.description}</p>}
          <div className="flex gap-6 text-xs text-gray-400">
            <span>Start: {new Date(c.startDate).toLocaleDateString()}</span>
            {c.endDate && <span>End: {new Date(c.endDate).toLocaleDateString()}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
