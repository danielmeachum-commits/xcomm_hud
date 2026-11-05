"use client"

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  GripVertical,
  Info,
  Minus,
  Pencil,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import { ManageBar } from "@/components/equipment/manage-bar"
import { UtcManforSection } from "@/components/equipment/utc-manfor-section"
import { UtcServicesSection } from "@/components/equipment/utc-services-section"
import {
  ColumnHeading,
  UtcDefContents,
} from "@/components/equipment/utc-def-contents"
import { Button } from "@/components/ui/button"
import { HorizontalScroller } from "@/components/ui/horizontal-scroller"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_VALUES,
  MEFPAK_HALVES,
  utcUsesEnclaves,
} from "@/lib/equipment-meta"
import type {
  Enclave,
  EquipmentType,
  Role,
  AssetCategory,
  ServiceTemplate,
  UtcDef,
  WorkCenter,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const LOGDET = MEFPAK_HALVES.logdet

const CODE_HINT = "Short-hand for the UTC — what gets said on a load plan."

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/** dnd-kit addresses every droppable by one id, and a column has to be
 *  distinguishable from the cards inside it. */
const COLUMN = "col:"
/** The untagged column. `enclave_id IS NULL` is a real slice of the bill of
 *  materials — gear that isn't any one network's — so it gets a column rather
 *  than being hidden. */
const COMMON = "common"

/** Global catalog rows are admin-managed; a workspace row needs operator.
 *  Mirrors `_require_write` in api/routers/equipment_catalog.py — the API is
 *  still the authority, this only decides whether to offer the button. */
function canEdit(def: UtcDef, role: Role): boolean {
  return def.is_global ? role === "admin" : role !== "viewer"
}

async function send(
  method: "PATCH" | "PUT",
  url: string,
  body: unknown,
): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return null
  const detail = await res.json().catch(() => ({}))
  return typeof detail.detail === "string" ? detail.detail : "Failed to save"
}

// ===================== line drafts =====================

/** One bill-of-materials line being edited. Unlike the package page, quantity
 *  is a number on the row rather than a count of repeated rows: a UTC can call
 *  for two dozen patch cables, and twenty-four identical cards is a column you
 *  scroll rather than a quantity you read. `uq_utc_def_line_type_enclave`
 *  forces the same conclusion — the same type cannot appear twice in one
 *  enclave, so a second card could never be saved anyway. */
interface LineDraft {
  /** Identity for React and dnd-kit, stable across a reorder. Seeded from the
   *  stored line id so the first render matches on server and client. */
  uid: string
  equipment_type_id: number
  enclave_id: number | null
  quantity: number
}

let addedRows = 0

function draftsOf(def: UtcDef): LineDraft[] {
  return [...def.lines]
    .sort((a, b) => a.display_order - b.display_order)
    .map((l) => ({
      uid: `l${l.id}`,
      equipment_type_id: l.equipment_type_id,
      enclave_id: l.enclave_id,
      quantity: Math.max(1, l.quantity),
    }))
}

/** Order is part of the value: `PUT /utc-defs/{id}/lines` writes
 *  `display_order` from the array index, so moving a card is a real change
 *  with nothing else to show for it. Hence a joined sequence, not a set. */
function signature(rows: LineDraft[]): string {
  return rows
    .map((r) => `${r.equipment_type_id}:${r.enclave_id ?? ""}:${r.quantity}`)
    .join("|")
}

/** Which enclaves currently have a column, derived from the lines rather than
 *  stored — the two can't drift that way. */
function activeFrom(rows: LineDraft[]): number[] {
  const out: number[] = []
  for (const r of rows) {
    if (r.enclave_id !== null && !out.includes(r.enclave_id)) out.push(r.enclave_id)
  }
  return out
}

/** Where the pointer is: a column when it's over the column's own padding,
 *  otherwise the column of the card under it. Returns null when neither, and
 *  a wrapper object rather than a bare value because `null` is itself a valid
 *  target — it's the Common column. */
function targetOf(
  overId: string,
  rows: LineDraft[],
): { enclave: number | null } | null {
  if (overId.startsWith(COLUMN)) {
    const raw = overId.slice(COLUMN.length)
    return { enclave: raw === COMMON ? null : Number(raw) }
  }
  const row = rows.find((r) => r.uid === overId)
  return row ? { enclave: row.enclave_id } : null
}

