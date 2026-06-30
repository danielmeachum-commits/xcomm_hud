import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { ServiceTypesAdmin } from "@/components/admin/service-types-admin"
import type { ServiceTemplate } from "@/lib/types"

export default async function ServiceTypesPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  let templates: ServiceTemplate[] = []
  try {
    templates = await apiGet<ServiceTemplate[]>("/service-templates")
  } catch {
    // empty
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Admin" }, { label: "Service catalog" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Service catalog</h1>
        <p className="text-xs text-muted-foreground">
          Standardized service types. New services across sites pick from this
          list so categorization stays consistent. Restrict which statuses each
          type accepts (leave empty to allow all).
        </p>
      </div>
      <ServiceTypesAdmin templates={templates} />
    </div>
  )
}
