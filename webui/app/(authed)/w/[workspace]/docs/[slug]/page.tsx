import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { DocsPageView } from "@/components/docs/docs-page-view"
import type { DocPage, DocSection, Me } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string; slug: string }>
}

export default async function DocsReadPage({ params }: PageProps) {
  const me: Me = await requireSession()
  const { workspace, slug } = await params
  const canEdit = me.role === "operator" || me.role === "admin"

  const [pages, sections] = await Promise.all([
    apiGet<DocPage[]>("/doc-pages").catch(() => [] as DocPage[]),
    apiGet<DocSection[]>("/doc-sections").catch(() => [] as DocSection[]),
  ])
  const page = pages.find((p) => p.slug === slug)
  if (!page) notFound()

  return (
    <DocsPageView
      pages={pages}
      sections={sections}
      page={page}
      canEdit={canEdit}
      basePath={`/w/${workspace}/docs`}
    />
  )
}
