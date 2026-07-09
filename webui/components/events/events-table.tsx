"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { PersonnelStatusBadge } from "@/components/personnel/personnel-status-badge"
import {
  PERSONNEL_STATUS_LABELS,
  PERSONNEL_STATUSES,
} from "@/lib/personnel-data"
import { LocalClock, LocalTime } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  statusLabel,
  statusToIndicatorState,
} from "@/lib/status"
import {
  REGISTRY_TYPE_LABELS,
  SUBJECT_KIND_LABELS,
} from "@/lib/event-type-labels"
import {
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  severityDotClass,
  severityRank,
} from "@/lib/severity"
import { formatZulu, formatZuluTime, zuluDayGroup } from "@/lib/time"
import {
  emconClasses,
  emconLabel,
  fpconClasses,
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
  Me,
  PersonnelStatus,
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

import { ColumnsPopover } from "./columns-popover"
import { EventCreateDialog } from "./event-create-dialog"
import { EventEditNoteDialog } from "./event-edit-note-dialog"
import { EventHideConfirmDialog } from "./event-hide-confirm-dialog"
import {
  ALL_COLUMNS,
  type ColumnKey,
  DEFAULT_ORDER,
  DEFAULT_VISIBLE,
  loadColumnPrefs,
  saveColumnPrefs,
} from "./events-columns"
import { downloadCsv, toCsv } from "./events-csv"
import { FloatingActionBar } from "./floating-action-bar"
import {
  FilterChips,
  HeaderFilter,
  type FilterBankItem,
  type MultiSelectGroup,
  type MultiSelectOption,
} from "@/components/multi-select-filter"

const FPCON_SET = new Set<string>(["normal", "alpha", "bravo", "charlie", "delta"])
const EMCON_SET = new Set<string>(["a", "b", "c", "d"])

function renderLevelBadge(kind: "fpcon" | "emcon", value: string) {
  if (kind === "fpcon" && FPCON_SET.has(value)) {
    const c = fpconClasses(value as Fpcon)
    return (
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
          c.bg,
          c.text,
          c.ring,
        )}
      >
        FPCON {fpconLabel(value as Fpcon)}
      </span>
    )
  }
  if (kind === "emcon" && EMCON_SET.has(value)) {
    const c = emconClasses(value as Emcon)
    return (
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
          c.bg,
          c.text,
        )}
      >
        {emconLabel(value as Emcon)}
      </span>
    )
  }
  return <span className="text-[10px] uppercase tracking-wider">{value}</span>
}

const KIND_GROUPS: MultiSelectGroup[] = [
  { key: "validation", label: "Validation" },
  { key: "personnel", label: "Personnel" },
  { key: "general", label: "General" },
]

const KIND_OPTIONS: MultiSelectOption[] = [
  { value: "service", label: "Service", group: "validation" },
  { value: "gateway", label: "Gateway", group: "validation" },
  { value: "site", label: "Site", group: "validation" },
  { value: "site_status", label: "Site status", group: "validation" },
  { value: "site_fpcon", label: "Site FPCON", group: "validation" },
  { value: "site_emcon", label: "Site EMCON", group: "validation" },
  { value: "personnel_location", label: "Personnel", group: "personnel" },
  { value: "system", label: "System", group: "general" },
  { value: "mission", label: "Mission", group: "general" },
  { value: "exercise", label: "Exercise", group: "general" },
  { value: "workspace", label: "Workspace", group: "general" },
  { value: "team", label: "Team", group: "general" },
  { value: "unit", label: "Unit", group: "general" },
  { value: "work_center", label: "Work center", group: "general" },
]

const SEVERITY_OPTIONS: MultiSelectOption[] = SEVERITY_ORDER.map((s) => ({
  value: s,
  label: SEVERITY_LABELS[s],
}))

const STATUS_GROUPS: MultiSelectGroup[] = [
  { key: "operational", label: "Operational" },
  { key: "issue", label: "Issue" },
  { key: "transitional", label: "Transitional" },
  { key: "personnel", label: "Personnel" },
  { key: "other", label: "Other" },
]

