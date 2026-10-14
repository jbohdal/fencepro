/**
 * KanbanBoard — the column board shared by the Sales Pipeline and Operations.
 *
 *   - Columns run left to right at a fixed width. The board scrolls sideways,
 *     each column scrolls up and down on its own, headers stay put.
 *   - A column collapses to a narrow strip when its header is clicked.
 *   - Dragging uses dnd-kit: mouse on desktop, long press on a phone. The
 *     board scrolls by itself near its left and right edges and a column near
 *     its top and bottom, faster the closer the card is to the edge.
 *   - A card can be dropped anywhere on a column: its header, its cards, the
 *     empty space under them, or its collapsed strip.
 *
 * The board only reports the drop. What a drop means (stage change, order,
 * confirmation) is up to the page that owns the data.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, AutoScrollActivator,
  useSensor, useSensors, useDraggable, useDroppable,
  type CollisionDetection, type DragStartEvent,
} from '@dnd-kit/core'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export interface KanbanColumn<T> {
  key: string
  label: string
  /** Cards in display order. */
  items: T[]
  /** Dollar total shown in the header; hidden when zero. */
  total: number
  colorHex: string
  icon?: string
  muted?: boolean
  /** Extra header badge, e.g. crew count. */
  badge?: ReactNode
  emptyLabel: string
  /** False for a column that cards cannot be moved into. */
  acceptsDrop?: boolean
}

interface Props<T> {
  columns: KanbanColumn<T>[]
  getId: (item: T) => string
  canDrag?: (item: T) => boolean
  renderCard: (item: T) => ReactNode
  collapsed: Record<string, boolean>
  onToggle: (key: string) => void
  /**
   * Where a card held over `pointerIndex` of a column would really end up,
   * counted among that column's other cards. Null means a drop there changes
   * nothing, so no placeholder is shown. Defaults to the pointer position.
   */
  landingIndex?: (item: T, columnKey: string, pointerIndex: number) => number | null
  /** `pointerIndex` is counted among the column's other cards. */
  onDrop: (item: T, columnKey: string, pointerIndex: number) => void
  /** DOM id for a column, so the page can scroll to it. */
  columnDomId?: (key: string) => string
}

type Target = { col: string; pointerIndex: number; landing: number | null }

const sameTarget = (a: Target | null, b: Target | null) =>
  a === b || (!!a && !!b && a.col === b.col && a.pointerIndex === b.pointerIndex && a.landing === b.landing)

/** The column and position under point `p`, read from what is on screen right now. */
function locate<T>(
  board: HTMLElement | null,
  p: { x: number; y: number } | null,
  { columns, collapsed, landingIndex, getId }: Pick<Props<T>, 'columns' | 'collapsed' | 'landingIndex' | 'getId'>,
  item: T,
): Target | null {
  if (!p || !board) return null
  const b = board.getBoundingClientRect()
  if (p.x < b.left || p.x > b.right || p.y < b.top - 40 || p.y > b.bottom + 40) return null
  for (const el of board.querySelectorAll<HTMLElement>('[data-kanban-col]')) {
    const r = el.getBoundingClientRect()
    // Half of the gap on each side counts as the column, so there is no dead strip between columns.
    if (p.x < r.left - 6 || p.x > r.right + 6) continue
    const key = el.dataset.kanbanCol!
    const col = columns.find(c => c.key === key)
    if (!col || col.acceptsDrop === false) return null
    let pointerIndex = 0
    if (!collapsed[key]) {
      const id = getId(item)
      for (const card of el.querySelectorAll<HTMLElement>('[data-kanban-card]')) {
        if (card.dataset.kanbanCard === id) continue
        const c = card.getBoundingClientRect()
        if (c.top + c.height / 2 < p.y) pointerIndex++
      }
    }
    const landing = landingIndex ? landingIndex(item, key, pointerIndex) : pointerIndex
    return { col: key, pointerIndex, landing }
  }
  return null
}

