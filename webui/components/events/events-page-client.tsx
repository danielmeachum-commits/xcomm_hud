"use client"

import { useCallback, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, GanttChart, Plus, Table2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ViewTabs } from "@/components/ui/view-tabs"
import type {
  Event,
  EventSummary,
  EventTypeDef,
  Gateway,
  Me,
  Service,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

import { EventCreateDialog } from "./event-create-dialog"
import { EventTimeline } from "./event-timeline"
import { EventWidgets } from "./event-widgets"
import { EventsTable } from "./events-table"

type View = "timeline" | "table"

const VIEW_OPTIONS = [
  { value: "timeline" as View, label: "Event Timeline", icon: GanttChart },
  { value: "table" as View, label: "Log Table", icon: Table2 },
]

interface Props {
  me: Me
  summary: EventSummary | null
  events: Event[]
  sites: Site[]
  services: Service[]
  gateways: Gateway[]
  eventTypes: EventTypeDef[]
  teams: Team[]
  units: Unit[]
  workCenters: WorkCenter[]
}

/** Global events page body: widget row, Timeline | Table | Audit views. */
export function EventsPageClient({
  me,
  summary,
  events,
  sites,
  services,
  gateways,
  eventTypes,
  teams,
  units,
  workCenters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = (searchParams.get("view") as View) || "timeline"
  const [showCreate, setShowCreate] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  const isOperator = me.role === "operator" || me.role === "admin"

  const setView = useCallback(
    (next: View) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "timeline") params.delete("view")
      else params.set("view", next)
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : "?", { scroll: false })
    },
    [router, searchParams],
  )

  const tableProps = {
    me,
    events,
    sites,
    services,
    gateways,
    eventTypes,
    teams,
    units,
    workCenters,
    workspace: me.current_workspace,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Events</h1>
          <p className="text-xs text-muted-foreground">
            Significant occurrences on the timeline; the full append-only audit
            trail in the Log Table. Operators can log events and define new
            event types.
          </p>
        </div>
        {isOperator && (
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="h-8 shrink-0 gap-1.5"
          >
            <Plus className="size-3.5" />
            Log event
          </Button>
        )}
      </div>

      {summary && <EventWidgets summary={summary} />}

      <div className="flex items-center justify-between gap-2">
        <ViewTabs value={view} onChange={setView} options={VIEW_OPTIONS} />
        <Button
          variant={showHidden ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowHidden((v) => !v)}
          className="h-8 gap-1.5"
          aria-pressed={showHidden}
        >
          {showHidden ? (
            <Eye className="size-3.5" />
          ) : (
            <EyeOff className="size-3.5" />
          )}
          Hidden records
        </Button>
      </div>

      {view === "timeline" && (
        <EventTimeline
          me={me}
          events={events}
          eventTypes={eventTypes}
          showHidden={showHidden}
        />
      )}
      {view === "table" && (
        <EventsTable {...tableProps} showHidden={showHidden} hideCreateButton />
      )}

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
        workspace={me.current_workspace}
        onCreated={() => router.refresh()}
      />
    </div>
  )
}
