import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CheckinLog } from "@/components/personnel/checkin-log"
import { RANGES, type RangeKey } from "@/lib/checkin-ranges"
import type { CheckinActivity } from "@/lib/types"

/** Door activity from the CAC check-in stations — kept here for the desk
 *  rather than on the kiosk screen, which only shows the person in front
 *  of it. Refreshes live with every scan. */
export default async function CheckinLogPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; station?: string }>
}) {
  await requireSession()
  const sp = await searchParams
  const range: RangeKey = sp.range && sp.range in RANGES ? (sp.range as RangeKey) : "24h"
  const params = new URLSearchParams({
    hours: String(RANGES[range].hours),
    limit: "1000",
  })
  if (sp.station) params.set("station_id", sp.station)

  const rows = await apiGet<CheckinActivity[]>(
    `/checkin-activity?${params.toString()}`,
  ).catch(() => [] as CheckinActivity[])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Personnel" }, { label: "Check-in log" }]}
      />
      <CheckinLog rows={rows} range={range} station={sp.station ?? ""} />
    </div>
  )
}
