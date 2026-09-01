"use client"

import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import { GripDots } from "@/components/equipment/grip-dots"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_SUBCATEGORY_VALUES,
  UTC_ROLE_HINT_LABELS,
  UTC_ROLE_HINT_VALUES,
} from "@/lib/equipment-meta"
import type {
  CapabilityKind,
  Enclave,
  EquipmentSubcategory,
  EquipmentType,
  WorkCenter,
  PackageDef,
  UtcDef,
  UtcDefLine,
  UtcRoleHint,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/** Kept as a re-export under its old name: the sheets and the create dialog
 *  have called it this since before `AssetCategory` existed. */
export const CATEGORY_VALUES: EquipmentSubcategory[] =
  EQUIPMENT_SUBCATEGORY_VALUES

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

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

export const patch = (url: string, body: unknown) => send("PATCH", url, body)
export const put = (url: string, body: unknown) => send("PUT", url, body)

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  /** Spelled-out meaning for abbreviations nobody should have to look up. */
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        title={hint}
        className={
          "text-[11px] uppercase tracking-wide text-muted-foreground" +
          (hint ? " cursor-help decoration-dotted underline-offset-2" : "")
        }
      >
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

/** `kinds` shows the catalog's generic name for each kind — right for an
 *  aggregate across types. `caps` shows a type's own labels, which may be
 *  hand-written ("SIPR data" rather than "Data"). */
export function CapabilityChips({
  kinds,
  caps,
}: {
  kinds?: CapabilityKind[]
  /** `materialize_by_default` is read where the caller has it. An aggregate
   *  over several types does not: whether a capability comes as standard is a
   *  fact about one model, not about a union of them. */
  caps?: {
    kind: CapabilityKind
    label: string
    materialize_by_default?: boolean
  }[]
}) {
  const chips =
    caps?.map((c, i) => ({
      key: `${c.kind}-${i}`,
      text: c.label,
      optional: c.materialize_by_default === false,
    })) ??
    kinds?.map((k) => ({
      key: k,
      text: CAPABILITY_LABELS[k],
      optional: false,
    })) ??
    []
  if (chips.length === 0)
    return <span className="text-xs text-muted-foreground">None</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        // Dashed means optional, the same way it does on the enclave chips: an
        // outline drawn but not filled in reads as "sometimes", and it is the
        // only mark read mode makes — the editor says it with two groups, and
        // at rest this was the one place the distinction went missing.
        //
        // The title carries it for anyone who cannot see a dash: a border
        // style is not something a screen reader announces.
        <span
          key={c.key}
          title={c.optional ? `${c.text} — optional on this model` : undefined}
          className={cn(
            "rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground",
            c.optional && "border-dashed",
          )}
        >
          {c.text}
        </span>
      ))}
    </div>
  )
}

/** Union of capability kinds the equipment in these lines can provide, in the
 *  order the catalog declares them. Answers "what can this UTC actually do". */
export function aggregateCapabilities(
  lines: UtcDefLine[],
  byId: Map<number, EquipmentType>,
): CapabilityKind[] {
  const seen = new Set<CapabilityKind>()
  for (const l of lines) {
    for (const c of byId.get(l.equipment_type_id)?.capabilities ?? [])
      seen.add(c.kind)
  }
  return [...seen]
}

function SaveBar({
  editing,
  canEdit,
  pending,
  error,
  onEdit,
  onCancel,
  onSave,
}: {
  editing: boolean
  canEdit: boolean
  pending: boolean
  error: string | null
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <SheetFooter className="flex-col items-stretch gap-2">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Read-only — global catalog rows are admin-managed.
        </p>
      )}
      {canEdit &&
        (editing ? (
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={pending} className="flex-1">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={onEdit}>
            Edit
          </Button>
        ))}
    </SheetFooter>
  )
}

// ===================== Equipment type =====================

export const CAPABILITY_VALUES = Object.keys(
  CAPABILITY_LABELS,
) as CapabilityKind[]

