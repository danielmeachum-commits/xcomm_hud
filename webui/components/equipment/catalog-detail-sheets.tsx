"use client"

import { Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { TagsInput } from "@/components/equipment/tags-input"
import {
  UtcLineEditor,
  activeEnclavesFrom,
  type LineDraft,
} from "@/components/equipment/utc-line-editor"
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
  EQUIPMENT_CATEGORY_LABELS,
  equipmentIcon,
} from "@/lib/equipment-meta"
import type {
  CapabilityKind,
  Enclave,
  EquipmentCategory,
  EquipmentType,
  PackageDef,
  UtcDef,
  UtcDefLine,
  UtcRoleHint,
} from "@/lib/types"
import { cn } from "@/lib/utils"

export const CATEGORY_VALUES = Object.keys(
  EQUIPMENT_CATEGORY_LABELS,
) as EquipmentCategory[]

const ROLE_HINT_LABELS: Record<UtcRoleHint, string> = {
  primary: "Primary",
  extension: "Extension",
  either: "Any role",
}

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

/** Code pill for a UTC or package. Mirrors the transport-badge shape so codes
 *  read as identifiers rather than prose. */
export function CodeBadge({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-foreground ring-1 ring-inset ring-border " +
        (className ?? "")
      }
    >
      {code}
    </span>
  )
}

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

/** Read-view sections, mirroring `UtcLineEditor`: enclaves in catalog order,
 *  then the untagged lines as "common" — the tail of the packing list, not the
 *  headline. Enclaves the def says nothing about are omitted entirely; an
 *  empty section would read as a stack that was deliberately left out.
 *
 *  Grouped by enclave rather than by equipment category because that is how the
 *  UTC is described out loud: what are we supporting, and what does each one
 *  need. */
function groupLinesByEnclave(
  lines: UtcDefLine[],
  enclaves: Enclave[],
): { enclave: Enclave | null; lines: UtcDefLine[] }[] {
  const sections = enclaves
    .map((e) => ({
      enclave: e as Enclave | null,
      lines: lines.filter((l) => l.enclave_id === e.id),
    }))
    .filter((s) => s.lines.length > 0)
  // A line tagged with an enclave this sheet wasn't handed (retired, or from
  // another workspace) still has to appear — falling through to "common" is
  // wrong but visible, where dropping it silently is not.
  const known = new Set(enclaves.map((e) => e.id))
  const common = lines.filter(
    (l) => l.enclave_id === null || !known.has(l.enclave_id),
  )
  return common.length > 0
    ? [...sections, { enclave: null, lines: common }]
    : sections
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
  category: EquipmentCategory
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
}

