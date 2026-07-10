"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Bell,
  BookOpen,
  ChevronRight,
  ChevronUp,
  FileText,
  Flag,
  ListChecks,
  LogOut,
  MapPin,
  Network,
  Radio,
  Settings,
  Shapes,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { statusToIndicatorState } from "@/lib/status"
import type { Me, Site } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const SECONDARY_NAV_ITEMS = [
  { path: "/services", label: "Services", icon: Radio },
  { path: "/events", label: "Events", icon: Bell },
  { path: "/documents", label: "Documents", icon: FileText },
]

// Quick links to the personnel structure graphs (?view=graph&graph=…).
const PERSONNEL_SUB_ITEMS = [
  { search: "?view=graph", graph: "org", label: "Org chart", icon: Flag },
  {
    search: "?view=graph&graph=teams",
    graph: "teams",
    label: "Teams",
    icon: UsersRound,
  },
]

// Workspace-scoped admin items (gateways lives under the current workspace);
// truly global admin items follow with absolute paths.
const WORKSPACE_ADMIN_ITEMS = [
  { path: "/settings/event-types", label: "Event types", icon: Shapes },
  { path: "/settings/rules", label: "Rules", icon: Workflow },
  { path: "/admin/gateways", label: "Gateways", icon: Network },
  { path: "/admin/site-properties", label: "Site properties", icon: ListChecks },
  { path: "/admin/work-centers", label: "Work centers", icon: Users },
  { path: "/admin/teams", label: "Teams", icon: Users },
  { path: "/admin/units", label: "Units", icon: Users },
]
const GLOBAL_ADMIN_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/service-types", label: "Service catalog", icon: Settings },
]

interface Props {
  user: Me
  sites: Site[]
  title?: string
}

export function AppSidebar({ user, sites }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { w } = useWorkspace()
  const isAdmin = user.role === "admin"
  const sitesHref = w("/sites")
  const onSitesRoute =
    pathname === sitesHref || pathname.startsWith(sitesHref + "/")
  const [sitesOpen, setSitesOpen] = useState(onSitesRoute)

  useEffect(() => {
    if (onSitesRoute) setSitesOpen(true)
  }, [onSitesRoute])

  const personnelHref = w("/personnel")
  const onPersonnelRoute =
    pathname === personnelHref || pathname.startsWith(personnelHref + "/")
  const [personnelOpen, setPersonnelOpen] = useState(onPersonnelRoute)

  useEffect(() => {
    if (onPersonnelRoute) setPersonnelOpen(true)
  }, [onPersonnelRoute])

  // Which structure graph the roster page is showing, if any — mirrors the
  // page's URL params (?view=graph&graph=…, org when graph is omitted).
  const activeGraph =
    pathname === personnelHref && searchParams.get("view") === "graph"
      ? (searchParams.get("graph") ?? "org")
      : null

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/")

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive(sitesHref)}
                  tooltip="Sites"
                  render={<Link href={sitesHref} />}
                >
                  <MapPin />
                  <span>Sites</span>
                </SidebarMenuButton>
                {sites.length > 0 && (
                  <>
                    <SidebarMenuAction
                      onClick={() => setSitesOpen((v) => !v)}
                      aria-label={sitesOpen ? "Collapse sites" : "Expand sites"}
                      aria-expanded={sitesOpen}
                    >
                      <ChevronRight
                        className={cn(
                          "transition-transform duration-150",
                          sitesOpen && "rotate-90",
                        )}
                      />
                    </SidebarMenuAction>
                    {sitesOpen && (
                      <SidebarMenuSub>
                        {sites.map((s) => (
                          <SidebarMenuSubItem key={s.id}>
                            <SidebarMenuSubButton
                              isActive={pathname === w(`/sites/${s.id}`)}
                              render={<Link href={w(`/sites/${s.id}`)} />}
                            >
                              <StatusIndicator
                                state={statusToIndicatorState(s.status)}
                                size="sm"
                              />
                              <span>{s.name}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </>
                )}
              </SidebarMenuItem>

              {SECONDARY_NAV_ITEMS.slice(0, 1).map((item) => {
                const href = w(item.path)
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive(href)}
                      tooltip={item.label}
                      render={<Link href={href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive(personnelHref)}
                  tooltip="Personnel"
                  render={<Link href={personnelHref} />}
                >
                  <Users />
                  <span>Personnel</span>
                </SidebarMenuButton>
                <SidebarMenuAction
                  onClick={() => setPersonnelOpen((v) => !v)}
                  aria-label={
                    personnelOpen
                      ? "Collapse personnel views"
                      : "Expand personnel views"
                  }
                  aria-expanded={personnelOpen}
                >
                  <ChevronRight
                    className={cn(
                      "transition-transform duration-150",
                      personnelOpen && "rotate-90",
                    )}
                  />
                </SidebarMenuAction>
                {personnelOpen && (
                  <SidebarMenuSub>
                    {PERSONNEL_SUB_ITEMS.map((item) => (
                      <SidebarMenuSubItem key={item.graph}>
                        <SidebarMenuSubButton
                          isActive={activeGraph === item.graph}
                          render={
                            <Link href={`${personnelHref}${item.search}`} />
                          }
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {SECONDARY_NAV_ITEMS.slice(1).map((item) => {
                const href = w(item.path)
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive(href)}
                      tooltip={item.label}
                      render={<Link href={href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {[
                  ...WORKSPACE_ADMIN_ITEMS.map((item) => ({
                    ...item,
                    href: w(item.path),
                  })),
                  ...GLOBAL_ADMIN_ITEMS,
                ].map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item.href)}
                      tooltip={item.label}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Docs live at the top-level /docs route (not workspace-scoped). */}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Documentation"
              isActive={isActive("/docs")}
              render={<Link href="/docs" />}
            >
              <BookOpen data-icon="inline-start" />
              <span>Documentation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={user.display_name || user.username}
                    className="data-open:bg-sidebar-accent"
                  >
                    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold uppercase">
                      {(user.display_name || user.username).slice(0, 2)}
                    </div>
                    <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {user.display_name || user.username}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user.role}
                      </span>
                    </div>
                    <ChevronUp className="ml-auto size-4 text-muted-foreground" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent
                side="right"
                align="end"
                className="min-w-56"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Signed in as {user.username}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut data-icon="inline-start" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
