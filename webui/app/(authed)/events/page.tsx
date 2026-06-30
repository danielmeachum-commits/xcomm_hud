import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EventsTable } from "@/components/events/events-table"
import type { Validation } from "@/lib/types"

export default async function EventsPage() {
  await requireSession()
  let validations: Validation[] = []
  try {
    validations = await apiGet<Validation[]>("/validations?limit=1000")
  } catch {
    // ignore
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Events" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Validation events</h1>
        <p className="text-xs text-muted-foreground">
          Append-only history. Sort by any column, filter by site/kind/status,
          search across subject and notes.
        </p>
      </div>
      <EventsTable validations={validations} />
    </div>
  )
}
