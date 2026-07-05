"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react"

import { PersonnelStatusPill } from "@/components/personnel/personnel-status-pill"
import { RankInsignia } from "@/components/personnel/rank-insignia"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { PERSONNEL_STATUS_LABELS } from "@/lib/personnel-data"
import type { Personnel, Site, Unit, WorkCenter } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

import {
  ALL_PERSONNEL_COLUMNS,
  DEFAULT_VISIBLE,
  loadVisibleColumns,
  saveVisibleColumns,
  type PersonnelColumnKey,
} from "./personnel-columns"

interface Props {
  personnel: Personnel[]
  workCenters: WorkCenter[]
  units: Unit[]
  sites: Site[]
  canEdit: boolean
  emptyMessage?: string
  /**
   * When set, each row's link carries a `from`/`fromLabel` query so the detail
   * page can breadcrumb back here instead of the full personnel list.
   */
  linkFrom?: { path: string; label: string }
  /**
   * Optional trailing action cell per row (e.g. a per-site quick check-in).
   * Return null to leave a row's action blank. Adds a right-aligned column.
   */
  rowAction?: (person: Personnel) => React.ReactNode
}

type SortDir = "asc" | "desc"

export function PersonnelTable({
  personnel,
  workCenters,
  units,
  sites,
  canEdit,
  emptyMessage = "No personnel.",
  linkFrom,
  rowAction,
}: Props) {
  const { w } = useWorkspace()

  const wcById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc])),
    [workCenters],
  )
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites])

  // Column visibility — initialize with defaults (SSR-stable), then hydrate
  // from localStorage after mount to avoid a hydration mismatch.
  const [visible, setVisible] = useState<PersonnelColumnKey[]>(DEFAULT_VISIBLE)
  useEffect(() => {
    setVisible(loadVisibleColumns())
  }, [])
  const visibleSet = useMemo(() => new Set(visible), [visible])
  const columns = ALL_PERSONNEL_COLUMNS.filter((c) => visibleSet.has(c.key))

  const [sortKey, setSortKey] = useState<PersonnelColumnKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  function toggleColumn(key: PersonnelColumnKey) {
    setVisible((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key]
      if (!next.includes("name")) next.unshift("name")
      saveVisibleColumns(next)
      return next
    })
  }

  function toggleSort(key: PersonnelColumnKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  function sortValue(p: Personnel, key: PersonnelColumnKey): string {
    switch (key) {
      case "name":
        return `${p.last_name} ${p.first_name}`.toLowerCase()
      case "status":
        return PERSONNEL_STATUS_LABELS[p.current_status].toLowerCase()
      case "work_center":
        return (
          (p.work_center_id ? wcById.get(p.work_center_id)?.name : "") ?? ""
        ).toLowerCase()
      case "unit":
        return (
          (p.unit_id ? unitById.get(p.unit_id)?.name : "") ?? ""
        ).toLowerCase()
      case "assigned_site":
        return (
          (p.assigned_site_id ? siteById.get(p.assigned_site_id)?.name : "") ??
          ""
        ).toLowerCase()
      case "cellphone":
        return (p.cellphone ?? "").toLowerCase()
      case "dsn":
        return (p.dsn ?? "").toLowerCase()
      case "email":
        return (p.email ?? "").toLowerCase()
      case "room":
        return (p.room_number ?? "").toLowerCase()
    }
  }

  const sorted = useMemo(() => {
    const rows = [...personnel]
    rows.sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      // Blanks always sort to the bottom regardless of direction.
      if (av === "" && bv !== "") return 1
      if (bv === "" && av !== "") return -1
      const cmp = av.localeCompare(bv)
      return sortDir === "asc" ? cmp : -cmp
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personnel, sortKey, sortDir, wcById, unitById, siteById])

  function renderCell(p: Personnel, key: PersonnelColumnKey) {
    switch (key) {
      case "name":
        return (
          <Link
            href={personHref(p)}
            className="inline-flex items-center gap-2 hover:underline"
          >
            <RankInsignia
              branch={p.branch}
              personnelType={p.personnel_type}
              rank={p.rank}
              size={20}
              className="shrink-0"
            />
            <span className="text-sm">
              {p.rank ? (
                <span className="text-muted-foreground">{p.rank} </span>
              ) : null}
              <span className="font-medium text-foreground">
                {p.last_name}, {p.first_name}
              </span>
            </span>
          </Link>
        )
      case "status":
        return <PersonnelStatusPill person={p} sites={sites} canEdit={canEdit} />
      case "work_center":
        return p.work_center_id ? wcById.get(p.work_center_id)?.name : "—"
      case "unit":
        return p.unit_id ? unitById.get(p.unit_id)?.name : "—"
      case "assigned_site":
        return p.assigned_site_id
          ? siteById.get(p.assigned_site_id)?.name
          : "—"
      case "cellphone":
        return p.cellphone || "—"
      case "dsn":
        return p.dsn || "—"
      case "email":
        return p.email || "—"
      case "room":
        return p.room_number || "—"
    }
  }

  function personHref(p: Personnel): string {
    const base = w(`/personnel/${p.id}`)
    if (!linkFrom) return base
    const params = new URLSearchParams({
      from: linkFrom.path,
      fromLabel: linkFrom.label,
    })
    return `${base}?${params.toString()}`
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <ColumnsMenu visible={visibleSet} onToggle={toggleColumn} />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2">
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        sortKey === c.key
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {c.label}
                      {sortKey === c.key ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              {rowAction && <th className="px-3 py-2 text-right">Quick</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (rowAction ? 1 : 0)}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {sorted.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2",
                      c.key === "name" || c.key === "status"
                        ? ""
                        : "text-muted-foreground",
                    )}
                  >
                    {renderCell(p, c.key)}
                  </td>
                ))}
                {rowAction && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {rowAction(p)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ColumnsMenu({
  visible,
  onToggle,
}: {
  visible: Set<PersonnelColumnKey>
  onToggle: (key: PersonnelColumnKey) => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent/50"
          >
            <Columns3 className="size-3.5" />
            Columns
          </button>
        }
      />
      <PopoverContent align="end" className="w-52 p-2">
        <div className="px-1 pb-1 text-xs font-medium">Show columns</div>
        <div className="flex flex-col">
          {ALL_PERSONNEL_COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.alwaysOn ? undefined : () => onToggle(c.key)}
              disabled={c.alwaysOn}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm disabled:cursor-not-allowed"
            >
              <Checkbox
                checked={visible.has(c.key)}
                disabled={c.alwaysOn}
                tabIndex={-1}
                className="pointer-events-none"
              />
              <span className={cn(c.alwaysOn && "text-muted-foreground")}>
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
