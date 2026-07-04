"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { LocalTime } from "@/components/time-display"
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
import { formatZulu } from "@/lib/time"
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
  Fpcon,
  Gateway,
  Me,
  Service,
  Site,
  SubjectKind,
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
  MultiSelectFilter,
  type MultiSelectGroup,
  type MultiSelectOption,
} from "./multi-select-filter"

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
  { key: "general", label: "General" },
]

const KIND_OPTIONS: MultiSelectOption[] = [
  { value: "service", label: "Service", group: "validation" },
  { value: "gateway", label: "Gateway", group: "validation" },
  { value: "site", label: "Site", group: "validation" },
  { value: "site_status", label: "Site status", group: "validation" },
  { value: "site_fpcon", label: "Site FPCON", group: "validation" },
  { value: "site_emcon", label: "Site EMCON", group: "validation" },
  { value: "system", label: "System", group: "general" },
  { value: "mission", label: "Mission", group: "general" },
  { value: "exercise", label: "Exercise", group: "general" },
]

const EVENT_TYPE_TABS: { value: EventType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "validation", label: "Validation" },
  { value: "general", label: "General" },
]

const STATUS_GROUPS: MultiSelectGroup[] = [
  { key: "operational", label: "Operational" },
  { key: "issue", label: "Issue" },
  { key: "transitional", label: "Transitional" },
  { key: "other", label: "Other" },
]

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
]

type SortKey = "validated_at" | "subject_kind" | "subject_name" | "site_name" | "status" | "operator"
type SortDir = "asc" | "desc"

const SORT_BY_COLUMN: Partial<Record<ColumnKey, SortKey>> = {
  validated_at: "validated_at",
  subject_kind: "subject_kind",
  subject_name: "subject_name",
  site_name: "site_name",
  status: "status",
  operator: "operator",
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
}

export function EventsTable({
  me,
  events: initialEvents,
  sites,
  services,
  gateways,
}: Props) {
  const [events, setEvents] = useState(initialEvents)
  useEffect(() => setEvents(initialEvents), [initialEvents])

  const [search, setSearch] = useState("")
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType | "all">("all")
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set())
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = events
    if (eventTypeFilter !== "all") {
      rows = rows.filter((v) => v.event_type === eventTypeFilter)
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
    eventTypeFilter,
    siteFilter,
    kindFilter,
    statusFilter,
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
    const hiddenIds = new Set(updated.map((v) => v.id))
    setEvents((prev) => prev.filter((v) => !hiddenIds.has(v.id)))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of hiddenIds) next.delete(id)
      return next
    })
  }

  const validationRows = useMemo(
    () => filtered.filter((v) => v.event_type === "validation"),
    [filtered],
  )
  const generalRows = useMemo(
    () => filtered.filter((v) => v.event_type === "general"),
    [filtered],
  )

  const renderTableSection = (rows: Event[], heading?: string) => (
    <div className="flex flex-col gap-1">
      {heading && (
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {heading}
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {rows.length} event{rows.length === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <div className="overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider">
            <tr>
              <th className="w-10 px-3 py-2 text-left">
                <Checkbox
                  checked={
                    rows.length > 0 && rows.every((v) => selected.has(v.id))
                  }
                  indeterminate={
                    rows.some((v) => selected.has(v.id)) &&
                    !rows.every((v) => selected.has(v.id))
                  }
                  onCheckedChange={() => toggleSectionSelected(rows)}
                  aria-label="Select all visible"
                />
              </th>
              {orderedVisibleCols.map((key) => {
                const col = ALL_COLUMNS.find((c) => c.key === key)!
                const sortableKey = SORT_BY_COLUMN[key]
                return (
                  <th key={key} className="px-3 py-2 text-left">
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
                  </th>
                )
              })}
              <th className="w-10 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const isChecked = selected.has(v.id)
              return (
                <tr
                  key={v.id}
                  className={cn(
                    "border-t border-border",
                    isChecked && "bg-primary/5",
                  )}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleRowSelected(v.id)}
                      aria-label={`Select event ${v.id}`}
                    />
                  </td>
                  {orderedVisibleCols.map((key) => (
                    <td
                      key={key}
                      className={cn(
                        "px-3 py-2",
                        (key === "validated_at" || key === "zulu") &&
                          "font-mono text-xs",
                        (key === "site_name" ||
                          key === "operator" ||
                          key === "note" ||
                          key === "source") &&
                          "text-muted-foreground",
                        key === "note" && "text-xs",
                      )}
                    >
                      {renderCell(key, v)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <RowMenu
                      isOperator={isOperator}
                      isAdmin={isAdmin}
                      isAuthor={
                        v.validated_by_user_id != null &&
                        v.validated_by_user_id === me.user_id
                      }
                      onEdit={() => setEditingEvent(v)}
                      onHide={() => setConfirmHideIds([v.id])}
                    />
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={orderedVisibleCols.length + 2}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  No {heading ? heading.toLowerCase() + " " : ""}events match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
        <div className="inline-flex w-fit rounded-md border border-input bg-muted/30 p-0.5 text-xs">
          {EVENT_TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setEventTypeFilter(t.value)}
              className={cn(
                "rounded-sm px-3 py-1 font-medium transition-colors",
                eventTypeFilter === t.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,180px))_auto_auto_auto]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, site, note…"
              className="pl-7"
            />
          </div>
          <MultiSelectFilter
            label="Sites"
            options={siteOptions}
            searchable
            selected={siteFilter}
            onChange={setSiteFilter}
          />
          <MultiSelectFilter
            label="Kind"
            options={KIND_OPTIONS}
            groups={KIND_GROUPS}
            selected={kindFilter}
            onChange={setKindFilter}
          />
          <MultiSelectFilter
            label="Status"
            options={STATUS_OPTIONS}
            groups={STATUS_GROUPS}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
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
          {isOperator && (
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

        <div className="text-xs text-muted-foreground">
          {filtered.length} of {events.length} events
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

        {eventTypeFilter === "all" ? (
          <div className="flex flex-col gap-4">
            {renderTableSection(validationRows, "Validation")}
            {renderTableSection(generalRows, "General")}
          </div>
        ) : (
          renderTableSection(filtered)
        )}
      </div>

      <EventCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        sites={sites}
        services={services}
        gateways={gateways}
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
  onEdit,
  onHide,
}: {
  isOperator: boolean
  isAdmin: boolean
  isAuthor: boolean
  onEdit: () => void
  onHide: () => void
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
        {isAdmin && (
          <DropdownMenuItem
            onClick={onHide}
            className="text-destructive"
          >
            Hide event
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function renderCell(key: ColumnKey, v: Event): React.ReactNode {
  switch (key) {
    case "validated_at":
      return <LocalTime iso={v.validated_at} />
    case "zulu":
      return formatZulu(v.validated_at)
    case "subject_kind":
      return (
        <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
          {v.subject_kind}
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
    case "site_name":
      return v.site_name ?? "—"
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
  return (
    <span className="inline-flex items-center gap-2">
      <StatusIndicator state={statusToIndicatorState(value)} size="sm" />
      {statusLabel(value)}
    </span>
  )
}