/** Editable shape of one declared capability. No server `id` — the save path
 *  replaces the whole list, so rows only need to survive until the PUT. */
export interface CapabilityDraft {
  /** Identity for React and for dnd-kit, stable across a reorder — the array
   *  index is not, and sorting by index makes the dragged row swap places with
   *  its own ghost. Never sent: every caller builds the PUT body field by
   *  field. */
  uid: string
  kind: CapabilityKind
  label: string
  materialize_by_default: boolean
}

/** Which enclaves a model of gear can serve. Checkboxes rather than a single
 *  select because a type can be capable of several — a switch works on NIPR or
 *  SIPR. Which one a *particular* box is on is set per instance, since crypto
 *  separation means one box serves one network at a time.
 *
 *  Checking nothing means unrestricted, which the copy has to say out loud —
 *  an empty set reads as "capable of nothing" otherwise. */
export function EnclaveCapabilityPicker({
  enclaves,
  value,
  onChange,
  disabled,
}: {
  enclaves: Enclave[]
  value: number[]
  onChange: (next: number[]) => void
  disabled: boolean
}) {
  if (enclaves.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {enclaves.map((en) => {
          const on = value.includes(en.id)
          return (
            <label
              key={en.id}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                on ? "" : "border-dashed text-muted-foreground",
                on ? enclaveChipClass(en.color) : "",
              )}
              style={on ? enclaveChipStyle(en.color) : undefined}
            >
              <input
                type="checkbox"
                className="size-3"
                checked={on}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    on
                      ? value.filter((id) => id !== en.id)
                      : [...value, en.id],
                  )
                }
              />
              {en.short_name || en.name}
            </label>
          )
        })}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {value.length === 0
          ? "None checked — this gear can be assigned to any enclave."
          : "A specific piece of this gear is assigned one of these when it's registered."}
      </span>
    </div>
  )
}

/** dnd-kit addresses every droppable by one id, and a group has to be
 *  droppable while it is empty, so its id cannot be one of its rows'. */
const GROUP = "group:"

/** The two groups, in the order they are shown. Standard first: it is what
 *  most capabilities are, and the list should open reading as what this gear
 *  does rather than as what it might do. */
const STANDARD = "standard"
const OPTIONAL = "optional"
type CapabilityGroupId = typeof STANDARD | typeof OPTIONAL

const GROUP_LABELS: Record<CapabilityGroupId, string> = {
  [STANDARD]: "Standard",
  [OPTIONAL]: "Optional",
}

const GROUP_HINTS: Record<CapabilityGroupId, string> = {
  [STANDARD]: "Every one of these boxes has it. Ticked when a kit is registered.",
  [OPTIONAL]: "Only some boxes have it. Unticked until someone says otherwise.",
}

/** Which group a capability sits in. `materialize_by_default` is written from
 *  the box's point of view — a capability that comes as standard is pre-ticked
 *  when a kit is registered — so Standard is the true case. */
function groupOf(cap: CapabilityDraft): CapabilityGroupId {
  return cap.materialize_by_default ? STANDARD : OPTIONAL
}

let addedCapabilities = 0

/** Put a new capability at the end of `group`, in the flat list.
 *
 *  Which kind it is gets decided here and never again: with the row's select
 *  gone, changing your mind means removing the row and adding the one you
 *  meant. That is the honest shape of it — a capability is not a slot whose
 *  kind you adjust, it is a thing the gear either provides or does not. */
function addCapability(
  rows: CapabilityDraft[],
  kind: CapabilityKind,
  group: CapabilityGroupId,
  /** Only "other" carries one: it is asked for at add time, because a row
   *  that cannot say what it is has nothing to show in the list. */
  label?: string,
): CapabilityDraft[] {
  const fresh: CapabilityDraft = {
    uid: `new${addedCapabilities++}`,
    kind,
    label: label?.trim() || (kind === "other" ? "" : CAPABILITY_LABELS[kind]),
    materialize_by_default: group === STANDARD,
  }
  let at = rows.length
  rows.forEach((r, i) => {
    if (groupOf(r) === group) at = i + 1
  })
  return [...rows.slice(0, at), fresh, ...rows.slice(at)]
}

