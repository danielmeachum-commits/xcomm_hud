import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { TeamsAdmin } from "@/components/personnel/teams-admin"
import type { Personnel, Team, WorkCenter } from "@/lib/types"

export default async function TeamsAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const [teams, workCenters, personnel] = await Promise.all([
    apiGet<Team[]>("/teams").catch(() => [] as Team[]),
    apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
    apiGet<Personnel[]>("/personnel").catch(() => [] as Personnel[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Admin" }, { label: "Teams" }]} />
      <TeamsAdmin
        teams={teams}
        workCenters={workCenters}
        personnel={personnel.filter((p) => !p.is_guest)}
        canEdit
        canDelete
      />
    </div>
  )
}
