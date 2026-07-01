import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { SiteDetailClient } from "@/components/sites/site-detail-client"
import type { Gateway, Service, ServiceTemplate, Site } from "@/lib/types"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteDetailPage({ params }: PageProps) {
  await requireSession()
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

  const [allServices, allSites, gateways, templates] = await Promise.all([
    apiGet<Service[]>(`/services`).catch(() => [] as Service[]),
    apiGet<Site[]>(`/sites`).catch(() => [] as Site[]),
    apiGet<Gateway[]>(`/sites/${siteId}/gateways`).catch(() => [] as Gateway[]),
    apiGet<ServiceTemplate[]>(`/service-templates`).catch(
      () => [] as ServiceTemplate[],
    ),
  ])

  const siteServices = allServices.filter((s) => s.site_id === siteId)

  return (
    <SiteDetailClient
      site={site}
      services={siteServices}
      gateways={gateways}
      sites={allSites}
      templates={templates}
    />
  )
}
