import { notFound } from "next/navigation"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EquipmentTypeDetailClient } from "@/components/equipment/equipment-type-detail-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave, EquipmentType, WorkCenter } from "@/lib/types"

/** One equipment type: what a model of gear is, what it can do, who answers
 *  for it.
 *
 *  The list endpoint is the only read path — the API exposes no
 *  `GET /equipment-types/{id}` — so this finds the row in the collection it
 *  already has to trust for visibility rules. Cheap: the catalog is small,
 *  and filtering here keeps the same global-plus-workspace scoping the list
 *  has. Same shape as the UTC definition and package pages. */
export default async function EquipmentTypeDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>
}) {
  const { workspace: slug, id } = await params
  const w = (path: string) => `/w/${slug}${path}`
  const me = await requireSession()

  // Enclaves and work centers come down with the type because the editor
  // needs every one on offer, not just the ones already picked.
  const [types, enclaves, workCenters] = await Promise.all([
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
    apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
  ])
  const type = types.find((t) => String(t.id) === id)
  if (!type) notFound()

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Equipment types", href: w("/admin/equipment-types") },
          { label: type.short_name || type.title },
        ]}
      />
      <EquipmentTypeDetailClient
        type={type}
        enclaves={enclaves}
        workCenters={workCenters}
        // Suggestions come from the whole catalog, not this row — the point
        // is to reuse a tag someone already coined rather than coin a synonym.
        tagSuggestions={[...new Set(types.flatMap((t) => t.tags))].sort()}
        canEdit={me.role === "admin" || !type.is_global}
      />
    </div>
  )
}
