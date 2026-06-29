import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { ApiError } from "@/lib/api"
import { SiteDetailClient } from "@/components/sites/site-detail-client"
import type { Equipment, Site, UTC } from "@/lib/types"

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

  const [utcs, equipment] = await Promise.all([
    apiGet<UTC[]>(`/sites/${siteId}/utcs`).catch(() => [] as UTC[]),
    apiGet<Equipment[]>(`/equipment?site_id=${siteId}`).catch(
      () => [] as Equipment[],
    ),
  ])

  return (
    <SiteDetailClient site={site} initialUtcs={utcs} initialEquipment={equipment} />
  )
}
