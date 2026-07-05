import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { PersonnelListClient } from "@/components/personnel/personnel-list-client"
import type {
  Personnel,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

export default async function PersonnelListPage() {
  const me = await requireSession()

  const [personnel, workCenters, units, teams, sites] = await Promise.all([
    apiGet<Personnel[]>("/personnel").catch(() => [] as Personnel[]),
    apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
    apiGet<Unit[]>("/units").catch(() => [] as Unit[]),
    apiGet<Team[]>("/teams").catch(() => [] as Team[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Personnel" }]} />
      <PersonnelListClient
        personnel={personnel}
        workCenters={workCenters}
        units={units}
        teams={teams}
        sites={sites}
        userRole={me.role}
      />
    </div>
  )
}
