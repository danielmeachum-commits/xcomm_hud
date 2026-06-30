"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { LocalTime } from "@/components/time-display"
import { Input } from "@/components/ui/input"
import {
  GATEWAY_STATUS_VALUES,
  SERVICE_STATUS_VALUES,
  statusLabel,
  statusToIndicatorState,
} from "@/lib/status"
import { formatZulu } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { AnyStatus, SubjectKind, Validation } from "@/lib/types"

const ALL_STATUS_VALUES: AnyStatus[] = Array.from(
  new Set<AnyStatus>([...SERVICE_STATUS_VALUES, ...GATEWAY_STATUS_VALUES]),
)

type SortKey = "validated_at" | "subject_kind" | "subject_name" | "site_name" | "status" | "validator"
type SortDir = "asc" | "desc"

interface Props {
  validations: Validation[]
}

function compareStr(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "")
}

export function EventsTable({ validations }: Props) {
  const [search, setSearch] = useState("")
  const [siteFilter, setSiteFilter] = useState<string>("all")
  const [kindFilter, setKindFilter] = useState<"all" | SubjectKind>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | AnyStatus>("all")
  const [sortKey, setSortKey] = useState<SortKey>("validated_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const siteOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of validations) {
      if (v.site_id != null) {
        m.set(String(v.site_id), v.site_name ?? `site ${v.site_id}`)
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [validations])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = validations
    if (siteFilter !== "all") {
      const sid = Number(siteFilter)
      rows = rows.filter((v) => v.site_id === sid)
    }
    if (kindFilter !== "all") {
      rows = rows.filter((v) => v.subject_kind === kindFilter)
    }
    if (statusFilter !== "all") {
      rows = rows.filter((v) => v.status === statusFilter)
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
        case "validator":
          cmp = compareStr(a.validated_by_username, b.validated_by_username)
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return sorted
  }, [validations, search, siteFilter, kindFilter, statusFilter, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(k)
      setSortDir(k === "validated_at" ? "desc" : "asc")
    }
  }

  function SortHeader({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
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

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, site, note…"
            className="pl-7"
          />
        </div>
        <select
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All sites</option>
          {siteOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "all" | SubjectKind)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All subjects</option>
          <option value="service">Service</option>
          <option value="gateway">Gateway</option>
          <option value="site">Site</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | AnyStatus)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All statuses</option>
          {ALL_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} of {validations.length} events
      </div>

      <div className="overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left">
                <SortHeader k="validated_at" label="Local" />
              </th>
              <th className="px-3 py-2 text-left">Zulu</th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="subject_kind" label="Kind" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="subject_name" label="Subject" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="site_name" label="Site" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="status" label="Status" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="validator" label="Validator" />
              </th>
              <th className="px-3 py-2 text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">
                  <LocalTime iso={v.validated_at} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {formatZulu(v.validated_at)}
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                    {v.subject_kind}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {v.subject_name ?? `id ${v.subject_id}`}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {v.site_name ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <StatusIndicator
                      state={statusToIndicatorState(v.status)}
                      size="sm"
                    />
                    {statusLabel(v.status)}
                    {v.prev_status && v.prev_status !== v.status && (
                      <span className="text-[10px] text-muted-foreground">
                        (was {statusLabel(v.prev_status)})
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {v.validated_by_username ?? v.source}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {v.note ?? ""}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  No events match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
