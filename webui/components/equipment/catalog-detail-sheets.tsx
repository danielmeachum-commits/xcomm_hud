"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

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
import {
  CAPABILITY_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
  equipmentIcon,
} from "@/lib/equipment-meta"
import type {
  CapabilityKind,
  EquipmentCategory,
  EquipmentType,
  PackageDef,
  UtcDef,
  UtcDefLine,
  UtcRoleHint,
} from "@/lib/types"

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

async function patch(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return null
  const detail = await res.json().catch(() => ({}))
  return typeof detail.detail === "string" ? detail.detail : "Failed to save"
}

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
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function CapabilityChips({ kinds }: { kinds: CapabilityKind[] }) {
  if (kinds.length === 0)
    return <span className="text-xs text-muted-foreground">None</span>
  return (
    <div className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <span
          key={k}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {CAPABILITY_LABELS[k]}
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

function groupLinesByCategory(
  lines: UtcDefLine[],
  byId: Map<number, EquipmentType>,
): [EquipmentCategory, UtcDefLine[]][] {
  const groups = new Map<EquipmentCategory, UtcDefLine[]>()
  for (const l of lines) {
    const cat = byId.get(l.equipment_type_id)?.category ?? "other"
    const bucket = groups.get(cat)
    if (bucket) bucket.push(l)
    else groups.set(cat, [l])
  }
  return CATEGORY_VALUES.filter((c) => groups.has(c)).map((c) => [
    c,
    groups.get(c)!,
  ])
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
  }
}

export function EquipmentTypeSheet({
  type,
  canEdit,
  tagSuggestions = [],
  onClose,
}: {
  type: EquipmentType | null
  canEdit: boolean
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
    setPending(false)
    if (err) {
      setError(err)
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
                        value={form.nsn}
                        onChange={(e) =>
                          setForm({ ...form, nsn: e.target.value })
                        }
                        disabled={pending}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="eq-lin">LIN</Label>
                      <Input
                        id="eq-lin"
                        value={form.lin}
                        onChange={(e) =>
                          setForm({ ...form, lin: e.target.value })
                        }
                        disabled={pending}
                      />
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
                    <Field label="NSN">{type.nsn || "—"}</Field>
                    <Field label="LIN">{type.lin || "—"}</Field>
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
                  <Field label="Capabilities">
                    <CapabilityChips
                      kinds={type.capabilities.map((c) => c.kind)}
                    />
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
  canEdit,
  onClose,
}: {
  def: UtcDef | null
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

  async function save() {
    if (!def || !form) return
    setPending(true)
    setError(null)
    const err = await patch(`/api/be/utc-defs/${def.id}`, {
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
                {def.lines.length} equipment line
                {def.lines.length === 1 ? "" : "s"}
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
                      kinds={aggregateCapabilities(def.lines, byId)}
                    />
                  </Field>
                  <div className="flex flex-col gap-3">
                    {groupLinesByCategory(def.lines, byId).map(
                      ([cat, lines]) => {
                        const Icon = equipmentIcon(cat)
                        return (
                          <div key={cat} className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                              <Icon className="size-3.5" />
                              {EQUIPMENT_CATEGORY_LABELS[cat]}
                            </div>
                            <ul className="flex flex-col gap-1 text-sm">
                              {lines.map((l) => (
                                <li
                                  key={l.id}
                                  className="flex justify-between gap-2 border-b border-border/50 pb-1"
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
                        )
                      },
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