export default function KanbanBoard<T>({
  columns, getId, canDrag, renderCard, collapsed, onToggle, landingIndex, onDrop, columnDomId,
}: Props<T>) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState<T | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const targetRef = useRef<Target | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)

  // The newest props, for the drag loop below, which outlives a render.
  const latest = useRef({ columns, collapsed, landingIndex, getId })
  useEffect(() => { latest.current = { columns, collapsed, landingIndex, getId } })

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long press picks a card up; a plain swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  )

  /** The column and position under the pointer, read from what is on screen right now. */
  const findTarget = useCallback((item: T) => locate(boardRef.current, pointer.current, latest.current, item), [])

  // While a card is held, follow the pointer and re-read the target every
  // frame: the board and columns scroll under a pointer that is not moving.
  useEffect(() => {
    if (!active) return
    const onMouse = (e: MouseEvent) => { pointer.current = { x: e.clientX, y: e.clientY } }
    const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) pointer.current = { x: t.clientX, y: t.clientY } }
    const noMenu = (e: Event) => e.preventDefault()
    window.addEventListener('mousemove', onMouse, true)
    window.addEventListener('touchmove', onTouch, { capture: true, passive: true })
    window.addEventListener('contextmenu', noMenu, true)
    let frame = 0
    const tick = () => {
      const next = findTarget(active)
      if (!sameTarget(next, targetRef.current)) { targetRef.current = next; setTarget(next) }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('mousemove', onMouse, true)
      window.removeEventListener('touchmove', onTouch, true)
      window.removeEventListener('contextmenu', noMenu, true)
    }
  }, [active, findTarget])

  // A mouse wheel only goes up and down, so Shift + wheel moves the board
  // sideways. (A Mac already turns that into a sideways wheel; this covers the rest.)
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || e.deltaX !== 0 || e.deltaY === 0) return
      e.preventDefault()
      board.scrollLeft += e.deltaY
    }
    board.addEventListener('wheel', onWheel, { passive: false })
    return () => board.removeEventListener('wheel', onWheel)
  }, [])

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    const item = columns.flatMap(c => c.items).find(i => getId(i) === id)
    if (!item) return
    const ev = e.activatorEvent as MouseEvent & TouchEvent
    const t = ev.touches?.[0]
    pointer.current = t ? { x: t.clientX, y: t.clientY } : { x: ev.clientX, y: ev.clientY }
    if (t) { try { navigator.vibrate?.(15) } catch { /* not supported */ } }
    setActive(item)
  }

  function endDrag(drop: boolean) {
    const item = active
    // Read the target once more: the last frame may be older than the release.
    const t = item ? findTarget(item) : null
    setActive(null); setTarget(null); targetRef.current = null; pointer.current = null
    if (drop && item && t && t.landing !== null) onDrop(item, t.col, t.pointerIndex)
  }

  // dnd-kit scrolls the scroll containers around whatever the card is "over",
  // so it is told the same column the placeholder is in.
  const collisions: CollisionDetection = () => {
    const t = targetRef.current
    return t ? [{ id: t.col }] : []
  }

  const activeId = active ? getId(active) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      autoScroll={{ activator: AutoScrollActivator.Pointer, threshold: { x: 0.12, y: 0.15 }, acceleration: 14 }}
      onDragStart={onDragStart}
      onDragEnd={() => endDrag(true)}
      onDragCancel={() => endDrag(false)}
    >
      <div ref={boardRef} data-kanban-board className="kanban-board flex-1 min-h-0 flex gap-3 overflow-x-auto overflow-y-hidden pb-1">
        {columns.map(col => (
          <Column
            key={col.key}
            col={col}
            domId={columnDomId?.(col.key)}
            isCollapsed={!!collapsed[col.key]}
            onToggle={() => onToggle(col.key)}
            getId={getId}
            canDrag={canDrag}
            renderCard={renderCard}
            activeId={activeId}
            target={target && target.col === col.key ? target : null}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <div className="rotate-2 shadow-2xl rounded-xl cursor-grabbing">{renderCard(active)}</div>}
      </DragOverlay>
    </DndContext>
  )
}

