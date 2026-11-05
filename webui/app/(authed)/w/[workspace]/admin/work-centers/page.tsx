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
    is_global: wc.is_global,
    extras: { afsc: wc.afsc },
  }))

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Global" }, { label: "Work centers" }]}
      />
      <SimpleAdmin
        title="Work centers"
        description="The shops people work in and gear is owned by. Shared shops appear in every workspace; add a local one for anyone only this picture accounts for."
        resource="/work-centers"
        rows={rows}
        extraColumns={[{ key: "afsc", label: "AFSC" }]}
        extraFields={[{ key: "afsc", label: "AFSC", placeholder: "3D1X3" }]}
        canEdit
        canDelete
        globalOption
      />
    </div>
  )
}
