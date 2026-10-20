/**
 * A plain drawn picture of a fence type, for a style with no photo in
 * Settings: vinyl privacy (or bell top), chain link, aluminum, wood. Inline
 * SVG, no image files.
 */

const VINYL_COLORS: Record<string, string> = { white: '#f8fafc', tan: '#d8c7a3' }

export default function StylePicture({ material, family, colors }: { material: string; family: string; colors: string[] }) {
  const kind = material.startsWith('chain') ? 'chain' : material.startsWith('alum') ? 'aluminum' : material.startsWith('wood') ? 'wood' : 'vinyl'
  const first = (colors[0] || '').toLowerCase()
  return (
    <svg viewBox="0 0 160 120" className="w-full h-full" role="img" aria-label={`${kind === 'chain' ? 'Chain link' : kind[0].toUpperCase() + kind.slice(1)} fence`} data-w-style-picture={kind}>
      <rect width="160" height="120" fill="#e0f2fe" />
      <rect y="96" width="160" height="24" fill="#86efac" />
      {kind === 'vinyl' && <Vinyl fill={VINYL_COLORS[first] ?? '#f8fafc'} bell={/^bell/i.test(family)} />}
      {kind === 'chain' && <Chain stroke={first === 'black' ? '#1f2937' : '#9ca3af'} />}
      {kind === 'aluminum' && <Aluminum />}
      {kind === 'wood' && <Wood />}
    </svg>
  )
}

function Vinyl({ fill, bell }: { fill: string; bell: boolean }) {
  const top = bell ? 'M14 36 Q80 18 146 36 L146 98 L14 98 Z' : 'M14 30 L146 30 L146 98 L14 98 Z'
  return (
    <g stroke="#94a3b8" strokeWidth="1.5">
      <path d={top} fill={fill} />
      {[34, 54, 74, 94, 114, 134].map(x => <line key={x} x1={x} y1={bell ? 34 : 30} x2={x} y2="98" strokeWidth="0.8" />)}
      <rect x="6" y="22" width="10" height="78" fill={fill} />
      <rect x="144" y="22" width="10" height="78" fill={fill} />
      <rect x="4" y="18" width="14" height="6" fill={fill} />
      <rect x="142" y="18" width="14" height="6" fill={fill} />
    </g>
  )
}

function Chain({ stroke }: { stroke: string }) {
  const lines = []
  for (let i = -60; i <= 160; i += 10) {
    lines.push(<line key={`a${i}`} x1={i} y1="34" x2={i + 62} y2="96" />)
    lines.push(<line key={`b${i}`} x1={i + 62} y1="34" x2={i} y2="96" />)
  }
  return (
    <g>
      <clipPath id="w-chain-clip"><rect x="12" y="34" width="136" height="62" /></clipPath>
      <g stroke={stroke} strokeWidth="0.9" clipPath="url(#w-chain-clip)">{lines}</g>
      <g stroke={stroke} strokeWidth="4" strokeLinecap="round">
        <line x1="10" y1="30" x2="150" y2="30" />
        <line x1="10" y1="26" x2="10" y2="98" />
        <line x1="80" y1="30" x2="80" y2="98" />
        <line x1="150" y1="26" x2="150" y2="98" />
      </g>
    </g>
  )
}

function Aluminum() {
  const pickets = []
  for (let x = 20; x <= 140; x += 8) pickets.push(<line key={x} x1={x} y1="40" x2={x} y2="94" />)
  return (
    <g stroke="#111827" strokeLinecap="round">
      <g strokeWidth="2">{pickets}</g>
      <g strokeWidth="3">
        <line x1="10" y1="42" x2="150" y2="42" />
        <line x1="10" y1="88" x2="150" y2="88" />
      </g>
      <g strokeWidth="5">
        <line x1="10" y1="34" x2="10" y2="98" />
        <line x1="150" y1="34" x2="150" y2="98" />
      </g>
    </g>
  )
}

function Wood() {
  const boards = []
  for (let x = 12; x < 148; x += 10) boards.push(<path key={x} d={`M${x} 34 L${x + 5} 28 L${x + 10} 34 L${x + 10} 98 L${x} 98 Z`} />)
  return (
    <g>
      <g fill="#c08a52" stroke="#8b5a2b" strokeWidth="0.8">{boards}</g>
      <g fill="#8b5a2b">
        <rect x="6" y="30" width="8" height="70" />
        <rect x="146" y="30" width="8" height="70" />
      </g>
    </g>
  )
}
