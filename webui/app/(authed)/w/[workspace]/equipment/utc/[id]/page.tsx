import { notFound } from "next/navigation"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { UtcDetailClient } from "@/components/equipment/utc-detail-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type {
  Enclave,
  Equipment,
  EquipmentHolding,
  EquipmentType,
  Gateway,
  Service,
  UtcInstance,
} from "@/lib/types"

export default async function UtcDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>
}) {
  const { workspace: slug, id } = await params
  const w = (path: string) =>
    `/w/${slug}${path.startsWith("/") ? path : `/${path}`}`
  await requireSession()

  const utc = await apiGet<UtcInstance>(`/utcs/${id}`).catch(() => null)
  if (!utc) notFound()

  const [equipment, holdings, types, enclaves, services, gateways] =
    await Promise.all([
      apiGet<Equipment[]>(`/equipment?utc_instance_id=${utc.id}`).catch(
        () => [] as Equipment[],
      ),
      apiGet<EquipmentHolding[]>(`/utcs/${utc.id}/holdings`).catch(
        () => [] as EquipmentHolding[],
      ),
      apiGet<EquipmentType[]>("/equipment-types").catch(
        () => [] as EquipmentType[],
      ),
      apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
      // Bindings can only point at this site's services and gateways, so
      // scope the fetch rather than filtering a workspace-wide list.
      apiGet<Service[]>(`/services?site_id=${utc.site_id}`).catch(
        () => [] as Service[],
      ),
      apiGet<Gateway[]>(`/sites/${utc.site_id}/gateways`).catch(
        () => [] as Gateway[],
      ),
    ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Equipment", href: w("/equipment") },
          { label: utc.name },
        ]}
      />
      <UtcDetailClient
        utc={utc}
        equipment={equipment}
        holdings={holdings}
        types={types}
        enclaves={enclaves}
        services={services}
        gateways={gateways}
      />
    </div>
  )
}
