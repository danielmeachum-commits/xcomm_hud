import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EnclavesClient } from "@/components/enclaves/enclaves-client"
import { apiGet } from "@/lib/api"
import { requireSession } from "@/lib/auth"
import type { Enclave } from "@/lib/types"

export default async function EnclavesPage({
  params,
}: {
  params: Promise<{ workspace: string }>
}) {
  await params
  const me = await requireSession()

  const enclaves = await apiGet<Enclave[]>("/enclaves").catch(
    () => [] as Enclave[],
  )

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Enclaves" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Enclaves</h1>
        <p className="text-xs text-muted-foreground">
          The networks gear and services sit on. Transport is the colorless
          layer everything else rides on. An enclave is not a classification
          level — the two correlate, but they answer different questions.
        </p>
      </div>
      <EnclavesClient enclaves={enclaves} isAdmin={me.role === "admin"} />
    </div>
  )
}
