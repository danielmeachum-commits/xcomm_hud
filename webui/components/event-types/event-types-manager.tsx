"use client"

import { useMemo, useState } from "react"
import { Plus } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  GENERAL_SUBJECT_KINDS,
  SEVERITIES,
  type EventTypeDef,
  type Me,
  type RecordClass,
  type Severity,
  type SubjectKind,
} from "@/lib/types"
import { eventTypeIcon, groupByCategory } from "@/lib/event-type-meta"
import { cn } from "@/lib/utils"

import {
  ColorSelect,
  IconGrid,
} from "@/components/events/type-style-pickers"

const SCOPE_LABELS: Partial<Record<SubjectKind, string>> = {
  system: "System",
  mission: "Mission",
  exercise: "Exercise",
  site: "Site",
  team: "Team",
  unit: "Unit",
  work_center: "Work center",
  workspace: "Workspace",
}

function scopeLabel(kind: SubjectKind): string {
  return SCOPE_LABELS[kind] ?? kind
}

/** Derive a slug from a label: lowercase, spaces → ".", strip invalid chars. */
function deriveSlug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64)
}

interface FormState {
  label: string
  slug: string
  slugTouched: boolean
  description: string
  category: string
  record_class: RecordClass
  default_severity: Severity
  icon: string | null
  color: string | null
  allowed_subject_kinds: SubjectKind[]
}

const EMPTY_FORM: FormState = {
  label: "",
  slug: "",
  slugTouched: false,
  description: "",
  category: "",
  record_class: "event",
  default_severity: "info",
  icon: null,
  color: null,
  allowed_subject_kinds: [],
}

interface Props {
  me: Me
  initialTypes: EventTypeDef[]
}

