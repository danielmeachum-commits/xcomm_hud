import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EventsPageClient } from "@/components/events/events-page-client"
import type {
  Event,
  EventSummary,
  EventTypeDef,
  Gateway,
  Service,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

export default async function EventsPage() {
  const me = await requireSession()

  const [
    summary,
    events,
    sites,
    services,
    gateways,
    eventTypes,
    teams,
    units,
    workCenters,
  ] = await Promise.all([
    apiGet<EventSummary>("/events/summary").catch(() => null),
    apiGet<Event[]>("/events?limit=500").catch(() => [] as Event[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
    apiGet<Service[]>("/services").catch(() => [] as Service[]),
    apiGet<Gateway[]>("/gateways").catch(() => [] as Gateway[]),
    apiGet<EventTypeDef[]>("/event-types").catch(() => [] as EventTypeDef[]),
    apiGet<Team[]>("/teams").catch(() => [] as Team[]),
    apiGet<Unit[]>("/units").catch(() => [] as Unit[]),
    apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Events" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Events</h1>
        <p className="text-xs text-muted-foreground">
          Significant occurrences on the timeline; the full append-only audit
          trail in the Audit view. Operators can log events and define new
          event types.
        </p>
      </div>
      <EventsPageClient
        me={me}
        summary={summary}
        events={events}
        sites={sites}
        services={services}
        gateways={gateways}
        eventTypes={eventTypes}
        teams={teams}
        units={units}
        workCenters={workCenters}
      />
    </div>
  )
}
