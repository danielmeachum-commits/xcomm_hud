import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { GatewaysAdmin } from "@/components/admin/gateways-admin"
import { Breadcrumbs } from "@/components/breadcrumbs"
import type { Gateway, Site } from "@/lib/types"

export default async function GatewaysAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") redirect("/")

  const [gateways, sites] = await Promise.all([
    apiGet<Gateway[]>("/gateways").catch(() => [] as Gateway[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: "Admin" }, { label: "Gateways" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Gateways</h1>
        <p className="text-xs text-muted-foreground">
          All gateways across sites. Sort by PACE to see priority at a glance;
          inline-edit kind, provider, or PACE.
        </p>
      </div>
      <GatewaysAdmin gateways={gateways} sites={sites} />
    </div>
  )
}
