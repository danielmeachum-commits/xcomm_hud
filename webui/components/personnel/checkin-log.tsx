"use client"

import { ArrowRight, LogIn, LogOut, ScanLine } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo } from "react"

import { RANGES, type RangeKey } from "@/lib/checkin-ranges"
import { useWorkspace } from "@/lib/workspace"
import type { CheckinActivity } from "@/lib/types"


const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm"

const ACTION = {
  in: {
    label: "In",
    icon: LogIn,
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  moved: {
    label: "Moved",
    icon: ArrowRight,
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  out: {
    label: "Out",
    icon: LogOut,
    cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
} as const

function dayLabel(d: Date): string {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400_000)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

export function CheckinLog({
  rows,
  range,
  station,
}: {
  rows: CheckinActivity[]
  range: RangeKey
  station: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { w } = useWorkspace()

  // Stations seen in this window (the station list itself is admin-only).
  const stations = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of rows)
      if (r.station_id != null) m.set(r.station_id, r.station_name ?? "Removed station")
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const counts = useMemo(() => {
    const c = { in: 0, moved: 0, out: 0 }
    for (const r of rows) c[r.action]++
    return c
  }, [rows])

  // Group by day, newest first (rows already come newest first).
  const days = useMemo(() => {
    const out: { label: string; rows: CheckinActivity[] }[] = []
    for (const r of rows) {
      const label = dayLabel(new Date(r.at))
      if (out.at(-1)?.label !== label) out.push({ label, rows: [] })
      out.at(-1)!.rows.push(r)
    }
    return out
  }, [rows])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Check-in log</h1>
          <p className="text-xs text-muted-foreground">
            Every CAC scan that checked someone in or out at a check-in
            station, newest first. Updates as people scan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Time range"
            className={selectClass}
            value={range}
            onChange={(e) => setParam("range", e.target.value === "24h" ? "" : e.target.value)}
          >
            {Object.entries(RANGES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Station"
            className={selectClass}
            value={station}
            onChange={(e) => setParam("station", e.target.value)}
          >
            <option value="">All stations</option>
            {stations.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(["in", "moved", "out"] as const).map((a) => {
          const A = ACTION[a]
          return (
            <span
              key={a}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${A.cls}`}
            >
              <A.icon className="size-3.5" /> {counts[a]} {A.label.toLowerCase()}
            </span>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
          <ScanLine className="mx-auto mb-2 size-5" />
          No check-ins in this period.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-20 px-3 py-2">Time</th>
                <th className="px-3 py-2">Person</th>
                <th className="w-28 px-3 py-2">Action</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Station</th>
              </tr>
            </thead>
            {days.map((d) => (
              <tbody key={d.label}>
                <tr>
                  <td
                    colSpan={5}
                    className="bg-muted/20 px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                  >
                    {d.label}
                  </td>
                </tr>
                {d.rows.map((r) => {
                  const A = ACTION[r.action]
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                        {new Date(r.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={w(`/personnel/${r.personnel_id}`)}
                          className="font-medium hover:underline"
                        >
                          {r.name}
                        </Link>
                        {r.is_guest && (
                          <span className="ml-2 text-xs text-muted-foreground">guest</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${A.cls}`}
                        >
                          <A.icon className="size-3.5" /> {A.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {r.action === "out"
                          ? r.from_site_name ?? "—"
                          : r.site_name}
                        {r.action === "moved" && r.from_site_name && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            from {r.from_site_name}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.station_name ?? "Removed station"}
                        {r.enrolled_at_desk && (
                          <span className="ml-2 text-xs">· enrolled at desk</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  )
}
