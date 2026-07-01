import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { AppSidebar } from "@/components/app-sidebar"
import { BreadcrumbsProvider } from "@/components/breadcrumbs"
import { LiveUpdatesProvider } from "@/components/live-updates-provider"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
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
          <SidebarProvider>
            <AppSidebar user={user} sites={sites} />
            <SidebarInset>
              <SiteHeader />
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                {children}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </LiveUpdatesProvider>
      </BreadcrumbsProvider>
    </div>
  )
}
