"use client"

import Link from "next/link"

import type { WidgetProps } from "@/lib/dashboard/registry"
import { statusBadgeClass, statusLabel } from "@/lib/status"

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
          <div className="flex items-baseline justify-between">
            <span className="font-medium">{s.name}</span>
            <span className="text-xs uppercase tracking-wider">
              {statusLabel(s.status)}
            </span>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>{s.utc_count} UTC</span>
            <span>{s.equipment_count} eq</span>
            <span>{s.service_count} svc</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