function Column<T>({
  col, domId, isCollapsed, onToggle, getId, canDrag, renderCard, activeId, target,
}: {
  col: KanbanColumn<T>
  domId?: string
  isCollapsed: boolean
  onToggle: () => void
  getId: (item: T) => string
  canDrag?: (item: T) => boolean
  renderCard: (item: T) => ReactNode
  activeId: string | null
  /** Set while a card is held over this column. */
  target: Target | null
}) {
  const { setNodeRef } = useDroppable({ id: col.key, disabled: col.acceptsDrop === false })
  const hot = !!target && target.landing !== null
  const count = col.items.length

  if (isCollapsed) {
    return (
      <section id={domId} data-kanban-col={col.key} data-collapsed="true" className="w-11 shrink-0 h-full">
        <button
          ref={setNodeRef}
          onClick={onToggle}
          title={`${col.label}: ${count} · click to expand`}
          style={{ borderTopColor: col.colorHex }}
          className={`w-full h-full flex flex-col items-center gap-2 py-2 rounded-2xl border border-t-4 transition-colors ${hot ? 'bg-orange-100 border-orange-400 ring-2 ring-orange-400' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
        >
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">{count}</span>
          {hot && <span data-kanban-placeholder className="w-7 h-7 rounded-lg border-2 border-dashed border-orange-500 bg-orange-50" />}
          <span className="text-xs font-bold text-gray-700 whitespace-nowrap [writing-mode:vertical-rl]">{col.label}</span>
          {col.total > 0 && <span className="text-[11px] font-semibold text-emerald-700 whitespace-nowrap [writing-mode:vertical-rl]">{fmtUSD(col.total)}</span>}
        </button>
      </section>
    )
  }

  const others = activeId ? col.items.filter(i => getId(i) !== activeId) : col.items
  const placeholderBefore = hot ? (others[target!.landing!] ? getId(others[target!.landing!]) : null) : undefined
  const placeholder = <div key="__placeholder" data-kanban-placeholder className="h-24 rounded-xl border-2 border-dashed border-orange-400 bg-orange-50 flex items-center justify-center text-xs font-semibold text-orange-600">Drop here</div>

  return (
    <section
      id={domId}
      data-kanban-col={col.key}
      className={`w-[300px] max-w-[85vw] shrink-0 h-full flex flex-col min-h-0 rounded-2xl border transition-colors ${hot ? 'border-orange-300 bg-orange-50/60' : 'border-gray-200 bg-gray-100/70'}`}
    >
      <button
        onClick={onToggle}
        title="Click to collapse"
        style={{ borderTopColor: col.colorHex }}
        className={`shrink-0 w-full px-3 py-2.5 flex items-center justify-between gap-2 rounded-t-2xl border-t-4 border-b border-b-gray-200 text-left transition-colors ${col.muted ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {col.icon && <span className="text-sm">{col.icon}</span>}
          <span className={`text-sm font-bold truncate ${col.muted ? 'text-gray-600' : 'text-gray-900'}`}>{col.label}</span>
          <span data-kanban-count className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">{count}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {col.badge}
          {col.total > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{fmtUSD(col.total)}</span>}
          <span className="text-gray-400 text-xs">⇤</span>
        </span>
      </button>
      <div data-kanban-scroll className="kanban-col-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-2">
        <div ref={setNodeRef} className="min-h-full space-y-2 pt-2 pb-20 md:pb-2">
          {col.items.map(item => {
            const id = getId(item)
            return [
              placeholderBefore === id && placeholder,
              <DraggableCard key={id} id={id} disabled={canDrag ? !canDrag(item) : false} held={id === activeId}>
                {renderCard(item)}
              </DraggableCard>,
            ]
          })}
          {placeholderBefore === null && placeholder}
          {count === 0 && !hot && (
            <div className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-6 text-center text-xs text-gray-400">{col.emptyLabel}</div>
          )}
        </div>
      </div>
    </section>
  )
}

function DraggableCard({ id, disabled, held, children }: { id: string; disabled: boolean; held: boolean; children: ReactNode }) {
  const { setNodeRef, listeners } = useDraggable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      data-kanban-card={id}
      {...listeners}
      className={`kanban-card rounded-xl ${held ? 'opacity-40 outline-2 outline-dashed outline-gray-400' : ''}`}
    >
      {children}
    </div>
  )
}