function columnId(enclaveId: number | null): string {
  return `${COLUMN}${enclaveId ?? COMMON}`
}

/** Pull a card out of the flat list and put it back under `enclave`, either in
 *  front of `overUid` or at the end of that column.
 *
 *  The list stays flat rather than becoming a map of columns: `display_order`
 *  is one sequence across the whole UTC, and rebuilding it from four buckets
 *  every save would invent an ordering the operator never chose. */
function move(
  rows: LineDraft[],
  activeUid: string,
  enclave: number | null,
  overUid: string | null,
): LineDraft[] {
  const active = rows.find((r) => r.uid === activeUid)
  if (!active) return rows
  const rest = rows.filter((r) => r.uid !== activeUid)
  const moved = { ...active, enclave_id: enclave }
  if (overUid) {
    const at = rest.findIndex((r) => r.uid === overUid)
    if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)]
  }
  let at = rest.length
  rest.forEach((r, i) => {
    if (r.enclave_id === enclave) at = i + 1
  })
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** Reorder without changing which column a card is in. What a non-comm UTC
 *  gets, since it has no columns — and rewriting `enclave_id` there would
 *  quietly discard tags left behind by a UTC that used to be comm. */
function reorder(
  rows: LineDraft[],
  activeUid: string,
  overUid: string,
): LineDraft[] {
  const from = rows.findIndex((r) => r.uid === activeUid)
  const to = rows.findIndex((r) => r.uid === overUid)
  if (from < 0 || to < 0 || from === to) return rows
  const next = [...rows]
  const [pulled] = next.splice(from, 1)
  next.splice(to, 0, pulled)
  return next
}

/** Fold a type that now appears twice in one column back into a single line
 *  carrying the sum.
 *
 *  `uq_utc_def_line_type_enclave` allows a type once per enclave, so this is
 *  not a preference — a second row is unsaveable. Deliberately the opposite of
 *  the package page, where a second copy IS the quantity. Runs at drop rather
 *  than while dragging: merging mid-drag would make the card vanish from under
 *  the pointer at the one moment it's too late to change your mind. */
function mergeDuplicates(rows: LineDraft[]): {
  rows: LineDraft[]
  merged: LineDraft | null
} {
  const out: LineDraft[] = []
  const seen = new Map<string, LineDraft>()
  let merged: LineDraft | null = null
  for (const r of rows) {
    const key = `${r.enclave_id ?? COMMON}:${r.equipment_type_id}`
    const hit = seen.get(key)
    if (hit) {
      hit.quantity += r.quantity
      merged = hit
      continue
    }
    const copy = { ...r }
    seen.set(key, copy)
    out.push(copy)
  }
  return { rows: out, merged }
}

// ===================== the page =====================

/** One UTC definition: what it is, and what it brings.
 *
 *  Read mode is the point of the page — the bill of materials laid out the way
 *  the UTC is described out loud. Manage turns that same layout into something
 *  you drag between, and a Cancel/Save bar appears the moment anything moves.
 *  Nothing is written until Save; nothing but the properties sits behind a
 *  panel.
 *
 *  `category` decides the whole layout: a comm UTC divides by enclave and gets
 *  a board, everything else gets one list. See `utcUsesEnclaves`. */
