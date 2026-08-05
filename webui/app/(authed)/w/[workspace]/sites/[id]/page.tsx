import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { SiteDetailClient } from "@/components/sites/site-detail-client"
import type {
  Equipment,
  EquipmentHolding,
  SiteEquipmentAdvisory,
  UtcInstance,
  Document,
  Event,
  EventTypeDef,
  Folder,
  Gateway,
  Me,
  Personnel,
  Service,
  ServiceTemplate,
  Site,
  SiteProperty,
  SitePropertyTemplate,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteDetailPage({ params }: PageProps) {
  const me: Me = await requireSession()
  const { id } = await params
  const siteId = Number(id)
  if (!Number.isFinite(siteId)) notFound()

  let site: Site
  try {
    site = await apiGet<Site>(`/sites/${siteId}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  const [
    allServices,
    allSites,
    gateways,
    templates,
    properties,
    propertyTemplates,
    personnel,
    workCenters,
    units,
    teams,
    events,
    eventTypes,
    siteFolders,
    siteDocuments,
    equipment,
    utcs,
    advisory,
  ] = await Promise.all([
    apiGet<Service[]>(`/services`).catch(() => [] as Service[]),
    apiGet<Site[]>(`/sites`).catch(() => [] as Site[]),
    apiGet<Gateway[]>(`/sites/${siteId}/gateways`).catch(() => [] as Gateway[]),
    apiGet<ServiceTemplate[]>(`/service-templates`).catch(
      () => [] as ServiceTemplate[],
    ),
    apiGet<SiteProperty[]>(`/sites/${siteId}/properties`).catch(
      () => [] as SiteProperty[],
    ),
    apiGet<SitePropertyTemplate[]>(`/site-property-templates`).catch(
      () => [] as SitePropertyTemplate[],
    ),
    apiGet<Personnel[]>(`/personnel`).catch(() => [] as Personnel[]),
    apiGet<WorkCenter[]>(`/work-centers`).catch(() => [] as WorkCenter[]),
    apiGet<Unit[]>(`/units`).catch(() => [] as Unit[]),
    apiGet<Team[]>(`/teams`).catch(() => [] as Team[]),
    apiGet<Event[]>(`/events?site_id=${siteId}&limit=500`).catch(
      () => [] as Event[],
    ),
    apiGet<EventTypeDef[]>(`/event-types`).catch(() => [] as EventTypeDef[]),
    apiGet<Folder[]>(`/folders?site_id=${siteId}`).catch(() => [] as Folder[]),
    apiGet<Document[]>(`/documents?site_id=${siteId}`).catch(
      () => [] as Document[],
    ),
    apiGet<Equipment[]>(`/equipment?site_id=${siteId}`).catch(
      () => [] as Equipment[],
    ),
    apiGet<UtcInstance[]>(`/utcs?site_id=${siteId}`).catch(
      () => [] as UtcInstance[],
    ),
    // Advisory only — reported-vs-equipment-derived, never written back.
    apiGet<SiteEquipmentAdvisory>(`/sites/${siteId}/equipment-advisory`).catch(
      () => ({ service_derived: {}, gateway_derived: {} }) as SiteEquipmentAdvisory,
    ),
  ])

  // Holdings hang off each UTC rather than off the site, so they need one
  // fetch per deployed UTC. Done after the batch above because the UTC ids
  // aren't known until it resolves.
  const holdings = (
    await Promise.all(
      utcs.map((u) =>
        apiGet<EquipmentHolding[]>(`/utcs/${u.id}/holdings`).catch(
          () => [] as EquipmentHolding[],
        ),
      ),
    )
  ).flat()

  const siteServices = allServices.filter((s) => s.site_id === siteId)

  return (
    <SiteDetailClient
      site={site}
      services={siteServices}
      gateways={gateways}
      sites={allSites}
      templates={templates}
      properties={properties}
      propertyTemplates={propertyTemplates}
      personnel={personnel}
      workCenters={workCenters}
      units={units}
      teams={teams}
      userRole={me.role}
      me={me}
      events={events}
      eventTypes={eventTypes}
      siteFolders={siteFolders}
      siteDocuments={siteDocuments}
      equipment={equipment}
      utcs={utcs}
      holdings={holdings}
      advisory={advisory}
    />
  )
}
