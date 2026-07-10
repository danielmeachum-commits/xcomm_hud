import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { DocsPageView } from "@/components/docs/docs-page-view"
import type { DocPage, Me } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string; slug: string }>
}

export default async function DocsReadPage({ params }: PageProps) {
  const me: Me = await requireSession()
  const { workspace, slug } = await params
  const canEdit = me.role === "operator" || me.role === "admin"

  const pages = await apiGet<DocPage[]>("/doc-pages").catch(() => [] as DocPage[])
  const page = pages.find((p) => p.slug === slug)
  if (!page) notFound()

  return (
    <DocsPageView
      pages={pages}
      page={page}
      canEdit={canEdit}
      basePath={`/w/${workspace}/docs`}
    />
  )
}