function typeForm(t: EquipmentType): TypeForm {
  return {
    title: t.title,
    short_name: t.short_name ?? "",
    category: t.category,
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
  tagSuggestions = [],
  onClose,
}: {
  type: EquipmentType | null
  canEdit: boolean
  enclaves?: Enclave[]
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

  const Icon = type ? equipmentIcon(type.category) : null

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
                {EQUIPMENT_CATEGORY_LABELS[type.category]}
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
                            category: e.target.value as EquipmentCategory,
                          })
                        }
                        disabled={pending}
                      >
                        {CATEGORY_VALUES.map((c) => (
                          <option key={c} value={c}>
                            {EQUIPMENT_CATEGORY_LABELS[c]}
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

export function UtcDefSheet({
  def,
  types,
  enclaves = [],
  canEdit,
  onClose,
}: {
  def: UtcDef | null
  types: EquipmentType[]
  enclaves?: Enclave[]
  canEdit: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CodeForm | null>(null)
  // The full bill of materials as drafts. Editing lines here rather than only
  // their enclave tags is what makes "add an item to SIPR" possible at all.
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([])
  const [activeEnclaves, setActiveEnclaves] = useState<number[]>([])

  useEffect(() => {
    setEditing(false)
    setError(null)
    setForm(
      def
        ? { code: def.code, name: def.name, description: def.description ?? "" }
        : null,
    )
    const drafts: LineDraft[] = def
      ? def.lines.map((l) => ({
          equipment_type_id: l.equipment_type_id,
          quantity: l.quantity,
          enclave_id: l.enclave_id,
        }))
      : []
    setLineDrafts(drafts)
    setActiveEnclaves(activeEnclavesFrom(drafts))
  }, [def])

  const byId = new Map(types.map((t) => [t.id, t]))

  async function save() {
    if (!def || !form) return
    setPending(true)
    setError(null)
    const err = await patch(`/api/be/utc-defs/${def.id}`, {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
    })
    if (err) {
      setPending(false)
      setError(err)
      return
    }
    // Lines live on their own wholesale-replace endpoint. Only call it when
    // something actually changed — an unnecessary replace churns line ids that
    // nothing else should have to care about.
    const payload = lineDrafts
      .filter((l) => l.equipment_type_id !== "")
      .map((l) => ({
        equipment_type_id: Number(l.equipment_type_id),
        quantity: l.quantity,
        enclave_id: l.enclave_id,
      }))
    const before = def.lines
      .map((l) => `${l.equipment_type_id}:${l.enclave_id ?? ""}:${l.quantity}`)
      .sort()
      .join("|")
    const after = payload
      .map((l) => `${l.equipment_type_id}:${l.enclave_id ?? ""}:${l.quantity}`)
      .sort()
      .join("|")
    const linesErr =
      before !== after
        ? await put(`/api/be/utc-defs/${def.id}/lines`, payload)
        : null
    setPending(false)
    if (linesErr) {
      // The code/name already saved; say so rather than implying a rollback.
      setError(`Details saved, but the bill of materials failed: ${linesErr}`)
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
                {def.lines.length} equipment line
                {def.lines.length === 1 ? "" : "s"}
                {def.is_global ? " · Global catalog" : " · Workspace"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {editing && form ? (
                <div className="flex flex-col gap-4">
                  <CodeFields form={form} setForm={setForm} pending={pending} />
                  <div className="flex flex-col gap-1.5">
                    <Label>Bill of materials</Label>
                    <p className="text-[11px] text-muted-foreground">
                      What this UTC brings, grouped by the enclave it serves.
                      Unchecking an enclave removes its section — that&apos;s
                      what lets a deployment leave a whole stack home in one
                      click later.
                    </p>
                    <UtcLineEditor
                      lines={lineDrafts}
                      onChange={setLineDrafts}
                      types={types}
                      enclaves={enclaves}
                      active={activeEnclaves}
                      onActiveChange={setActiveEnclaves}
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
                      kinds={aggregateCapabilities(def.lines, byId)}
                    />
                  </Field>
                  <div className="flex flex-col gap-3">
                    {groupLinesByEnclave(def.lines, enclaves).map(
                      ({ enclave, lines }) => (
                        <div
                          key={enclave?.id ?? "common"}
                          className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5"
                        >
                          <div className="flex items-center gap-2">
                            {enclave ? (
                              <>
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                    enclaveChipClass(enclave.color),
                                  )}
                                  style={enclaveChipStyle(enclave.color)}
                                >
                                  {enclave.short_name || enclave.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {enclave.name}
                                </span>
                              </>
                            ) : (
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Common to every enclave
                              </span>
                            )}
                          </div>
                          <ul className="flex flex-col gap-1 text-sm">
                            {lines.map((l) => (
                              <li
                                key={l.id}
                                className="flex justify-between gap-2 border-b border-border/50 pb-1 last:border-b-0 last:pb-0"
                              >
                                <span>
                                  {l.equipment_type_short_name ??
                                    l.equipment_type_title}
                                  {!l.serialized && (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      (bulk)
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-muted-foreground">
                                  ×{l.quantity}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ),
                    )}
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

  useEffect(() => {
    setEditing(false)
    setError(null)
    setForm(
      def
        ? { code: def.code, name: def.name, description: def.description ?? "" }
        : null,
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
    setPending(false)
    if (err) {
      setError(err)
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
                <CodeFields form={form} setForm={setForm} pending={pending} />
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
                            {ROLE_HINT_LABELS[u.role_hint]}
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
