import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { SitePropertyTemplatesAdmin } from "@/components/admin/site-property-templates-admin"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import type { SitePropertyTemplate } from "@/lib/types"

export default async function SitePropertyTemplatesPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  let templates: SitePropertyTemplate[] = []
  try {
    templates = await apiGet<SitePropertyTemplate[]>("/site-property-templates")
  } catch {
    // empty
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Admin" }, { label: "Site properties" }]}
      />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Site properties</h1>
        <p className="text-xs text-muted-foreground">
          Templates of typed key-value fields (phone, email, number, date…)
          that can be applied to any site in this workspace. Duplicate or
          export a template to reuse it elsewhere.
        </p>
      </div>
      <SitePropertyTemplatesAdmin templates={templates} />
    </div>
  )
}
