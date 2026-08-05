import { notFound } from "next/navigation"

import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EquipmentDetailClient } from "@/components/equipment/equipment-detail-client"
import type {
  Enclave,
  Equipment,
  EquipmentLink,
  Event,
  Gateway,
  Service,
} from "@/lib/types"

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>
}) {
  const { workspace: slug, id } = await params
  const w = (path: string) => `/w/${slug}${path.startsWith("/") ? path : `/${path}`}`
  await requireSession()

  const equipment = await apiGet<Equipment>(`/equipment/${id}`).catch(() => null)
  if (!equipment) notFound()

  const [services, gateways, links, events, enclaves] = await Promise.all([
    apiGet<Service[]>(`/services?site_id=${equipment.site_id}`).catch(
      () => [] as Service[],
    ),
    apiGet<Gateway[]>("/gateways").catch(() => [] as Gateway[]),
    apiGet<EquipmentLink[]>("/topology/links").catch(() => [] as EquipmentLink[]),
    apiGet<Event[]>(
      `/events?subject_kind=equipment&subject_id=${equipment.id}&limit=25`,
    ).catch(() => [] as Event[]),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Equipment", href: w("/equipment") },
          { label: equipment.equipment_code },
        ]}
      />
      <EquipmentDetailClient
        equipment={equipment}
        enclaves={enclaves}
        services={services}
        gateways={gateways.filter((g) => g.site_id === equipment.site_id)}
        links={links.filter(
          (l) =>
            l.a_equipment_id === equipment.id || l.b_equipment_id === equipment.id,
        )}
        events={events}
      />
    </div>
  )
}
