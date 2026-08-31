import { notFound } from "next/navigation"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { UtcDefDetailClient } from "@/components/equipment/utc-def-detail-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave, EquipmentType, UtcDef } from "@/lib/types"

/** One UTC definition: what it is, and the equipment it brings.
 *
 *  The list endpoint is the only read path — the API exposes no
 *  `GET /utc-defs/{id}` — so this finds the row in the collection it already
 *  has to trust for visibility rules. Cheap: the catalog is small, and
 *  filtering here keeps the same global-plus-workspace scoping the list has.
 *  Same shape as the package detail page next door. */
export default async function UtcDefDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>
}) {
  const { workspace: slug, id } = await params
  const w = (path: string) => `/w/${slug}${path}`
  const me = await requireSession()

  // Types and enclaves come down with the definition because the manage board
  // needs every type on offer and every enclave that could be a column, not
  // just the ones already in the lines.
  const [utcDefs, types, enclaves] = await Promise.all([
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
  ])
  const def = utcDefs.find((d) => String(d.id) === id)
  if (!def) notFound()

  return (
    // `min-w-0` all the way down: the bill of materials scrolls sideways, and
    // an `overflow-x-auto` box can only contain its content if every flex
    // ancestor is allowed to be narrower than that content. Without it the
    // board's min-content width — the sum of its fixed-width columns —
    // propagates up and pushes the page off screen instead.
    <div className="flex h-full min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "UTCs", href: w("/admin/utcs") },
          { label: def.code },
        ]}
      />
      <UtcDefDetailClient
        def={def}
        types={types}
        enclaves={enclaves}
        role={me.role}
      />
    </div>
  )
}
