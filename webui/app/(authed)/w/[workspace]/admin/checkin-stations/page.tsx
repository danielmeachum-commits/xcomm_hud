import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CheckinStationsAdmin } from "@/components/personnel/checkin-stations-admin"
import type { CheckinStation, Site } from "@/lib/types"

export default async function CheckinStationsAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const [stations, sites] = await Promise.all([
    apiGet<CheckinStation[]>("/checkin-stations").catch(
      () => [] as CheckinStation[],
    ),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Personnel" }, { label: "Check-in stations" }]}
      />
      <CheckinStationsAdmin stations={stations} sites={sites} />
    </div>
  )
}