/** The reason a list of capabilities cannot be saved yet, or null.
 *
 *  The catalog is unique on (equipment_type_id, kind, label), so two rows of
 *  one kind have to differ by name. That only bites "other" — every other kind
 *  is offered once — and it is why the name field exists: a second unnamed
 *  "Other" serialises to the same label as the first and the API can only
 *  reject it. Caught here so the bar can say which name collides, rather than
 *  letting a save fail on a constraint nobody outside the database has read. */
export function capabilityNameError(rows: CapabilityDraft[]): string | null {
  const seen = new Set<string>()
  for (const r of rows) {
    const named = r.label.trim()
    if (r.kind === "other" && !named)
      return "Every Other capability needs a name."
    const key = `${r.kind}\u0000${named.toLowerCase()}`
    if (seen.has(key))
      return `Two capabilities are both called \u201C${named}\u201D.`
    seen.add(key)
  }
  return null
}

/** Pull a row out of the flat list and put it back in `group`, either in front
 *  of `overUid` or at the end of that group.
 *
 *  The list stays flat rather than becoming two arrays: `display_order` is one
 *  sequence across the whole type, and rebuilding it from two buckets every
 *  save would invent an ordering nobody chose. Which group a row is in is not
 *  stored anywhere separate — it *is* `materialize_by_default`, so the move
 *  writes that and nothing else. */
function moveCapability(
  rows: CapabilityDraft[],
  activeUid: string,
  group: CapabilityGroupId,
  overUid: string | null,
): CapabilityDraft[] {
  const active = rows.find((r) => r.uid === activeUid)
  if (!active) return rows
  const rest = rows.filter((r) => r.uid !== activeUid)
  const moved = { ...active, materialize_by_default: group === STANDARD }
  if (overUid) {
    const at = rest.findIndex((r) => r.uid === overUid)
    if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)]
  }
  // Dropped on the group itself rather than on one of its rows: land after
  // whatever it already holds, or at the end when it holds nothing.
  let at = rest.length
  rest.forEach((r, i) => {
    if (groupOf(r) === group) at = i + 1
  })
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** One declared capability: what it is, and nothing else.
 *
 *  No control for the kind. It used to be a select, which invited you to
 *  rewrite a row into a different capability entirely — a thing you almost
 *  never mean, and one that quietly carried the row's group and position with
 *  it. Changing your mind is now remove-and-add, which is the same number of
 *  clicks and says what it does.
 *
 *  Standard-or-optional is likewise not on the row: it is the group the row
 *  sits in, the way the package page carries a UTC's role. So a row is down to
 *  a handle, a name and a way to delete it. */
function CapabilityRow({
  cap,
  disabled,
  onRemove,
  onRename,
}: {
  cap: CapabilityDraft
  disabled: boolean
  onRemove: () => void
  onRename: (label: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cap.uid })

  // The stored label where there is one, which is what read mode shows and
  // what the write path saves. Nothing edits it any more, but a type that
  // already calls this "SATCOM (TSM/DAMA)" should still say so here.
  const name = cap.label.trim() || CAPABILITY_LABELS[cap.kind]

  return (
    <Item
      variant="outline"
      size="sm"
      render={
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Transform.toString(transform), transition }}
          className={cn(
            // Lifted off the stack while it travels, so it reads as the thing
            // being moved rather than a row the list is shuffling around.
            isDragging && "z-10 shadow-lg",
          )}
        />
      }
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${name}`}
        disabled={disabled}
        className="flex cursor-grab items-center self-stretch rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
      >
        <GripDots />
      </button>

      <ItemContent className="min-w-0">
        {cap.kind === "other" ? (
          // The one kind the label table cannot name. "Other" is the bucket
          // for everything not enumerated, so the row says nothing until
          // someone says what it actually is. The named kinds stay read-only
          // on purpose — a field there only invites typing "SATCOM" into a
          // row already called SATCOM.
          <Input
            value={cap.label}
            onChange={(e) => onRename(e.target.value)}
            disabled={disabled}
            placeholder="What is it?"
            aria-label="Name for this capability"
            maxLength={96}
            className="h-7 rounded-full px-2.5 md:text-sm"
          />
        ) : (
          <ItemTitle className="font-normal">{name}</ItemTitle>
        )}
      </ItemContent>

      <ItemActions>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${name}`}
          disabled={disabled}
          onClick={onRemove}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </Button>
      </ItemActions>
    </Item>
  )
}

