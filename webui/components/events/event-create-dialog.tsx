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
  GATEWAY_STATUS_VALUES,
  SERVICE_STATUS_VALUES,
  SITE_STATUS_VALUES,
  statusLabel,
} from "@/lib/status"
import { SEVERITY_LABELS } from "@/lib/severity"
import {
  emconLabel,
  fpconLabel,
} from "@/lib/threat-level"
import { cn } from "@/lib/utils"
import type {
  AnyStatus,
  Emcon,
  Event,
  EventType,
  EventTypeDef,
  Fpcon,
  Gateway,
  RecordClass,
  Service,
  Severity,
  Site,
  SubjectKind,
  Team,
  Unit,
  WorkCenter,
  Workspace,
} from "@/lib/types"
import { GENERAL_SUBJECT_KINDS, SEVERITIES } from "@/lib/types"
import { groupByCategory } from "@/lib/event-type-meta"

import { ColorSelect, IconGrid } from "./type-style-pickers"

const FPCON_LEVELS: AnyStatus[] = ["normal", "alpha", "bravo", "charlie", "delta"]
const EMCON_LEVELS: AnyStatus[] = ["a", "b", "c", "d"]

const FPCON_SET = new Set<string>(FPCON_LEVELS)
const EMCON_SET = new Set<string>(EMCON_LEVELS)

/** Friendly labels for the scopes a declarable event can attach to. */
const SCOPE_LABELS: Partial<Record<SubjectKind, string>> = {
  workspace: "Workspace",
  site: "Site",
  team: "Team",
  unit: "Unit",
  work_center: "Work center",
  system: "System",
  mission: "Mission",
  exercise: "Exercise",
}

/** Scopes whose subject is a live entity picked from a list (vs free text). */
const ENTITY_SCOPES: readonly SubjectKind[] = [
  "workspace",
  "site",
  "team",
  "unit",
  "work_center",
]

function labelForStatus(value: AnyStatus): string {
  if (FPCON_SET.has(value)) return `FPCON ${fpconLabel(value as Fpcon)}`
  if (EMCON_SET.has(value)) return `EMCON ${emconLabel(value as Emcon)}`
  return statusLabel(value)
}

function statusOptionsFor(kind: SubjectKind): AnyStatus[] {
  switch (kind) {
    case "service":
    case "service_gateway":
    case "site":
      return SERVICE_STATUS_VALUES
    case "gateway":
      return GATEWAY_STATUS_VALUES
    case "site_status":
      return SITE_STATUS_VALUES
    case "site_fpcon":
      return FPCON_LEVELS
    case "site_emcon":
      return EMCON_LEVELS
    default:
      return []
  }
}

function slugFromLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 64)
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  sites: Site[]
  services: Service[]
  gateways: Gateway[]
  eventTypes: EventTypeDef[]
  teams: Team[]
  units: Unit[]
  workCenters: WorkCenter[]
  workspace: Workspace
  /** Preselect this site for site-scoped events (site detail tab). */
  defaultSiteId?: number
  onCreated: (v: Event) => void
  /** Called when a new type is created inline so parents can refresh lists. */
  onTypeCreated?: (t: EventTypeDef) => void
}

