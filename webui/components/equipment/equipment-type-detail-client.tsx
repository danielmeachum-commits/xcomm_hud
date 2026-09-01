"use client"

import { Info, Pencil, SlidersHorizontal } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  CATEGORY_VALUES,
  CapabilityChips,
  CapabilityEditor,
  EnclaveCapabilityPicker,
  WorkCenterPicker,
  capabilityNameError,
  patch,
  put,
  type CapabilityDraft,
  type WorkCenterDraft,
} from "@/components/equipment/catalog-detail-sheets"
import { CodeBadge } from "@/components/equipment/code-badge"
import { GlobalBadge } from "@/components/equipment/global-badge"
import { ManageBar } from "@/components/equipment/manage-bar"
import { TagsInput } from "@/components/equipment/tags-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
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
  CAPABILITY_LABELS,
  EQUIPMENT_SUBCATEGORY_ICONS,
  EQUIPMENT_SUBCATEGORY_LABELS,
} from "@/lib/equipment-meta"
import type {
  AssetCategory,
  Enclave,
  EquipmentSubcategory,
  EquipmentType,
  WorkCenter,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

const SHORT_NAME_HINT =
  "Short-hand for the model — what gets said out loud and printed on a label."

/** Which list is being managed, or none. Only one at a time: each carries its
 *  own action bar, and two bars on screen would each look like the way out. */
type Managing = "capabilities" | "enclaves" | "workCenters" | null

// ===================== drafts =====================

function capabilityDrafts(t: EquipmentType): CapabilityDraft[] {
  return t.capabilities.map((c) => ({
    // Seeded from the stored row's id so the first render matches on the
    // server and the client, and so re-seeding after a save keeps the same
    // identities the drag was using.
    uid: `c${c.id}`,
    kind: c.kind,
    label: c.label,
    materialize_by_default: c.materialize_by_default,
  }))
}

function workCenterDrafts(t: EquipmentType): WorkCenterDraft[] {
  return t.work_centers.map((w) => ({
    work_center_id: w.work_center_id,
    is_primary: w.is_primary,
  }))
}

/** Order is part of the value here — it becomes `display_order` server-side —
 *  so this signature is positional, and a reorder alone counts as a change. */
function capabilitySignature(rows: CapabilityDraft[]): string {
  return rows
    .map(
      (c) =>
        `${c.kind}:${c.label.trim() || CAPABILITY_LABELS[c.kind]}:${c.materialize_by_default}`,
    )
    .join("|")
}

/** Order is not part of the value for either of these — the server keys them
 *  by id — so sort first, and a reshuffle alone reads as unchanged. */
function enclaveSignature(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",")
}

function workCenterSignature(rows: WorkCenterDraft[]): string {
  return [...rows]
    .sort((a, b) => a.work_center_id - b.work_center_id)
    .map((r) => `${r.work_center_id}:${r.is_primary}`)
    .join(",")
}

// ===================== the page =====================

/** One equipment type: what a model of gear is, what it can do, and who
 *  answers for it.
 *
 *  A page rather than the side sheet it used to be. The sheet was a column of
 *  two-up fields squeezed into 448px next to a table nobody was reading any
 *  more, and it could not be linked to — the same reasons UTC definitions and
 *  packages got pages, and this one is built to their shape: read mode is the
 *  point of the page, each list has a Manage that turns it into an editor with
 *  a Cancel/Save bar, and nothing but the properties sits behind a panel.
 *
 *  Three managed lists rather than the one those pages have, because a type's
 *  capabilities, enclaves and work centers are three separate wholesale-replace
 *  endpoints. One at a time keeps each Save to the endpoint it belongs to: the
 *  old sheet wrote all three behind a single button and had to report which leg
 *  of it failed. */
