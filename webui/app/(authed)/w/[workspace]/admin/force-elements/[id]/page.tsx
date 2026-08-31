import { notFound } from "next/navigation"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { PackageDetailClient } from "@/components/equipment/package-detail-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { PackageDef } from "@/lib/types"

/** One package definition, with its properties editable in place.
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

  const packageDefs = await apiGet<PackageDef[]>("/package-defs").catch(
    () => [] as PackageDef[],
  )
  const def = packageDefs.find((p) => String(p.id) === id)
  if (!def) notFound()

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Force elements", href: w("/admin/force-elements") },
          { label: def.code },
        ]}
      />
      <PackageDetailClient def={def} role={me.role} />
    </div>
  )
}
