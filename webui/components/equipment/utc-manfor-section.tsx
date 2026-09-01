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
import { Minus, Plus, SlidersHorizontal } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { GripDots } from "@/components/equipment/grip-dots"
import { ManageBar } from "@/components/equipment/manage-bar"
import {
  ManforPositionItem,
  UtcManforContents,
} from "@/components/equipment/utc-manfor-contents"
import { Button } from "@/components/ui/button"
import { ItemGroup } from "@/components/ui/item"
import { MEFPAK_HALVES } from "@/lib/equipment-meta"
import { manforStrength, peopleLabel } from "@/lib/manfor-meta"
import { SKILL_LEVELS, SKILL_LEVEL_LABELS } from "@/lib/personnel-data"
import type { UtcDef, WorkCenter } from "@/lib/types"
import { cn } from "@/lib/utils"

const MANFOR = MEFPAK_HALVES.manfor

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-xs"

/** One authorized position being authored — a shop, a level, and how many.
 *
 *  Set when it is added and never edited in place. Editing a row's shop is
 *  indistinguishable from removing it and adding a different one, and offering
 *  both is what let two rows drift into saying the same thing. */
interface PositionDraft {
  /** Identity for React and dnd-kit, stable across a reorder — the array index
   *  is not, and sorting by index makes a dragged row swap with its own
   *  ghost. */
  uid: string
  work_center: string
  skill_level: number | null
  quantity: number
}

let addedRows = 0

function draftsOf(def: UtcDef): PositionDraft[] {
  return [...def.manfor]
    .sort((a, b) => a.display_order - b.display_order)
    .map((p) => ({
      uid: `p${p.id}`,
      work_center: p.work_center,
      skill_level: p.skill_level,
      quantity: p.quantity,
    }))
}

/** Every field that reaches the API, in order — so Save is offered only when
 *  something a reader would notice actually changed. */
function signature(rows: PositionDraft[]): string {
  return rows
    .map((r) => [r.work_center, r.skill_level ?? "", r.quantity].join("|"))
    .join("\n")
}

/** What the API stores. */
function payload(rows: PositionDraft[]) {
  return rows.map((r, i) => ({
    work_center: r.work_center,
    skill_level: r.skill_level,
    quantity: r.quantity,
    display_order: i,
  }))
}

/**
 * The MANFOR — who a UTC deploys with, beside the LOGDET that says what it
 * deploys with.
 *
 * Owns its own manage mode rather than threading state through the definition
 * page: the two halves are edited independently (a MANFOR change is a
 * manpower decision, a LOGDET change is a logistics one), and a single Save
 * spanning both would make every equipment edit look like a personnel edit in
 * the audit trail.
 */