export function EquipmentTypeDetailClient({
  type,
  enclaves,
  workCenters,
  tagSuggestions,
  canEdit,
}: {
  type: EquipmentType
  enclaves: Enclave[]
  workCenters: WorkCenter[]
  tagSuggestions: string[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [editingProperties, setEditingProperties] = useState(false)
  const [form, setForm] = useState<PropertiesForm>(() => formOf(type))

  const [managing, setManaging] = useState<Managing>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [caps, setCaps] = useState<CapabilityDraft[]>(() =>
    capabilityDrafts(type),
  )
  const [enclaveIds, setEnclaveIds] = useState<number[]>(() => [
    ...type.enclave_ids,
  ])
  const [centers, setCenters] = useState<WorkCenterDraft[]>(() =>
    workCenterDrafts(type),
  )

  /** Seed from the saved row on the way in, rather than trusting whatever a
   *  cancelled edit left behind. */
  function startManaging(which: Exclude<Managing, null>) {
    if (which === "capabilities") setCaps(capabilityDrafts(type))
    if (which === "enclaves") setEnclaveIds([...type.enclave_ids])
    if (which === "workCenters") setCenters(workCenterDrafts(type))
    setError(null)
    setManaging(which)
  }

  function stopManaging() {
    setError(null)
    setManaging(null)
  }

  /** Every list here is a wholesale replace at its own URL, so one save path
   *  covers all three: send the body, then let the saved row come back down
   *  through a refresh rather than patching local state to match it. */
  async function saveList(path: string, body: unknown) {
    setPending(true)
    setError(null)
    const err = await put(`/api/be/equipment-types/${type.id}/${path}`, body)
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setManaging(null)
    router.refresh()
  }

  const capsDirty =
    capabilitySignature(caps) !== capabilitySignature(capabilityDrafts(type))
  // Two rows of one kind must differ by name, so an unnamed second "Other" is
  // a save the API can only bounce. Said here, before it is sent.
  const capsError = capabilityNameError(caps)
  const enclavesDirty =
    enclaveSignature(enclaveIds) !== enclaveSignature(type.enclave_ids)
  const centersDirty =
    workCenterSignature(centers) !== workCenterSignature(workCenterDrafts(type))

  // Both read straight out of their maps rather than through `equipmentIcon`:
  // a subcategory on a type is never null, and a call returning a component
  // in a render body is what the static-components rule is there to catch.
  const Icon = EQUIPMENT_SUBCATEGORY_ICONS[type.subcategory]
  const CategoryIcon = ASSET_CATEGORY_ICONS[type.category]

  /** Whether the supply system knows this thing by any name of its own. All
   *  four are optional, and a workspace type someone typed in by hand often
   *  has none of them. */
  const identified = Boolean(
    type.nsn || type.lin || type.manufacturer || type.model,
  )

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-lg flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <span>{type.title}</span>
            {type.short_name && (
              <CodeBadge code={type.short_name} tone="strong" />
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <CategoryIcon className="size-3" />
              {ASSET_CATEGORY_LABELS[type.category]}
            </span>
            {type.is_global && <GlobalBadge />}
          </h1>
          {type.description ? (
            <p className="text-sm text-muted-foreground">{type.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground/60">No description.</p>
          )}
        </div>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setForm(formOf(type))
              setEditingProperties(true)
            }}
          >
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        )}
      </header>

      {/* What the supply system calls this thing, and nothing else. These are
          the numbers someone opens the page holding — an NSN off a work order,
          a model off a nameplate — so they get the weight.

          No heading and no Manage of its own: this is the header spelled out,
          and every field in it is edited in the panel the header opens. A row
          only exists when there is something to put in it, and if none of them
          are filled in the block is absent rather than empty — a grid of em
          dashes described the schema rather than the gear. */}
      {identified && (
        <ItemGroup>
          {type.nsn && (
            <DetailRow
              label="NSN"
              hint="National Stock Number — identifies the model, not an individual unit"
            >
              {type.nsn}
            </DetailRow>
          )}
          {type.lin && (
            <DetailRow
              label="LIN"
              hint="Line Item Number — property-book grouping for interchangeable items"
            >
              {type.lin}
            </DetailRow>
          )}
          {type.manufacturer && (
            <DetailRow label="Manufacturer">{type.manufacturer}</DetailRow>
          )}
          {type.model && <DetailRow label="Model">{type.model}</DetailRow>}
        </ItemGroup>
      )}

      <ManagedSection
        title="Capabilities"
        hint="What a box of this kind can do once it is set up."
        canManage={canEdit}
        managing={managing === "capabilities"}
        otherManaging={managing !== null && managing !== "capabilities"}
        onManage={() => startManaging("capabilities")}
        editor={
          <CapabilityEditor value={caps} onChange={setCaps} disabled={pending} />
        }
        bar={
          <ManageBar
            hint="Drag a capability between Standard and Optional, or add one."
            error={error ?? capsError}
            dirty={capsDirty}
            pending={pending}
            blocked={capsError !== null}
            onCancel={stopManaging}
            onSave={() =>
              saveList(
                "capabilities",
                caps.map((c) => ({
                  kind: c.kind,
                  label: c.label.trim() || CAPABILITY_LABELS[c.kind],
                  materialize_by_default: c.materialize_by_default,
                })),
              )
            }
          />
        }
      >
        <CapabilityChips caps={type.capabilities} />
      </ManagedSection>

      <ManagedSection
        title="Enclaves"
        hint="The networks a box of this kind can be put on."
        canManage={canEdit && enclaves.length > 0}
        managing={managing === "enclaves"}
        otherManaging={managing !== null && managing !== "enclaves"}
        onManage={() => startManaging("enclaves")}
        editor={
          <EnclaveCapabilityPicker
            enclaves={enclaves}
            value={enclaveIds}
            onChange={setEnclaveIds}
            disabled={pending}
          />
        }
        bar={
          <ManageBar
            hint="Check every enclave this gear can serve."
            error={error}
            dirty={enclavesDirty}
            pending={pending}
            onCancel={stopManaging}
            onSave={() => saveList("enclaves", enclaveIds)}
          />
        }
      >
        {type.enclave_ids.length === 0 ? (
          <p className="text-xs text-muted-foreground">Any — none declared.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {type.enclave_ids.map((id) => {
              const en = enclaves.find((e) => e.id === id)
              if (!en) return null
              return (
                <span
                  key={id}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    enclaveChipClass(en.color),
                  )}
                  style={enclaveChipStyle(en.color)}
                >
                  {en.short_name || en.name}
                </span>
              )
            })}
          </div>
        )}
      </ManagedSection>

      {/* The sheet had no room for these and left them write-only: you could
          set a work center and never see it again without reopening the
          editor. */}
      <ManagedSection
        title="Responsible work centers"
        hint="Usually one shop owns a kind of gear, but it can be shared. The primary is who gets asked first."
        canManage={canEdit && workCenters.length > 0}
        managing={managing === "workCenters"}
        otherManaging={managing !== null && managing !== "workCenters"}
        onManage={() => startManaging("workCenters")}
        editor={
          <WorkCenterPicker
            workCenters={workCenters}
            value={centers}
            onChange={setCenters}
            disabled={pending}
          />
        }
        bar={
          <ManageBar
            hint="Name the shops that answer for this gear."
            error={error}
            dirty={centersDirty}
            pending={pending}
            onCancel={stopManaging}
            onSave={() => saveList("work-centers", centers)}
          />
        }
      >
        {type.work_centers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None — nobody is named for this gear.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {type.work_centers.map((w) => (
              <span
                key={w.work_center_id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
              >
                {w.work_center_name ?? `#${w.work_center_id}`}
                {w.is_primary && (
                  <span className="text-muted-foreground">primary</span>
                )}
              </span>
            ))}
          </div>
        )}
      </ManagedSection>

      {/* The incidentals, kept legible and kept out of the way. Serial format
          is a setting, not a fact about the gear; other names and tags are
          things you search by rather than things you came here to read. All
          three were sitting at the same weight as the NSN, which is the one
          number on this page someone arrives already holding. */}
      <footer className="flex flex-col gap-2 border-t border-border pt-4">
        <MinorFact label="Tracking">
          {type.serialized
            ? `Serialized · IDs start ${type.id_prefix}`
            : "Bulk (no serial)"}
        </MinorFact>
        {type.aliases.length > 0 && (
          <MinorFact label="Also called">{type.aliases.join(", ")}</MinorFact>
        )}
        {type.tags.length > 0 && (
          <MinorFact label="Tags">
            {type.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </MinorFact>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Read-only — global catalog rows are admin-managed.
          </p>
        )}
      </footer>

      <PropertiesSheet
        type={type}
        form={form}
        setForm={setForm}
        tagSuggestions={tagSuggestions}
        open={editingProperties}
        onClose={() => setEditingProperties(false)}
      />
    </div>
  )
}

