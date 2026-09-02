import { notFound, redirect } from "next/navigation"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { ServiceTypeDetailClient } from "@/components/admin/service-type-detail-client"
import { ApiError, apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave, ServiceTemplate } from "@/lib/types"

/** One service type: what a service created from this template starts out as,
 *  and which statuses its instances may be set to.
 *
 *  Same shape as the equipment type and UTC definition pages. The catalog is
 *  global rather than workspace-scoped, so the path has no `/w/<slug>` in it
 *  and the breadcrumb points straight back at the list. */
export default async function ServiceTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  // Enclaves come down with the template because the editor needs every one
  // on offer, not just the one already picked.
  const [template, enclaves] = await Promise.all([
    apiGet<ServiceTemplate>(`/service-templates/${id}`).catch(
      (err: unknown) => {
        // A missing row is this page's 404; anything else is a real fault and
        // should surface as one rather than as "no such type".
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      },
    ),
    apiGet<Enclave[]>("/enclaves").catch(() => [] as Enclave[]),
  ])
  if (!template) notFound()

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Admin" },
          { label: "Services", href: "/admin/service-types" },
          { label: template.name },
        ]}
      />
      <ServiceTypeDetailClient template={template} enclaves={enclaves} />
    </div>
  )
}
