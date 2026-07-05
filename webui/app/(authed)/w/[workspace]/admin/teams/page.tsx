import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { SimpleAdmin, type AdminRow } from "@/components/personnel/simple-admin"
import type { Team } from "@/lib/types"

export default async function TeamsAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const teams = await apiGet<Team[]>("/teams").catch(() => [] as Team[])
  const rows: AdminRow[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    extras: { color: t.color },
  }))

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Admin" }, { label: "Teams" }]} />
      <SimpleAdmin
        title="Teams"
        description="Ad-hoc groupings that span work centers. A person can be on multiple teams."
        resource="/teams"
        rows={rows}
        extraColumns={[{ key: "color", label: "Color" }]}
        extraFields={[
          { key: "color", label: "Color (hex)", placeholder: "#3b82f6" },
        ]}
        canEdit
        canDelete
      />
    </div>
  )
}
