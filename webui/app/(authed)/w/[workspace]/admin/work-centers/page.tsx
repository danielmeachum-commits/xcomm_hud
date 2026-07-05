import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { SimpleAdmin, type AdminRow } from "@/components/personnel/simple-admin"
import type { WorkCenter } from "@/lib/types"

export default async function WorkCentersAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const workCenters = await apiGet<WorkCenter[]>("/work-centers").catch(
    () => [] as WorkCenter[],
  )
  const rows: AdminRow[] = workCenters.map((wc) => ({
    id: wc.id,
    name: wc.name,
    description: wc.description,
  }))

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Admin" }, { label: "Work centers" }]}
      />
      <SimpleAdmin
        title="Work centers"
        description="Physical/functional groupings that hold personnel."
        resource="/work-centers"
        rows={rows}
        canEdit
        canDelete
      />
    </div>
  )
}
