"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { Plus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type {
  Role,
  SiteProperty,
  SitePropertyTemplate,
  SitePropertyType,
  SitePropertyValue,
} from "@/lib/types"

const TYPES: SitePropertyType[] = [
  "text",
  "long_text",
  "number",
  "phone",
  "email",
  "url",
  "date",
  "bool",
]

const TYPE_LABEL: Record<SitePropertyType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  phone: "Phone",
  email: "Email",
  url: "URL",
  date: "Date",
  bool: "Yes/No",
}

interface Props {
  siteId: number
  properties: SiteProperty[]
  templates: SitePropertyTemplate[]
  userRole?: Role
}

export function SiteDetailsTab({ siteId, properties, templates, userRole }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [adding, setAdding] = useState(false)
  const canEdit = userRole === "operator" || userRole === "admin"

  // Group properties by their `group` — nullish falls into "Other".
  const grouped = useMemo(() => {
    const map = new Map<string, SiteProperty[]>()
    for (const p of properties) {
      const g = p.group ?? "Other"
      const list = map.get(g) ?? []
      list.push(p)
      map.set(g, list)
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => a.display_order - b.display_order || a.label.localeCompare(b.label),
      )
    }
    // Named groups first (alpha), "Other" last if present.
    const keys = [...map.keys()].sort((a, b) => {
      if (a === "Other") return 1
      if (b === "Other") return -1
      return a.localeCompare(b)
    })
    return keys.map((k) => [k, map.get(k)!] as const)
  }, [properties])

  const hasTemplates = templates.length > 0

  const groupSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const p of properties) if (p.group) set.add(p.group)
    return [...set].sort()
  }, [properties])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {editing ? "Values save on blur." : "Ad-hoc typed properties for this site."}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing && (
            <>
              {hasTemplates && (
                <Button size="sm" variant="outline" onClick={() => setApplying(true)}>
                  Apply template
                </Button>
              )}
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" />
                Add property
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          )}
          {!editing && canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No properties yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasTemplates
              ? "Apply a template to seed a standard set of fields, or add ad-hoc properties one at a time."
              : "Add ad-hoc properties one at a time, or create a template in the workspace admin to seed a standard set."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([groupName, items]) => (
            <section key={groupName}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {groupName}
              </h2>
              <ul className="divide-y divide-border rounded-lg border">
                {items.map((p) => (
                  <PropertyRow
                    key={p.id}
                    siteId={siteId}
                    property={p}
                    groupSuggestions={groupSuggestions}
                    editing={editing}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {applying && (
        <ApplyTemplateDialog
          siteId={siteId}
          templates={templates}
          onClose={() => setApplying(false)}
        />
      )}

      {adding && (
        <PropertySchemaDialog
          siteId={siteId}
          property={null}
          groupSuggestions={groupSuggestions}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function ReadOnlyValue({ property }: { property: SiteProperty }) {
  const v = property.value
  if (v == null || v === "") return <span className="text-muted-foreground">—</span>
  if (property.type === "bool") return <span>{v === true ? "Yes" : "No"}</span>
  if (property.type === "long_text")
    return <span className="whitespace-pre-wrap">{String(v)}</span>
  return <span>{String(v)}</span>
}

function PropertyRow({
  siteId,
  property,
  groupSuggestions,
  editing,
  onChanged,
}: {
  siteId: number
  property: SiteProperty
  groupSuggestions: string[]
  editing: boolean
  onChanged: () => void
}) {
  const [editingSchema, setEditingSchema] = useState(false)

  async function remove() {
    if (!confirm(`Delete property "${property.label}"?`)) return
    const res = await fetch(
      `/api/be/sites/${siteId}/properties/${property.id}`,
      { method: "DELETE" },
    )
    if (res.ok) onChanged()
  }

  return (
    <>
      <li className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editing ? (
              <button
                type="button"
                onClick={() => setEditingSchema(true)}
                className="text-sm font-medium hover:underline"
                title="Edit field"
              >
                {property.label}
              </button>
            ) : (
              <span className="text-sm font-medium">{property.label}</span>
            )}
            {property.required && (
              <span className="text-[10px] uppercase tracking-wider text-destructive">
                required
              </span>
            )}
            {editing && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {TYPE_LABEL[property.type]}
              </span>
            )}
            {editing && property.source === "custom" && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                · custom
              </span>
            )}
          </div>
          {property.description && (
            <p className="text-xs text-muted-foreground">
              {property.description}
            </p>
          )}
        </div>
        <div className="w-full max-w-sm text-sm">
          {editing ? (
            <ValueEditor
              siteId={siteId}
              property={property}
              onChanged={onChanged}
            />
          ) : (
            <ReadOnlyValue property={property} />
          )}
        </div>
        {editing && (
          <Button size="sm" variant="ghost" onClick={remove} title="Delete">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </li>
      {editingSchema && (
        <PropertySchemaDialog
          siteId={siteId}
          property={property}
          groupSuggestions={groupSuggestions}
          onClose={() => setEditingSchema(false)}
        />
      )}
    </>
  )
}

function ValueEditor({
  siteId,
  property,
  onChanged,
}: {
  siteId: number
  property: SiteProperty
  onChanged: () => void
}) {
  const [value, setValue] = useState<SitePropertyValue>(property.value)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next: SitePropertyValue) {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/be/sites/${siteId}/properties/${property.id}/value`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: next }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Save failed")
      }
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setPending(false)
    }
  }

  const strValue = value == null ? "" : String(value)
  const commonProps = {
    disabled: pending,
    className: cn(
      "h-9 w-full rounded-md border border-input bg-background px-3 text-sm",
      error && "border-destructive",
    ),
  }

  if (property.type === "long_text") {
    return (
      <div>
        <Textarea
          value={strValue}
          rows={2}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const next = strValue === "" ? null : strValue
            if (next !== property.value) void save(next)
          }}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    )
  }
  if (property.type === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value === true}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked
            setValue(next)
            void save(next)
          }}
        />
        <span className="text-muted-foreground">
          {value === true ? "Yes" : "No"}
        </span>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </label>
    )
  }
  const type =
    property.type === "number"
      ? "number"
      : property.type === "phone"
        ? "tel"
        : property.type === "email"
          ? "email"
          : property.type === "url"
            ? "url"
            : property.type === "date"
              ? "date"
              : "text"

  return (
    <div>
      <input
        {...commonProps}
        type={type}
        value={strValue}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const raw = strValue
          let next: SitePropertyValue = raw === "" ? null : raw
          if (property.type === "number" && next !== null) {
            const parsed = Number(raw)
            next = Number.isFinite(parsed) ? parsed : null
          }
          if (next !== property.value) void save(next)
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ApplyTemplateDialog({
  siteId,
  templates,
  onClose,
}: {
  siteId: number
  templates: SitePropertyTemplate[]
  onClose: () => void
}) {
  const router = useRouter()
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? 0)
  const [mode, setMode] = useState<"add" | "replace">("add")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/be/sites/${siteId}/properties/apply-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id: templateId, mode }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Apply failed")
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl">Template</Label>
            <select
              id="tpl"
              value={templateId}
              onChange={(e) => setTemplateId(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.definitions.length} fields)
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("add")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-left text-xs transition-colors",
                  mode === "add"
                    ? "border-foreground bg-accent"
                    : "border-input hover:bg-accent/50",
                )}
                disabled={pending}
              >
                <span className="text-sm font-medium">Add</span>
                <span className="text-muted-foreground">
                  Add missing fields, refresh labels on existing ones. Values
                  kept.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("replace")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-left text-xs transition-colors",
                  mode === "replace"
                    ? "border-foreground bg-accent"
                    : "border-input hover:bg-accent/50",
                )}
                disabled={pending}
              >
                <span className="text-sm font-medium">Replace</span>
                <span className="text-muted-foreground">
                  Sync fully — remove template fields no longer in the template.
                  Custom fields preserved.
                </span>
              </button>
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !templateId}>
            {pending ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PropertySchemaDialog({
  siteId,
  property,
  groupSuggestions,
  onClose,
}: {
  siteId: number
  property: SiteProperty | null
  groupSuggestions: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const editing = property !== null
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    key: property?.key ?? "",
    label: property?.label ?? "",
    type: (property?.type ?? "text") as SitePropertyType,
    required: property?.required ?? false,
    group: property?.group ?? "",
    description: property?.description ?? "",
    display_order: property?.display_order ?? 0,
  })

  function slugify(s: string) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64)
  }
  function setLabel(v: string) {
    setDraft((prev) => ({
      ...prev,
      label: v,
      key: editing || prev.key !== slugify(prev.label) ? prev.key : slugify(v),
    }))
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body = {
        key: draft.key,
        label: draft.label,
        type: draft.type,
        required: draft.required,
        group: draft.group || null,
        description: draft.description || null,
        display_order: draft.display_order,
      }
      const url = editing
        ? `/api/be/sites/${siteId}/properties/${property!.id}`
        : `/api/be/sites/${siteId}/properties`
      const method = editing ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Save failed")
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${property!.label}` : "New property"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-label">Label</Label>
              <Input
                id="p-label"
                value={draft.label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-key">Key</Label>
              <Input
                id="p-key"
                value={draft.key}
                onChange={(e) =>
                  setDraft({ ...draft, key: slugify(e.target.value) })
                }
                disabled={pending}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-type">Type</Label>
              <select
                id="p-type"
                value={draft.type}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    type: e.target.value as SitePropertyType,
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-group">Group</Label>
              <Input
                id="p-group"
                list="p-group-suggestions"
                value={draft.group}
                onChange={(e) => setDraft({ ...draft, group: e.target.value })}
                placeholder="Contacts, Location…"
                disabled={pending}
              />
              <datalist id="p-group-suggestions">
                {groupSuggestions.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-order">Order</Label>
              <Input
                id="p-order"
                type="number"
                value={draft.display_order}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    display_order: Number(e.target.value) || 0,
                  })
                }
                disabled={pending}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(e) =>
                    setDraft({ ...draft, required: e.target.checked })
                  }
                  disabled={pending}
                />
                Required
              </label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea
              id="p-desc"
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              rows={2}
              disabled={pending}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !draft.label || !draft.key}
          >
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
