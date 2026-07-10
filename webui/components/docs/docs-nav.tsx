"use client"

import Link from "next/link"
import { Globe, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DocPage } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"

interface TreeNode {
  page: DocPage
  children: TreeNode[]
}

/** Build a tree from the flat, shadow-resolved page list. Orphans (parent not
 * in the set — e.g. a global parent shadowed by a workspace page) fall to root. */
function buildTree(pages: DocPage[]): TreeNode[] {
  const byId = new Map<number, DocPage>(pages.map((p) => [p.id, p]))
  const nodes = new Map<number, TreeNode>(
    pages.map((p) => [p.id, { page: p, children: [] }]),
  )
  const roots: TreeNode[] = []
  for (const p of pages) {
    const node = nodes.get(p.id)!
    if (p.parent_id != null && byId.has(p.parent_id)) {
      nodes.get(p.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (list: TreeNode[]) => {
    list.sort(
      (a, b) =>
        a.page.display_order - b.page.display_order ||
        a.page.title.localeCompare(b.page.title),
    )
    list.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

function NavItems({
  nodes,
  currentSlug,
  base,
  depth,
}: {
  nodes: TreeNode[]
  currentSlug: string | null
  base: string
  depth: number
}) {
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l border-border/60 pl-2")}>
      {nodes.map(({ page, children }) => {
        const active = page.slug === currentSlug
        return (
          <li key={page.id}>
            <Link
              href={`${base}/${page.slug}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="truncate">{page.title}</span>
              {page.is_global && (
                <Globe className="ml-auto size-3 shrink-0 opacity-60" aria-label="Global" />
              )}
            </Link>
            {children.length > 0 && (
              <NavItems
                nodes={children}
                currentSlug={currentSlug}
                base={base}
                depth={depth + 1}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function DocsNav({
  pages,
  currentSlug,
  canEdit,
}: {
  pages: DocPage[]
  currentSlug: string | null
  canEdit: boolean
}) {
  const { w } = useWorkspace()
  const base = w("/docs")
  const tree = buildTree(pages)

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documentation
        </span>
        {canEdit && (
          <Link
            href={`${base}/new`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="New page"
          >
            <Plus className="size-3.5" />
            New
          </Link>
        )}
      </div>
      {tree.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No pages yet.</p>
      ) : (
        <NavItems nodes={tree} currentSlug={currentSlug} base={base} depth={0} />
      )}
    </nav>
  )
}