// ===================== one detail row =====================

/** One fact about the type: what it is called on the left, what it is on the
 *  right. The caller decides whether the row exists at all, so this never has
 *  to render a placeholder for a value nobody filled in.
 *
 *  Same `Item` shape as the UTC bill of materials and the package's UTC list,
 *  so the three catalog pages stack their rows identically. */
function DetailRow({
  label,
  hint,
  children,
}: {
  label: string
  /** Spelled-out meaning for an abbreviation nobody should have to look up. */
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Item variant="muted" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle
          title={hint}
          className={cn(
            "font-normal text-muted-foreground",
            hint && "cursor-help decoration-dotted underline-offset-2",
          )}
        >
          {label}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="flex-wrap justify-end gap-1.5 text-sm">
        {children}
      </ItemActions>
    </Item>
  )
}

/** A fact worth keeping but not worth the weight of a row: label and value on
 *  one quiet line, no card behind it. */
function MinorFact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-center gap-1 text-foreground/80">
        {children}
      </span>
    </div>
  )
}

// ===================== one managed list =====================

/** A list with a read rendering and an editor behind one Manage button.
 *
 *  While another section is being managed this one keeps its read rendering
 *  but loses its Manage: a second entrance into a mode you are already in the
 *  middle of is an invitation to lose the edit you have open. */
