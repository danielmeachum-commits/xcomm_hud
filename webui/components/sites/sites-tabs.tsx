"use client"

import Link from "next/link"
import { useState } from "react"
import { LayoutGrid, Network } from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import TransportBadge from "@/components/8starlabs-ui/transport-badge"
import { MapCanvas } from "@/components/map/map-canvas"
import { ViewTabs } from "@/components/ui/view-tabs"
import { statusBadgeClass, statusLabel, statusToIndicatorState } from "@/lib/status"
import type { MapBundle, Site } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"

type View = "list" | "graph"

interface Props {
  sites: Site[]
  bundle: MapBundle
}

export function SitesTabs({ sites, bundle }: Props) {
  const [view, setView] = useState<View>("list")

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewTabs<View>
        value={view}
        onChange={setView}
        options={[
          { value: "list", label: "List", icon: LayoutGrid },
          { value: "graph", label: "Graph", icon: Network },
        ]}
      />

      {view === "list" ? (
        <SitesList sites={sites} />
      ) : (
        <SitesGraph bundle={bundle} />
      )}
    </div>
  )
}

function SitesList({ sites }: { sites: Site[] }) {
  const { w } = useWorkspace()
  if (sites.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
        No sites yet — add your first site.
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sites.map((s) => (
        <Link
          key={s.id}
          href={w(`/sites/${s.id}`)}
          className={`flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-accent ${statusBadgeClass(s.status)}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{s.name}</span>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider">
              <StatusIndicator
                state={statusToIndicatorState(s.status)}
                size="sm"
              />
              <span>{statusLabel(s.status)}</span>
            </div>
          </div>
          <TransportBadge
            fpcon={s.show_fpcon ? s.fpcon : undefined}
            emcon={s.show_emcon ? s.emcon : undefined}
            size="sm"
          />
          {s.location_label && (
            <p className="text-xs text-muted-foreground">{s.location_label}</p>
          )}
        </Link>
      ))}
    </div>
  )
}

function SitesGraph({ bundle }: { bundle: MapBundle }) {
  if (bundle.sites.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
        No sites yet — add one to see them on the graph.
      </div>
    )
  }
  return <MapCanvas bundle={bundle} />
}
