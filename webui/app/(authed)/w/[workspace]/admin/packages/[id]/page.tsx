import { notFound } from "next/navigation"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { PackageDetailClient } from "@/components/equipment/package-detail-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave, EquipmentType, PackageDef, UtcDef } from "@/lib/types"

/** One package definition: what it is, and the UTCs it carries.
 *
 *  The list endpoint is the only read path — the API exposes no
 *  `GET /package-defs/{id}` — so this finds the row in the collection it
 *  already has to trust for visibility rules. Cheap: the catalog is small, and
 *  filtering here keeps the same global-plus-workspace scoping the list has. */
export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>
}) {
  const { workspace: slug, id } = await params
  const w = (path: string) => `/w/${slug}${path}`
  const me = await requireSession()

  // The UTC catalog comes down with the package because the manage panel needs
  // every definition on offer, not just the ones already in the list, and the
  // structure diagram needs their lines to draw anything below a UTC.
  // Enclaves come down too: the peek sheet names a UTC's columns with them.
  // Equipment types are the diagram's alone — a line already carries its
  // type's title, so this only buys the icon that says what kind of box it is.
  const [packageDefs, utcDefs, enclaves, types] = await Promise.all([
    apiGet<PackageDef[]>("/package-defs").catch(() => [] as PackageDef[]),
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
    apiGet<EquipmentType[]>("/equipment-types").catch(
      () => [] as EquipmentType[],
    ),
  ])
  const def = packageDefs.find((p) => String(p.id) === id)
  if (!def) notFound()

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Packages", href: w("/admin/packages") },
          { label: def.code },
        ]}
      />
      <PackageDetailClient
        def={def}
        utcDefs={utcDefs}
        enclaves={enclaves}
        types={types}
        role={me.role}
      />
    </div>
  )
}
