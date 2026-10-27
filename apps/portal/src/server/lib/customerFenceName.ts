/**
 * A fence's name as the customer reads it, on the proposal link, the signed
 * page and the signed contract PDF. The office's plain name of a best price
 * fence carries an internal tag, "6 or 8 ft panels (best price)" (Settings →
 * Fence styles, the Panel width choice). The customer reads the panels the
 * quote's runs actually used (the best price pick of each run, the option's
 * runRails): "8 ft panels" or "6 ft panels" when every run took one width,
 * "6 ft and 8 ft panels" when it really mixes (review Oct 27 2026: a 120 ft
 * single run of 8 ft panels read "6 ft or 8 ft panels"). Without the runs'
 * picks it stays "6 ft or 8 ft panels". Anything else is left as written.
 *
 * Pure, no imports. Only the words shown change: the saved quote, its option
 * labels and prices are never rewritten.
 */
export function customerFenceName(label: string | null | undefined, runRails?: unknown): string {
  const widths = panelWidthsOf(runRails)
  return String(label ?? '')
    .replace(/\b(\d+) or (\d+) ft panels\b/gi, (_m, a: string, b: string) =>
      widths.length === 1 ? `${widths[0]} ft panels` : widths.length > 1 ? `${widths.join(' ft and ')} ft panels` : `${a} ft or ${b} ft panels`)
    .replace(/\s*\((?:best price|auto)\)/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The panel widths a best price fence's runs used, smallest first (["8"], ["6", "8"]), from its
 * runRails ('6ft' | '8ft' per run). [] when not known: none saved, or a run still on 'auto'.
 */
export function panelWidthsOf(runRails: unknown): string[] {
  if (!Array.isArray(runRails) || runRails.length === 0) return []
  const seen = new Set<string>()
  for (const r of runRails) {
    const m = /^(\d+)ft$/.exec(String(r ?? ''))
    if (!m) return []
    seen.add(m[1])
  }
  return [...seen].sort((a, b) => Number(a) - Number(b))
}

/** The runs' picks of an option (its priced snapshot), else the quote's own when they are all picked. */
export function railsOf(option: { snapshot?: { runRails?: unknown } | null } | null | undefined, quoteRails?: unknown): unknown {
  const own = option?.snapshot?.runRails
  return panelWidthsOf(own).length ? own : quoteRails
}

/**
 * "What's included" as the customer reads it, from the lines frozen on the proposal:
 *  - the posts line without zero counts, and "end posts" when there are no gates
 *    ("0 corner posts and 2 end and gate posts" reads "2 end posts"; review Oct 27 2026);
 *  - a move or repair: its description, already shown as the work, is not said twice.
 * Only the words shown change; the saved proposal is never rewritten.
 */
export function customerIncluded(p: { included?: unknown; kind?: string | null; description?: string | null; gatesText?: string | null }): string[] {
  const lines = Array.isArray(p.included) ? p.included.map(String) : []
  const gates = !!p.gatesText && !/^no gates$/i.test(String(p.gatesText).trim())
  const desc = String(p.description ?? '').trim()
  const out: string[] = []
  for (const line of lines) {
    if (p.kind && desc && line.trim() === desc) continue
    const m = /^(\d+) corner posts? and (\d+) end and gate posts?$/.exec(line.trim())
    if (m) {
      const n = (k: number, what: string) => (k > 0 ? `${k} ${what}${k === 1 ? '' : 's'}` : '')
      const posts = [n(Number(m[1]), 'corner post'), n(Number(m[2]), gates ? 'end and gate post' : 'end post')].filter(Boolean).join(' and ')
      if (posts) out.push(posts)
      continue
    }
    out.push(line)
  }
  return out
}
