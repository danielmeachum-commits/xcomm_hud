"use client"

import { Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import { TagsInput } from "@/components/equipment/tags-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_VALUES,
  EQUIPMENT_SUBCATEGORY_LABELS,
  UTC_ROLE_HINT_LABELS,
  UTC_ROLE_HINT_VALUES,
  equipmentIcon,
} from "@/lib/equipment-meta"
import type {
  CapabilityKind,
  Enclave,
  AssetCategory,
  EquipmentSubcategory,
  EquipmentType,
  WorkCenter,
  PackageDef,
  UtcDef,
  UtcDefLine,
  UtcRoleHint,
} from "@/lib/types"
import { cn } from "@/lib/utils"

export const CATEGORY_VALUES = Object.keys(
  EQUIPMENT_SUBCATEGORY_LABELS,
) as EquipmentSubcategory[]

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

const patch = (url: string, body: unknown) => send("PATCH", url, body)
const put = (url: string, body: unknown) => send("PUT", url, body)

function Field({
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
function CapabilityChips({
  kinds,
  caps,
}: {
  kinds?: CapabilityKind[]
  caps?: { kind: CapabilityKind; label: string }[]
}) {
  const chips =
    caps?.map((c, i) => ({ key: `${c.kind}-${i}`, text: c.label })) ??
    kinds?.map((k) => ({ key: k, text: CAPABILITY_LABELS[k] })) ??
    []
  if (chips.length === 0)
    return <span className="text-xs text-muted-foreground">None</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
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

/** Editable shape of one declared capability. No `id` — the save path replaces
 *  the whole list, so rows only need to survive until the PUT. */
export interface CapabilityDraft {
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

/** Rows the operator edits in place. Order is meaningful: it becomes
 *  `display_order` server-side. */
export function CapabilityEditor({
  value,
  onChange,
  disabled,
}: {
  value: CapabilityDraft[]
  onChange: (next: CapabilityDraft[]) => void
  disabled: boolean
}) {
  function update(index: number, patch: Partial<CapabilityDraft>) {
    onChange(value.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          None declared. Capabilities are what this gear can provide — they
          become the checkboxes when a kit is registered.
        </p>
      )}
      {value.map((cap, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
          <div className="flex gap-1.5">
            <select
              aria-label="Capability kind"
              className={cn(SELECT_CLASS, "flex-1")}
              value={cap.kind}
              disabled={disabled}
              onChange={(e) => {
                const kind = e.target.value as CapabilityKind
                // Keep a hand-written label, but retitle one the operator
                // never touched so it follows the kind they just picked.
                const renamed =
                  cap.label === CAPABILITY_LABELS[cap.kind] || !cap.label.trim()
                update(i, {
                  kind,
                  ...(renamed ? { label: CAPABILITY_LABELS[kind] } : {}),
                })
              }}
            >
              {CAPABILITY_VALUES.map((k) => (
                <option key={k} value={k}>
                  {CAPABILITY_LABELS[k]}
                </option>
              ))}
            </select>
            <Input
              aria-label="Capability label"
              className="flex-1"
              value={cap.label}
              placeholder="Label"
              disabled={disabled}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove capability"
              disabled={disabled}
              onClick={() => onChange(value.filter((_, x) => x !== i))}
            >
              <X className="size-4" />
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={cap.materialize_by_default}
              disabled={disabled}
              onChange={(e) =>
                update(i, { materialize_by_default: e.target.checked })
              }
            />
            Checked by default when a kit is registered
          </label>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...value,
            {
              kind: "other",
              label: CAPABILITY_LABELS.other,
              materialize_by_default: true,
            },
          ])
        }
      >
        <Plus className="size-4" />
        Add capability
      </Button>
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

/** Order counts — it becomes `display_order` — so compare positionally. */
function capabilitiesChanged(
  type: EquipmentType,
  drafts: CapabilityDraft[],
): boolean {
  if (type.capabilities.length !== drafts.length) return true
  return type.capabilities.some((c, i) => {
    const d = drafts[i]
    return (
      c.kind !== d.kind ||
      c.label !== (d.label.trim() || CAPABILITY_LABELS[d.kind]) ||
      c.materialize_by_default !== d.materialize_by_default
    )
  })
}

interface TypeForm {
  title: string
  short_name: string
  /** The coarse level, shared with UTCs. */
  category: AssetCategory
  /** What kind of box it is, under `category`. */
  subcategory: EquipmentSubcategory
  aliases: string
  tags: string[]
  nsn: string
  lin: string
  manufacturer: string
  model: string
  id_prefix: string
  serialized: boolean
  description: string
  capabilities: CapabilityDraft[]
  enclave_ids: number[]
  work_centers: WorkCenterDraft[]
}

function typeForm(t: EquipmentType): TypeForm {
  return {
    title: t.title,
    short_name: t.short_name ?? "",
    category: t.category,
    subcategory: t.subcategory,
    work_centers: t.work_centers.map((w) => ({
      work_center_id: w.work_center_id,
      is_primary: w.is_primary,
    })),
    aliases: t.aliases.join(", "),
    tags: [...t.tags],
    nsn: t.nsn ?? "",
    lin: t.lin ?? "",
    manufacturer: t.manufacturer ?? "",
    model: t.model ?? "",
    id_prefix: t.id_prefix,
    serialized: t.serialized,
    description: t.description ?? "",
    capabilities: t.capabilities.map((c) => ({
      kind: c.kind,
      label: c.label,
      materialize_by_default: c.materialize_by_default,
    })),
    enclave_ids: [...t.enclave_ids],
  }
}

export function EquipmentTypeSheet({
  type,
  canEdit,
  enclaves = [],
  workCenters = [],
  tagSuggestions = [],
  onClose,
}: {
  type: EquipmentType | null
  canEdit: boolean
  enclaves?: Enclave[]
  workCenters?: WorkCenter[]
  tagSuggestions?: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<TypeForm | null>(null)

  useEffect(() => {
    setEditing(false)
    setError(null)
    setForm(type ? typeForm(type) : null)
  }, [type])

  async function save() {
    if (!type || !form) return
    setPending(true)
    setError(null)
    const err = await patch(`/api/be/equipment-types/${type.id}`, {
      title: form.title.trim(),
      short_name: form.short_name.trim() || null,
      category: form.category,
      aliases: form.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      tags: form.tags,
      nsn: form.nsn.trim() || null,
      lin: form.lin.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      id_prefix: form.id_prefix.trim() || "X",
      serialized: form.serialized,
      description: form.description.trim() || null,
    })
    if (err) {
      setPending(false)
      setError(err)
      return
    }
    // Capabilities live on their own endpoint (wholesale replace), so this is
    // a second call. Only make it when the list actually changed — an
    // unnecessary replace churns rows other UTCs read.
    const enclavesChanged =
      [...form.enclave_ids].sort().join(",") !==
      [...type.enclave_ids].sort().join(",")
    const encErr = enclavesChanged
      ? await put(
          `/api/be/equipment-types/${type.id}/enclaves`,
          form.enclave_ids,
        )
      : null
    if (encErr) {
      setPending(false)
      setError(`Details saved, but enclaves failed: ${encErr}`)
      router.refresh()
      return
    }
    const wcSig = (rows: WorkCenterDraft[]) =>
      [...rows]
        .sort((a, b) => a.work_center_id - b.work_center_id)
        .map((r) => `${r.work_center_id}:${r.is_primary}`)
        .join(",")
    const wcErr =
      wcSig(form.work_centers) !==
      wcSig(
        type.work_centers.map((w) => ({
          work_center_id: w.work_center_id,
          is_primary: w.is_primary,
        })),
      )
        ? await put(
            `/api/be/equipment-types/${type.id}/work-centers`,
            form.work_centers,
          )
        : null
    if (wcErr) {
      setPending(false)
      setError(`Details saved, but work centers failed: ${wcErr}`)
      router.refresh()
      return
    }
    const capsErr = capabilitiesChanged(type, form.capabilities)
      ? await put(
          `/api/be/equipment-types/${type.id}/capabilities`,
          form.capabilities.map((c) => ({
            kind: c.kind,
            label: c.label.trim() || CAPABILITY_LABELS[c.kind],
            materialize_by_default: c.materialize_by_default,
          })),
        )
      : null
    setPending(false)
    if (capsErr) {
      // The type fields already saved; say so rather than implying a rollback.
      setError(`Details saved, but capabilities failed: ${capsErr}`)
      router.refresh()
      return
    }
    setEditing(false)
    router.refresh()
  }

  const Icon = type ? equipmentIcon(type.subcategory) : null

  return (
    <Sheet open={!!type} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        {type && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {Icon && <Icon className="size-5 text-muted-foreground" />}
                {type.title}
              </SheetTitle>
              <SheetDescription>
                {ASSET_CATEGORY_LABELS[type.category]}
                {" · "}
                {EQUIPMENT_SUBCATEGORY_LABELS[type.subcategory]}
                {type.is_global ? " · Global catalog" : " · Workspace"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {editing && form ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="eq-title">Title</Label>
                    <Input
                      id="eq-title"
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                      disabled={pending}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="eq-short">Short name</Label>
                      <Input
                        id="eq-short"
                        value={form.short_name}
                        onChange={(e) =>
                          setForm({ ...form, short_name: e.target.value })
                        }
                        disabled={pending}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
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
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="eq-subcategory">Subcategory</Label>
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
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="eq-aliases">Aliases</Label>
                    <Input
                      id="eq-aliases"
                      value={form.aliases}
                      onChange={(e) =>
                        setForm({ ...form, aliases: e.target.value })
                      }
                      placeholder="Comma separated"
                      disabled={pending}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="eq-tags">Tags</Label>
                    <TagsInput
                      id="eq-tags"
                      value={form.tags}
                      onChange={(tags) => setForm({ ...form, tags })}
                      suggestions={tagSuggestions}
                      disabled={pending}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="eq-nsn">NSN</Label>
                      <Input
                        id="eq-nsn"
                        placeholder="5820-01-523-9937"
                        value={form.nsn}
                        onChange={(e) =>
                          setForm({ ...form, nsn: e.target.value })
                        }
                        disabled={pending}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        National Stock Number — identifies this model of gear,
                        not an individual unit. Every one of these shares it;
                        serials tell them apart.
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="eq-lin">LIN</Label>
                      <Input
                        id="eq-lin"
                        placeholder="R31103"
                        value={form.lin}
                        onChange={(e) =>
                          setForm({ ...form, lin: e.target.value })
                        }
                        disabled={pending}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        Line Item Number — the property-book grouping for
                        interchangeable items. Optional.
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
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
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="eq-model">Model</Label>
                      <Input
                        id="eq-model"
                        value={form.model}
                        onChange={(e) =>
                          setForm({ ...form, model: e.target.value })
                        }
                        disabled={pending}
                      />
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex flex-col gap-1">
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
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="eq-desc">Description</Label>
                    <Textarea
                      id="eq-desc"
                      rows={3}
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      disabled={pending}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Enclaves this gear can serve</Label>
                    <EnclaveCapabilityPicker
                      enclaves={enclaves}
                      value={form.enclave_ids}
                      onChange={(enclave_ids) =>
                        setForm({ ...form, enclave_ids })
                      }
                      disabled={pending}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Responsible work centers</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Usually one shop owns a kind of gear, but it can be
                      shared. The primary is who gets asked first.
                    </p>
                    <WorkCenterPicker
                      workCenters={workCenters}
                      value={form.work_centers}
                      onChange={(work_centers) =>
                        setForm({ ...form, work_centers })
                      }
                      disabled={pending}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Capabilities</Label>
                    <CapabilityEditor
                      value={form.capabilities}
                      onChange={(capabilities) =>
                        setForm({ ...form, capabilities })
                      }
                      disabled={pending}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {type.description && (
                    <p className="text-sm text-muted-foreground">
                      {type.description}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Short name">{type.short_name || "—"}</Field>
                    <Field label="Tracking">
                      {type.serialized
                        ? `Serialized · IDs start ${type.id_prefix}`
                        : "Bulk (no serial)"}
                    </Field>
                    <Field
                      label="NSN"
                      hint="National Stock Number — identifies the model, not an individual unit"
                    >
                      {type.nsn || "—"}
                    </Field>
                    <Field
                      label="LIN"
                      hint="Line Item Number — property-book grouping for interchangeable items"
                    >
                      {type.lin || "—"}
                    </Field>
                    <Field label="Manufacturer">
                      {type.manufacturer || "—"}
                    </Field>
                    <Field label="Model">{type.model || "—"}</Field>
                  </div>
                  <Field label="Also called">
                    {type.aliases.length > 0 ? type.aliases.join(", ") : "—"}
                  </Field>
                  <Field label="Tags">
                    {type.tags.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {type.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-muted px-2 py-0.5 text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Field>
                  <Field label="Enclaves">
                    {type.enclave_ids.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Any — none declared
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
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
                      </span>
                    )}
                  </Field>
                  <Field label="Capabilities">
                    <CapabilityChips caps={type.capabilities} />
                  </Field>
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
                setForm(typeForm(type))
              }}
              onSave={save}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
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
