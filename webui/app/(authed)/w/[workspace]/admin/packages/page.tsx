import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CatalogCreateDialog } from "@/components/equipment/catalog-create-dialog"
import { PackagesClient } from "@/components/equipment/packages-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { PackageDef, UtcDef } from "@/lib/types"

/** Force structure, read top-down: a package composes UTCs, each in a role.
 *
 *  Deliberately only two collections. What a UTC is made of — enclaves,
 *  equipment types, capabilities — belongs to the UTCs page next door; pulling
 *  it in here buried the structure this page exists to show. Read-only: every
 *  write happens on a package's own detail page. */
export default async function PackagesPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  const me = await requireSession()

  const [utcDefs, packageDefs] = await Promise.all([
    apiGet<UtcDef[]>("/utc-defs").catch(() => [] as UtcDef[]),
    apiGet<PackageDef[]>("/package-defs").catch(() => [] as PackageDef[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Packages" }]} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Packages</h1>
          <p className="text-xs text-muted-foreground">
            Every package and the UTCs it carries, with the role each one plays.
          </p>
        </div>
        <CatalogCreateDialog
          kind="packages"
          utcDefs={utcDefs}
          isAdmin={me.role === "admin"}
        />
      </div>
      <PackagesClient utcDefs={utcDefs} packageDefs={packageDefs} />
    </div>
  )
}
