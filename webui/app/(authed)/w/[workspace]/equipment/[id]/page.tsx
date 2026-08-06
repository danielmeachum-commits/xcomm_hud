import { notFound } from "next/navigation"

import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EquipmentDetailClient } from "@/components/equipment/equipment-detail-client"
import type {
  Enclave,
  Equipment,
  EquipmentType,
  EquipmentLink,
  Event,
  Gateway,
  Service,
  Site,
  UtcInstance,
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

  const [
    services,
    gateways,
    links,
    events,
    enclaves,
    types,
    allEquipment,
    sites,
    utcs,
  ] = await Promise.all([
    // Workspace-wide, narrowed below to the sites this gear's UTC reaches.
    // Scoping the fetch to `equipment.site_id` used to be right, but gear can
    // now be placed at the far end of a shot while still backing the service
    // it reaches — that scoping would hide the binding it already has.
    apiGet<Service[]>("/services").catch(() => [] as Service[]),
    apiGet<Gateway[]>("/gateways").catch(() => [] as Gateway[]),
    apiGet<EquipmentLink[]>("/topology/links").catch(() => [] as EquipmentLink[]),
    apiGet<Event[]>(
      `/events?subject_kind=equipment&subject_id=${equipment.id}&limit=25`,
    ).catch(() => [] as Event[]),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
    // The whole workspace, not this site — the far end of a cross-site shot
    // has to be pickable from here.
    apiGet<Equipment[]>("/equipment").catch(() => [] as Equipment[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
    apiGet<UtcInstance[]>("/utcs").catch(() => [] as UtcInstance[]),
  ])

  const utc = utcs.find((u) => u.id === equipment.utc_instance_id) ?? null

  // Every site this gear can legitimately back something at: wherever it sits,
  // plus everywhere its UTC reaches. Gear at the far end of a shot backs the
  // service on the other side, and the API stopped rejecting those binds.
  const reachable = new Set<number>([
    equipment.site_id,
    ...(utc?.site_ids ?? []),
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
        equipmentType={
          types.find((t) => t.id === equipment.equipment_type_id) ?? null
        }
        services={services.filter((s) => reachable.has(s.site_id))}
        gateways={gateways.filter((g) => reachable.has(g.site_id))}
        links={links.filter(
          (l) =>
            l.a_equipment_id === equipment.id || l.b_equipment_id === equipment.id,
        )}
        allEquipment={allEquipment}
        sites={sites}
        utc={utc}
        events={events}
      />
    </div>
  )
}