export function UtcDefDetailClient({
  def,
  types,
  enclaves,
  workCenters,
  templates,
  role,
}: {
  def: UtcDef
  types: EquipmentType[]
  enclaves: Enclave[]
  /** This workspace's shops, for the MANFOR picker. */
  workCenters: WorkCenter[]
  /** The service catalog, for the services this UTC brings up. */
  templates: ServiceTemplate[]
  role: Role
}) {
  const router = useRouter()
  const editable = canEdit(def, role)
  const usesEnclaves = utcUsesEnclaves(def.category)

  const [editingProperties, setEditingProperties] = useState(false)
  const [form, setForm] = useState<Form>(() => formOf(def))

  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<LineDraft[]>(() => draftsOf(def))
  /** Enclave ids with a visible column. Seeded from the lines, then owned by
   *  the chips so an empty column can exist while it's being filled in. */
  const [active, setActive] = useState<number[]>(() => activeFrom(draftsOf(def)))
  const [dragging, setDragging] = useState<string | null>(null)
  const beforeDrag = useRef<LineDraft[] | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** One-shot line about what a drop just did, shown in the action bar. A
   *  merge changes two cards into one, which is worth saying out loud. */
  const [notice, setNotice] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const typeById = useMemo(
    () => new Map(types.map((t) => [t.id, t])),
    [types],
  )
  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )

  const baseline = useMemo(() => draftsOf(def), [def])
  const dirty = signature(rows) !== signature(baseline)

  /** Enter saves, Escape cancels, from anywhere in edit mode. On the window
   *  because the add popover renders through a portal — a React portal still
   *  bubbles to its React parent, so a local handler would see Escape meant
   *  for the popover and drop the whole edit. */
  useEffect(() => {
    if (!editing) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          '[data-slot="popover-content"], [data-slot="sheet-content"]',
        )
      ) {
        return
      }
      if (e.key === "Escape") {
        // Mid-drag, Escape belongs to the drag.
        if (dragging) return
        e.preventDefault()
        cancel()
      } else if (e.key === "Enter" && dirty && !pending) {
        e.preventDefault()
        save()
      }
    }
    // Capture, so this sees Escape before dnd-kit does.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  function startEditing() {
    const fresh = draftsOf(def)
    setRows(fresh)
    setActive(activeFrom(fresh))
    setError(null)
    setNotice(null)
    setEditing(true)
  }

  function cancel() {
    const fresh = draftsOf(def)
    setRows(fresh)
    setActive(activeFrom(fresh))
    setError(null)
    setNotice(null)
    setEditing(false)
  }

  /** Dropping a column drops its contents — they only exist as part of that
   *  enclave's stack. Local until Save, so cancelling puts them back. */
  function toggleEnclave(id: number) {
    if (active.includes(id)) {
      setActive(active.filter((x) => x !== id))
      setRows(rows.filter((r) => r.enclave_id !== id))
    } else {
      setActive([...active, id])
    }
  }

  function addLine(typeId: number, enclaveId: number | null) {
    const held = rows.find(
      (r) => r.equipment_type_id === typeId && r.enclave_id === enclaveId,
    )
    // Picking a type the column already holds means one more of it — the
    // unique index leaves no other reading.
    if (held) {
      setRows(
        rows.map((r) =>
          r.uid === held.uid ? { ...r, quantity: r.quantity + 1 } : r,
        ),
      )
      return
    }
    setRows([
      ...rows,
      {
        uid: `new${++addedRows}`,
        equipment_type_id: typeId,
        enclave_id: enclaveId,
        quantity: 1,
      },
    ])
  }

  function setQuantity(uid: string, next: number) {
    setRows(
      rows.map((r) => (r.uid === uid ? { ...r, quantity: Math.max(1, next) } : r)),
    )
  }

  function removeLine(uid: string) {
    setRows(rows.filter((r) => r.uid !== uid))
  }

  function handleDragStart({ active: a }: DragStartEvent) {
    beforeDrag.current = rows
    setNotice(null)
    setDragging(String(a.id))
  }

  /** Crossing into another column moves the card *now*, while the pointer is
   *  still down. dnd-kit reflows a list by itself only within one
   *  SortableContext, and each column is its own — so with the move left until
   *  drop, dragging between columns showed nothing until the card teleported. */
  function handleDragOver({ active: a, over }: DragOverEvent) {
    if (!over) return
    const activeUid = String(a.id)
    const overId = String(over.id)
    if (activeUid === overId) return
    const row = rows.find((r) => r.uid === activeUid)
    if (!row) return

    if (!usesEnclaves) return

    const target = targetOf(overId, rows)
    if (!target || target.enclave === row.enclave_id) return
    setRows(
      move(
        rows,
        activeUid,
        target.enclave,
        overId.startsWith(COLUMN) ? null : overId,
      ),
    )
  }

  function handleDragEnd({ active: a, over }: DragEndEvent) {
    setDragging(null)
    beforeDrag.current = null
    if (!over) return
    const activeUid = String(a.id)
    const overId = String(over.id)
    if (activeUid === overId) return
    const row = rows.find((r) => r.uid === activeUid)
    if (!row) return

    if (!usesEnclaves) {
      setRows(reorder(rows, activeUid, overId))
      return
    }

    const target = targetOf(overId, rows)
    if (!target) return
    // Usually a no-op by now — the card crossed during the drag — but it's
    // what settles its final position inside the column.
    const moved = move(
      rows,
      activeUid,
      target.enclave,
      overId.startsWith(COLUMN) ? null : overId,
    )
    const { rows: settled, merged } = mergeDuplicates(moved)
    setRows(settled)
    if (merged) {
      const t = typeById.get(merged.equipment_type_id)
      const where =
        merged.enclave_id === null
          ? "Common"
          : enclaveById.get(merged.enclave_id)?.name ?? "that enclave"
      setNotice(
        `Merged — ${t?.short_name || t?.title || "that type"} can appear once ` +
          `per enclave, so ${where} now calls for ${merged.quantity}.`,
      )
    }
  }

  /** Escape mid-drag puts the list back as it was, since the drag has been
   *  rearranging it the whole way across. */
  function handleDragCancel() {
    setDragging(null)
    if (beforeDrag.current) setRows(beforeDrag.current)
    beforeDrag.current = null
  }

  async function save() {
    setPending(true)
    setError(null)
    const err = await send(
      "PUT",
      `/api/be/utc-defs/${def.id}/lines`,
      rows.map((r) => ({
        equipment_type_id: r.equipment_type_id,
        quantity: r.quantity,
        enclave_id: r.enclave_id,
      })),
    )
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setEditing(false)
    setNotice(null)
    // The page is a server component reading the UTC list, so a refresh is
    // what brings the saved lines back down.
    router.refresh()
  }

  /** Columns in catalog order, with Common last — it's the tail of the packing
   *  list, not the headline. In read mode a column holding nothing says
   *  nothing, so it doesn't appear. */
  const columns = useMemo(() => {
    const chosen = editing ? active : activeFrom(rows)
    const out: (Enclave | null)[] = enclaves
      .filter((e) => chosen.includes(e.id))
      .map((e) => e as Enclave | null)
    const hasCommon = rows.some((r) => r.enclave_id === null)
    if (editing || hasCommon) out.push(null)
    return out
  }, [enclaves, active, rows, editing])

  const CategoryIcon = ASSET_CATEGORY_ICONS[def.category]

  return (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-6",
        // A board needs the width; a plain list reads better narrow, and
        // matches the package page it sits beside.
        usesEnclaves ? "max-w-5xl" : "max-w-lg",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            <span>{def.name}</span>
            <CodeBadge code={def.code} tone="strong" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <CategoryIcon className="size-3" />
              {ASSET_CATEGORY_LABELS[def.category]}
            </span>
          </h1>
          {def.description ? (
            <p className="text-sm text-muted-foreground">{def.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground/60">No description.</p>
          )}
        </div>
        {editable && !editing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setForm(formOf(def))
              setEditingProperties(true)
            }}
          >
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        )}
      </header>

      {/* MANFOR first, LOGDET second — the order MEFPAK names the two halves
          in, and the order a deployment is actually built: people, then the
          gear they take. */}
      <UtcManforSection
        def={def}
        workCenters={workCenters}
        editable={editable}
      />

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <LOGDET.icon className="size-4 text-muted-foreground" />
                {LOGDET.plain}
              </h2>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {LOGDET.code}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {usesEnclaves
                ? "What this UTC brings, by the enclave it serves."
                : "What this UTC brings. Not tied to a network."}
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

        {editing && usesEnclaves && enclaves.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Enclaves this UTC supports
            </span>
            <div className="flex flex-wrap gap-1.5">
              {enclaves.map((en) => {
                const on = active.includes(en.id)
                const n = rows.filter((r) => r.enclave_id === en.id).length
                return (
                  <button
                    key={en.id}
                    type="button"
                    aria-pressed={on}
                    disabled={pending}
                    onClick={() => toggleEnclave(en.id)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? enclaveChipClass(en.color)
                        : "border-dashed text-muted-foreground hover:text-foreground",
                    )}
                    style={on ? enclaveChipStyle(en.color) : undefined}
                    title={
                      on
                        ? `Remove the ${en.name} column and its ${n} line${n === 1 ? "" : "s"}`
                        : `Add a ${en.name} column`
                    }
                  >
                    <span>{en.short_name || en.name}</span>
                    {on && n > 0 && (
                      <span className="tabular-nums opacity-75">{n}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {editing ? (
          <>
            <DndContext
              sensors={sensors}
              // Corners rather than centers: with several columns side by side,
              // an empty column's center is a long way from a card being
              // dragged past it and closestCenter skips over it.
              collisionDetection={closestCorners}
              // Empty columns only exist once a drag is under way, so their
              // rects have to be taken during the drag rather than before it.
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              {usesEnclaves ? (
                <HorizontalScroller
                  label={`${def.code} bill of materials, by enclave`}
                  className="flex items-start gap-3 pb-2"
                >
                  {columns.map((en) => (
                    <LineColumn
                      key={en?.id ?? COMMON}
                      enclave={en}
                      rows={rows.filter((r) =>
                        en ? r.enclave_id === en.id : r.enclave_id === null,
                      )}
                      typeById={typeById}
                      types={types}
                      allRows={rows}
                      disabled={pending}
                      onAdd={addLine}
                      onQuantity={setQuantity}
                      onRemove={removeLine}
                    />
                  ))}
                </HorizontalScroller>
              ) : (
                <div className="flex flex-col gap-2">
                  <SortableContext
                    items={rows.map((r) => r.uid)}
                    strategy={verticalListSortingStrategy}
                  >
                    {rows.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                        Nothing yet.
                      </p>
                    ) : (
                      rows.map((row) => (
                        <LineCard
                          key={row.uid}
                          row={row}
                          type={typeById.get(row.equipment_type_id) ?? null}
                          disabled={pending}
                          onQuantity={setQuantity}
                          onRemove={removeLine}
                        />
                      ))
                    )}
                  </SortableContext>
                  <AddTypePopover
                    enclave={null}
                    types={types}
                    rows={rows}
                    disabled={pending}
                    onAdd={addLine}
                  />
                </div>
              )}
            </DndContext>

            <ManageBar
              hint={
                usesEnclaves
                  ? "Drag an item between enclaves, or add one."
                  : "Add or remove items."
              }
              notice={notice}
              error={error}
              dirty={dirty}
              pending={pending}
              onCancel={cancel}
              onSave={save}
            />
          </>
        ) : (
          /* Read mode is the shared renderer, so this page and the peek sheet
             on the package page can never describe the same UTC differently.
             It reads `def` rather than `rows`: outside edit mode the two agree,
             and the saved row is the honest source. */
          <UtcDefContents def={def} enclaves={enclaves} />
        )}
      </section>

      {/* After the LOGDET, because every service here is wired to gear on it. */}
      <UtcServicesSection
        def={def}
        types={types}
        enclaves={enclaves}
        templates={templates}
        editable={editable}
      />

      {!editable && (
        <p className="text-xs text-muted-foreground">
          {def.is_global
            ? "Read-only — global catalog rows are admin-managed."
            : "Read-only — editing requires the operator role."}
        </p>
      )}

      <PropertiesSheet
        def={def}
        form={form}
        setForm={setForm}
        open={editingProperties}
        onClose={() => setEditingProperties(false)}
      />
    </div>
  )
}

// ===================== one column =====================

function LineColumn({
  enclave,
  rows,
  typeById,
  types,
  allRows,
  disabled,
  onAdd,
  onQuantity,
  onRemove,
}: {
  enclave: Enclave | null
  rows: LineDraft[]
  typeById: Map<number, EquipmentType>
  types: EquipmentType[]
  allRows: LineDraft[]
  disabled: boolean
  onAdd: (typeId: number, enclaveId: number | null) => void
  onQuantity: (uid: string, next: number) => void
  onRemove: (uid: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId(enclave?.id ?? null),
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-60 shrink-0 flex-col gap-2 rounded-2xl border border-transparent p-2 transition-colors",
        isOver && "border-ring/40 bg-muted/50",
      )}
    >
      <ColumnHeading
        enclave={enclave}
        units={rows.reduce((a, r) => a + r.quantity, 0)}
      />

      <SortableContext
        items={rows.map((r) => r.uid)}
        strategy={verticalListSortingStrategy}
      >
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-center text-xs text-muted-foreground">
            Drop here
          </p>
        ) : (
          rows.map((row) => (
            <LineCard
              key={row.uid}
              row={row}
              type={typeById.get(row.equipment_type_id) ?? null}
              disabled={disabled}
              onQuantity={onQuantity}
              onRemove={onRemove}
            />
          ))
        )}
      </SortableContext>

      <AddTypePopover
        enclave={enclave}
        types={types}
        rows={allRows}
        disabled={disabled}
        onAdd={onAdd}
      />
    </div>
  )
}

