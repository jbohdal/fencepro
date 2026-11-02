/**
 * A proposal as it may leave the server on a public path: only what the customer reads. A list of what stays, not of
 * what goes, so a new staff field is private until someone says otherwise (review Nov 2 2026: `minimumLifted`,
 * `adjustmentRefused` and `problems` were in the public JSON).
 */

type Json = any
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)

const pick = (o: Json, keys: string[]) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]))

export function customerOption(o: Json): Json {
  return {
    ...pick(o, ['label', 'fenceStyle', 'finalPrice', 'perFoot', 'sections', 'photoId', 'adjustmentCents', 'badge', 'warranty']),
    ...(isObj(o?.tier) ? { tier: pick(o.tier, ['key', 'label', 'blurb']) } : {}),
  }
}

export function customerProposal<T>(p: T): T | Json {
  if (!isObj(p) || !Array.isArray(p.options)) return p
  const { tierPrefs, tierSet, ...rest } = p
  void tierPrefs; void tierSet
  return { ...rest, options: p.options.map(customerOption) }
}
