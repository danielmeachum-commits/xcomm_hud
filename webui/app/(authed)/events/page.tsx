import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EventsTable } from "@/components/events/events-table"
import type { Event, Gateway, Service, Site } from "@/lib/types"

export default async function EventsPage() {
  const me = await requireSession()

  const [events, sites, services, gateways] = await Promise.all([
    apiGet<Event[]>("/events?limit=1000").catch(() => [] as Event[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
    apiGet<Service[]>("/services").catch(() => [] as Service[]),
    apiGet<Gateway[]>("/gateways").catch(() => [] as Gateway[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Events" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Events</h1>
        <p className="text-xs text-muted-foreground">
          Append-only history of status changes. Filter, export, and (for
          operators) log manual events.
        </p>
      </div>
      <EventsTable
        me={me}
        events={events}
        sites={sites}
        services={services}
        gateways={gateways}
      />
    </div>
  )
}
