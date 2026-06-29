"use client"

import { useCallback, useState } from "react"
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels"
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, useSortable } from "@dnd-kit/sortable"
import { Columns2, GripVertical, Rows2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { findNode } from "@/lib/dashboard/default"
import type { LayoutNode, Orientation, SplitNode } from "@/lib/dashboard/types"
import { getWidget } from "@/lib/dashboard/widgets"
import type { WidgetData } from "@/lib/dashboard/registry"

import { useDashboard } from "./dashboard-context"

const SLOT_PREFIX = "slot:"
function slotId(splitId: string, idx: number): string {
  return `${SLOT_PREFIX}${splitId}:${idx}`
}
function parseSlotId(id: string): { splitId: string; idx: number } | null {
  if (!id.startsWith(SLOT_PREFIX)) return null
  const rest = id.slice(SLOT_PREFIX.length)
  // splitId may itself contain ":", so split off the trailing idx only.
  const lastColon = rest.lastIndexOf(":")
  if (lastColon < 0) return null
  const splitId = rest.slice(0, lastColon)
  const idx = Number(rest.slice(lastColon + 1))
  if (!Number.isFinite(idx)) return null
  return { splitId, idx }
}

interface LayoutViewProps {
  data: WidgetData
}

export function LayoutView({ data }: LayoutViewProps) {
  const { layout, insertAt } = useDashboard()
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  // Only slot droppables are considered during drag. Restrict further to
  // root-level slots when the active widget is `standaloneOnly`, since those
  // widgets cannot live inside a nested stack.
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const activeNode = findNode(layout.root, String(args.active.id))?.node
      const activeDef =
        activeNode?.kind === "leaf"
          ? getWidget(activeNode.widgetId)
          : undefined
      const standalone = !!activeDef?.standaloneOnly

      const candidates = args.droppableContainers.filter((c) => {
        const id = String(c.id)
        const parsed = parseSlotId(id)
        if (!parsed) return false
        if (standalone && parsed.splitId !== layout.root.id) return false
        return true
      })
      return closestCorners({ ...args, droppableContainers: candidates })
    },
    [layout],
  )

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id))
  }, [])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const activeIdStr = String(e.active.id)
      const overId = e.over ? String(e.over.id) : null
      setActiveId(null)
      if (!overId) return
      const parsed = parseSlotId(overId)
      if (!parsed) return
      insertAt(activeIdStr, parsed.splitId, parsed.idx)
    },
    [insertAt],
  )

  const onDragCancel = useCallback(() => setActiveId(null), [])

  if (layout.root.children.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Empty dashboard. Toggle edit mode to add widgets.
      </div>
    )
  }

  const activeNode = activeId ? findNode(layout.root, activeId)?.node : null
  const activeDef =
    activeNode?.kind === "leaf" ? getWidget(activeNode.widgetId) : undefined
  const activeStandalone = !!activeDef?.standaloneOnly

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always },
      }}
    >
      <SplitView
        node={layout.root}
        data={data}
        depth={0}
        isDragActive={!!activeId}
        activeStandalone={activeStandalone}
        rootId={layout.root.id}
      />
      <DragOverlay>
        {activeNode ? <DragGhost node={activeNode} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function DragGhost({ node }: { node: LayoutNode }) {
  if (node.kind === "leaf") {
    const w = getWidget(node.widgetId)
    return (
      <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-primary shadow-lg">
        <GripVertical className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{w?.title ?? node.widgetId}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-primary shadow-lg">
      {node.orientation === "h" ? (
        <Columns2 className="size-4 text-muted-foreground" />
      ) : (
        <Rows2 className="size-4 text-muted-foreground" />
      )}
      <span className="text-sm font-medium">
        Stack ({node.orientation === "h" ? "horizontal" : "vertical"})
      </span>
    </div>
  )
}

interface SplitViewProps {
  node: SplitNode
  data: WidgetData
  depth: number
  isDragActive: boolean
  activeStandalone: boolean
  rootId: string
}

function SplitView({
  node,
  data,
  depth,
  isDragActive,
  activeStandalone,
  rootId,
}: SplitViewProps) {
  const { setSizes } = useDashboard()
  const orientation = node.orientation === "h" ? "horizontal" : "vertical"

  const childIds = node.children.map((c) => c.id)
  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      setSizes(
        node.id,
        childIds.map((id) => layout[id] ?? 0),
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, setSizes, childIds.join(",")],
  )

  const initialSizes =
    node.sizes.length === node.children.length
      ? node.sizes
      : evenSizes(node.children.length)

  // Standalone widgets can only target root-level slots — skip rendering
  // slots in nested splits while a standalone widget is being dragged.
  const showSlots =
    isDragActive && (!activeStandalone || node.id === rootId)

  return (
    <SortableContext items={childIds}>
      <div className="relative h-full w-full">
        <PanelGroup
          orientation={orientation}
          onLayoutChanged={onLayoutChanged}
          className="h-full w-full"
        >
          {node.children.map((child, i) => {
            const size = initialSizes[i] ?? 100 / node.children.length
            return (
              <PanelSlot
                key={child.id}
                node={child}
                data={data}
                size={size}
                isLast={i === node.children.length - 1}
                orientation={node.orientation}
                depth={depth + 1}
                isDragActive={isDragActive}
                activeStandalone={activeStandalone}
                rootId={rootId}
              />
            )
          })}
        </PanelGroup>
        {showSlots && (
          <DropSlots
            splitId={node.id}
            orientation={node.orientation}
            sizes={initialSizes}
          />
        )}
      </div>
    </SortableContext>
  )
}

function DropSlots({
  splitId,
  orientation,
  sizes,
}: {
  splitId: string
  orientation: Orientation
  sizes: number[]
}) {
  // Boundary positions as percentages: 0, s0, s0+s1, …, 100.
  const boundaries: number[] = [0]
  let acc = 0
  for (const s of sizes) {
    acc += s
    boundaries.push(acc)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {boundaries.map((pos, i) => (
        <DropSlot
          key={i}
          id={slotId(splitId, i)}
          orientation={orientation}
          position={pos}
          isEdge={i === 0 || i === boundaries.length - 1}
        />
      ))}
    </div>
  )
}

function DropSlot({
  id,
  orientation,
  position,
  isEdge,
}: {
  id: string
  orientation: Orientation
  position: number
  isEdge: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({ id })

  // The outer wrapper is the hit area (~24px wide bar across the split).
  // The inner bar is the visible affordance.
  const wrapperStyle: React.CSSProperties =
    orientation === "h"
      ? { left: `${position}%` }
      : { top: `${position}%` }

  return (
    <div
      ref={setNodeRef}
      style={wrapperStyle}
      className={cn(
        "pointer-events-auto absolute flex items-center justify-center",
        orientation === "h"
          ? "top-1 bottom-1 w-6 -translate-x-1/2"
          : "left-1 right-1 h-6 -translate-y-1/2",
      )}
    >
      <div
        className={cn(
          "rounded-full transition-all duration-150",
          orientation === "h"
            ? isOver
              ? "h-[calc(100%-4px)] w-1.5"
              : isEdge
                ? "h-[40%] w-0.5"
                : "h-[60%] w-0.5"
            : isOver
              ? "w-[calc(100%-4px)] h-1.5"
              : isEdge
                ? "w-[40%] h-0.5"
                : "w-[60%] h-0.5",
          isOver
            ? "bg-primary shadow-[0_0_12px_var(--color-primary)]"
            : "bg-primary/40",
        )}
      />
    </div>
  )
}

interface PanelSlotProps {
  node: LayoutNode
  data: WidgetData
  size: number
  isLast: boolean
  orientation: Orientation
  depth: number
  isDragActive: boolean
  activeStandalone: boolean
  rootId: string
}

function PanelSlot({
  node,
  data,
  size,
  isLast,
  orientation,
  depth,
  isDragActive,
  activeStandalone,
  rootId,
}: PanelSlotProps) {
  return (
    <>
      <Panel id={node.id} defaultSize={size} minSize={5}>
        <div className="h-full w-full p-2">
          {node.kind === "split" ? (
            <SortableSplit
              node={node}
              data={data}
              depth={depth}
              isDragActive={isDragActive}
              activeStandalone={activeStandalone}
              rootId={rootId}
            />
          ) : (
            <SortableLeaf node={node} data={data} />
          )}
        </div>
      </Panel>
      {!isLast && (
        <PanelResizeHandle
          className={cn(
            "group/sep relative flex items-center justify-center transition-colors",
            orientation === "h" ? "w-2 hover:w-2.5" : "h-2 hover:h-2.5",
            "bg-transparent hover:bg-primary/40",
          )}
        >
          <div
            className={cn(
              "absolute rounded-full bg-border/0 group-hover/sep:bg-primary/70 transition-colors",
              orientation === "h" ? "h-8 w-0.5" : "h-0.5 w-8",
            )}
          />
        </PanelResizeHandle>
      )}
    </>
  )
}

function SortableSplit({
  node,
  data,
  depth,
  isDragActive,
  activeStandalone,
  rootId,
}: {
  node: SplitNode
  data: WidgetData
  depth: number
  isDragActive: boolean
  activeStandalone: boolean
  rootId: string
}) {
  const { editMode, selectedId, setSelected, removeNode, toggleOrientation } =
    useDashboard()
  const selected = selectedId === node.id

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useSortable({ id: node.id, disabled: !editMode })

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.3 : undefined,
  }

  const onClick = editMode
    ? (e: React.MouseEvent) => {
        // Only select if click started on the chrome (not inside a child leaf)
        if (e.target === e.currentTarget) setSelected(node.id)
      }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-lg transition-colors",
        editMode
          ? selected
            ? "ring-2 ring-primary bg-primary/5"
            : "ring-2 ring-dashed ring-border/70 hover:ring-primary/50 bg-muted/30"
          : "",
      )}
    >
      {editMode && (
        <div
          className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/40 bg-background/70 backdrop-blur"
          onClick={() => setSelected(node.id)}
        >
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label="Drag stack"
            {...attributes}
            {...listeners}
            className="flex items-center gap-1 cursor-grab active:cursor-grabbing rounded px-1 hover:bg-muted/60"
          >
            <GripVertical className="size-3" />
            Stack · {node.orientation === "h" ? "Horizontal" : "Vertical"}
          </button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Toggle orientation"
              onClick={(e) => {
                e.stopPropagation()
                toggleOrientation(node.id)
              }}
            >
              {node.orientation === "h" ? <Rows2 /> : <Columns2 />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Remove stack"
              onClick={(e) => {
                e.stopPropagation()
                removeNode(node.id)
              }}
            >
              <X />
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0" onClick={onClick}>
        <SplitView
          node={node}
          data={data}
          depth={depth}
          isDragActive={isDragActive}
          activeStandalone={activeStandalone}
          rootId={rootId}
        />
      </div>
    </div>
  )
}

function SortableLeaf({
  node,
  data,
}: {
  node: Extract<LayoutNode, { kind: "leaf" }>
  data: WidgetData
}) {
  const {
    editMode,
    selectedId,
    setSelected,
    removeNode,
    updateLeafConfig,
  } = useDashboard()
  const widget = getWidget(node.widgetId)
  const selected = selectedId === node.id

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useSortable({ id: node.id, disabled: !editMode })

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.3 : undefined,
  }

  if (!widget) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex h-full items-center justify-center rounded-xl border border-dashed border-destructive/40 text-xs text-destructive"
      >
        Unknown widget: {node.widgetId}
      </div>
    )
  }

  const Component = widget.component
  const config = (node.config ?? {}) as Record<string, unknown>

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={editMode ? () => setSelected(node.id) : undefined}
      className={cn(
        "group/leaf relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 transition-colors",
        editMode
          ? selected
            ? "ring-primary cursor-pointer"
            : "ring-border/60 hover:ring-primary/50 cursor-pointer"
          : "ring-foreground/10",
      )}
    >
      {editMode && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-1.5 py-1 bg-background/80 backdrop-blur border-b border-border/40 opacity-0 group-hover/leaf:opacity-100 transition-opacity">
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
            className="flex items-center gap-1 cursor-grab active:cursor-grabbing rounded px-1 hover:bg-muted/60"
          >
            <GripVertical className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {widget.title}
            </span>
          </button>
          <div className="flex items-center gap-1">
            {widget.standaloneOnly && (
              <span className="text-[9px] uppercase tracking-widest text-primary/80">
                standalone
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Remove widget"
              onClick={(e) => {
                e.stopPropagation()
                removeNode(node.id)
              }}
            >
              <X />
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 p-4">
        <Component
          data={data}
          config={config}
          setConfig={(patch) => updateLeafConfig(node.id, patch)}
        />
      </div>
    </div>
  )
}

function evenSizes(n: number): number[] {
  if (n <= 0) return []
  const each = 100 / n
  return Array.from({ length: n }, () => each)
}
