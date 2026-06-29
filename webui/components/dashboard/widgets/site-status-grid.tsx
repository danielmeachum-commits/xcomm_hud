"use client"

import Link from "next/link"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import type { WidgetProps } from "@/lib/dashboard/registry"
import { statusBadgeClass, statusLabel, statusToIndicatorState } from "@/lib/status"

export function SiteStatusGridWidget({ data }: WidgetProps) {
  const sites = data.sites ?? []

  if (sites.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
        No sites yet — add one from the Sites page.
      </div>
    )
  }

  return (
    <div className="grid h-full w-full gap-3 overflow-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
      {sites.map((s) => (
        <Link
          key={s.id}
          href={`/sites/${s.id}`}
          className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:bg-accent ${statusBadgeClass(s.status)}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{s.name}</span>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider">
              <StatusIndicator state={statusToIndicatorState(s.status)} size="sm" />
              <span>{statusLabel(s.status)}</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {s.service_count} {s.service_count === 1 ? "service" : "services"}
          </div>
        </Link>
      ))}
    </div>
  )
}