// ===================== one editable card =====================

/** A quantity of one shows nothing until you reach for it: most lines are a
 *  single item, and a stepper on every card makes a packing list look like a
 *  form. Hover or keyboard focus swaps the count for the control. */
function LineCard({
  row,
  type,
  disabled,
  onQuantity,
  onRemove,
}: {
  row: LineDraft
  type: EquipmentType | null
  disabled: boolean
  onQuantity: (uid: string, next: number) => void
  onRemove: (uid: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.uid })

  const what = type ? type.short_name || type.title : "this item"

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 rounded-xl border border-border bg-card p-2 text-sm",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground outline-none focus-visible:text-foreground"
        aria-label={`Reorder ${what}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>

      {/* The card is narrow, so long titles truncate — the tooltip shows
          the full name. */}
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 flex-1" />}>
          <span className="block truncate font-medium">
            {type?.title ?? "Unknown equipment type"}
          </span>
          {type?.short_name && (
            <span className="block truncate text-[11px] text-muted-foreground">
              {type.short_name}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>
          {type?.title ?? "Unknown equipment type"}
        </TooltipContent>
      </Tooltip>

      {/* The count and the stepper occupy the same slot — one is always
          hidden, so the card never changes width on hover. */}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-focus-within:hidden group-hover:hidden">
        {row.quantity > 1 ? `×${row.quantity}` : ""}
      </span>
      <span className="hidden shrink-0 items-center overflow-hidden rounded-md border border-input group-focus-within:flex group-hover:flex">
        <button
          type="button"
          className="px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label={`One fewer ${what}`}
          disabled={disabled || row.quantity <= 1}
          onClick={() => onQuantity(row.uid, row.quantity - 1)}
        >
          <Minus className="size-3" />
        </button>
        <span className="min-w-5 text-center text-[11px] tabular-nums">
          {row.quantity}
        </span>
        <button
          type="button"
          className="px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`One more ${what}`}
          disabled={disabled}
          onClick={() => onQuantity(row.uid, row.quantity + 1)}
        >
          <Plus className="size-3" />
        </button>
      </span>

      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
        aria-label={`Remove ${what}`}
        disabled={disabled}
        onClick={() => onRemove(row.uid)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ===================== add popover =====================

/** Non-typeable markers carried inside the cmdk `value`, so the filter below
 *  can read a type's standing -- and keep each value unique -- without either
 *  fact becoming searchable text. Control characters precisely because no
 *  search box can produce them. */
const DECLARED = "\u0001"
const IDMARK = "\u0002"

function itemValue(t: EquipmentType, declared: boolean): string {
  const parts = [t.title, t.short_name ?? "", ...t.aliases]
  return `${declared ? DECLARED : ""}${parts.join(" ")}${IDMARK}${t.id}`
}

/** Search title, short name and aliases — so "crypto" finds a TACLANE, the way
 *  `GET /equipment?search=` already matches.
 *
 *  Two things are ranked, in this order: whether the type declares the column's
 *  enclave, then how well it matches. The +10 is deliberately larger than any
 *  match score, because cmdk orders groups by their best item and the column
 *  you opened the menu from should decide the order rather than the query. */
function rankTypes(value: string, search: string): number {
  const declared = value.startsWith(DECLARED)
  const cut = value.indexOf(IDMARK)
  const hay = (cut >= 0 ? value.slice(0, cut) : value)
    .replace(DECLARED, "")
    .trim()
    .toLowerCase()
  const q = search.trim().toLowerCase()

  let s: number
  if (!q) {
    s = 1
  } else {
    const at = hay.indexOf(q)
    if (at < 0) return 0
    // A hit at the start of a word outranks one buried mid-string, so "cat"
    // puts CAT6 above Cisco Catalyst.
    s = at === 0 || hay[at - 1] === " " ? 3 : 1
  }
  return declared ? s + 10 : s
}

/** Which types this column can hold. A type declaring no enclaves is
 *  unrestricted, not "capable of nothing" — the same convention the rest of
 *  the catalog uses, and the same rule `UtcLineEditor` applies. */
function offeredFor(types: EquipmentType[], enclave: Enclave | null) {
  const usable = enclave
    ? types.filter(
        (t) => t.enclave_ids.length === 0 || t.enclave_ids.includes(enclave.id),
      )
    : types
  return {
    declared: enclave
      ? usable.filter((t) => t.enclave_ids.includes(enclave.id))
      : [],
    open: enclave ? usable.filter((t) => t.enclave_ids.length === 0) : usable,
  }
}

function AddTypePopover({
  enclave,
  types,
  rows,
  disabled,
  onAdd,
}: {
  enclave: Enclave | null
  types: EquipmentType[]
  rows: LineDraft[]
  disabled: boolean
  onAdd: (typeId: number, enclaveId: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const { declared, open: unrestricted } = useMemo(
    () => offeredFor(types, enclave),
    [types, enclave],
  )

  /** How many of each type this column already holds, so picking one again
   *  reads as one more of the same rather than as a duplicate. */
  const held = useMemo(() => {
    const out = new Map<number, number>()
    for (const r of rows) {
      if (r.enclave_id !== (enclave?.id ?? null)) continue
      out.set(r.equipment_type_id, r.quantity)
    }
    return out
  }, [rows, enclave])

  function row(t: EquipmentType, isDeclared: boolean) {
    const have = held.get(t.id)
    return (
      <CommandItem
        key={t.id}
        value={itemValue(t, isDeclared)}
        onSelect={() => {
          onAdd(t.id, enclave?.id ?? null)
          setOpen(false)
        }}
      >
        <span className="min-w-0 flex-1 truncate">{t.title}</span>
        {t.short_name && <CodeBadge code={t.short_name} />}
        {have !== undefined && (
          <CommandShortcut>{`${have} → ${have + 1}`}</CommandShortcut>
        )}
      </CommandItem>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center border border-dashed border-border text-muted-foreground"
            disabled={disabled}
          />
        }
      >
        <Plus data-icon="inline-start" />
        Add item
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command filter={rankTypes}>
          <CommandInput placeholder="Search equipment types…" />
          <CommandList>
            <CommandEmpty>No equipment type matches.</CommandEmpty>
            {declared.length > 0 && (
              <CommandGroup heading={`Declared for ${enclave?.name}`}>
                {declared.map((t) => row(t, true))}
              </CommandGroup>
            )}
            {unrestricted.length > 0 && (
              <CommandGroup
                heading={enclave ? "Any enclave" : "Equipment types"}
              >
                {unrestricted.map((t) => row(t, false))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ===================== properties panel =====================

interface Form {
  name: string
  code: string
  category: AssetCategory
  description: string
}

function formOf(def: UtcDef): Form {
  return {
    name: def.name,
    code: def.code,
    category: def.category,
    description: def.description ?? "",
  }
}

/** Name, code, category, description — the order they're decided in. Category
 *  sits with the identity fields rather than under the bill of materials
 *  because it says what the UTC IS, even though changing it is what re-lays
 *  out everything below. */
function PropertiesSheet({
  def,
  form,
  setForm,
  open,
  onClose,
}: {
  def: UtcDef
  form: Form
  setForm: (form: Form) => void
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setError(null)
    onClose()
  }

  const unchanged =
    form.name.trim() === def.name &&
    form.code.trim() === def.code &&
    form.category === def.category &&
    form.description.trim() === (def.description ?? "")

  async function save() {
    setPending(true)
    setError(null)
    const err = await send("PATCH", `/api/be/utc-defs/${def.id}`, {
      name: form.name.trim(),
      code: form.code.trim(),
      category: form.category,
      description: form.description.trim() || null,
    })
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    close()
    router.refresh()
  }

  const blocked = pending || unchanged || !form.name.trim() || !form.code.trim()

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit UTC definition</SheetTitle>
          <SheetDescription>
            How this UTC is named, classified and described.
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked) save()
          }}
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="utc-name">Name</Label>
              <Input
                id="utc-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="utc-code" className="gap-1.5">
                Code
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`About the code field. ${CODE_HINT}`}
                        className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                      />
                    }
                  >
                    <Info className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="left">{CODE_HINT}</TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="utc-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={pending}
                className="font-mono uppercase"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="utc-category">Category</Label>
              <select
                id="utc-category"
                className={SELECT_CLASS}
                value={form.category}
                disabled={pending}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as AssetCategory })
                }
              >
                {ASSET_CATEGORY_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Communications UTCs are laid out by enclave. Everything else
                gets one list — HVAC and power have no network to divide along.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="utc-description">Description</Label>
              <Textarea
                id="utc-description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                disabled={pending}
                rows={4}
              />
            </div>
          </div>

          <SheetFooter className="flex-col items-stretch gap-2">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={blocked}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
