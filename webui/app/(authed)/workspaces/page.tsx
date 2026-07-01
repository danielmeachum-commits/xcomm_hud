import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { WorkspacesAdminClient } from "@/components/workspaces-admin-client"
import type { Workspace } from "@/lib/types"

export default async function WorkspacesPage() {
  await requireSession()

  let workspaces: Workspace[] = []
  try {
    workspaces = await apiGet<Workspace[]>("/workspaces")
  } catch {
    // ignore — client will show empty state
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Workspaces" }]} />
      <WorkspacesAdminClient initialWorkspaces={workspaces} />
    </div>
  )
}
