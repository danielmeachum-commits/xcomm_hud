import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CatalogCreateDialog } from "@/components/equipment/catalog-create-dialog"
import { UtcDefsClient } from "@/components/equipment/utc-defs-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave, EquipmentType, UtcDef } from "@/lib/types"

/** Every UTC definition, flat. The packages page shows which ones a package
 *  carries; this one shows that they exist and what they hold — including the
 *  ones no package has claimed. */
export default async function UtcDefsPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  const me = await requireSession()

  // Types and enclaves come down for the contents column and for the create
  // dialog's line editor, which needs every type on offer.
  const [utcDefs, types, enclaves] = await Promise.all([
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
  ])
  const isAdmin = me.role === "admin"

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "UTCs" }]} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">UTCs</h1>
          <p className="text-xs text-muted-foreground">
            A UTC bundles equipment types into a deployable unit. Serialized
            gear is tracked from here down.
          </p>
        </div>
        <CatalogCreateDialog
          kind="utcs"
          types={types}
          utcDefs={utcDefs}
          enclaves={enclaves}
          isAdmin={isAdmin}
        />
      </div>
      <UtcDefsClient
        utcDefs={utcDefs}
        types={types}
        enclaves={enclaves}
        isAdmin={isAdmin}
      />
    </div>
  )
}