export function EventCreateDialog({
  open,
  onOpenChange,
  sites,
  services,
  gateways,
  eventTypes,
  teams,
  units,
  workCenters,
  workspace,
  defaultSiteId,
  onCreated,
  onTypeCreated,
}: Props) {
  const [eventType, setEventType] = useState<EventType>("general")
  const [types, setTypes] = useState<EventTypeDef[]>(eventTypes)

  // Declarable ("Event") flow state.
  const [typeSlug, setTypeSlug] = useState<string>("note.general")
  const [scope, setScope] = useState<SubjectKind>("workspace")
  const [severity, setSeverity] = useState<Severity | "">("")
  const [creatingType, setCreatingType] = useState(false)

  // Validation flow state.
  const [kind, setKind] = useState<SubjectKind>("service")
  const [subjectId, setSubjectId] = useState<string>("")
  const [subjectLabel, setSubjectLabel] = useState<string>("")
  const [status, setStatus] = useState<AnyStatus | "">("")

  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedType = useMemo(
    () => types.find((t) => t.slug === typeSlug) ?? null,
    [types, typeSlug],
  )

  const allowedScopes = useMemo<SubjectKind[]>(() => {
    const allowed =
      selectedType && selectedType.allowed_subject_kinds.length > 0
        ? selectedType.allowed_subject_kinds
        : [...GENERAL_SUBJECT_KINDS]
    return allowed.filter((k) => SCOPE_LABELS[k])
  }, [selectedType])

  // Keep the scope legal for the chosen type.
  const effectiveScope = allowedScopes.includes(scope)
    ? scope
    : allowedScopes[0] ?? "workspace"

  const scopeSubjectOptions = useMemo(() => {
    switch (effectiveScope) {
      case "site":
        return sites.map((s) => ({ id: s.id, label: s.name }))
      case "team":
        return teams.map((t) => ({ id: t.id, label: t.name }))
      case "unit":
        return units.map((u) => ({ id: u.id, label: u.name }))
      case "work_center":
        return workCenters.map((w) => ({ id: w.id, label: w.name }))
      default:
        return []
    }
  }, [effectiveScope, sites, teams, units, workCenters])

  const validationSubjectOptions = useMemo(() => {
    switch (kind) {
      case "service":
        return services.map((s) => ({
          id: s.id,
          label: `${s.name}${s.site_id ? ` — ${siteName(sites, s.site_id)}` : ""}`,
        }))
      case "gateway":
        return gateways.map((g) => ({
          id: g.id,
          label: `${g.name} — ${siteName(sites, g.site_id)}`,
        }))
      case "site":
      case "site_status":
      case "site_fpcon":
      case "site_emcon":
        return sites.map((s) => ({ id: s.id, label: s.name }))
      default:
        return []
    }
  }, [kind, services, gateways, sites])

  const statusOptions = useMemo(() => statusOptionsFor(kind), [kind])

  function reset() {
    setEventType("general")
    setTypeSlug("note.general")
    setScope("workspace")
    setSeverity("")
    setCreatingType(false)
    setKind("service")
    setSubjectId("")
    setSubjectLabel("")
    setStatus("")
    setNote("")
    setError(null)
  }

  function switchEventType(next: EventType) {
    setEventType(next)
    setError(null)
    setSubjectLabel("")
    if (next === "validation") {
      setKind("service")
      setStatus("up")
      setSubjectId("")
    } else {
      setStatus("")
      setSubjectId(defaultSiteId != null ? String(defaultSiteId) : "")
    }
  }

  function handleScopeChange(next: SubjectKind) {
    setScope(next)
    setSubjectLabel("")
    if (next === "site" && defaultSiteId != null) {
      setSubjectId(String(defaultSiteId))
    } else {
      setSubjectId("")
    }
  }

  function handleTypeCreated(t: EventTypeDef) {
    setTypes((prev) => [t, ...prev])
    setTypeSlug(t.slug)
    setCreatingType(false)
    onTypeCreated?.(t)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let payload: Record<string, unknown>
    if (eventType === "validation") {
      if (!subjectId) {
        setError("Pick a subject.")
        return
      }
      if (!status) {
        setError("Pick a status.")
        return
      }
      payload = {
        event_type: "validation",
        subject_kind: kind,
        subject_id: Number(subjectId),
        subject_label: null,
        status,
        note: note.trim() || null,
      }
    } else {
      const entityScope = ENTITY_SCOPES.includes(effectiveScope)
      let sid: number | null = null
      if (effectiveScope === "workspace") {
        sid = workspace.id
      } else if (entityScope) {
        if (!subjectId) {
          setError(`Pick a ${SCOPE_LABELS[effectiveScope]?.toLowerCase()}.`)
          return
        }
        sid = Number(subjectId)
      } else if (!subjectLabel.trim()) {
        setError("Enter a subject.")
        return
      }
      payload = {
        event_type: "general",
        subject_kind: effectiveScope,
        subject_id: sid,
        subject_label: entityScope ? null : subjectLabel.trim(),
        type_slug: typeSlug,
        severity: severity || null,
        note: note.trim() || null,
      }
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Create failed (${res.status})`)
      }
      const created = (await res.json()) as Event
      onCreated(created)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  // System types (validations, sign-ins) are written by rules, not logged
  // by hand — keep them out of the manual picker.
  const typeGroups = useMemo(
    () => groupByCategory(types.filter((t) => !t.retired_at && !t.is_system)),
    [types],
  )
  const existingCategories = useMemo(
    () =>
      Array.from(
        new Set(
          types.map((t) => t.category?.trim()).filter((c): c is string => !!c),
        ),
      ).sort(),
    [types],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      disablePointerDismissal
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log new event</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-1 rounded-md border border-input bg-muted/30 p-1 text-sm">
            <TabButton
              active={eventType === "general"}
              onClick={() => switchEventType("general")}
            >
              Event
            </TabButton>
            <TabButton
              active={eventType === "validation"}
              onClick={() => switchEventType("validation")}
            >
              Validation
            </TabButton>
          </div>

          {eventType === "general" ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Type</Label>
                  <button
                    type="button"
                    onClick={() => setCreatingType((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-3" />
                    New type…
                  </button>
                </div>
                <select
                  value={typeSlug}
                  onChange={(e) => setTypeSlug(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {typeGroups.map((g) => (
                    <optgroup key={g.category} label={g.category}>
                      {g.types.map((t) => (
                        <option key={t.id} value={t.slug}>
                          {t.label}
                          {t.workspace_id != null ? " (custom)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedType?.description && (
                  <p className="text-[11px] text-muted-foreground">
                    {selectedType.description}
                  </p>
                )}
              </div>

              {creatingType && (
                <InlineTypeCreate
                  existingCategories={existingCategories}
                  onCreated={handleTypeCreated}
                  onCancel={() => setCreatingType(false)}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Scope</Label>
                  <select
                    value={effectiveScope}
                    onChange={(e) =>
                      handleScopeChange(e.target.value as SubjectKind)
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {allowedScopes.map((k) => (
                      <option key={k} value={k}>
                        {SCOPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Severity
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (default: {SEVERITY_LABELS[selectedType?.default_severity ?? "notice"]})
                    </span>
                  </Label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as Severity | "")}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— type default —</option>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Subject</Label>
                {effectiveScope === "workspace" ? (
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
                    {workspace.name} (entire workspace)
                  </div>
                ) : ENTITY_SCOPES.includes(effectiveScope) ? (
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">
                      Select a {SCOPE_LABELS[effectiveScope]?.toLowerCase()}…
                    </option>
                    {scopeSubjectOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={subjectLabel}
                    onChange={(e) => setSubjectLabel(e.target.value)}
                    placeholder={
                      effectiveScope === "system"
                        ? "e.g. NIPR Access, HF Radio, etc."
                        : effectiveScope === "mission"
                          ? "Mission name or ID"
                          : "Exercise name"
                    }
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Kind</Label>
                  <select
                    value={kind}
                    onChange={(e) => {
                      const k = e.target.value as SubjectKind
                      setKind(k)
                      setSubjectId("")
                      setStatus(statusOptionsFor(k)[0])
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="service">Service</option>
                    <option value="gateway">Gateway</option>
                    <option value="site">Site</option>
                    <option value="site_fpcon">Site FPCON</option>
                    <option value="site_emcon">Site EMCON</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus((e.target.value as AnyStatus | "") || "")
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {labelForStatus(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Subject</Label>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a subject…</option>
                  {validationSubjectOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context or reason for this event."
              className="min-h-20"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Log event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Inline mini-form for creating a workspace event type without leaving the
 *  log dialog — created types are selected immediately. */
function InlineTypeCreate({
  existingCategories,
  onCreated,
  onCancel,
}: {
  existingCategories: string[]
  onCreated: (t: EventTypeDef) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [category, setCategory] = useState("")
  const [recordClass, setRecordClass] = useState<RecordClass>("event")
  const [defaultSeverity, setDefaultSeverity] = useState<Severity>("notice")
  const [icon, setIcon] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [scopes, setScopes] = useState<Set<SubjectKind>>(
    () => new Set<SubjectKind>(["workspace", "site", "team"]),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSlug = slugTouched ? slug : slugFromLabel(label)

  function toggleScope(k: SubjectKind) {
    setScopes((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  async function handleCreate() {
    if (!label.trim() || !effectiveSlug) {
      setError("Enter a name.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/event-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: effectiveSlug,
          label: label.trim(),
          category: category.trim() || null,
          record_class: recordClass,
          default_severity: defaultSeverity,
          icon,
          color,
          allowed_subject_kinds: Array.from(scopes),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Create failed (${res.status})`)
      }
      onCreated((await res.json()) as EventTypeDef)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  const scopeChoices = GENERAL_SUBJECT_KINDS.filter((k) => SCOPE_LABELS[k])

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-input bg-muted/20 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Comms check"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Slug</Label>
          <Input
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(slugFromLabel(e.target.value) || e.target.value)
            }}
            placeholder="comms.check"
            className="font-mono text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Exercise, Briefing…"
            list="event-type-categories"
          />
          <datalist id="event-type-categories">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label>Color</Label>
          <ColorSelect value={color} onChange={setColor} disabled={pending} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Class</Label>
          <select
            value={recordClass}
            onChange={(e) => setRecordClass(e.target.value as RecordClass)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="event">Event (timeline)</option>
            <option value="log">Log (audit only)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Default severity</Label>
          <select
            value={defaultSeverity}
            onChange={(e) => setDefaultSeverity(e.target.value as Severity)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Icon</Label>
        <IconGrid value={icon} onChange={setIcon} disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label>Allowed scopes</Label>
        <p className="text-[10px] text-muted-foreground">
          Which things an event of this type can be attached to when logging.
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {scopeChoices.map((k) => (
            <label
              key={k}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Checkbox
                checked={scopes.has(k)}
                onCheckedChange={() => toggleScope(k)}
              />
              {SCOPE_LABELS[k]}
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleCreate} disabled={pending}>
          {pending ? "Creating…" : "Create type"}
        </Button>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-md text-xs font-medium",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function siteName(sites: Site[], siteId: number): string {
  return sites.find((s) => s.id === siteId)?.name ?? `site ${siteId}`
}
