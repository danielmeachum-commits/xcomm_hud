import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { RosterAdmin } from "@/components/personnel/roster-admin"
import type { Person, Unit } from "@/lib/types"

export default async function RosterAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const [people, units] = await Promise.all([
    apiGet<Person[]>("/people").catch(() => [] as Person[]),
    apiGet<Unit[]>("/units").catch(() => [] as Unit[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Global" }, { label: "Roster" }]} />
      <RosterAdmin people={people} units={units} />
    </div>
  )
}
