import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { DocumentsBrowser } from "@/components/documents/documents-browser"
import type { Document, Folder } from "@/lib/types"

export default async function DocumentsPage() {
  await requireSession()

  // Workspace-level scope — no site_id filter.
  const [folders, documents] = await Promise.all([
    apiGet<Folder[]>("/folders").catch(() => [] as Folder[]),
    apiGet<Document[]>("/documents").catch(() => [] as Document[]),
  ])

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Documents" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Documents</h1>
          <p className="text-xs text-muted-foreground">
            Shared files and folders for this workspace.
          </p>
        </div>
      </div>

      <DocumentsBrowser folders={folders} documents={documents} />
    </div>
  )
}
