"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Activity,
  Bell,
  ChevronRight,
  ChevronUp,
  LogOut,
  MapPin,
  Network,
  Radio,
  Settings,
  Users,
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
import { statusToIndicatorState } from "@/lib/status"
import type { Me, Site } from "@/lib/types"
import { cn } from "@/lib/utils"

const SECONDARY_NAV_ITEMS = [
  { href: "/services", label: "Services", icon: Radio },
  { href: "/events", label: "Events", icon: Bell },
]

const ADMIN_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/service-types", label: "Service catalog", icon: Settings },
  { href: "/admin/gateways", label: "Gateways", icon: Network },
]

interface Props {
  user: Me
  sites: Site[]
  title?: string
}

export function AppSidebar({ user, sites, title = "xCOMM HUD" }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = user.role === "admin"
  const onSitesRoute =
    pathname === "/sites" || pathname.startsWith("/sites/")
  const [sitesOpen, setSitesOpen] = useState(onSitesRoute)

  useEffect(() => {
    if (onSitesRoute) setSitesOpen(true)
  }, [onSitesRoute])

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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/sites" />}
              tooltip={title}
            >
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Activity className="size-4" />
              </div>
              <span className="truncate font-heading text-sm font-semibold tracking-tight">
                {title}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive("/sites")}
                  tooltip="Sites"
                  render={<Link href="/sites" />}
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
                              isActive={pathname === `/sites/${s.id}`}
                              render={<Link href={`/sites/${s.id}`} />}
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

              {SECONDARY_NAV_ITEMS.map((item) => (
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

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_ITEMS.map((item) => (
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
                <DropdownMenuItem onSelect={handleLogout}>
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
