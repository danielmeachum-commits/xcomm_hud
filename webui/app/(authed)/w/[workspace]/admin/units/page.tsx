import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { UnitsAdmin } from "@/components/personnel/units-admin"
import type { Unit } from "@/lib/types"

export default async function UnitsAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const units = await apiGet<Unit[]>("/units").catch(() => [] as Unit[])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Admin" }, { label: "Units" }]} />
      <UnitsAdmin units={units} canEdit canDelete />
    </div>
  )
}
