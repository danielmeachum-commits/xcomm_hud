import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { ServiceDetailClient } from "@/components/services/service-detail-client"
import type { Equipment, Service, Site, UTC } from "@/lib/types"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ServiceDetailPage({ params }: PageProps) {
  await requireSession()
  const { id } = await params
  const sid = Number(id)
  if (!Number.isFinite(sid)) notFound()

  let service: Service
  try {
    service = await apiGet<Service>(`/services/${sid}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  const [equipment, sites, utcs] = await Promise.all([
    apiGet<Equipment[]>(`/equipment`).catch(() => [] as Equipment[]),
    apiGet<Site[]>(`/sites`).catch(() => [] as Site[]),
    apiGet<UTC[]>(`/sites/${service.site_id ?? 0}/utcs`).catch(() => [] as UTC[]),
  ])

  return (
    <ServiceDetailClient
      service={service}
      allEquipment={equipment}
      sites={sites}
      utcs={utcs}
    />
  )
}