export function UtcManforSection({
  def,
  workCenters,
  editable,
}: {
  def: UtcDef
  /** This workspace's shops, for the add form. A position stores the shop by
   *  NAME (a UTC definition can be global, a work center never is), so these
   *  are choices rather than a foreign key — a name that matches nothing is
   *  still a name, which is what lets a shared template say "RF". */
  workCenters: WorkCenter[]
  /** Same rule as the LOGDET: global catalog rows are admin-managed. */
  editable: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<PositionDraft[]>(() => draftsOf(def))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** One-shot line about what the last add did — see `notice` on ManageBar. */
  const [notice, setNotice] = useState<string | null>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking the handle to
    // focus it does not read as a grab.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const dirty = signature(rows) !== signature(draftsOf(def))
  const strength = rows.reduce((a, r) => a + r.quantity, 0)
  const shown = editing ? strength : manforStrength(def.manfor)

  function startEditing() {
    setRows(draftsOf(def))
    setError(null)
    setNotice(null)
    setEditing(true)
  }

  function cancel() {
    setRows(draftsOf(def))
    setError(null)
    setNotice(null)
    setEditing(false)
  }

  /** Adding a position already on the list raises its count rather than making
   *  a second row saying the same thing — which is what asking for another Sys
   *  Ops 7-level means, and what the database enforces anyway. */
  function addPosition(
    workCenter: string,
    skillLevel: number | null,
    qty: number,
  ) {
    setError(null)
    const at = rows.findIndex(
      (r) => r.work_center === workCenter && r.skill_level === skillLevel,
    )
    if (at >= 0) {
      const next = rows[at].quantity + qty
      setRows(rows.map((r, i) => (i === at ? { ...r, quantity: next } : r)))
      setNotice(`Already on the list — raised to ${next}.`)
      return
    }
    setNotice(null)
    setRows([
      ...rows,
      {
        uid: `new${++addedRows}`,
        work_center: workCenter,
        skill_level: skillLevel,
        quantity: qty,
      },
    ])
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    setRows((prev) => {
      const from = prev.findIndex((r) => r.uid === active.id)
      const to = prev.findIndex((r) => r.uid === over.id)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }

  async function save() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/be/utc-defs/${def.id}/manfor`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(rows)),
    })
    setPending(false)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      setError(
        typeof detail.detail === "string" ? detail.detail : "Failed to save",
      )
      return
    }
    setEditing(false)
    setNotice(null)
    // The page is a server component reading the UTC list, so a refresh is
    // what brings the saved MANFOR back down.
    router.refresh()
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          {/* The strength is a figure beside the heading, not the tail of the
              sentence below it. Set in the same muted type as the boilerplate
              it followed, a live count reads as boilerplate too — and a number
              that looks like prose looks like a number nobody is maintaining.
              Same treatment the LOGDET's column headings give "22 items". */}
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <MANFOR.icon className="size-4 text-muted-foreground" />
              {MANFOR.plain}
            </h2>
            {/* The acronym as quiet text beside the plain word, not a filled
                pill: it is the same thing said again, and a badge would give
                the jargon more weight than the word everyone knows. */}
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {MANFOR.code}
            </span>
            {shown > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {peopleLabel(shown)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Who this UTC deploys with — authorized positions, not named people.
          </p>
        </div>
        {/* While editing, the action bar is the only way out — a second exit
            up here was easy to miss and, once dirty, would have been a button
            that silently discarded the edit. */}
        {editable && !editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            <SlidersHorizontal data-icon="inline-start" />
            Manage
          </Button>
        )}
      </div>

      {editing ? (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={rows.map((r) => r.uid)}
              strategy={verticalListSortingStrategy}
            >
              {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                  No positions yet.
                </p>
              ) : (
                <ItemGroup>
                  {rows.map((row) => (
                    <SortablePosition
                      key={row.uid}
                      row={row}
                      disabled={pending}
                      onRemove={() =>
                        setRows((prev) => prev.filter((r) => r.uid !== row.uid))
                      }
                    />
                  ))}
                </ItemGroup>
              )}
            </SortableContext>
          </DndContext>

          <AddPositionForm
            workCenters={workCenters}
            disabled={pending}
            onAdd={addPosition}
          />

          <ManageBar
            hint="Add a position, or drag to reorder."
            notice={notice}
            error={error}
            dirty={dirty}
            pending={pending}
            onCancel={cancel}
            onSave={save}
          />
        </>
      ) : (
        /* Read mode is the shared renderer, so this page and the peek sheet on
           the package page can never describe the same UTC differently. It
           reads `def` rather than `rows`: outside edit mode the two agree, and
           the saved row is the honest source. */
        <UtcManforContents def={def} />
      )}
    </section>
  )
}

// ===================== one row, while managing =====================

/** The read-mode row with a drag handle bolted to its left and a remove button
 *  on its right. Nothing inside it is editable — a position is set when it is
 *  added. */
function SortablePosition({
  row,
  disabled,
  onRemove,
}: {
  row: PositionDraft
  disabled: boolean
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.uid })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-1", isDragging && "opacity-40")}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none px-0.5 text-muted-foreground outline-none focus-visible:text-foreground"
        aria-label={`Reorder ${row.work_center}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripDots />
      </button>
      <div className="min-w-0 flex-1">
        <ManforPositionItem
          workCenter={row.work_center}
          skillLevel={row.skill_level}
          quantity={row.quantity}
          onRemove={onRemove}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

// ===================== the add form =====================

/** Where a position is authored, and the only place it can be.
 *
 *  Inline rather than behind a popover: three fields is not enough to hide,
 *  and keeping them permanently visible is what makes "set on add" read as the
 *  rule rather than as a missing edit button. */
function AddPositionForm({
  workCenters,
  disabled,
  onAdd,
}: {
  workCenters: WorkCenter[]
  disabled: boolean
  onAdd: (workCenter: string, skillLevel: number | null, qty: number) => void
}) {
  const [workCenter, setWorkCenter] = useState(workCenters[0]?.name ?? "")
  // Journeyman is the level a deployable slot is written at far more often
  // than any other — a starting point, not a rule.
  const [skillLevel, setSkillLevel] = useState<number | null>(5)
  const [qty, setQty] = useState(1)

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border p-2">
      <select
        value={workCenter}
        onChange={(e) => setWorkCenter(e.target.value)}
        disabled={disabled || workCenters.length === 0}
        aria-label="Shop"
        className={cn(SELECT_CLASS, "w-44")}
      >
        {workCenters.length === 0 && <option value="">No shops yet</option>}
        {workCenters.map((wc) => (
          <option key={wc.id} value={wc.name}>
            {wc.name}
          </option>
        ))}
      </select>
      <select
        value={skillLevel ?? ""}
        onChange={(e) =>
          setSkillLevel(e.target.value ? Number(e.target.value) : null)
        }
        disabled={disabled}
        aria-label="Skill level"
        className={SELECT_CLASS}
      >
        {/* Officer and civilian slots qualify some other way, so "no skill
            level" has to be sayable rather than merely unset. */}
        <option value="">No skill level</option>
        {SKILL_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l} lvl — {SKILL_LEVEL_LABELS[l]}
          </option>
        ))}
      </select>
      <span className="flex items-center overflow-hidden rounded-md border border-input">
        <button
          type="button"
          className="px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label="One fewer"
          disabled={disabled || qty <= 1}
          onClick={() => setQty(qty - 1)}
        >
          <Minus className="size-3" />
        </button>
        <span className="min-w-5 text-center text-[11px] tabular-nums">
          {qty}
        </span>
        <button
          type="button"
          className="px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="One more"
          disabled={disabled}
          onClick={() => setQty(qty + 1)}
        >
          <Plus className="size-3" />
        </button>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        disabled={disabled || workCenter === ""}
        onClick={() => {
          onAdd(workCenter, skillLevel, qty)
          // Shop and level stay put — adding several positions from one shop is
          // the common case — but the count goes back to one, which is what the
          // next position almost always calls for.
          setQty(1)
        }}
      >
        <Plus data-icon="inline-start" />
        Add position
      </Button>
    </div>
  )
}
