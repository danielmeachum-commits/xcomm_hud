"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { GanttChart, Plus, Table2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ViewTabs } from "@/components/ui/view-tabs"
import type {
  Event,
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
import { EventsTable } from "./events-table"

type View = "timeline" | "table"

const VIEW_OPTIONS = [
  { value: "timeline" as View, label: "Timeline", icon: GanttChart },
  { value: "table" as View, label: "Table", icon: Table2 },
]

interface Props {
  site: Site
  me: Me
  events: Event[]
  sites: Site[]
  services: Service[]
  gateways: Gateway[]
  eventTypes: EventTypeDef[]
  teams: Team[]
  units: Unit[]
  workCenters: WorkCenter[]
}

/** Site-scoped events: same timeline/table as the global page, locked to
 *  this site, with the log dialog defaulted to the site's scope. */
export function SiteEventsTab({
  site,
  me,
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
  const [view, setView] = useState<View>("timeline")
  const [showCreate, setShowCreate] = useState(false)

  const isOperator = me.role === "operator" || me.role === "admin"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <ViewTabs value={view} onChange={setView} options={VIEW_OPTIONS} />
        {view === "timeline" && isOperator && (
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="h-8 gap-1.5"
          >
            <Plus className="size-3.5" />
            Log event
          </Button>
        )}
      </div>

      {view === "timeline" ? (
        <EventTimeline
          me={me}
          events={events}
          eventTypes={eventTypes}
          siteId={site.id}
          logsView="Log Table"
        />
      ) : (
        <EventsTable
          me={me}
          events={events}
          sites={sites}
          services={services}
          gateways={gateways}
          eventTypes={eventTypes}
          teams={teams}
          units={units}
          workCenters={workCenters}
          workspace={me.current_workspace}
          defaultSiteId={site.id}
        />
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
        defaultSiteId={site.id}
        onCreated={() => router.refresh()}
      />
    </div>
  )
}
