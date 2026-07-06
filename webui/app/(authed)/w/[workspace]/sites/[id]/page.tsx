import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { SiteDetailClient } from "@/components/sites/site-detail-client"
import type {
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
  ])

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
    />
  )
}
