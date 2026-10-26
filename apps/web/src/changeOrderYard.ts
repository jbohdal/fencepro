/**
 * A yard turned into the runs and posts the calculator takes, the way the
 * quote builder does it (QuoteBuilder.tsx: deriveLayout at the style's section
 * width, tees posted as the style's tee post). Change orders rebuild a job's
 * drawing from more than one change with it (server lib/changeOrderMerge.ts),
 * on the server through the estimate bundle and in the app.
 */
import { deriveLayout, teePostFor, type YardLayout } from './yardLayout'
import { layoutPanelFt } from './gateSlide'

type StyleLike = { name: string; category?: string; panelWidth?: number; autoRailMix?: boolean }

export function deriveRunsFor(styles: StyleLike[], yard: YardLayout, fenceStyle: string) {
  if (!yard || !Array.isArray(yard.sides)) return null
  const style = styles.find(s => s.name === fenceStyle) ?? null
  const r = deriveLayout(yard, layoutPanelFt(style) * 12, { teeAs: teePostFor(style) })
  return {
    runs: r.runs.map(x => x.ft), corners: r.corners, ends: r.ends, walkGates: r.walkGates, dblGates: r.dblGates, linePosts: r.linePosts,
    // Each run by its side, as the crew packet names them ("Back", "Left side (2 of 2)").
    runNames: r.runs.map(x => (x.pieces > 1 ? `${x.sideName} (${x.piece} of ${x.pieces})` : x.sideName)),
  }
}