// Personnel sign-in states carried by personnel_location events. Skip
// "unknown" — the "other" group already contributes that value.
const PERSONNEL_STATUS_OPTIONS: MultiSelectOption[] = PERSONNEL_STATUSES.filter(
  (s) => s !== "unknown",
).map((s) => ({
  value: s,
  label: PERSONNEL_STATUS_LABELS[s],
  group: "personnel",
}))

const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: "up", label: "Up", group: "operational" },
  { value: "active", label: "Active", group: "operational" },
  { value: "ready", label: "Standby", group: "operational" },
  { value: "operational", label: "Operational", group: "operational" },
  { value: "standby", label: "Standby", group: "operational" },
  { value: "limited", label: "Limited", group: "issue" },
  { value: "degraded", label: "Degraded", group: "issue" },
  { value: "down", label: "Down", group: "issue" },
  { value: "offline", label: "Offline", group: "issue" },
  { value: "maintenance", label: "Maintenance", group: "transitional" },
  { value: "setup", label: "Setup", group: "transitional" },
  { value: "unknown", label: "Unknown", group: "other" },
  { value: "normal", label: "FPCON Normal", group: "other" },
  { value: "alpha", label: "FPCON Alpha", group: "other" },
  { value: "bravo", label: "FPCON Bravo", group: "other" },
  { value: "charlie", label: "FPCON Charlie", group: "other" },
  { value: "delta", label: "FPCON Delta", group: "other" },
  { value: "a", label: "EMCON A", group: "other" },
  { value: "b", label: "EMCON B", group: "other" },
  { value: "c", label: "EMCON C", group: "other" },
  { value: "d", label: "EMCON D", group: "other" },
  ...PERSONNEL_STATUS_OPTIONS,
]

type SortKey =
  | "validated_at"
  | "severity"
  | "subject_kind"
  | "subject_name"
  | "site_name"
  | "status"
  | "operator"
type SortDir = "asc" | "desc"

const SORT_BY_COLUMN: Partial<Record<ColumnKey, SortKey>> = {
  subject_kind: "subject_kind",
  subject_name: "subject_name",
  status: "status",
  operator: "operator",
}

/** Panel treatment for the data columns of a row: a floating, severity-tinted
 *  card detached from the bare time/severity gutter — the table echo of the
 *  timeline's severity-encoded card elevation. */
function severityPanel(s: Severity): { bg: string; border: string } {
  switch (s) {
    case "notice":
      return { bg: "bg-card", border: "border-border" }
    case "warning":
      return { bg: "bg-amber-500/5", border: "border-amber-500/30" }
    case "critical":
      return {
        bg: "bg-red-500/10 dark:bg-red-500/15",
        border: "border-red-500/40",
      }
    default:
      return { bg: "bg-muted/25 dark:bg-muted/15", border: "border-border/50" }
  }
}

function compareStr(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "")
}

interface Props {
  me: Me
  events: Event[]
  sites: Site[]
  services: Service[]
  gateways: Gateway[]
  eventTypes: EventTypeDef[]
  teams: Team[]
  units: Unit[]
  workCenters: WorkCenter[]
  workspace: Workspace
  /** Lock the view to one record class (e.g. "log"). */
  fixedRecordClass?: RecordClass
  /** Include soft-hidden records (dimmed) instead of filtering them out. */
  showHidden?: boolean
  /** Hide the toolbar's create button when a header-level one already exists. */
  hideCreateButton?: boolean
  /** Preselect this site in the log dialog (site detail tab). */
  defaultSiteId?: number
}