export function EventTypesManager({ me, initialTypes }: Props) {
  const [types, setTypes] = useState<EventTypeDef[]>(initialTypes)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EventTypeDef | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{
    id: number
    message: string
  } | null>(null)

  const isAdmin = me.role === "admin"
  const isOperator = isAdmin || me.role === "operator"

  // Grouped by category ("Exercise", "Briefing", ...) — workspace-vs-builtin
  // is a per-row chip, not the primary grouping.
  const grouped = useMemo(() => groupByCategory(types), [types])
  const existingCategories = useMemo(
    () =>
      Array.from(
        new Set(
          types.map((t) => t.category?.trim()).filter((c): c is string => !!c),
        ),
      ).sort(),
    [types],
  )

  function canManage(t: EventTypeDef): boolean {
    return t.workspace_id === null ? isAdmin : isOperator
  }

  function startCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setDialogOpen(true)
  }

  function startEdit(t: EventTypeDef) {
    setEditing(t)
    setForm({
      label: t.label,
      slug: t.slug,
      slugTouched: true,
      description: t.description ?? "",
      category: t.category ?? "",
      record_class: t.record_class,
      default_severity: t.default_severity,
      icon: t.icon,
      color: t.color,
      allowed_subject_kinds: t.allowed_subject_kinds,
    })
    setError(null)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
    setError(null)
  }

  function toggleScope(kind: SubjectKind, checked: boolean) {
    setForm((f) => ({
      ...f,
      allowed_subject_kinds: checked
        ? [...f.allowed_subject_kinds, kind]
        : f.allowed_subject_kinds.filter((k) => k !== kind),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const shared = {
        label: form.label.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        record_class: form.record_class,
        default_severity: form.default_severity,
        icon: form.icon,
        color: form.color,
        allowed_subject_kinds: form.allowed_subject_kinds,
      }
      const res = await fetch(
        editing ? `/api/be/event-types/${editing.id}` : "/api/be/event-types",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editing ? shared : { ...shared, slug: form.slug.trim() },
          ),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : `Save failed (${res.status})`,
        )
      }
      const saved = (await res.json()) as EventTypeDef
      setTypes((prev) =>
        editing
          ? prev.map((t) => (t.id === saved.id ? saved : t))
          : [saved, ...prev],
      )
      closeDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  async function toggleRetired(t: EventTypeDef) {
    setRowError(null)
    const action = t.retired_at ? "unretire" : "retire"
    try {
      const res = await fetch(`/api/be/event-types/${t.id}/${action}`, {
        method: "POST",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : `${action === "retire" ? "Retire" : "Unretire"} failed (${res.status})`,
        )
      }
      const updated = (await res.json().catch(() => null)) as
        | EventTypeDef
        | null
      setTypes((prev) =>
        prev.map((row) =>
          row.id === t.id
            ? (updated ?? {
                ...row,
                retired_at:
                  action === "retire" ? new Date().toISOString() : null,
              })
            : row,
        ),
      )
    } catch (err) {
      setRowError({
        id: t.id,
        message: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  function renderRow(t: EventTypeDef) {
    const RowIcon = eventTypeIcon(t.icon)
    return (
      <li
        key={t.id}
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 first:border-t-0",
          t.retired_at && "opacity-50",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RowIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              style={t.color ? { color: t.color } : undefined}
              aria-hidden
            />
            <span className="text-sm font-medium">{t.label}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {t.slug}
            </span>
            <span className="rounded border border-border bg-muted/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.record_class}
            </span>
            <span className="rounded border border-border bg-muted/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.default_severity}
            </span>
            <span
              className={cn(
                "rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
                t.workspace_id === null
                  ? "border-border bg-muted/60 text-muted-foreground"
                  : "border-primary/30 bg-primary/10 text-primary",
              )}
            >
              {t.workspace_id === null ? "Built-in" : "Custom"}
            </span>
            {t.retired_at && (
              <span className="rounded border border-border bg-muted/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                Retired
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t.allowed_subject_kinds.length > 0
              ? t.allowed_subject_kinds.map(scopeLabel).join(", ")
              : "Any scope"}
            {t.description ? ` — ${t.description}` : ""}
          </p>
          {rowError?.id === t.id && (
            <p className="mt-0.5 text-xs text-destructive" role="alert">
              {rowError.message}
            </p>
          )}
        </div>
        {canManage(t) && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggleRetired(t)}
            >
              {t.retired_at ? "Unretire" : "Retire"}
            </Button>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {isOperator && (
        <div className="flex justify-end">
          <Button size="sm" onClick={startCreate}>
            <Plus data-icon="inline-start" />
            New type
          </Button>
        </div>
      )}

      {grouped.length === 0 && (
        <p className="rounded-md border px-3 py-6 text-center text-xs text-muted-foreground">
          No event types yet.
        </p>
      )}
      {grouped.map((g) => (
        <section key={g.category} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{g.category}</h2>
          <ul className="overflow-hidden rounded-md border">
            {g.types.map(renderRow)}
          </ul>
        </section>
      ))}

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        disablePointerDismissal
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.label}` : "New event type"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="et-label">Label</Label>
                <Input
                  id="et-label"
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      label: e.target.value,
                      slug: f.slugTouched ? f.slug : deriveSlug(e.target.value),
                    }))
                  }
                  disabled={pending}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-slug">Slug</Label>
                <Input
                  id="et-slug"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value,
                      slugTouched: true,
                    }))
                  }
                  disabled={pending || editing !== null}
                  required
                  pattern="[a-z0-9][a-z0-9._-]*"
                  maxLength={64}
                  className="font-mono"
                />
                {editing === null && (
                  <p className="text-[10px] text-muted-foreground">
                    Lowercase letters, digits, dots, dashes. Cannot be changed
                    later.
                  </p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="et-desc">Description</Label>
                <Textarea
                  id="et-desc"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={2}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-category">Category</Label>
                <Input
                  id="et-category"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  placeholder="e.g. Exercise, Briefing…"
                  list="et-category-options"
                  disabled={pending}
                />
                <datalist id="et-category-options">
                  {existingCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>Color</Label>
                <ColorSelect
                  value={form.color}
                  onChange={(color) => setForm((f) => ({ ...f, color }))}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-record-class">Record class</Label>
                <select
                  id="et-record-class"
                  value={form.record_class}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      record_class: e.target.value as RecordClass,
                    }))
                  }
                  disabled={pending}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="log">log</option>
                  <option value="event">event</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-severity">Default severity</Label>
                <select
                  id="et-severity"
                  value={form.default_severity}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      default_severity: e.target.value as Severity,
                    }))
                  }
                  disabled={pending}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Icon</Label>
                <IconGrid
                  value={form.icon}
                  onChange={(icon) => setForm((f) => ({ ...f, icon }))}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Allowed scopes</Label>
                <p className="text-[10px] text-muted-foreground">
                  Which things an event of this type can be attached to when
                  logging — e.g. a safety brief can target the whole workspace,
                  a site, or a single team. Leave all unchecked to allow any
                  scope.
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  {GENERAL_SUBJECT_KINDS.map((kind) => (
                    <label
                      key={kind}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={form.allowed_subject_kinds.includes(kind)}
                        onCheckedChange={(checked) =>
                          toggleScope(kind, checked === true)
                        }
                        disabled={pending}
                      />
                      {scopeLabel(kind)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !form.label.trim() || !form.slug.trim()}
              >
                {pending
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create type"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
