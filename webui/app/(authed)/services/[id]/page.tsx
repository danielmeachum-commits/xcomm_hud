import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { ServiceDetailClient } from "@/components/services/service-detail-client"
import type { Service, Site } from "@/lib/types"

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

  const sites = await apiGet<Site[]>(`/sites`).catch(() => [] as Site[])

  return <ServiceDetailClient service={service} sites={sites} />
}