export function EventsTable({
  me,
  events: initialEvents,
  sites,
  services,
  gateways,
  eventTypes,
  teams,
  units,
  workCenters,
  workspace,
  fixedRecordClass,
  showHidden = false,
  hideCreateButton = false,
  defaultSiteId,
}: Props) {
  const [events, setEvents] = useState(initialEvents)
  useEffect(() => setEvents(initialEvents), [initialEvents])

  const [search, setSearch] = useState("")
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set())
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>("validated_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_VISIBLE),
  )
  const [colOrder, setColOrder] = useState<ColumnKey[]>(DEFAULT_ORDER)

  useEffect(() => {
    const prefs = loadColumnPrefs()
    setVisibleCols(new Set(prefs.visible))
    setColOrder(prefs.order)
  }, [])
  useEffect(() => {
    saveColumnPrefs({ visible: Array.from(visibleCols), order: colOrder })
  }, [visibleCols, colOrder])

  const [showCreate, setShowCreate] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [confirmHideIds, setConfirmHideIds] = useState<number[] | null>(null)

  const isOperator = me.role === "operator" || me.role === "admin"
  const isAdmin = me.role === "admin"

  const siteOptions: MultiSelectOption[] = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of events) {
      if (v.site_id != null) {
        m.set(String(v.site_id), v.site_name ?? `site ${v.site_id}`)
      }
    }
    return Array.from(m.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }))
  }, [events])

  // Type labels resolve through the catalog, then the registry-action map;
  // unknown slugs fall back to the raw slug.
  const typeLabels = useMemo(() => {
    const m = new Map<string, string>(Object.entries(REGISTRY_TYPE_LABELS))
    for (const t of eventTypes) m.set(t.slug, t.label)
    return m
  }, [eventTypes])

  const typeOptions: MultiSelectOption[] = useMemo(() => {
    const slugs = new Set<string>()
    for (const v of events) if (v.type_slug) slugs.add(v.type_slug)
    return Array.from(slugs)
      .map((slug) => ({ value: slug, label: typeLabels.get(slug) ?? slug }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [events, typeLabels])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = events
    if (!showHidden) {
      rows = rows.filter((v) => !v.hidden_at)
    }
    if (fixedRecordClass) {
      rows = rows.filter((v) => v.record_class === fixedRecordClass)
    }
    if (siteFilter.size > 0) {
      rows = rows.filter((v) => v.site_id != null && siteFilter.has(String(v.site_id)))
    }
    if (kindFilter.size > 0) {
      rows = rows.filter((v) => kindFilter.has(v.subject_kind))
    }
    if (statusFilter.size > 0) {
      rows = rows.filter((v) => v.status != null && statusFilter.has(v.status))
    }
    if (severityFilter.size > 0) {
      rows = rows.filter((v) => severityFilter.has(v.severity))
    }
    if (typeFilter.size > 0) {
      rows = rows.filter((v) => v.type_slug != null && typeFilter.has(v.type_slug))
    }
    if (q) {
      rows = rows.filter((v) => {
        const hay = [
          v.subject_name,
          v.site_name,
          v.note,
          v.validated_by_username,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return hay.includes(q)
      })
    }
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "validated_at":
          cmp = new Date(a.validated_at).getTime() - new Date(b.validated_at).getTime()
          break
        case "severity":
          cmp = severityRank(a.severity) - severityRank(b.severity)
          break
        case "subject_kind":
          cmp = compareStr(a.subject_kind, b.subject_kind)
          break
        case "subject_name":
          cmp = compareStr(a.subject_name, b.subject_name)
          break
        case "site_name":
          cmp = compareStr(a.site_name, b.site_name)
          break
        case "status":
          cmp = compareStr(a.status, b.status)
          break
        case "operator":
          cmp = compareStr(a.validated_by_username, b.validated_by_username)
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return sorted
  }, [
    events,
    search,
    fixedRecordClass,
    showHidden,
    siteFilter,
    kindFilter,
    statusFilter,
    severityFilter,
    typeFilter,
    sortKey,
    sortDir,
  ])

  // Prune selection when it drifts outside the current filter.
  useEffect(() => {
    if (selected.size === 0) return
    const inView = new Set(filtered.map((v) => v.id))
    let changed = false
    const next = new Set<number>()
    for (const id of selected) {
      if (inView.has(id)) next.add(id)
      else changed = true
    }
    if (changed) setSelected(next)
  }, [filtered, selected])

  const orderedVisibleCols = useMemo(
    () => colOrder.filter((k) => visibleCols.has(k)),
    [colOrder, visibleCols],
  )

  // Group rows into Zulu-day sections — but only while sorted by time, where
  // day bands are meaningful. Any other sort renders a single flat section.
  const groups = useMemo(() => {
    if (sortKey !== "validated_at") {
      return [{ key: "all", label: null as string | null, rows: filtered }]
    }
    const out: { key: string; label: string | null; rows: Event[] }[] = []
    for (const v of filtered) {
      const { key, label } = zuluDayGroup(v.validated_at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(v)
      else out.push({ key, label, rows: [v] })
    }
    return out
  }, [filtered, sortKey])

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(k)
      setSortDir(k === "validated_at" ? "desc" : "asc")
    }
  }

  function toggleRowSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport(scope: "filtered" | "selected") {
    const rows =
      scope === "selected"
        ? filtered.filter((v) => selected.has(v.id))
        : filtered
    const csv = toCsv(rows)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    downloadCsv(`events-${stamp}.csv`, csv)
  }

  function handleCreated(v: Event) {
    setEvents((prev) => [v, ...prev])
  }

  function handleEdited(updated: Event) {
    setEvents((prev) =>
      prev.map((v) => (v.id === updated.id ? updated : v)),
    )
  }

  function handleHidden(updated: Event[]) {
    // Patch in place (not remove) so the rows stay available when the
    // "show hidden" toggle is on; the filter handles visibility.
    const map = new Map(updated.map((v) => [v.id, v]))
    setEvents((prev) => prev.map((v) => map.get(v.id) ?? v))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of map.keys()) next.delete(id)
      return next
    })
  }

  async function handleUnhide(id: number) {
    try {
      const res = await fetch(`/api/be/events/${id}/unhide`, { method: "POST" })
      if (!res.ok) throw new Error(`Unhide failed (${res.status})`)
      const updated = (await res.json()) as Event
      setEvents((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
    } catch {
      // Surfaced by the row staying hidden; keep the table quiet on failure.
    }
  }

  // Total column span (checkbox · time · site · severity gutter + data cols +
  // actions) for the full-width date bands and empty state.
  const totalCols = orderedVisibleCols.length + 5
  const grouped = sortKey === "validated_at"

  // Inline column filters — each filterable column exposes a funnel in its
  // header; the same sets drive the active-filter chips below the toolbar.
  const filterBank: FilterBankItem[] = [
    { key: "site", label: "Site", options: siteOptions, searchable: true, selected: siteFilter, onChange: setSiteFilter },
    { key: "severity", label: "Severity", options: SEVERITY_OPTIONS, selected: severityFilter, onChange: setSeverityFilter },
    { key: "type", label: "Type", options: typeOptions, searchable: true, selected: typeFilter, onChange: setTypeFilter },
    { key: "kind", label: "Kind", options: KIND_OPTIONS, groups: KIND_GROUPS, selected: kindFilter, onChange: setKindFilter },
    { key: "status", label: "Status", options: STATUS_OPTIONS, groups: STATUS_GROUPS, selected: statusFilter, onChange: setStatusFilter },
  ]

  // Which configurable column each bank sits under (gutter columns render
  // their own funnel directly). Panel funnels align to the right edge so
  // right-hand columns don't push the panel off-screen.
  const PANEL_FILTER_BANK: Partial<Record<ColumnKey, string>> = {
    type_slug: "type",
    subject_kind: "kind",
    status: "status",
  }
  const columnFilterFor = (key: ColumnKey) => {
    const bankKey = PANEL_FILTER_BANK[key]
    if (!bankKey) return null
    const f = filterBank.find((b) => b.key === bankKey)!
    return (
      <HeaderFilter
        label={f.label}
        options={f.options}
        groups={f.groups}
        searchable={f.searchable}
        selected={f.selected}
        onChange={f.onChange}
        align="end"
      />
    )
  }

  const renderRow = (v: Event) => {
    const isChecked = selected.has(v.id)
    const severity = v.severity as Severity
    const panel = isChecked
      ? { bg: "bg-primary/5", border: "border-primary/40" }
      : severityPanel(severity)
    // Every data cell carries the panel bg + top/bottom border; the first and
    // the trailing actions cell cap it with a left/right border + rounding so
    // the run of cells reads as one floating card.
    const panelCell = cn(panel.bg, panel.border, "border-y")
    return (
      <tr key={v.id} className={cn(v.hidden_at && "opacity-60")}>
        {/* Gutter — bare, detached from the panel. */}
        <td className="w-10 py-2 pl-1 pr-2 align-middle">
          <Checkbox
            checked={isChecked}
            onCheckedChange={() => toggleRowSelected(v.id)}
            aria-label={`Select event ${v.id}`}
          />
        </td>
        <td className="whitespace-nowrap py-2 pr-3 text-right align-middle">
          <div className="flex flex-col items-end gap-0.5 font-mono text-[11px] leading-tight text-muted-foreground">
            {grouped ? (
              <>
                <span className="text-foreground/80">
                  {formatZuluTime(v.validated_at)}
                </span>
                <LocalClock
                  iso={v.validated_at}
                  className="text-muted-foreground/60"
                />
              </>
            ) : (
              <>
                <span className="text-foreground/80">
                  {formatZulu(v.validated_at)}
                </span>
                <LocalTime
                  iso={v.validated_at}
                  className="text-muted-foreground/60"
                />
              </>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap py-2 pr-4 align-middle">
          <span className="flex h-4 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                severityDotClass(severity),
              )}
            />
            {SEVERITY_LABELS[severity] ?? v.severity}
          </span>
        </td>
        {/* Site — timeline pin treatment, detached in the gutter, right up
            against the card edge. */}
        <td className="py-2 pr-4 align-middle">
          {v.site_name ? (
            <span className="flex h-4 max-w-[9rem] items-center gap-1 text-[11px] leading-4 text-muted-foreground/80">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{v.site_name}</span>
            </span>
          ) : (
            <span className="flex h-4 items-center text-[11px] leading-4 text-muted-foreground/40">
              —
            </span>
          )}
        </td>
        {/* Panel — the configurable data columns as one floating card. */}
        {orderedVisibleCols.map((key, i) => (
          <td
            key={key}
            className={cn(
              "px-3 py-2 align-middle",
              panelCell,
              i === 0 && "rounded-l-lg border-l pl-3",
              (key === "prev_status" || key === "status") &&
                "whitespace-nowrap",
              (key === "operator" ||
                key === "note" ||
                key === "source") &&
                "text-muted-foreground",
              key === "note" && "text-xs",
            )}
          >
            {/* Block-level flex so cell content centers by box, not text
                baseline — keeps pills level with the gutter's site/severity. */}
            <div className="flex min-h-4 items-center">
              {renderCell(key, v, typeLabels)}
            </div>
          </td>
        ))}
        <td
          className={cn(
            "w-10 py-2 pl-1 pr-2 text-right align-middle",
            panelCell,
            "rounded-r-lg border-r",
            orderedVisibleCols.length === 0 && "rounded-l-lg border-l",
          )}
        >
          <RowMenu
            isOperator={isOperator}
            isAdmin={isAdmin}
            isAuthor={
              v.validated_by_user_id != null &&
              v.validated_by_user_id === me.user_id
            }
            isHidden={v.hidden_at != null}
            onEdit={() => setEditingEvent(v)}
            onHide={() => setConfirmHideIds([v.id])}
            onUnhide={() => handleUnhide(v.id)}
          />
        </td>
      </tr>
    )
  }

  const renderTable = () => (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-1.5 text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-10 pb-1 pl-1 pr-2 text-left align-bottom">
              <Checkbox
                checked={
                  filtered.length > 0 &&
                  filtered.every((v) => selected.has(v.id))
                }
                indeterminate={
                  filtered.some((v) => selected.has(v.id)) &&
                  !filtered.every((v) => selected.has(v.id))
                }
                onCheckedChange={() => toggleSectionSelected(filtered)}
                aria-label="Select all visible"
              />
            </th>
            <th className="pb-1 pr-3 text-right align-bottom">
              <div className="flex justify-end">
                <SortHeader
                  active={sortKey === "validated_at"}
                  dir={sortDir}
                  onClick={() => toggleSort("validated_at")}
                  label="Time"
                />
              </div>
            </th>
            <th className="pb-1 pr-4 text-left align-bottom">
              <div className="flex items-center gap-1">
                <SortHeader
                  active={sortKey === "severity"}
                  dir={sortDir}
                  onClick={() => toggleSort("severity")}
                  label="Severity"
                />
                <HeaderFilter
                  label="Severity"
                  options={SEVERITY_OPTIONS}
                  selected={severityFilter}
                  onChange={setSeverityFilter}
                />
              </div>
            </th>
            <th className="pb-1 pr-4 text-left align-bottom">
              <div className="flex items-center gap-1">
                <SortHeader
                  active={sortKey === "site_name"}
                  dir={sortDir}
                  onClick={() => toggleSort("site_name")}
                  label="Site"
                />
                <HeaderFilter
                  label="Site"
                  options={siteOptions}
                  searchable
                  selected={siteFilter}
                  onChange={setSiteFilter}
                />
              </div>
            </th>
            {orderedVisibleCols.map((key) => {
              const col = ALL_COLUMNS.find((c) => c.key === key)!
              const sortableKey = SORT_BY_COLUMN[key]
              const filter = columnFilterFor(key)
              return (
                <th key={key} className="pb-1 pl-3 pr-3 text-left align-bottom">
                  <div className="flex items-center gap-1">
                    {sortableKey ? (
                      <SortHeader
                        active={sortKey === sortableKey}
                        dir={sortDir}
                        onClick={() => toggleSort(sortableKey)}
                        label={col.label}
                      />
                    ) : (
                      col.label
                    )}
                    {filter}
                  </div>
                </th>
              )
            })}
            <th className="w-10 pb-1" />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {g.label && (
                <tr>
                  <td colSpan={totalCols} className="pb-0.5 pt-3">
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {g.label}
                      </span>
                      <span
                        className="h-px flex-1 bg-border/60"
                        aria-hidden
                      />
                      <span className="text-[10px] tabular-nums text-muted-foreground/60">
                        {g.rows.length}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
              {g.rows.map(renderRow)}
            </Fragment>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={totalCols}
                className="px-3 py-8 text-center text-xs text-muted-foreground"
              >
                No events match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  function toggleSectionSelected(rows: Event[]) {
    const allInSection = rows.every((v) => selected.has(v.id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allInSection) {
        for (const v of rows) next.delete(v.id)
      } else {
        for (const v of rows) next.add(v.id)
      }
      return next
    })
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, site, note…"
              className="pl-7"
            />
          </div>
          <ColumnsPopover
            visible={visibleCols}
            order={colOrder}
            onVisibleChange={setVisibleCols}
            onOrderChange={setColOrder}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("filtered")}
            className="h-9 gap-1.5"
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
          {isOperator && !hideCreateButton && (
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="h-9 gap-1.5"
            >
              <Plus className="size-3.5" />
              New event
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span>
            {filtered.length} of {events.length} events
          </span>
          <FilterChips bank={filterBank} />
        </div>

        {selected.size > 0 && (
          <FloatingActionBar
            count={selected.size}
            canHide={isAdmin}
            onExport={() => handleExport("selected")}
            onHide={() => setConfirmHideIds(Array.from(selected))}
            onClear={() => setSelected(new Set())}
          />
        )}

        {renderTable()}
      </div>

      <EventCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        sites={sites}
        services={services}
        gateways={gateways}
        eventTypes={eventTypes}
        teams={teams}
        units={units}
        workCenters={workCenters}
        workspace={workspace}
        defaultSiteId={defaultSiteId}
        onCreated={handleCreated}
      />
      <EventEditNoteDialog
        event={editingEvent}
        onClose={() => setEditingEvent(null)}
        onSaved={handleEdited}
      />
      <EventHideConfirmDialog
        ids={confirmHideIds}
        onClose={() => setConfirmHideIds(null)}
        onHidden={handleHidden}
      />
    </>
  )
}

function SortHeader({
  active,
  dir,
  label,
  onClick,
}: {
  active: boolean
  dir: SortDir
  label: string
  onClick: () => void
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      <Icon className="size-3" />
    </button>
  )
}

function RowMenu({
  isOperator,
  isAdmin,
  isAuthor,
  isHidden,
  onEdit,
  onHide,
  onUnhide,
}: {
  isOperator: boolean
  isAdmin: boolean
  isAuthor: boolean
  isHidden: boolean
  onEdit: () => void
  onHide: () => void
  onUnhide: () => void
}) {
  const canEdit = isAdmin || (isOperator && isAuthor)
  if (!canEdit && !isAdmin) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Row actions"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end">
        {canEdit && (
          <DropdownMenuItem onClick={onEdit}>Edit note</DropdownMenuItem>
        )}
        {isAdmin &&
          (isHidden ? (
            <DropdownMenuItem onClick={onUnhide}>Unhide event</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onHide} className="text-destructive">
              Hide event
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function renderCell(
  key: ColumnKey,
  v: Event,
  typeLabels: Map<string, string>,
): React.ReactNode {
  switch (key) {
    case "type_slug":
      return v.type_slug ? (
        <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] tracking-wide">
          {typeLabels.get(v.type_slug) ?? v.type_slug}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    case "record_class":
      return (
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
            v.record_class === "event"
              ? "bg-primary/10 text-primary"
              : "bg-muted/40 text-muted-foreground",
          )}
        >
          {v.record_class}
        </span>
      )
    case "subject_kind":
      return (
        <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
          {SUBJECT_KIND_LABELS[v.subject_kind] ?? v.subject_kind}
        </span>
      )
    case "subject_name":
      // For paired subjects (matrix cells), surface the "svc via gw" label
      // below the primary name so the gateway isn't hidden in the note.
      if (v.subject_kind === "service_gateway" && v.subject_label) {
        return (
          <div className="flex flex-col leading-tight">
            <span>{v.subject_name ?? `id ${v.subject_id}`}</span>
            <span className="text-[10px] text-muted-foreground">
              {v.subject_label}
            </span>
          </div>
        )
      }
      return v.subject_name ?? `id ${v.subject_id}`
    case "prev_status":
      return renderStatusValue(v.prev_status, v.subject_kind)
    case "status":
      return renderStatusValue(v.status, v.subject_kind)
    case "operator":
      return v.validated_by_username ?? v.source
    case "source":
      return v.source
    case "note":
      return v.note ?? ""
  }
}

function renderStatusValue(
  value: AnyStatus | null,
  subject_kind: SubjectKind,
): React.ReactNode {
  if (!value) return <span className="text-muted-foreground">—</span>
  const isFpcon = subject_kind === "site_fpcon"
  const isEmcon = subject_kind === "site_emcon"
  const threatKind = isFpcon ? "fpcon" : isEmcon ? "emcon" : null
  if (threatKind) {
    return renderLevelBadge(threatKind, value)
  }
  if (subject_kind === "personnel_location") {
    // Personnel status uses its own badge palette (colored dot) — keep the
    // events feed consistent with the personnel pages.
    return <PersonnelStatusBadge status={value as PersonnelStatus} />
  }
  return (
    <span className="inline-flex items-center gap-2">
      <StatusIndicator state={statusToIndicatorState(value)} size="sm" />
      {statusLabel(value)}
    </span>
  )
}
