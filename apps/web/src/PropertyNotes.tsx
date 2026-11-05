/**
 * The job's property notes where the crew and the office look (review, Nov 5
 * 2026): the gate code, the tenant or property manager and their phone, and
 * the access notes of the property the job is at (propertiesApi.ts). Nothing
 * when the property has none. The Installer reads them for his installs'
 * customers (portal lib/crewScope.ts).
 */

import { useEffect, useState } from 'react'
import { loadProperties, type Property } from './propertiesApi'
import { sameAddress } from './propertyAddress'
import { formatPhone } from './phoneFormat'

export default function PropertyNotes({ customerId, propertyId, address }: { customerId?: string | null; propertyId?: string | null; address?: string | null }) {
  const [p, setP] = useState<Property | null>(null)
  useEffect(() => {
    let live = true
    setP(null)
    if (!customerId) return
    void loadProperties(customerId).then(r => {
      if (!live || !r.ok) return
      setP(r.properties.find(x => x.id === propertyId) ?? (address ? r.properties.find(x => sameAddress(x.address, address)) : undefined) ?? null)
    })
    return () => { live = false }
  }, [customerId, propertyId, address])
  if (!p || !(p.gateCode || p.tenantName || p.tenantPhone || p.accessNotes)) return null
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-950 space-y-0.5" data-property-notes={p.id}>
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{p.label} property</p>
      {p.gateCode && <p>Gate code: <b data-property-notes-gate>{p.gateCode}</b></p>}
      {(p.tenantName || p.tenantPhone) && (
        <p>Tenant / manager: {p.tenantName}{p.tenantPhone && <> {p.tenantName ? '· ' : ''}<a className="underline font-medium" href={`tel:${p.tenantPhone.replace(/[^\d+]/g, '')}`}>{formatPhone(p.tenantPhone)}</a></>}</p>
      )}
      {p.accessNotes && <p className="whitespace-pre-line">{p.accessNotes}</p>}
    </div>
  )
}
