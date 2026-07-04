import { notFound, redirect } from "next/navigation"

import { apiGet, ApiError } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { SitePropertyTemplateDetail } from "@/components/admin/site-property-template-detail"
import type { SitePropertyTemplate } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string; id: string }>
}

export default async function SitePropertyTemplateDetailPage({
  params,
}: PageProps) {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const { workspace, id } = await params
  const templateId = Number(id)
  if (!Number.isFinite(templateId)) notFound()

  let template: SitePropertyTemplate
  try {
    template = await apiGet<SitePropertyTemplate>(
      `/site-property-templates/${templateId}`,
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Admin" },
          {
            label: "Site properties",
            href: `/w/${workspace}/admin/site-properties`,
          },
          { label: template.name },
        ]}
      />
      <SitePropertyTemplateDetail template={template} />
    </div>
  )
}
