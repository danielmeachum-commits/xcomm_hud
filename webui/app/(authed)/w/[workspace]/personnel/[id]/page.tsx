import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet, ApiError } from "@/lib/api"
import { PersonnelDetailClient } from "@/components/personnel/personnel-detail-client"
import type {
  Personnel,
  PersonnelLocationEvent,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PersonnelDetailPage({ params }: PageProps) {
  const me = await requireSession()
  const { id } = await params
  const pid = Number(id)
  if (!Number.isFinite(pid)) notFound()

  let person: Personnel
  try {
    person = await apiGet<Personnel>(`/personnel/${pid}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  const [allPersonnel, workCenters, units, teams, sites, history] =
    await Promise.all([
      apiGet<Personnel[]>("/personnel").catch(() => [] as Personnel[]),
      apiGet<WorkCenter[]>("/work-centers").catch(() => [] as WorkCenter[]),
      apiGet<Unit[]>("/units").catch(() => [] as Unit[]),
      apiGet<Team[]>("/teams").catch(() => [] as Team[]),
      apiGet<Site[]>("/sites").catch(() => [] as Site[]),
      apiGet<PersonnelLocationEvent[]>(`/personnel/${pid}/history`).catch(
        () => [] as PersonnelLocationEvent[],
      ),
    ])

  return (
    <PersonnelDetailClient
      person={person}
      allPersonnel={allPersonnel}
      workCenters={workCenters}
      units={units}
      teams={teams}
      sites={sites}
      history={history}
      userRole={me.role}
    />
  )
}
