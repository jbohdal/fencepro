/**
 * Draft purchase orders (BusinessState.purchaseOrders, made by web
 * purchaseOrderStore.ts) saved in dollars before audit #53 (Oct 28 2026),
 * turned into integer cents: unitCost → unitCostCents, total → totalCents,
 * subtotal → subtotalCents. Each figure is rounded to the cent once; nothing
 * is added up in dollars. A draft already in cents is left as it is. Pure (no
 * database): scripts/po-cents-2026-10-28.ts saves the result.
 */

type Json = any

const cents = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** One draft in cents, and whether anything changed. */
export function poToCents(po: Json): { po: Json; changed: boolean } {
  if (!po || typeof po !== 'object') return { po, changed: false }
  let changed = false
  const lineItems = (Array.isArray(po.lineItems) ? po.lineItems : []).map((li: Json) => {
    if (!li || typeof li !== 'object' || (!('unitCost' in li) && !('total' in li))) return li
    changed = true
    const { unitCost, total, ...rest } = li
    const unitCostCents = typeof rest.unitCostCents === 'number' ? rest.unitCostCents : cents(unitCost) ?? 0
    const totalCents = typeof rest.totalCents === 'number' ? rest.totalCents : cents(total) ?? Math.round((Number(rest.quantity) || 0) * unitCostCents)
    return { ...rest, unitCostCents, totalCents }
  })
  const out: Json = Array.isArray(po.lineItems) ? { ...po, lineItems } : { ...po }
  if ('subtotal' in po) {
    changed = true
    const { subtotal, ...rest } = out
    const sub = typeof rest.subtotalCents === 'number' ? rest.subtotalCents : cents(subtotal) ?? lineItems.reduce((s: number, li: Json) => s + (Number(li?.totalCents) || 0), 0)
    return { po: { ...rest, subtotalCents: sub }, changed }
  }
  return { po: out, changed }
}

/** Every draft in the list in cents; the list and how many changed. */
export function posToCents(list: unknown): { list: Json[]; changed: number } {
  const arr = Array.isArray(list) ? list : []
  let changed = 0
  const out = arr.map(po => { const r = poToCents(po); if (r.changed) changed++; return r.po })
  return { list: out, changed }
}

/** The lines' totals added up, in cents (to check a draft's subtotal against). */
export const sumOfLines = (po: Json): number => (Array.isArray(po?.lineItems) ? po.lineItems : []).reduce((s: number, li: Json) => s + (Number(li?.totalCents) || 0), 0)
