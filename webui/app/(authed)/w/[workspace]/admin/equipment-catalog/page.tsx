import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EquipmentCatalogClient } from "@/components/equipment/equipment-catalog-client"
import type { EquipmentType, PackageDef, UtcDef } from "@/lib/types"

export default async function EquipmentCatalogPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  const me = await requireSession()

  const [types, utcDefs, packageDefs] = await Promise.all([
    apiGet<EquipmentType[]>("/equipment-types").catch(() => [] as EquipmentType[]),
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<PackageDef[]>("/package-defs").catch(() => [] as PackageDef[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Equipment catalog" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Equipment catalog
        </h1>
        <p className="text-xs text-muted-foreground">
          Reference data: what a model of gear is, what it can do, and which
          UTCs and packages it belongs to.
        </p>
      </div>
      <EquipmentCatalogClient
        types={types}
        utcDefs={utcDefs}
        packageDefs={packageDefs}
        isAdmin={me.role === "admin"}
      />
    </div>
  )
}
