import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EquipmentPageClient } from "@/components/equipment/equipment-page-client"
import type {
  Enclave,
  Equipment,
  EquipmentType,
  Gateway,
  NetworkTopology,
  PackageDef,
  PackageInstance,
  Service,
  Site,
  UtcDef,
  UtcInstance,
} from "@/lib/types"

export default async function EquipmentPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  await requireSession()

  const [
    equipment,
    enclaves,
    sites,
    utcs,
    packages,
    types,
    utcDefs,
    packageDefs,
    services,
    gateways,
    topology,
  ] = await Promise.all([
    apiGet<Equipment[]>("/equipment").catch(() => [] as Equipment[]),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
    apiGet<UtcInstance[]>("/utcs").catch(() => [] as UtcInstance[]),
    apiGet<PackageInstance[]>("/packages").catch(() => [] as PackageInstance[]),
    apiGet<EquipmentType[]>("/equipment-types").catch(() => [] as EquipmentType[]),
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<PackageDef[]>("/package-defs").catch(() => [] as PackageDef[]),
    apiGet<Service[]>("/services").catch(() => [] as Service[]),
    apiGet<Gateway[]>("/gateways").catch(() => [] as Gateway[]),
    apiGet<NetworkTopology>("/topology/network").catch(
      () =>
        ({
          sites: [],
          utc_instances: [],
          equipment: [],
          links: [],
          positions: [],
          service_derived: {},
          gateway_derived: {},
        }) as NetworkTopology,
    ),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Equipment" }]} />
      <EquipmentPageClient
        equipment={equipment}
        enclaves={enclaves}
        sites={sites}
        utcs={utcs}
        packages={packages}
        types={types}
        utcDefs={utcDefs}
        packageDefs={packageDefs}
        services={services}
        gateways={gateways}
        topology={topology}
      />
    </div>
  )
}