function ManagedSection({
  title,
  hint,
  canManage,
  managing,
  otherManaging,
  onManage,
  editor,
  bar,
  children,
}: {
  title: string
  hint: string
  canManage: boolean
  managing: boolean
  otherManaging: boolean
  onManage: () => void
  editor: React.ReactNode
  bar: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {/* While managing, the action bar is the only way out — a second exit
            up here was easy to miss and, once dirty, would have been a button
            that silently discarded the edit. */}
        {canManage && !managing && !otherManaging && (
          <Button variant="ghost" size="sm" onClick={onManage}>
            <SlidersHorizontal data-icon="inline-start" />
            Manage
          </Button>
        )}
      </div>
      {managing ? (
        <>
          {editor}
          {bar}
        </>
      ) : (
        children
      )}
    </section>
  )
}

// ===================== properties panel =====================

interface PropertiesForm {
  title: string
  short_name: string
  /** The coarse level, shared with UTCs. */
  category: AssetCategory
  /** What kind of box it is, under `category`. */
  subcategory: EquipmentSubcategory
  description: string
  aliases: string
  tags: string[]
  nsn: string
  lin: string
  manufacturer: string
  model: string
  id_prefix: string
  serialized: boolean
}

function formOf(t: EquipmentType): PropertiesForm {
  return {
    title: t.title,
    short_name: t.short_name ?? "",
    category: t.category,
    subcategory: t.subcategory,
    description: t.description ?? "",
    aliases: t.aliases.join(", "),
    tags: [...t.tags],
    nsn: t.nsn ?? "",
    lin: t.lin ?? "",
    manufacturer: t.manufacturer ?? "",
    model: t.model ?? "",
    id_prefix: t.id_prefix,
    serialized: t.serialized,
  }
}

function splitAliases(value: string): string[] {
  return value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
}

/** Everything `EquipmentTypePatch` accepts, in the order a type is decided:
 *  what it is called, what kind of thing it is, what it is for; then the
 *  numbers the supply system knows it by; then how individual boxes of it are
 *  tracked.
 *
 *  Its lists — capabilities, enclaves, work centers — are deliberately not
 *  here. Each is its own endpoint, managed in place on the page, which is what
 *  lets a failure name the one list that failed rather than report that part of
 *  a single Save went through. */
