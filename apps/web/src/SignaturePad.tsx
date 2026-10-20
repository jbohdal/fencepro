/**
 * A finger signature pad: the same pad as the proposal page (server
 * routes/proposal.ts), for React screens: the final walkthrough and the
 * customer portal's change orders. onChange gets a PNG data URL after each
 * stroke, or null when cleared.
 */
import { useRef } from 'react'

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const down = useRef(false)
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!, r = c.getBoundingClientRect()
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height] as const
  }
  const ctx = () => { const x = ref.current!.getContext('2d')!; x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#1C1030'; return x }
  return (
    <div className="relative border border-dashed border-purple-300 rounded-lg bg-white">
      <canvas ref={ref} width={600} height={200} className="w-full h-40 block touch-none" aria-label="Sign here with a finger" data-wt-sigpad
        onPointerDown={e => { down.current = true; try { ref.current!.setPointerCapture(e.pointerId) } catch { /* older phones */ } const [x, y] = pos(e); const c = ctx(); c.beginPath(); c.moveTo(x, y); e.preventDefault() }}
        onPointerMove={e => { if (!down.current) return; const [x, y] = pos(e); const c = ctx(); c.lineTo(x, y); c.stroke(); e.preventDefault() }}
        onPointerUp={() => { if (!down.current) return; down.current = false; onChange(ref.current!.toDataURL('image/png')) }} />
      <button type="button" className="absolute right-1 top-1 min-h-[48px] min-w-[64px] text-sm font-semibold text-[color:var(--color-brand)]"
        onClick={() => { ctx().clearRect(0, 0, 600, 200); onChange(null) }}>Clear</button>
      <span className="absolute left-3 bottom-2 text-xs text-gray-400 pointer-events-none">Sign here</span>
    </div>
  )
}
