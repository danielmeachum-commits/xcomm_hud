"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
  Bell,
  Blocks,
  BookOpen,
  Boxes,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileText,
  Flag,
  Globe,
  HardDrive,
  Layers,
  LayoutTemplate,
  ListChecks,
  LogOut,
  MapPin,
  Network,
  Package,
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
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { statusToIndicatorState } from "@/lib/status"
import type { Me, Site } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const SECONDARY_NAV_ITEMS = [
  { path: "/services", label: "Services", icon: Radio },
  { path: "/equipment", label: "Equipment", icon: HardDrive },
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
// truly global admin items follow with absolute paths. Split around the
// Templates submenu, which sits between the two halves.
const WORKSPACE_ADMIN_ITEMS_TOP = [
  { path: "/settings/event-types", label: "Event types", icon: Shapes },
  { path: "/settings/rules", label: "Rules", icon: Workflow },
  { path: "/admin/gateways", label: "Gateways", icon: Network },
]

// The reference collections, read top-down: a package composes UTCs, a UTC
// composes equipment types. Three pages rather than one tabbed catalog, so
// each is a place you can link to and come back to.
const TEMPLATE_ITEMS = [
  { path: "/admin/packages", label: "Packages", icon: Blocks },
  { path: "/admin/utcs", label: "UTCs", icon: Boxes },
  { path: "/admin/equipment-types", label: "Equipment types", icon: Radio },
]

const WORKSPACE_ADMIN_ITEMS_REST = [
  // Templates say what a TACLANE is; the property book says which ones we own.
  // Adjacent on purpose.
  { path: "/admin/property-book", label: "Property book", icon: Package },
  { path: "/admin/enclaves", label: "Enclaves", icon: Layers },
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

  // Admin and its Templates submenu open themselves when you're already
  // inside them. Both start closed, so without this every navigation within
  // Admin folded the sidebar shut over the page you had just opened.
  const onRoute = (href: string) =>
    pathname === href || pathname.startsWith(href + "/")
  const onTemplatesRoute = TEMPLATE_ITEMS.some((item) => onRoute(w(item.path)))
  const onAdminRoute =
    onTemplatesRoute ||
    [...WORKSPACE_ADMIN_ITEMS_TOP, ...WORKSPACE_ADMIN_ITEMS_REST].some((item) =>
      onRoute(w(item.path)),
    ) ||
    GLOBAL_ADMIN_ITEMS.some((item) => onRoute(item.href))
  const [adminOpen, setAdminOpen] = useState(onAdminRoute)
  const [templatesOpen, setTemplatesOpen] = useState(onTemplatesRoute)

  useEffect(() => {
    if (onAdminRoute) setAdminOpen(true)
  }, [onAdminRoute])

  useEffect(() => {
    if (onTemplatesRoute) setTemplatesOpen(true)
  }, [onTemplatesRoute])

  // The nav is taller than the pane it sits in — 20-odd rows against a 560px
  // sidebar on a 720px screen — so the item you are ON can land below the
  // fold, and the scroll pane starts at the top. Bring it into view whenever
  // the route or an open group changes what is where. `nearest` so an item
  // already visible is left exactly where it is.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    contentRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest" })
  }, [pathname, adminOpen, templatesOpen, sitesOpen, personnelOpen])

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

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent ref={contentRef}>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={onRoute(sitesHref)}
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
                      isActive={onRoute(href)}
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
                  isActive={onRoute(personnelHref)}
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
                      isActive={onRoute(href)}
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
            <SidebarGroupLabel
              render={
                <button
                  type="button"
                  onClick={() => setAdminOpen((o) => !o)}
                  className="flex w-full items-center justify-between"
                />
              }
            >
              <span>Admin</span>
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  adminOpen && "rotate-90",
                )}
              />
            </SidebarGroupLabel>
            {adminOpen && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {WORKSPACE_ADMIN_ITEMS_TOP.map((item) => {
                    const href = w(item.path)
                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          isActive={onRoute(href)}
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
                    {/* A toggle, not a link: Templates is a heading for the
                        three pages under it and has no page of its own. Its
                        own row shows active only while collapsed, so the
                        highlight is never on two rows at once. */}
                    <SidebarMenuButton
                      onClick={() => setTemplatesOpen((v) => !v)}
                      isActive={onTemplatesRoute && !templatesOpen}
                      tooltip="Templates"
                      aria-expanded={templatesOpen}
                    >
                      <LayoutTemplate />
                      <span>Templates</span>
                      <ChevronRight
                        className={cn(
                          "ml-auto size-4 transition-transform duration-150",
                          templatesOpen && "rotate-90",
                        )}
                      />
                    </SidebarMenuButton>
                    {templatesOpen && (
                      <SidebarMenuSub>
                        {TEMPLATE_ITEMS.map((item) => {
                          const href = w(item.path)
                          return (
                            <SidebarMenuSubItem key={href}>
                              <SidebarMenuSubButton
                                isActive={onRoute(href)}
                                render={<Link href={href} />}
                              >
                                <item.icon />
                                <span>{item.label}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          )
                        })}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>

                  {[
                    ...WORKSPACE_ADMIN_ITEMS_REST.map((item) => ({
                      ...item,
                      href: w(item.path),
                    })),
                    ...GLOBAL_ADMIN_ITEMS,
                  ].map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={onRoute(item.href)}
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
            )}
          </SidebarGroup>
        )}

        {/* Global scope — shared across every workspace, set apart from the
            workspace-scoped nav above. Room for more global areas later. */}
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel className="gap-1.5">
            <Globe className="size-3" />
            Global
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Knowledge Hub — shared across all workspaces"
                  isActive={onRoute(w("/docs"))}
                  render={<Link href={w("/docs")} />}
                >
                  <BookOpen data-icon="inline-start" />
                  <span>Knowledge Hub</span>
                </SidebarMenuButton>
                <SidebarMenuAction
                  showOnHover
                  title="Open in new tab"
                  aria-label="Open Knowledge Hub in a new tab"
                  render={
                    <a
                      href={w("/docs")}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLink />
                </SidebarMenuAction>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
