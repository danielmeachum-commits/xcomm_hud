import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { DocsPageView } from "@/components/docs/docs-page-view"
import type { DocPage, Me } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string }>
}

export default async function DocsLandingPage({ params }: PageProps) {
  const me: Me = await requireSession()
  const { workspace } = await params
  const canEdit = me.role === "operator" || me.role === "admin"

  const pages = await apiGet<DocPage[]>("/doc-pages").catch(() => [] as DocPage[])
  // Landing shows the "index" page if present, else the first by order.
  const page = pages.find((p) => p.slug === "index") ?? pages[0] ?? null

  return (
    <DocsPageView
      pages={pages}
      page={page}
      canEdit={canEdit}
      basePath={`/w/${workspace}/docs`}
    />
  )
}
