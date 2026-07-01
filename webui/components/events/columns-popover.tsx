"use client"

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Columns3, GripVertical } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import { ALL_COLUMNS, type ColumnKey } from "./events-columns"

interface Props {
  visible: Set<ColumnKey>
  order: ColumnKey[]
  onVisibleChange: (next: Set<ColumnKey>) => void
  onOrderChange: (next: ColumnKey[]) => void
}

export function ColumnsPopover({
  visible,
  order,
  onVisibleChange,
  onOrderChange,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(active.id as ColumnKey)
    const newIndex = order.indexOf(over.id as ColumnKey)
    if (oldIndex < 0 || newIndex < 0) return
    onOrderChange(arrayMove(order, oldIndex, newIndex))
  }

  function toggle(key: ColumnKey) {
    const next = new Set(visible)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onVisibleChange(next)
  }

  const colByKey = new Map(ALL_COLUMNS.map((c) => [c.key, c]))

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Columns3 className="size-3.5" />
            Columns
          </button>
        }
      />
      <PopoverContent align="end" className="w-64 gap-2 p-2">
        <div className="px-1 pb-1 text-xs font-medium">
          Show / reorder columns
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="flex max-h-80 flex-col overflow-y-auto">
              {order.map((key) => {
                const col = colByKey.get(key)
                if (!col) return null
                return (
                  <ColumnRow
                    key={key}
                    id={key}
                    label={col.label}
                    hideable={col.hideable}
                    checked={visible.has(key)}
                    onToggle={() => toggle(key)}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      </PopoverContent>
    </Popover>
  )
}

function ColumnRow({
  id,
  label,
  hideable,
  checked,
  onToggle,
}: {
  id: ColumnKey
  label: string
  hideable: boolean
  checked: boolean
  onToggle: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm",
        isDragging && "bg-accent/70",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={hideable ? onToggle : undefined}
        disabled={!hideable}
        className="flex flex-1 cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed"
      >
        <Checkbox
          checked={checked}
          disabled={!hideable}
          tabIndex={-1}
          className="pointer-events-none"
        />
        <span className={cn(!hideable && "text-muted-foreground")}>
          {label}
        </span>
      </button>
    </div>
  )
}
