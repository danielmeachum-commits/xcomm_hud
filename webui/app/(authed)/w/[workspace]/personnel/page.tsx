import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { PersonnelListClient } from "@/components/personnel/personnel-list-client"
import { KioskPendingPanel } from "@/components/personnel/kiosk-pending-panel"
import type {
  KioskPending,
  Person,
  Personnel,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

export default async function PersonnelListPage() {
  const me = await requireSession()

  const canResolve = me.role !== "viewer"
  const [personnel, roster, workCenters, units, teams, sites, pending] = await Promise.all([
    apiGet<Personnel[]>("/personnel").catch(() => [] as Personnel[]),
    apiGet<Person[]>("/people").catch(() => [] as Person[]),
    apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
    apiGet<Unit[]>("/units").catch(() => [] as Unit[]),
    apiGet<Team[]>("/teams").catch(() => [] as Team[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
    // Cards a check-in station couldn't place; operators resolve them here.
    canResolve
      ? apiGet<KioskPending[]>("/kiosk-pending").catch(() => [] as KioskPending[])
      : Promise.resolve([] as KioskPending[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Personnel" }]} />
      <KioskPendingPanel
        pending={pending}
        roster={roster}
        personnel={personnel}
        units={units}
      />
      <PersonnelListClient
        personnel={personnel.filter((p) => !p.is_guest)}
        roster={roster}
        workCenters={workCenters}
        units={units}
        teams={teams}
        sites={sites}
        userRole={me.role}
      />
    </div>
  )
}
