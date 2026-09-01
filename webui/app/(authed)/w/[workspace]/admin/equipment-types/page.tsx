import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CatalogCreateDialog } from "@/components/equipment/catalog-create-dialog"
import { EquipmentTypesClient } from "@/components/equipment/equipment-types-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { EquipmentType } from "@/lib/types"

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

  // Just the types: enclaves and work centers belong to one row's detail
  // page, which fetches them itself, and the list never showed them.
  const types = await apiGet<EquipmentType[]>("/equipment-types").catch(
    () => [] as EquipmentType[],
  )
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
      <EquipmentTypesClient types={types} isAdmin={isAdmin} />
    </div>
  )
}
