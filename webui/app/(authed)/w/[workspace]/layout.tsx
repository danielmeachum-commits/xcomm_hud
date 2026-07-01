import { notFound } from "next/navigation"

import { requireSession } from "@/lib/auth"

// Guard: verify the workspace slug in the URL exists for this user. The slug
// itself is honored automatically by every backend call via the
// x-workspace-slug header (set by middleware from this URL segment) — no
// per-page threading required.
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspace: string }>
}) {
  const { workspace: slug } = await params
  const me = await requireSession()
  if (!me.workspaces.some((w) => w.slug === slug)) {
    notFound()
  }
  return <>{children}</>
}
