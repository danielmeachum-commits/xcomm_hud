import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CatalogCreateDialog } from "@/components/equipment/catalog-create-dialog"
import { EquipmentTypesClient } from "@/components/equipment/equipment-types-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave, EquipmentType, WorkCenter } from "@/lib/types"

/** Reference data for gear: what a model of equipment is and what it can do.
 *  One row per kind, not per item — the ones we actually own are the property
 *  book's business. */
export default async function EquipmentTypesPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  const me = await requireSession()

  // Work centers come down so the type sheet can say who answers for a piece
  // of gear without a second round trip.
  const [types, enclaves, workCenters] = await Promise.all([
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
    apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
  ])
  const isAdmin = me.role === "admin"

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Equipment types" }]} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Equipment types
          </h1>
          <p className="text-xs text-muted-foreground">
            The gear catalog — one row per kind of equipment, not per item.
          </p>
        </div>
        <CatalogCreateDialog kind="types" types={types} isAdmin={isAdmin} />
      </div>
      <EquipmentTypesClient
        types={types}
        enclaves={enclaves}
        workCenters={workCenters}
        isAdmin={isAdmin}
      />
    </div>
  )
}
