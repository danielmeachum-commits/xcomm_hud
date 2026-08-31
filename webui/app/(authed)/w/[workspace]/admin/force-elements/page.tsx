import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { ForceElementsClient } from "@/components/equipment/force-elements-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { PackageDef, UtcDef } from "@/lib/types"

/** Force structure, read top-down: a package composes UTCs, each in a role.
 *
 *  Deliberately only two collections. What a UTC is made of — enclaves,
 *  equipment types, capabilities — belongs to the equipment catalog; pulling it
 *  in here buried the structure this page exists to show. Read-only: every
 *  write still goes through the catalog page's sheets. */
export default async function ForceElementsPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  await requireSession()

  const [utcDefs, packageDefs] = await Promise.all([
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<PackageDef[]>("/package-defs").catch(() => [] as PackageDef[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Force elements" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Force elements</h1>
        <p className="text-xs text-muted-foreground">
          Every package and the UTCs it carries, with the role each one plays.
        </p>
      </div>
      <ForceElementsClient utcDefs={utcDefs} packageDefs={packageDefs} />
    </div>
  )
}
