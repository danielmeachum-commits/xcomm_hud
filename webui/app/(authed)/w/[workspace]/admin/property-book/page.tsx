import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { PropertyBookClient } from "@/components/equipment/property-book-client"
import type { EquipmentAsset, EquipmentType, Workspace } from "@/lib/types"

export default async function PropertyBookPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  const { workspace } = await params
  const me = await requireSession()

  // Struck rows are included here and nowhere else — you can't audit what you
  // can't see, and the deploy wizard deliberately hides them.
  const [assets, types, workspaces] = await Promise.all([
    apiGet<EquipmentAsset[]>("/assets?include_retired=true").catch(
      () => [] as EquipmentAsset[],
    ),
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
    apiGet<Workspace[]>("/workspaces").catch(() => [] as Workspace[]),
  ])

  const current = workspaces.find((w) => w.slug === workspace)

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Property book" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Property book</h1>
        <p className="text-xs text-muted-foreground">
          Every physical box the unit owns, held once and shared by every
          workspace. Serials live here so they are typed once and never again;
          deploying draws from this list rather than registering gear afresh. A
          workspace is an operating picture, so the same box can legitimately
          appear in several at once — &ldquo;in use by&rdquo; says which.
        </p>
      </div>
      <PropertyBookClient
        assets={assets}
        types={types}
        workspaceName={current?.name ?? workspace}
        canEdit={me.role === "admin"}
      />
    </div>
  )
}
