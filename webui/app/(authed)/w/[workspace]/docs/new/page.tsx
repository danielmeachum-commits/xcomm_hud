import { redirect } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { DocPageEditor } from "@/components/docs/doc-page-editor"
import type { DocPage, Me } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string }>
}

export default async function NewDocPage({ params }: PageProps) {
  const me: Me = await requireSession()
  const { workspace } = await params
  if (me.role !== "operator" && me.role !== "admin") {
    redirect(`/w/${workspace}/docs`)
  }
  const pages = await apiGet<DocPage[]>("/doc-pages").catch(() => [] as DocPage[])

  return (
    <DocPageEditor
      mode="create"
      allPages={pages}
      basePath={`/w/${workspace}/docs`}
      canDelete={me.role === "admin"}
    />
  )
}
