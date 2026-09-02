import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { ForceElementsView } from "@/components/equipment/force-elements-view"
import type { ForceElement } from "@/lib/types"

/** Force elements, on a bare route.
 *
 *  Not under /w/[workspace] like the rest of the equipment pages, because a
 *  force element is not workspace data: `force_element.workspace_id` is
 *  nullable and the global rows are the normal case. Reaching them through one
 *  workspace's operating picture — which is how the ?view= toggle on the
 *  equipment page gets here — implied a scoping that does not exist.
 *
 *  The toggle still works. This is a second door, not a replacement: seeing
 *  force elements against a live picture is worth keeping.
 */
export default async function ForceElementsPage() {
  const me = await requireSession()
  if (me.role !== "admin") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    )
  }

  const forceElements = await apiGet<ForceElement[]>("/force-elements").catch(
    () => [] as ForceElement[],
  )

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Admin" }, { label: "Force elements" }]}
      />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Force elements</h1>
        <p className="text-xs text-muted-foreground">
          The UTCs a deployment brings and exactly which of the unit&apos;s gear
          fills them, pinned by serial from the property book. Held once and
          shared by every workspace, so a package is configured by hand only the
          first time.
        </p>
      </div>
      <ForceElementsView forceElements={forceElements} />
    </div>
  )
}
