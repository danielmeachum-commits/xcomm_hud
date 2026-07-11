import Link from "next/link"
import { Pencil, Plus } from "lucide-react"
import { DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/page"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { DocsNav } from "@/components/docs/docs-nav"
import { DocsToc } from "@/components/docs/docs-toc"
import { DocMarkdown, getDocToc } from "@/lib/docs-render"
import type { DocPage, DocSection } from "@/lib/types"

/** Shared in-shell Knowledge Hub read view: docs nav on the left, the rendered
 * page in the middle, an "On this page" rail on the right — all inside a single
 * self-contained floating card. `page` is null when there are no docs yet. */
export function DocsPageView({
  pages,
  sections,
  page,
  canEdit,
  canDelete,
  basePath,
}: {
  pages: DocPage[]
  sections: DocSection[]
  page: DocPage | null
  canEdit: boolean
  canDelete: boolean
  basePath: string
}) {
  const toc = page ? getDocToc(page.content) : []

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Knowledge Hub" },
          ...(page ? [{ label: page.title }] : []),
        ]}
      />
      <div className="flex gap-6 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <DocsNav
          pages={pages}
          sections={sections}
          currentSlug={page?.slug ?? null}
          currentSectionId={page?.section_id ?? null}
          canEdit={canEdit}
          canDelete={canDelete}
        />
        {page ? (
          <>
            <article className="min-w-0 flex-1">
              <div className="mb-2 flex items-start justify-between gap-4">
                <DocsTitle>{page.title}</DocsTitle>
                <div className="mt-1 flex shrink-0 items-center gap-2">
                  {canEdit && (
                    <Link
                      href={`${basePath}/${page.slug}/edit`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Link>
                  )}
                </div>
              </div>
              {page.description && (
                <DocsDescription>{page.description}</DocsDescription>
              )}
              <DocsBody>
                <DocMarkdown content={page.content} />
              </DocsBody>
            </article>
            <DocsToc items={toc} />
          </>
        ) : (
          <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center">
            <p className="text-sm text-muted-foreground">
              No documentation pages yet.
            </p>
            {canEdit && (
              <Link
                href={`${basePath}/new`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-4" />
                Create the first page
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
