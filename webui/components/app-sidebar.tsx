"use client"

import { useDashboard } from "@/components/dashboard/dashboard-context"
import { SidebarEditor } from "@/components/dashboard/sidebar-editor"

export function AppSidebar() {
  const { editMode } = useDashboard()

  if (!editMode) return null

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="border-b border-sidebar-border px-4 pt-5 pb-4">
        <h2 className="font-heading text-base font-semibold tracking-tight text-sidebar-foreground">
          Edit dashboard
        </h2>
      </div>

      <div className="min-h-0 flex-1">
        <SidebarEditor />
      </div>
    </aside>
  )
}
