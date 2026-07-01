"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { GatewayForm } from "@/components/sites/gateway-form"
import { Input } from "@/components/ui/input"
import {
  GATEWAY_KINDS,
  GATEWAY_PACE_VALUES,
  gatewayIcon,
  gatewayKindLabel,
  paceClasses,
  paceLabel,
  paceShort,
} from "@/lib/service-meta"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { Gateway, GatewayKind, GatewayPace, Site } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"

interface Props {
  gateways: Gateway[]
  sites: Site[]
}

type SortKey = "name" | "site" | "kind" | "pace" | "status"
type SortDir = "asc" | "desc"

const PACE_RANK: Record<GatewayPace, number> = {
  primary: 0,
  alternate: 1,
  contingency: 2,
  emergency: 3,
}

export function GatewaysAdmin({ gateways, sites }: Props) {
  const { w } = useWorkspace()
  const [search, setSearch] = useState("")
  const [siteFilter, setSiteFilter] = useState<string>("all")
  const [kindFilter, setKindFilter] = useState<"all" | GatewayKind>("all")
  const [paceFilter, setPaceFilter] = useState<"all" | GatewayPace>("all")
  const [sortKey, setSortKey] = useState<SortKey>("pace")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const siteName = new Map(sites.map((s) => [s.id, s.name]))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = gateways
    if (siteFilter !== "all") rows = rows.filter((g) => String(g.site_id) === siteFilter)
    if (kindFilter !== "all") rows = rows.filter((g) => g.kind === kindFilter)
    if (paceFilter !== "all") rows = rows.filter((g) => g.pace === paceFilter)
    if (q)
      rows = rows.filter((g) =>
        [g.name, g.provider, siteName.get(g.site_id), g.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name)
          break
        case "site":
          cmp = (siteName.get(a.site_id) ?? "").localeCompare(
            siteName.get(b.site_id) ?? "",
          )
          break
        case "kind":
          cmp = a.kind.localeCompare(b.kind)
          break
        case "pace":
          cmp = PACE_RANK[a.pace] - PACE_RANK[b.pace]
          break
        case "status":
          cmp = a.status.localeCompare(b.status)
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return sorted
  }, [gateways, search, siteFilter, kindFilter, paceFilter, sortKey, sortDir, siteName])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else {
      setSortKey(k)
      setSortDir("asc")
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
            placeholder="Search name, site, provider…"
            className="pl-7"
          />
        </div>
        <select
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "all" | GatewayKind)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All kinds</option>
          {GATEWAY_KINDS.map((k) => (
            <option key={k} value={k}>
              {gatewayKindLabel(k)}
            </option>
          ))}
        </select>
        <select
          value={paceFilter}
          onChange={(e) => setPaceFilter(e.target.value as "all" | GatewayPace)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All PACE</option>
          {GATEWAY_PACE_VALUES.map((p) => (
            <option key={p} value={p}>
              {paceLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} of {gateways.length} gateways
      </div>

      <div className="overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left">
                <SortHeader k="pace" label="PACE" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="name" label="Name" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="site" label="Site" />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="kind" label="Kind" />
              </th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-left">
                <SortHeader k="status" label="Status" />
              </th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const Icon = gatewayIcon(g.kind)
              const pace = paceClasses(g.pace)
              return (
                <tr key={g.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${pace.bg} ${pace.text}`}
                      title={paceLabel(g.pace)}
                    >
                      {paceShort(g.pace)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
                      <span className="font-medium">{g.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={w(`/sites/${g.site_id}`)}
                      className="text-muted-foreground hover:underline"
                    >
                      {siteName.get(g.site_id) ?? `site ${g.site_id}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {gatewayKindLabel(g.kind)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {g.provider ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <StatusIndicator
                        state={statusToIndicatorState(g.status)}
                        size="sm"
                      />
                      {statusLabel(g.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <GatewayForm
                        siteId={g.site_id}
                        gateway={g}
                        triggerLabel="Edit"
                      />
                      <GatewayStatusPill
                        gatewayId={g.id}
                        gatewayName={g.name}
                        status={g.status}
                        lastValidatedAt={g.validated_at}
                        lastValidatedBy={g.validated_by_username}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No gateways match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