/** Add a capability straight into one group.
 *
 *  One per group rather than a single button below both, because the group is
 *  now the only thing that says standard-or-optional: adding from inside
 *  Optional is how you declare an optional capability without a second step.
 *
 *  Kinds already on this type are left out. With no way to rename a row, two
 *  rows of the same kind would be two rows nobody could tell apart. */
function AddCapability({
  group,
  taken,
  disabled,
  onAdd,
}: {
  group: CapabilityGroupId
  taken: Set<CapabilityKind>
  disabled: boolean
  onAdd: (kind: CapabilityKind, label?: string) => void
}) {
  // The name for an "Other" being added, or null when the menu is at rest.
  // Asked for here rather than on the row, so the list never holds a row that
  // cannot say what it is — which is also the shape the catalog's
  // (type, kind, label) uniqueness needs to hold.
  const [naming, setNaming] = useState<string | null>(null)
  // "Other" is offered however many are already declared: it is the bucket for
  // everything the vocabulary does not name, and one model can easily carry two
  // unrelated ones. Its rows are told apart by the name typed into them, which
  // is exactly what the catalog's (type, kind, label) uniqueness wants. Every
  // named kind is still offered once — a second SATCOM row would duplicate the
  // first with nothing to tell them apart.
  const offered = CAPABILITY_VALUES.filter(
    (k) => k === "other" || !taken.has(k),
  )

  function commit() {
    const label = (naming ?? "").trim()
    if (!label) return
    onAdd("other", label)
    setNaming(null)
  }

  if (naming !== null) {
    return (
      // Deliberately not a <form>: this sits inside one on the create dialog,
      // and a nested form is not markup a browser will honour.
      <div className="flex items-center gap-1.5 self-stretch pt-1">
        <Input
          autoFocus
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              setNaming(null)
            }
          }}
          disabled={disabled}
          placeholder="What is it?"
          aria-label="Name for the new capability"
          // The catalog stores 96 characters; stopping here beats a 500.
          maxLength={96}
          className="h-8"
        />
        <Button
          type="button"
          size="sm"
          onClick={commit}
          disabled={disabled || !naming.trim()}
        >
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setNaming(null)}
          disabled={disabled}
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            disabled={disabled}
            title={`Add a ${GROUP_LABELS[group].toLowerCase()} capability`}
          />
        }
      >
        <Plus className="size-4" />
        Add
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {offered.map((k) => (
          <DropdownMenuItem
            key={k}
            onClick={() => (k === "other" ? setNaming("") : onAdd(k))}
          >
            {CAPABILITY_LABELS[k]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One of the two groups. Both are always on screen, even empty: with only two
 *  of them the empty one is the other half of the choice, a destination you
 *  cannot see is one you will not drag to, and its Add is the only way to
 *  declare a capability straight into it. */
function CapabilityGroup({
  group,
  rows,
  taken,
  disabled,
  onAdd,
  onRemove,
  onRename,
}: {
  group: CapabilityGroupId
  rows: CapabilityDraft[]
  taken: Set<CapabilityKind>
  disabled: boolean
  onAdd: (kind: CapabilityKind, label?: string) => void
  onRemove: (uid: string) => void
  onRename: (uid: string, label: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${GROUP}${group}` })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-transparent p-2 transition-colors",
        isOver && "border-ring/40 bg-muted/50",
      )}
    >
      <div className="flex flex-col px-1">
        <h3 className="text-sm font-medium">{GROUP_LABELS[group]}</h3>
        <p className="text-[11px] text-muted-foreground">
          {GROUP_HINTS[group]}
        </p>
      </div>

      <SortableContext
        items={rows.map((r) => r.uid)}
        strategy={verticalListSortingStrategy}
      >
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
            Nothing here. Drop one in, or add one.
          </p>
        ) : (
          <ItemGroup>
            {rows.map((cap) => (
              <CapabilityRow
                key={cap.uid}
                cap={cap}
                disabled={disabled}
                onRemove={() => onRemove(cap.uid)}
                onRename={(label) => onRename(cap.uid, label)}
              />
            ))}
          </ItemGroup>
        )}
      </SortableContext>

      <AddCapability
        group={group}
        taken={taken}
        disabled={disabled}
        onAdd={onAdd}
      />
    </div>
  )
}

/** Rows the operator edits in place. Order is meaningful: it becomes
 *  `display_order` server-side.
 *
 *  Two groups you drag between rather than a checkbox per row. "Optional" was
 *  a tick you had to read on every row to learn the shape of the thing; as a
 *  group it is one glance. Same arrangement as the package page's roles, and
 *  the same flat list underneath.
 *
 *  Both groups render even when the type declares nothing at all, because each
 *  group's Add is the only way in. */
export function CapabilityEditor({
  value,
  onChange,
  disabled,
}: {
  value: CapabilityDraft[]
  onChange: (next: CapabilityDraft[]) => void
  disabled: boolean
}) {
  /** The list as it stood when the drag began, so Escape can put it back:
   *  the drag has been rearranging it the whole way across. */
  const beforeDrag = useRef<CapabilityDraft[] | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const taken = new Set(value.map((c) => c.kind))

  /** Which group the pointer is over — the group itself when it is over the
   *  group's own padding, otherwise the group of the row under it. */
  function groupUnder(overId: string): CapabilityGroupId | undefined {
    if (overId.startsWith(GROUP))
      return overId.slice(GROUP.length) as CapabilityGroupId
    const row = value.find((r) => r.uid === overId)
    return row && groupOf(row)
  }

  /** Crossing into the other group moves the row *now*, while the pointer is
   *  still down: each group is its own SortableContext, and dnd-kit previews a
   *  reflow only within one, so leaving the move until drop showed nothing at
   *  all until it was too late to change your mind. */
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    const activeUid = String(active.id)
    const overId = String(over.id)
    if (activeUid === overId) return
    const row = value.find((r) => r.uid === activeUid)
    if (!row) return
    const target = groupUnder(overId)
    if (!target || target === groupOf(row)) return
    onChange(
      moveCapability(
        value,
        activeUid,
        target,
        overId.startsWith(GROUP) ? null : overId,
      ),
    )
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    beforeDrag.current = null
    if (!over) return
    const activeUid = String(active.id)
    const overId = String(over.id)
    if (activeUid === overId) return
    const row = value.find((r) => r.uid === activeUid)
    if (!row) return
    const target = groupUnder(overId)
    if (!target) return
    // Usually a no-op by now — the row crossed during the drag — but it is what
    // settles its final position inside the group.
    onChange(
      moveCapability(
        value,
        activeUid,
        target,
        overId.startsWith(GROUP) ? null : overId,
      ),
    )
  }

  function handleDragCancel() {
    if (beforeDrag.current) onChange(beforeDrag.current)
    beforeDrag.current = null
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          None declared. Capabilities are what this gear can provide — they
          become the checkboxes when a kit is registered.
        </p>
      )}
      <DndContext
        sensors={sensors}
        // Corners rather than centers: with a group stacked under another, an
        // empty group's center is a long way from a row being dragged past it
        // and closestCenter skips over it.
        collisionDetection={closestCorners}
        // An empty group has to be measured during the drag, not before it, or
        // the placeholder box it shows is not a target yet.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={() => {
          beforeDrag.current = value
        }}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-col gap-1">
          {([STANDARD, OPTIONAL] as CapabilityGroupId[]).map((g) => (
            <CapabilityGroup
              key={g}
              group={g}
              rows={value.filter((c) => groupOf(c) === g)}
              taken={taken}
              disabled={disabled}
              onAdd={(kind, label) =>
                onChange(addCapability(value, kind, g, label))
              }
              onRemove={(uid) => onChange(value.filter((c) => c.uid !== uid))}
              onRename={(uid, label) =>
                onChange(
                  value.map((c) => (c.uid === uid ? { ...c, label } : c)),
                )
              }
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}

/** One work center's claim on a type, while it's being edited. */
export interface WorkCenterDraft {
  work_center_id: number
  is_primary: boolean
}

/** Who answers for this kind of gear.
 *
 *  Two decisions in one control, because they are one thought: whether a shop
 *  is involved at all, and which shop actually owns it. Checking adds a shop;
 *  the star picks the single primary among those checked. Unchecking the
 *  primary hands the star to whoever is left, so there is never a set of
 *  owners with nobody responsible — the API would silently demote a second
 *  primary anyway, and a UI that let you build that state was lying.
 *
 *  A star rather than a radio column: at most one primary is the rule, but
 *  zero is legal too (a type nobody has claimed yet), and a radio group has no
 *  natural way to say "none of these". */
export function WorkCenterPicker({
  workCenters,
  value,
  onChange,
  disabled,
}: {
  workCenters: WorkCenter[]
  value: WorkCenterDraft[]
  onChange: (next: WorkCenterDraft[]) => void
  disabled: boolean
}) {
  if (workCenters.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No work centers yet — add them under Admin to say who owns this gear.
      </p>
    )
  }

  function toggle(id: number) {
    const on = value.some((v) => v.work_center_id === id)
    if (on) {
      const next = value.filter((v) => v.work_center_id !== id)
      // Dropping the primary promotes the first survivor rather than leaving
      // a set of owners with nobody responsible.
      if (next.length > 0 && !next.some((v) => v.is_primary)) {
        next[0] = { ...next[0], is_primary: true }
      }
      onChange(next)
      return
    }
    onChange([
      ...value,
      { work_center_id: id, is_primary: value.length === 0 },
    ])
  }

  function makePrimary(id: number) {
    onChange(
      value.map((v) => ({ ...v, is_primary: v.work_center_id === id })),
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {workCenters.map((wc) => {
        const held = value.find((v) => v.work_center_id === wc.id)
        return (
          <div key={wc.id} className="flex items-center gap-2">
            <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={!!held}
                disabled={disabled}
                onChange={() => toggle(wc.id)}
              />
              <span className="truncate">{wc.name}</span>
            </label>
            {held && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => makePrimary(wc.id)}
                aria-pressed={held.is_primary}
                aria-label={
                  held.is_primary
                    ? `${wc.name} is the primary work center`
                    : `Make ${wc.name} the primary work center`
                }
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
                  held.is_primary
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {held.is_primary ? "Primary" : "Make primary"}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ===================== UTC definition =====================

interface CodeForm {
  code: string
  name: string
  description: string
}

function CodeFields({
  form,
  setForm,
  pending,
}: {
  form: CodeForm
  setForm: (f: CodeForm) => void
  pending: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="cd-code">Code</Label>
        <Input
          id="cd-code"
          className="font-mono"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          disabled={pending}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="cd-name">Name</Label>
        <Input
          id="cd-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          disabled={pending}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="cd-desc">Description</Label>
        <Textarea
          id="cd-desc"
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          disabled={pending}
        />
      </div>
    </div>
  )
}

// ===================== Package definition =====================

/** One UTC a package calls for, while it's being authored. No `id` — the save
 *  path replaces the whole list, and `display_order` is the array order. */
interface PackageUtcDraft {
  utc_def_id: number | ""
  quantity: number
  role_hint: UtcRoleHint
}

/** What a package is made of: which UTCs, how many, and what each is for.
 *
 *  This was the one part of the catalog with no editor at all — a package
 *  definition could be created but never corrected, so a package that named
 *  the wrong extension stayed wrong and every deploy from it started with
 *  manual surgery. The role hint matters more here than it looks: the deploy
 *  wizard reads it to preset each queued UTC's role. */
function PackageUtcEditor({
  rows,
  onChange,
  utcDefs,
  disabled,
}: {
  rows: PackageUtcDraft[]
  onChange: (next: PackageUtcDraft[]) => void
  utcDefs: UtcDef[]
  disabled: boolean
}) {
  function update(index: number, patch: Partial<PackageUtcDraft>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">
          No UTCs yet — a package with none deploys nothing.
        </p>
      )}
      {rows.map((row, index) => {
        const chosen = row.utc_def_id
          ? utcDefs.find((u) => u.id === Number(row.utc_def_id))
          : undefined
        // A def already on the row but retired out of the list still has to
        // appear, or editing an unrelated field would silently blank it.
        const options =
          chosen && !utcDefs.some((u) => u.id === chosen.id)
            ? [...utcDefs, chosen]
            : utcDefs
        return (
          // Stacked rather than one wide row: the sheet is narrow enough that
          // a UTC select sharing a line with role and quantity truncated the
          // code down to "6KFCP —", which is the only part worth reading.
          <div
            key={index}
            className="flex flex-col gap-1.5 rounded-lg border border-border p-2"
          >
            <select
              aria-label="UTC definition"
              className={cn(SELECT_CLASS, "h-8 w-full")}
              value={row.utc_def_id}
              disabled={disabled}
              onChange={(e) =>
                update(index, {
                  utc_def_id: e.target.value ? Number(e.target.value) : "",
                })
              }
            >
              <option value="">Select a UTC…</option>
              {options.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Role hint"
                className={cn(SELECT_CLASS, "h-8 flex-1")}
                value={row.role_hint}
                disabled={disabled}
                onChange={(e) =>
                  update(index, { role_hint: e.target.value as UtcRoleHint })
                }
              >
                {UTC_ROLE_HINT_VALUES.map((h) => (
                  <option key={h} value={h}>
                    {UTC_ROLE_HINT_LABELS[h]}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">×</span>
              <Input
                type="number"
                min={1}
                aria-label="Quantity"
                className="h-8 w-16"
                value={row.quantity}
                disabled={disabled}
                onChange={(e) =>
                  update(index, {
                    quantity: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Remove UTC"
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 self-start text-xs"
        disabled={disabled}
        onClick={() =>
          onChange([...rows, { utc_def_id: "", quantity: 1, role_hint: "either" }])
        }
      >
        <Plus className="size-3.5" />
        Add UTC
      </Button>
    </div>
  )
}

export function PackageDefSheet({
  def,
  utcDefs,
  types,
  canEdit,
  onClose,
}: {
  def: PackageDef | null
  utcDefs: UtcDef[]
  types: EquipmentType[]
  canEdit: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CodeForm | null>(null)
  const [utcRows, setUtcRows] = useState<PackageUtcDraft[]>([])

  useEffect(() => {
    setEditing(false)
    setError(null)
    setForm(
      def
        ? { code: def.code, name: def.name, description: def.description ?? "" }
        : null,
    )
    setUtcRows(
      def
        ? [...def.utcs]
            .sort((a, b) => a.display_order - b.display_order)
            .map((u) => ({
              utc_def_id: u.utc_def_id,
              quantity: u.quantity,
              role_hint: u.role_hint,
            }))
        : [],
    )
  }, [def])

  const byId = new Map(types.map((t) => [t.id, t]))
  const utcById = new Map(utcDefs.map((u) => [u.id, u]))
  const allLines = def
    ? def.utcs.flatMap((u) => utcById.get(u.utc_def_id)?.lines ?? [])
    : []

  async function save() {
    if (!def || !form) return
    setPending(true)
    setError(null)
    const err = await patch(`/api/be/package-defs/${def.id}`, {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
    })
    if (err) {
      setPending(false)
      setError(err)
      return
    }
    // The UTC list has its own wholesale-replace endpoint. Only call it when
    // something actually changed — order is meaningful here, so this compares
    // the sequence rather than a sorted set.
    const payload = utcRows
      .filter((r) => r.utc_def_id !== "")
      .map((r) => ({
        utc_def_id: Number(r.utc_def_id),
        quantity: r.quantity,
        role_hint: r.role_hint,
      }))
    const key = (r: { utc_def_id: number; quantity: number; role_hint: string }) =>
      `${r.utc_def_id}:${r.quantity}:${r.role_hint}`
    const before = [...def.utcs]
      .sort((a, b) => a.display_order - b.display_order)
      .map(key)
      .join("|")
    const after = payload.map(key).join("|")
    const utcsErr =
      before !== after
        ? await put(`/api/be/package-defs/${def.id}/utcs`, payload)
        : null
    setPending(false)
    if (utcsErr) {
      // The code/name already saved; say so rather than implying a rollback.
      setError(`Details saved, but the UTC list failed: ${utcsErr}`)
      router.refresh()
      return
    }
    setEditing(false)
    router.refresh()
  }

  return (
    <Sheet open={!!def} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        {def && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <CodeBadge code={def.code} />
                {def.name}
              </SheetTitle>
              <SheetDescription>
                {def.utcs.length} UTC{def.utcs.length === 1 ? "" : "s"}
                {def.is_global ? " · Global catalog" : " · Workspace"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {editing && form ? (
                <div className="flex flex-col gap-4">
                  <CodeFields form={form} setForm={setForm} pending={pending} />
                  <div className="flex flex-col gap-1.5">
                    <Label>Unit type codes</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Which UTCs go out under this package, how many of each,
                      and what each is for. The deploy wizard queues exactly
                      this list and presets each UTC&apos;s role from its hint.
                    </p>
                    <PackageUtcEditor
                      rows={utcRows}
                      onChange={setUtcRows}
                      utcDefs={utcDefs}
                      disabled={pending}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {def.description && (
                    <p className="text-sm text-muted-foreground">
                      {def.description}
                    </p>
                  )}
                  <Field label="Capabilities available">
                    <CapabilityChips
                      kinds={aggregateCapabilities(allLines, byId)}
                    />
                  </Field>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Unit type codes
                    </span>
                    <ul className="flex flex-col gap-1 text-sm">
                      {def.utcs.map((u) => (
                        <li
                          key={u.id}
                          className="flex items-center justify-between gap-2 border-b border-border/50 pb-1"
                        >
                          <span className="flex items-center gap-2">
                            <CodeBadge code={u.utc_def_code ?? "—"} />
                            <span className="text-muted-foreground">
                              {u.utc_def_name}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {UTC_ROLE_HINT_LABELS[u.role_hint]}
                            {u.quantity > 1 ? ` ×${u.quantity}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <SaveBar
              editing={editing}
              canEdit={canEdit}
              pending={pending}
              error={error}
              onEdit={() => setEditing(true)}
              onCancel={() => {
                setEditing(false)
                setError(null)
                setForm({
                  code: def.code,
                  name: def.name,
                  description: def.description ?? "",
                })
              }}
              onSave={save}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
