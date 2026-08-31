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
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronLeft,
  Check,
  Info,
  Pencil,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import { UtcDefPeekSheet } from "@/components/equipment/utc-def-peek-sheet"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
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
import {
  UTC_ROLE_HINT_ICONS,
  UTC_ROLE_HINT_LABELS,
  UTC_ROLE_HINT_VALUES,
} from "@/lib/equipment-meta"
import type {
  Enclave,
  PackageDef,
  PackageDefUtc,
  Role,
  UtcDef,
  UtcRoleHint,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/** What the Code field means, said once. The rule is real — operators coin the
 *  code by rearranging the title's letters — and it is not guessable from a
 *  four-character string, so the form has to say it. */
const CODE_HINT = "Short-hand for the package title — usually an anagram of it."

/** dnd-kit addresses every droppable by one id, and a role group has to be
 *  distinguishable from the rows inside it. */
const GROUP = "group:"

/** Global catalog rows are admin-managed; a workspace row needs operator.
 *  Mirrors `_require_write` in api/routers/equipment_catalog.py — the API is
 *  still the authority, this only decides whether to offer the button. */
function canEdit(def: PackageDef, role: Role): boolean {
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

// ===================== UTC drafts =====================

/** One unit of one UTC. A package that carries two of something is two of
 *  these, not one row wearing a count: an operator reads a package as the list
 *  of things it puts on the ground, and "×2" is a number to decode rather than
 *  a thing to see. Quantity survives only at the edges — the API still stores
 *  one row per (UTC, role) with a count — so `draftsOf` expands it on the way
 *  in and `collapse` folds it back on the way out. */
interface UtcDraft {
  /** Identity for React and for dnd-kit, stable across a reorder — the array
   *  index is not, and sorting by index makes the dragged row swap places with
   *  its own ghost. Seeded from the membership row's id plus which copy this
   *  is, so the first render matches on the server and the client. */
  uid: string
  utc_def_id: number
  /** Which group the row currently sits in. No longer picked on the row: the
   *  group *is* the role, so this is set by where the row was dropped. */
  role_hint: UtcRoleHint
}

/** One line as the API stores it — what `collapse` produces and `saveUtcs`
 *  sends. */
interface UtcLine {
  utc_def_id: number
  quantity: number
  role_hint: UtcRoleHint
}

let addedRows = 0

function sortedUtcs(def: PackageDef): PackageDefUtc[] {
  return [...def.utcs].sort((a, b) => a.display_order - b.display_order)
}

function draftsOf(def: PackageDef): UtcDraft[] {
  return sortedUtcs(def).flatMap((u) =>
    repeat(u.quantity).map((i) => ({
      uid: `u${u.id}#${i}`,
      utc_def_id: u.utc_def_id,
      role_hint: u.role_hint,
    })),
  )
}

/** `[0, 1, … n-1]`, and never empty: a stored quantity of zero would otherwise
 *  make a membership row vanish from a list whose whole job is to show it. */
function repeat(n: number): number[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => i)
}

/** Fold the unit rows back into what the API stores: one line per (UTC, role)
 *  carrying a count, so `uq_package_def_utc_role` stays satisfied however many
 *  copies the operator laid out. A line takes its place in the sequence from
 *  where its first copy sits. */
function collapse(rows: UtcDraft[]): UtcLine[] {
  const lines: UtcLine[] = []
  const byPair = new Map<string, UtcLine>()
  for (const r of rows) {
    const key = `${r.utc_def_id}:${r.role_hint}`
    const line = byPair.get(key)
    if (line) {
      line.quantity += 1
      continue
    }
    const fresh = { utc_def_id: r.utc_def_id, quantity: 1, role_hint: r.role_hint }
    byPair.set(key, fresh)
    lines.push(fresh)
  }
  return lines
}

/** Order is part of the value: `PUT /package-defs/{id}/utcs` writes
 *  `display_order` from the array index, so moving a row is a real change with
 *  nothing else to show for it. Hence a joined sequence rather than a set
 *  comparison.
 *
 *  Taken over the collapsed lines rather than the rows, because that is what
 *  actually gets written: dragging one of two identical copies past the other
 *  rearranges the list without changing the package, and the Save button
 *  should not light up for it. */
function signature(rows: UtcDraft[]): string {
  return collapse(rows)
    .map((l) => `${l.utc_def_id}:${l.quantity}:${l.role_hint}`)
    .join("|")
}

/** Pull a row out of the flat list and put it back under `role`, either in
 *  front of `overUid` or at the end of that group.
 *
 *  Nothing merges any more. Dropping a UTC into a role that already carries it
 *  used to fold the two together and sum their counts; now the copy *is* the
 *  count, so the drop simply leaves two rows side by side and `collapse` is
 *  what turns them back into a quantity at save time.
 *
 *  The list stays flat rather than becoming a map of groups: `display_order` is
 *  one sequence across the whole package, and rebuilding it from five buckets
 *  every save would invent an ordering the operator never chose. */
function move(
  rows: UtcDraft[],
  activeUid: string,
  role: UtcRoleHint,
  overUid: string | null,
): UtcDraft[] {
  const active = rows.find((r) => r.uid === activeUid)
  if (!active) return rows
  const rest = rows.filter((r) => r.uid !== activeUid)
  const moved = { ...active, role_hint: role }
  if (overUid) {
    const at = rest.findIndex((r) => r.uid === overUid)
    if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)]
  }
  // Dropped on the group itself rather than on one of its rows: land after
  // whatever it already holds, or at the end when it holds nothing.
  let at = rest.length
  rest.forEach((r, i) => {
    if (r.role_hint === role) at = i + 1
  })
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

