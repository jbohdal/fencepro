/**
 * The crew's run table and gate lines on the install packet, from a yard and
 * its runs as priced: each run by its side ("Back (1 of 2)"), its length, its
 * sections and the post to post spacing; each gate with its place both ways
 * and its swing; each skip. Pure. The office's packet (installPacket.tsx) and
 * the server, for a job whose work a change order changed (routes/installPacket.ts),
 * both build them here, so they read the same before and after a change order.
 */

import { buildPlan } from './sitePlanGeometry'
import { deriveLayout, formatFtIn, postSpacing, GATE_LABEL, type YardLayout } from './yardLayout'
import { gateWhereText, layoutPanelFt, savedQuoteNearIn } from './gateSlide'

export interface PacketRun { label: string; length: string; sections: number; spacing: string }

export function packetRunsFor(yard: YardLayout | null, runs: number[], sections: number[], style: { name: string; panelWidth?: number; autoRailMix?: boolean } | null): { runs: PacketRun[]; gates: string[] | null; skips: string[] | null } {
  const widthFt = layoutPanelFt(style)
  const nearIn = yard ? savedQuoteNearIn(yard, runs, widthFt) : 96
  const derived = yard ? deriveLayout(yard, nearIn) : null
  const named = derived && derived.runs.length === runs.length ? derived.runs : null
  const out: PacketRun[] = runs.map((ft, i) => ({
    label: named ? (named[i].pieces > 1 ? `${named[i].sideName} (${named[i].piece} of ${named[i].pieces})` : named[i].sideName) : `Run ${i + 1}`,
    length: formatFtIn(ft * 12), sections: sections[i] ?? 0, spacing: postSpacing(ft, sections[i] ?? 0),
  }))
  if (!yard || !derived) return { runs: out, gates: null, skips: null }
  const gates: string[] = [], skips: string[] = []
  // Swing and hinge come from the drawing (left / right as seen from inside the yard).
  const planGates = new Map(buildPlan(yard, derived, undefined, widthFt).sides.map(p => [p.sideId, p.gate]))
  yard.sides.forEach((s, i) => {
    if (!s.on) return
    const r = derived.sides[i]
    if (s.gate && r.gateAtIn != null) {
      // Both ways, by the side's real ends: "Back: 5 ft walk gate, 12 ft from the Left side corner, 31 ft to the Right side corner".
      const where = gateWhereText(yard, i, nearIn) ?? `${formatFtIn(s.gate.widthIn)} ${GATE_LABEL[s.gate.type].toLowerCase()}`
      gates.push(`${s.name}: ${where}; ${planGates.get(s.id)?.swingText ?? 'swings in'} (as seen from inside the yard)`)
    } else if (s.gates?.length && r.gateSpans?.length) {
      // A walked side's gates (one or more), each where it was walked.
      s.gates.forEach((g, k) => {
        const span = r.gateSpans![k]
        if (!span) return
        const hinge = g.type === 'walk' && g.hinge ? `, hinge on the ${g.hinge}` : ''
        gates.push(`${s.name}: ${formatFtIn(g.widthIn)} ${GATE_LABEL[g.type].toLowerCase()}, ${formatFtIn(span[0])} from the start of the side; swings ${g.swing === 'out' ? 'out' : 'in'}${hinge} (as seen from inside the yard)`)
      })
    }
    if (s.skip && r.skipAtIn != null) skips.push(`${s.name}: ${formatFtIn(s.skip.lengthIn)} ${s.skip.kind === 'existing' ? 'existing fence' : 'with no fence'}, starting ${formatFtIn(r.skipAtIn)} from the start of the side`)
  })
  return { runs: out, gates, skips }
}
