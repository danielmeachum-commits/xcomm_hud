import { requireSession } from "@/lib/auth"
import { AppSidebar } from "@/components/app-sidebar"
import { TopNav } from "@/components/top-nav"
import { SidebarProvider } from "@/components/ui/sidebar"
import { DashboardProvider } from "@/components/dashboard/dashboard-context"

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireSession()

  return (
    <div className="theme-class-U">
      <DashboardProvider username={user.username}>
        <SidebarProvider className="!min-h-svh !flex-col">
          <TopNav user={user} />
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <main className="flex-1 overflow-auto bg-background">
              {children}
            </main>
          </div>
        </SidebarProvider>
      </DashboardProvider>
    </div>
  )
}