// ===================== the page =====================

/** One package definition: what it is, and what it carries.
 *
 *  Read mode is the point of the page — a light list of the UTCs, no editor
 *  chrome. Manage turns that same list into role groups you drag between, and a
 *  Cancel/Save bar appears the moment anything moves. Nothing is written until
 *  Save; nothing but the description sits behind a panel. */
export function PackageDetailClient({
  def,
  utcDefs,
  enclaves,
  role,
}: {
  def: PackageDef
  utcDefs: UtcDef[]
  /** Only used to name the columns in the peek sheet — the package itself has
   *  no enclave dimension. */
  enclaves: Enclave[]
  role: Role
}) {
  const router = useRouter()
  const editable = canEdit(def, role)

  /** Which UTC's contents are open over the page, if any. */
  const [peek, setPeek] = useState<UtcDef | null>(null)
  const [editingProperties, setEditingProperties] = useState(false)
  /** Seeded on the click that opens the panel rather than by an effect: opening
   *  is an event, and reseeding on every `def` change would re-run on the
   *  `router.refresh()` that follows a save. Seeding on open also makes Cancel
   *  mean what it says — the next open starts from the saved row. */
  const [form, setForm] = useState<Form>(() => formOf(def))

  const [editingUtcs, setEditingUtcs] = useState(false)
  const [rows, setRows] = useState<UtcDraft[]>(() => draftsOf(def))
  const [dragging, setDragging] = useState<string | null>(null)
  /** The list as it stood when the drag began. A drag now rearranges `rows`
   *  live, so Escape has to have something to put back.
   *
   *  A ref rather than state: nothing renders from it, and writing it should
   *  not cost a render in the middle of a drag. */
  const beforeDrag = useRef<UtcDraft[] | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking the handle to
    // focus it does not read as a grab.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Reordering without a mouse: focus the handle, space, arrows, space.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const utcById = useMemo(
    () => new Map(utcDefs.map((d) => [d.id, d])),
    [utcDefs],
  )

  const links = useMemo(() => sortedUtcs(def), [def])

  const dirty = signature(rows) !== signature(draftsOf(def))

  const draggingRow = rows.find((r) => r.uid === dragging) ?? null

  /** How many of each UTC each role already carries, so the add flow can say
   *  what picking a role again would do — raise that count — instead of
   *  striking the role out. */
  const counts = useMemo(() => {
    const out = new Map<number, Map<UtcRoleHint, number>>()
    for (const r of rows) {
      const byRole = out.get(r.utc_def_id) ?? new Map<UtcRoleHint, number>()
      byRole.set(r.role_hint, (byRole.get(r.role_hint) ?? 0) + 1)
      out.set(r.utc_def_id, byRole)
    }
    return out
  }, [rows])

  /** Adding a UTC to a role it is already in makes a second row, which is what
   *  two of something looks like everywhere else on the page. */
  function addUtc(utc: UtcDef, role: UtcRoleHint) {
    setRows([
      ...rows,
      { uid: `new${++addedRows}`, utc_def_id: utc.id, role_hint: role },
    ])
  }

  /** Enter saves, Escape cancels, from anywhere in edit mode.
   *
   *  On the window rather than a wrapper div because the add popover renders
   *  through a portal: a React portal still bubbles events to its React parent,
   *  so a local handler would see Escape meant for the popover and drop the
   *  whole edit. Overlays are skipped explicitly instead — Escape inside the
   *  popover or the properties sheet belongs to them. */
  useEffect(() => {
    if (!editingUtcs) return
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
        // Mid-drag, Escape belongs to the drag: dnd-kit cancels it and
        // `handleDragCancel` puts the list back where it was. Tearing down the
        // whole edit — every other change in it included — is a wild
        // overreaction to backing out of one drag.
        if (dragging) return
        e.preventDefault()
        cancelUtcs()
      } else if (e.key === "Enter" && dirty && !pending) {
        e.preventDefault()
        saveUtcs()
      }
    }
    // Capture, so this sees Escape before dnd-kit does. In the bubble phase it
    // does not: dnd-kit cancels the drag on the way up, React flushes that
    // re-render before the event reaches the window, and the listener the
    // render re-registered then reads `dragging` as already null — so an
    // Escape meant for the drag would tear down the whole edit.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  function startEditingUtcs() {
    setRows(draftsOf(def))
    setError(null)
    setEditingUtcs(true)
  }

  function cancelUtcs() {
    setRows(draftsOf(def))
    setError(null)
    setEditingUtcs(false)
  }

  function handleDragStart({ active }: DragStartEvent) {
    beforeDrag.current = rows
    setDragging(String(active.id))
  }

  /** Which role the pointer is over — the group itself when it is over the
   *  group's own padding, otherwise the role of the row under it. */
  function roleUnder(overId: string): UtcRoleHint | undefined {
    return overId.startsWith(GROUP)
      ? (overId.slice(GROUP.length) as UtcRoleHint)
      : rows.find((r) => r.uid === overId)?.role_hint
  }

  /** Crossing into another role moves the row *now*, while the pointer is still
   *  down.
   *
   *  dnd-kit reflows a list by itself only within one SortableContext, and each
   *  role group is its own — so with the move left until drag end, dragging
   *  between groups showed nothing at all until the drop, and the row appeared
   *  to teleport at the one moment it was too late to change your mind.
   *
   *  Reordering inside a role still needs nothing here: that is the case
   *  dnd-kit already previews. */
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    const activeUid = String(active.id)
    const overId = String(over.id)
    if (activeUid === overId) return
    const row = rows.find((r) => r.uid === activeUid)
    if (!row) return
    const target = roleUnder(overId)
    if (!target || target === row.role_hint) return
    setRows(
      move(rows, activeUid, target, overId.startsWith(GROUP) ? null : overId),
    )
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null)
    beforeDrag.current = null
    if (!over) return
    const activeUid = String(active.id)
    const overId = String(over.id)
    if (activeUid === overId) return
    const row = rows.find((r) => r.uid === activeUid)
    if (!row) return
    const target = roleUnder(overId)
    if (!target) return

    // Usually a no-op by now — the row crossed into this group during the drag
    // — but it is what settles its final position inside it.
    setRows(
      move(rows, activeUid, target, overId.startsWith(GROUP) ? null : overId),
    )
  }

  /** Escape mid-drag puts the list back as it was, since the drag has been
   *  rearranging it the whole way across. */
  function handleDragCancel() {
    setDragging(null)
    if (beforeDrag.current) setRows(beforeDrag.current)
    beforeDrag.current = null
  }

  async function saveUtcs() {
    setPending(true)
    setError(null)
    const err = await send(
      "PUT",
      `/api/be/package-defs/${def.id}/utcs`,
      collapse(rows),
    )
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setEditingUtcs(false)
    // The page is a server component reading the package list, so a refresh is
    // what brings the saved list back down.
    router.refresh()
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            <span>{def.name}</span>
            <CodeBadge code={def.code} tone="strong" />
          </h1>
          {def.description ? (
            <p className="text-sm text-muted-foreground">{def.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground/60">No description.</p>
          )}
        </div>
        {editable && (
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

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Unit type codes</h2>
          {/* While editing, the action bar is the only way out — a second exit
              up here was easy to miss and, once dirty, would have been a button
              that silently discarded the edit. */}
          {editable && !editingUtcs && (
            <Button variant="ghost" size="sm" onClick={startEditingUtcs}>
              <SlidersHorizontal data-icon="inline-start" />
              Manage
            </Button>
          )}
        </div>

        {editingUtcs ? (
          <>
            <DndContext
              sensors={sensors}
              // Corners rather than centers: with several containers stacked,
              // an empty group's center is a long way from a row being dragged
              // past it and closestCenter skips over it.
              collisionDetection={closestCorners}
              // Empty groups only exist once a drag is under way, so their
              // rects have to be taken during the drag rather than before it.
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="flex flex-col gap-3">
                {UTC_ROLE_HINT_VALUES.map((r) => (
                  <RoleGroup
                    key={r}
                    role={r}
                    rows={rows.filter((row) => row.role_hint === r)}
                    utcById={utcById}
                    dragging={draggingRow !== null}
                    disabled={pending}
                    onRemove={(uid) =>
                      setRows(rows.filter((row) => row.uid !== uid))
                    }
                  />
                ))}
              </div>
            </DndContext>

            <AddUtcPopover
              utcDefs={utcDefs}
              counts={counts}
              disabled={pending}
              onAdd={addUtc}
            />

            {/* Always on while editing, so leaving the mode is never something
                you have to go looking for. Its buttons follow the state:
                nothing to save yet means one Done, and the moment there is,
                Cancel and Save take over. */}
            {/* Sticky to the bottom of the scrolling pane: with five groups
                open the bar is well below the fold, and an action bar you have
                to scroll to find is one you will not find. */}
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/85 p-2 pl-3.5 shadow-lg backdrop-blur-sm">
              <p
                className={cn(
                  "mr-auto text-xs",
                  error ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {error ??
                  (dirty
                    ? "Unsaved changes."
                    : "Drag a UTC between roles, or add one.")}
              </p>
              {dirty ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelUtcs}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveUtcs} disabled={pending}>
                    {pending ? "Saving…" : "Save"}
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={cancelUtcs}>
                  <Check data-icon="inline-start" />
                  Done
                </Button>
              )}
            </div>
          </>
        ) : links.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No UTCs — this package definition is empty.
          </p>
        ) : (
          /* Role is a heading, not a badge on the row. It is the one thing
             every row in a group shares, and saying it once above them is what
             makes the page read as the shape of the package rather than as a
             list of UTCs that each happen to carry a role. Read mode groups
             exactly the way manage mode does, so nothing jumps when you cross
             between them.

             Name, code and nothing else on a row. What a UTC is made of lives
             on its own definition page; repeating it here buries the one thing
             this page is for. */
          <div className="flex flex-col gap-4">
            {UTC_ROLE_HINT_VALUES.map((role) => {
              const inRole = links.filter((l) => l.role_hint === role)
              if (inRole.length === 0) return null
              const RoleIcon = UTC_ROLE_HINT_ICONS[role]
              return (
                <div key={role} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-1">
                    <RoleIcon className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">
                      {UTC_ROLE_HINT_LABELS[role]}
                    </h3>
                  </div>
                  <ItemGroup>
                    {/* Two of a UTC is two rows. A count beside one row was a
                        number to decode; the second row is the thing itself. */}
                    {inRole.flatMap((link) => {
                      const utc = utcById.get(link.utc_def_id)
                      return repeat(link.quantity).map((i) => (
                        <Item
                          key={`${link.id}#${i}`}
                          variant="muted"
                          size="sm"
                          // What a UTC actually brings is the next question a
                          // reader has, and it is answered without leaving the
                          // package. A button, not a link: this opens a sheet
                          // over this page rather than navigating anywhere.
                          render={
                            <button
                              type="button"
                              disabled={!utc}
                              onClick={() => utc && setPeek(utc)}
                              aria-label={`Show what ${utc?.name ?? "this UTC"} brings`}
                              className="cursor-pointer text-left hover:bg-muted disabled:cursor-default"
                            />
                          }
                        >
                          <ItemContent>
                            <ItemTitle className="flex-wrap gap-2">
                              <span>
                                {utc?.name ??
                                  link.utc_def_name ??
                                  "Unknown UTC"}
                              </span>
                              <CodeBadge
                                code={utc?.code ?? link.utc_def_code ?? "—"}
                              />
                            </ItemTitle>
                          </ItemContent>
                        </Item>
                      ))
                    })}
                  </ItemGroup>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {!editable && (
        <p className="text-xs text-muted-foreground">
          {def.is_global
            ? "Read-only — global catalog rows are admin-managed."
            : "Read-only — editing requires the operator role."}
        </p>
      )}

      <UtcDefPeekSheet
        def={peek}
        enclaves={enclaves}
        onClose={() => setPeek(null)}
      />

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

// ===================== one role group =====================

/** A role is a container, not a field on a row: which group a UTC sits in is
 *  what gives it its role.
 *
 *  A role holding nothing is not shown at rest — five headings over four empty
 *  boxes described the vocabulary rather than the package. It appears the
 *  moment a drag starts, which is the only time an empty role is useful, and
 *  goes away again on drop. */
function RoleGroup({
  role,
  rows,
  utcById,
  dragging,
  disabled,
  onRemove,
}: {
  role: UtcRoleHint
  rows: UtcDraft[]
  utcById: Map<number, UtcDef>
  dragging: boolean
  disabled: boolean
  onRemove: (uid: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${GROUP}${role}` })
  const Icon = UTC_ROLE_HINT_ICONS[role]

  if (rows.length === 0 && !dragging) return null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-transparent p-2 transition-colors",
        isOver && "border-ring/40 bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2 px-1">
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{UTC_ROLE_HINT_LABELS[role]}</h3>
      </div>

      <SortableContext
        items={rows.map((r) => r.uid)}
        strategy={verticalListSortingStrategy}
      >
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
            Drop here
          </p>
        ) : (
          rows.map((row) => (
            <UtcEditorRow
              key={row.uid}
              row={row}
              utc={utcById.get(row.utc_def_id) ?? null}
              disabled={disabled}
              onRemove={() => onRemove(row.uid)}
            />
          ))
        )}
      </SortableContext>
    </div>
  )
}

// ===================== one editable row =====================

/** With the role carried by the group and the count carried by the number of
 *  rows, a row is down to what it is — so it reads exactly like the read-mode
 *  item it replaces, rather than like a form. Remove keeps its own full-height
 *  rail: nothing wraps around the one control on the row that destroys
 *  something.
 *
 *  Removing takes away one copy, because a row *is* one copy. Two of a UTC
 *  therefore takes two clicks to clear, which is the honest price of never
 *  making the operator edit a number to change what the package carries. */
function UtcEditorRow({
  row,
  utc,
  disabled,
  onRemove,
}: {
  row: UtcDraft
  utc: UtcDef | null
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

  const what = utc ? `${utc.code} ${utc.name}` : "this UTC"

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-1",
        // Lifted off the stack while it travels, so it reads as the thing being
        // moved rather than a row the list happens to be shuffling around.
        isDragging && "z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${what}`}
        disabled={disabled}
        className="flex cursor-grab items-center self-stretch rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
      >
        <GripDots />
      </button>

      {/* Code first, then name — the order the add list uses. You pick a row
          out of this list by its code, so the code is what the eye should hit
          in both places. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {utc && <CodeBadge code={utc.code} />}
        <span className="truncate text-sm">{utc?.name ?? "Unknown UTC"}</span>
      </div>

      <div className="flex shrink-0 items-center self-stretch border-l border-border pl-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${what}`}
          disabled={disabled}
          onClick={onRemove}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X />
        </Button>
      </div>
    </div>
  )
}

/** lucide's GripVertical at this size renders as two thin strokes rather than
 *  the six dots the icon is meant to be, which reads as a divider next to a
 *  real one. Drawn here so the handle looks like something you grab. */
function GripDots() {
  return (
    <svg
      viewBox="0 0 10 16"
      className="size-4 fill-current"
      aria-hidden="true"
      focusable="false"
    >
      {[3, 8, 13].map((y) =>
        [3, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
      )}
    </svg>
  )
}

// ===================== add a UTC =====================

/** Pick the UTC first, then the role it goes in. Two steps rather than a row of
 *  empty dropdowns: the list is searchable, and the roles come with the count
 *  each already carries, so choosing one you already have reads as raising that
 *  count — which is exactly what it does. */
function AddUtcPopover({
  utcDefs,
  counts,
  disabled,
  onAdd,
}: {
  utcDefs: UtcDef[]
  /** utc_def_id → role → how many that role already carries. */
  counts: Map<number, Map<UtcRoleHint, number>>
  disabled: boolean
  onAdd: (utc: UtcDef, role: UtcRoleHint) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<UtcDef | null>(null)

  function close() {
    setOpen(false)
    setPicked(null)
  }

  const byRole = picked ? counts.get(picked.id) : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={disabled}
          />
        }
      >
        <Plus data-icon="inline-start" />
        Add UTC
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {picked === null ? (
          <Command>
            <CommandInput placeholder="Search unit type codes…" />
            <CommandList>
              <CommandEmpty>No UTC matches.</CommandEmpty>
              <CommandGroup heading="Unit type codes">
                {utcDefs.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`${u.code} ${u.name}`}
                    onSelect={() => setPicked(u)}
                  >
                    <CodeBadge code={u.code} />
                    <span className="truncate">{u.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                {/* Placeholder on purpose — the option is here so the shape of
                    the flow is right, but it does nothing yet. */}
                <CommandItem disabled value="create utc">
                  <Plus />
                  <span>Create UTC…</span>
                  <CommandShortcut>Soon</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <Command>
            <div className="flex items-center gap-2 border-b border-border px-2 py-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to the UTC list"
                onClick={() => setPicked(null)}
              >
                <ChevronLeft />
              </Button>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <CodeBadge code={picked.code} />
                <span className="truncate text-muted-foreground">
                  {picked.name}
                </span>
              </span>
            </div>
            <CommandList>
              <CommandGroup heading="Add as">
                {UTC_ROLE_HINT_VALUES.map((r) => {
                  const Icon = UTC_ROLE_HINT_ICONS[r]
                  const held = byRole?.get(r) ?? 0
                  return (
                    <CommandItem
                      key={r}
                      value={UTC_ROLE_HINT_LABELS[r]}
                      onSelect={() => {
                        onAdd(picked, r)
                        close()
                      }}
                    >
                      <Icon />
                      <span>{UTC_ROLE_HINT_LABELS[r]}</span>
                      {/* How many rows the role already holds, so picking it
                          again reads as one more of the same rather than as a
                          duplicate. */}
                      {held > 0 && (
                        <CommandShortcut>{`${held} → ${held + 1}`}</CommandShortcut>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ===================== properties panel =====================

interface Form {
  name: string
  code: string
  description: string
}

function formOf(def: PackageDef): Form {
  return {
    name: def.name,
    code: def.code,
    description: def.description ?? "",
  }
}

/** Name, code, description — in that order, because that is the order they are
 *  decided in: you name the package, then coin a code for the name, then say
 *  what it is for. `PackageDefPatch` accepts exactly these three (plus
 *  `retired`, which is a lifecycle action and wants its own affordance). */
function PropertiesSheet({
  def,
  form,
  setForm,
  open,
  onClose,
}: {
  def: PackageDef
  form: Form
  setForm: (form: Form) => void
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Close by any route — Cancel, the X, Escape, the backdrop — and drop the
   *  error with it, so a failed save cannot greet the next open. */
  function close() {
    setError(null)
    onClose()
  }

  const unchanged =
    form.name.trim() === def.name &&
    form.code.trim() === def.code &&
    form.description.trim() === (def.description ?? "")

  async function save() {
    setPending(true)
    setError(null)
    const err = await send("PATCH", `/api/be/package-defs/${def.id}`, {
      name: form.name.trim(),
      code: form.code.trim(),
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
          <SheetTitle>Edit package</SheetTitle>
          <SheetDescription>
            How this package is named and described.
          </SheetDescription>
        </SheetHeader>

        {/* A real form, so Enter in Name or Code saves the way it does in every
            other dialog. The description is a textarea, where Enter is a
            newline and rightly stays one. Escape is already Cancel — Base UI
            closes the dialog on it, and closing discards. */}
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked) save()
          }}
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pkg-name">Name</Label>
              <Input
                id="pkg-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pkg-code" className="gap-1.5">
                Code
                <Tooltip>
                  {/* A button, not a bare icon: the hint has to be reachable
                    without a pointer, and only a focusable trigger gets there
                    by keyboard. */}
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
                id="pkg-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={pending}
                className="font-mono uppercase"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pkg-description">Description</Label>
              <Textarea
                id="pkg-description"
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
              <Button
                type="submit"
                className="flex-1"
                // A blank code or name would be saved as one; the API has no
                // min-length on either, so the guard has to live here.
                disabled={blocked}
              >
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
