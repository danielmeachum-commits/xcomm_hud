import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { SiteDetailClient } from "@/components/sites/site-detail-client"
import type { Service, Site } from "@/lib/types"

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

  const services = await apiGet<Service[]>(`/services`).catch(() => [] as Service[])
  const siteServices = services.filter((s) => s.site_id === siteId)

  return <SiteDetailClient site={site} services={siteServices} />
}