function PropertiesSheet({
  type,
  form,
  setForm,
  tagSuggestions,
  open,
  onClose,
}: {
  type: EquipmentType
  form: PropertiesForm
  setForm: (form: PropertiesForm) => void
  tagSuggestions: string[]
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
    form.title.trim() === type.title &&
    form.short_name.trim() === (type.short_name ?? "") &&
    form.category === type.category &&
    form.subcategory === type.subcategory &&
    form.description.trim() === (type.description ?? "") &&
    splitAliases(form.aliases).join(" ") === type.aliases.join(" ") &&
    form.tags.join(" ") === type.tags.join(" ") &&
    form.nsn.trim() === (type.nsn ?? "") &&
    form.lin.trim() === (type.lin ?? "") &&
    form.manufacturer.trim() === (type.manufacturer ?? "") &&
    form.model.trim() === (type.model ?? "") &&
    form.id_prefix.trim() === type.id_prefix &&
    form.serialized === type.serialized

  async function save() {
    setPending(true)
    setError(null)
    const err = await patch(`/api/be/equipment-types/${type.id}`, {
      title: form.title.trim(),
      short_name: form.short_name.trim() || null,
      category: form.category,
      subcategory: form.subcategory,
      description: form.description.trim() || null,
      aliases: splitAliases(form.aliases),
      tags: form.tags,
      nsn: form.nsn.trim() || null,
      lin: form.lin.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      id_prefix: form.id_prefix.trim() || "X",
      serialized: form.serialized,
    })
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    close()
    router.refresh()
  }

  const blocked = pending || unchanged || !form.title.trim()

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit equipment type</SheetTitle>
          <SheetDescription>
            What this model of gear is, and what the supply system calls it.
          </SheetDescription>
        </SheetHeader>

        {/* A real form, so Enter in any single-line field saves the way it does
            in every other dialog. The description is a textarea, where Enter is
            a newline and rightly stays one. Escape is already Cancel — Base UI
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
              <Label htmlFor="eq-title">Title</Label>
              <Input
                id="eq-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eq-short" className="gap-1.5">
                Short name
                <Tooltip>
                  {/* A button, not a bare icon: the hint has to be reachable
                      without a pointer, and only a focusable trigger gets
                      there by keyboard. */}
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`About the short name field. ${SHORT_NAME_HINT}`}
                        className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                      />
                    }
                  >
                    <Info className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="left">{SHORT_NAME_HINT}</TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="eq-short"
                value={form.short_name}
                onChange={(e) =>
                  setForm({ ...form, short_name: e.target.value })
                }
                disabled={pending}
                className="font-mono uppercase"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eq-category">Category</Label>
                <select
                  id="eq-category"
                  className={SELECT_CLASS}
                  value={form.category}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      category: e.target.value as AssetCategory,
                    })
                  }
                  disabled={pending}
                >
                  {ASSET_CATEGORY_VALUES.map((c) => (
                    <option key={c} value={c}>
                      {ASSET_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eq-subcategory">Kind</Label>
                <select
                  id="eq-subcategory"
                  className={SELECT_CLASS}
                  value={form.subcategory}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subcategory: e.target.value as EquipmentSubcategory,
                    })
                  }
                  disabled={pending}
                >
                  {CATEGORY_VALUES.map((c) => (
                    <option key={c} value={c}>
                      {EQUIPMENT_SUBCATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eq-manufacturer">Manufacturer</Label>
                <Input
                  id="eq-manufacturer"
                  value={form.manufacturer}
                  onChange={(e) =>
                    setForm({ ...form, manufacturer: e.target.value })
                  }
                  disabled={pending}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eq-model">Model</Label>
                <Input
                  id="eq-model"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  disabled={pending}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eq-nsn">NSN</Label>
              <Input
                id="eq-nsn"
                placeholder="5820-01-523-9937"
                value={form.nsn}
                onChange={(e) => setForm({ ...form, nsn: e.target.value })}
                disabled={pending}
              />
              <span className="text-[11px] text-muted-foreground">
                National Stock Number — identifies this model of gear, not an
                individual unit. Every one of these shares it; serials tell them
                apart.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eq-lin">LIN</Label>
              <Input
                id="eq-lin"
                placeholder="R31103"
                value={form.lin}
                onChange={(e) => setForm({ ...form, lin: e.target.value })}
                disabled={pending}
              />
              <span className="text-[11px] text-muted-foreground">
                Line Item Number — the property-book grouping for
                interchangeable items. Optional.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eq-description">Description</Label>
              <Textarea
                id="eq-description"
                rows={4}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                disabled={pending}
              />
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eq-aliases">Aliases</Label>
              <Input
                id="eq-aliases"
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="Comma separated"
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eq-tags">Tags</Label>
              <TagsInput
                id="eq-tags"
                value={form.tags}
                onChange={(tags) => setForm({ ...form, tags })}
                suggestions={tagSuggestions}
                disabled={pending}
              />
            </div>

            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="eq-prefix">ID prefix</Label>
                <Input
                  id="eq-prefix"
                  className="w-20"
                  value={form.id_prefix}
                  onChange={(e) =>
                    setForm({ ...form, id_prefix: e.target.value })
                  }
                  disabled={pending || !form.serialized}
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.serialized}
                  onChange={(e) =>
                    setForm({ ...form, serialized: e.target.checked })
                  }
                  disabled={pending}
                />
                Tracked by serial
              </label>
            </div>
          </div>

          <SheetFooter className="flex-col items-stretch gap-2">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1"
                // A blank title would be saved as one; the API has no
                // min-length on it, so the guard has to live here.
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
