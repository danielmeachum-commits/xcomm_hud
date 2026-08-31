import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { AppSidebar } from "@/components/app-sidebar"
import { BreadcrumbsProvider } from "@/components/breadcrumbs"
import { LiveUpdatesProvider } from "@/components/live-updates-provider"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { WorkspaceProvider } from "@/lib/workspace"
import type { Site } from "@/lib/types"

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireSession()

  let sites: Site[] = []
  try {
    sites = await apiGet<Site[]>("/sites")
  } catch {
    // API unavailable — sidebar shows Sites without submenu
  }

  return (
    <div className="theme-class-U">
      <BreadcrumbsProvider>
        {/* LiveUpdatesProvider lives here (not root) so SSE only runs while authed */}
        <LiveUpdatesProvider>
          <WorkspaceProvider
            initialCurrent={user.current_workspace}
            initialAll={user.workspaces}
          >
            {/* The shell is exactly one viewport tall, which makes the
                scroll pane below the real scroller. Without a definite height
                here the wrapper's `min-h-svh` lets the whole shell grow and the
                document scrolls instead — the pane's `overflow-auto` then never
                fires, and anything inside it positioned `sticky` pins to a box
                that is itself off-screen. */}
            <SidebarProvider className="h-svh overflow-hidden">
              <AppSidebar user={user} sites={sites} />
              <SidebarInset>
                <SiteHeader />
                {/* `min-w-0` for the same reason as `min-h-0`: without it a
                    wide child sets this column's width and the pane grows
                    instead of scrolling. */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
                  {children}
                </div>
              </SidebarInset>
            </SidebarProvider>
          </WorkspaceProvider>
        </LiveUpdatesProvider>
      </BreadcrumbsProvider>
    </div>
  )
}
