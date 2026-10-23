/**
 * Dispatch map pins: what each pin shows.
 *
 *   - Fill: the job's Operations stage color, by stage id, from Settings >
 *     Operations Stages (the same list and colors as the Operations board).
 *   - Ring and letters: the crew. The crew's color from Schedule > crews when
 *     the crew is there (found by id, or by name: Smart Schedule saves the
 *     name), else a steady color worked out from the crew's name.
 *   - No crew yet: a dashed gray ring and the customer's initials, so every
 *     pin says whose yard it is.
 */

export interface DispatchCrew {
  id: string
  name: string
  /** #rrggbb */
  hex: string
  /** Not in Schedule's crew list: a name typed on a job (Smart Schedule, the job page). */
  fromJob?: boolean
}

/** Schedule's crew colors are Tailwind classes; the hex each one is drawn with in this app. */
const CLASS_HEX: Record<string, string> = {
  'bg-blue-500': '#3B82F6',
  'bg-purple-500': '#8B5CF6',
  'bg-green-500': '#22C55E',
  // The app's "orange" is the brand purple (index.css @theme), so a crew set to orange shows that.
  'bg-orange-500': '#5E28A1',
  'bg-pink-500': '#EC4899',
  'bg-teal-500': '#14B8A6',
  'bg-red-500': '#EF4444',
  'bg-indigo-500': '#6366F1',
  'bg-yellow-500': '#EAB308',
  'bg-cyan-500': '#06B6D4',
}

const STEADY = ['#0EA5E9', '#D946EF', '#84CC16', '#F97316', '#0D9488', '#E11D48', '#7C3AED', '#CA8A04', '#2563EB', '#DB2777']

/** The same color for the same crew name, every time and on every device. */
export function steadyColor(name: string): string {
  let h = 0
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return STEADY[h % STEADY.length]
}

export function crewHex(color: string | undefined, name: string): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color
  return (color && CLASS_HEX[color]) || steadyColor(name)
}

/** Schedule's crews, plus any crew name on a job that is not in that list. */
export function dispatchCrews(settingsCrews: Array<{ id: string; name: string; color?: string; hexColor?: string }>, jobCrewValues: string[]): DispatchCrew[] {
  const out: DispatchCrew[] = settingsCrews.map(c => ({ id: c.id, name: c.name, hex: crewHex(c.hexColor || c.color, c.name) }))
  for (const v of jobCrewValues) {
    const t = (v || '').trim()
    if (!t || findCrew(out, t)) continue
    out.push({ id: t, name: t, hex: steadyColor(t), fromJob: true })
  }
  return out
}

/** The crew a job's crewAssigned names: by id, else by name (any case). */
export function findCrew(crews: DispatchCrew[], crewAssigned: string | null | undefined): DispatchCrew | null {
  const t = (crewAssigned || '').trim()
  if (!t) return null
  return crews.find(c => c.id === t) || crews.find(c => c.name.trim().toLowerCase() === t.toLowerCase()) || null
}

/** "Crew 1" -> C1, "Juan Bravo" -> JB, "Mike" -> MI. At most three letters. */
export function crewInitials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (!words.length) return ''
  if (words.length === 1) return /^\d+$/.test(words[0]) ? words[0].slice(0, 3) : words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 3).map(w => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join('').slice(0, 3)
}

/** "Mary Ann Smith" -> MS; "Smith" -> SM. */
export function nameInitials(name: string): string {
  const words = (name || '').replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export interface PinLook { fill: string; ring: string; label: string; dashed: boolean }

export function pinLook(stageColor: string, crew: DispatchCrew | null, customerName: string): PinLook {
  return crew
    ? { fill: stageColor, ring: crew.hex, label: crewInitials(crew.name), dashed: false }
    : { fill: stageColor, ring: '#6B7280', label: nameInitials(customerName), dashed: true }
}

/** The pin drawn for Leaflet (a divIcon's html). */
export function pinElement(look: PinLook, selected: boolean, data: Record<string, string>): HTMLElement {
  const el = document.createElement('div')
  el.style.position = 'relative'
  el.style.cursor = 'pointer'
  el.style.transition = 'transform 0.15s'
  if (selected) el.style.transform = 'scale(1.3)'
  for (const [k, v] of Object.entries(data)) el.setAttribute(`data-${k}`, v)
  const fs = look.label.length >= 3 ? 8 : 10
  // The letters are dark on the white middle for every crew color (a yellow ring stays readable).
  el.innerHTML = `
    <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17 1C8.16 1 1 8.16 1 17c0 12 16 26 16 26s16-14 16-26C33 8.16 25.84 1 17 1z" fill="${esc(look.fill)}" stroke="${selected ? '#111' : '#fff'}" stroke-width="2" data-pin-fill/>
      <circle cx="17" cy="17" r="10" fill="#fff" stroke="${esc(look.ring)}" stroke-width="3"${look.dashed ? ' stroke-dasharray="3 2.5"' : ''} data-pin-ring/>
      <text x="17" y="${17 + fs * 0.36}" text-anchor="middle" font-size="${fs}" font-weight="800" font-family="system-ui, sans-serif" fill="#1F2937" data-pin-label>${esc(look.label)}</text>
    </svg>`
  return el
}
