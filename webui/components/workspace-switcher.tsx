"use client"

import Link from "next/link"
import { Check, ChevronsUpDown, Layers, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useWorkspace } from "@/lib/workspace"
import type { Workspace } from "@/lib/types"

const ARCHIVED_TAG = "archived"

function isArchived(ws: Workspace): boolean {
  return ws.tags.includes(ARCHIVED_TAG)
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          {t}
        </span>
      ))}
    </div>
  )
}

export function WorkspaceSwitcher() {
  const { current, all, switchTo } = useWorkspace()

  const active = all.filter((w) => !isArchived(w))
  const archived = all.filter(isArchived)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={current.name}
                className="data-open:bg-sidebar-accent"
              >
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Layers className="size-4" />
                </div>
                <div className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate font-heading text-sm font-semibold tracking-tight">
                    {current.name}
                  </span>
                  {current.tags.length > 0 && (
                    <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                      {current.tags.join(" · ")}
                    </span>
                  )}
                </div>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            side="right"
            align="start"
            className="min-w-64"
          >
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              Workspaces
            </div>
            <DropdownMenuGroup>
              {active.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => switchTo(ws.slug)}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{ws.name}</span>
                    <TagChips tags={ws.tags} />
                  </div>
                  {ws.id === current.id && (
                    <Check className="ml-2 size-4 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {archived.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Archived
                </div>
                <DropdownMenuGroup>
                  {archived.map((ws) => (
                    <DropdownMenuItem
                      key={ws.id}
                      onClick={() => switchTo(ws.slug)}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-muted-foreground">
                          {ws.name}
                        </span>
                        <TagChips tags={ws.tags} />
                      </div>
                      {ws.id === current.id && (
                        <Check className="ml-2 size-4 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link href="/workspaces" />}>
                <Plus data-icon="inline-start" />
                Manage workspaces
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
