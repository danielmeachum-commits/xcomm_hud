import { notFound, redirect } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { DocPageEditor } from "@/components/docs/doc-page-editor"
import type { DocPage, DocSection, Me } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string; slug: string }>
}

export default async function EditDocPage({ params }: PageProps) {
  const me: Me = await requireSession()
  const { workspace, slug } = await params
  if (me.role !== "operator" && me.role !== "admin") {
    redirect(`/w/${workspace}/docs/${slug}`)
  }
  const [pages, sections] = await Promise.all([
    apiGet<DocPage[]>("/doc-pages").catch(() => [] as DocPage[]),
    apiGet<DocSection[]>("/doc-sections").catch(() => [] as DocSection[]),
  ])
  const page = pages.find((p) => p.slug === slug)
  if (!page) notFound()

  return (
    <DocPageEditor
      mode="edit"
      page={page}
      allPages={pages}
      sections={sections}
      basePath={`/w/${workspace}/docs`}
      canDelete={me.role === "admin"}
    />
  )
}
