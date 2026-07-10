import Link from "next/link"
import { Pencil, Plus } from "lucide-react"
import { DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/page"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { Badge } from "@/components/ui/badge"
import { DocsNav } from "@/components/docs/docs-nav"
import { DocMarkdown, getDocToc } from "@/lib/docs-render"
import type { DocPage } from "@/lib/types"

/** Shared in-shell docs read view: docs nav on the left, the rendered page in
 * the middle, an "On this page" rail on the right. `page` is null when the
 * workspace has no docs yet. We assemble the layout ourselves (rather than
 * fumadocs' <DocsPage>, which requires a <DocsLayout> context) so docs sit
 * inside the app shell. DocsBody/DocsTitle/DocsDescription are context-free. */
export function DocsPageView({
  pages,
  page,
  canEdit,
  basePath,
}: {
  pages: DocPage[]
  page: DocPage | null
  canEdit: boolean
  basePath: string
}) {
  const toc = page ? getDocToc(page.content) : []

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Documentation" },
          ...(page ? [{ label: page.title }] : []),
        ]}
      />
      <div className="flex gap-6">
        <DocsNav
          pages={pages}
          currentSlug={page?.slug ?? null}
          canEdit={canEdit}
        />
        {page ? (
          <>
            <article className="min-w-0 flex-1">
              <div className="mb-2 flex items-start justify-between gap-4">
                <DocsTitle>{page.title}</DocsTitle>
                <div className="mt-1 flex shrink-0 items-center gap-2">
                  {page.is_global && <Badge variant="outline">Global</Badge>}
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
            {toc.length > 0 && (
              <aside className="hidden w-56 shrink-0 xl:block">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  On this page
                </p>
                <ul className="space-y-1 text-sm">
                  {toc.map((item) => (
                    <li
                      key={item.url}
                      style={{ paddingLeft: Math.max(0, item.depth - 1) * 12 }}
                    >
                      <a
                        href={item.url}
                        className="block truncate text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
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
