"use client"

import { usePathname, useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

const WORKSPACE_URL_RE = /^\/w\/([^/]+)/

import type { Workspace } from "@/lib/types"

interface WorkspaceCtxValue {
  current: Workspace
  all: Workspace[]
  switchTo: (workspaceSlug: string) => void
  /** Prepend the current workspace's /w/<slug> prefix to a path. */
  w: (path: string) => string
}

export function workspacePath(slug: string, path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `/w/${slug}${suffix}`
}

const Ctx = createContext<WorkspaceCtxValue | null>(null)

interface Props {
  initialCurrent: Workspace
  initialAll: Workspace[]
  children: ReactNode
}

export function WorkspaceProvider({
  initialCurrent,
  initialAll,
  children,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [all, setAll] = useState<Workspace[]>(initialAll)

  // Re-sync when the RSC layout re-fetches /me (e.g., after create / import /
  // duplicate / delete on the manage page). Without this, new workspaces
  // appear in the manage table but not in the sidebar switcher until reload.
  useEffect(() => {
    setAll(initialAll)
  }, [initialAll])

  // Derive current from the URL when we're inside a /w/<slug>/... route so
  // the switcher, breadcrumbs, and w() helper follow whatever workspace the
  // user is actually looking at. Fall back to the server-side selection for
  // routes outside the workspace prefix (root, /workspaces, /admin/users…).
  const urlMatch = pathname?.match(WORKSPACE_URL_RE)
  const urlSlug = urlMatch ? decodeURIComponent(urlMatch[1]) : null
  const current = useMemo<Workspace>(() => {
    if (urlSlug) {
      const fromUrl = all.find((w) => w.slug === urlSlug)
      if (fromUrl) return fromUrl
    }
    return initialCurrent
  }, [urlSlug, all, initialCurrent])

  const switchTo = useCallback(
    (workspaceSlug: string) => {
      if (workspaceSlug === current.slug) return
      // Navigate first so the URL becomes the source of truth immediately;
      // the /w/<slug>/... URL then drives current via the useMemo above.
      // Fire-and-forget the /me/workspace POST so `current_workspace_id`
      // tracks last-used for the `/` landing redirect.
      router.push(workspacePath(workspaceSlug, "/sites"))
      router.refresh()
      const target = all.find((w) => w.slug === workspaceSlug)
      if (target) {
        void fetch("/api/be/me/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace_id: target.id }),
        })
      }
    },
    [current.slug, all, router],
  )

  const w = useCallback(
    (path: string) => workspacePath(current.slug, path),
    [current.slug],
  )

  const value = useMemo<WorkspaceCtxValue>(
    () => ({ current, all, switchTo, w }),
    [current, all, switchTo, w],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): WorkspaceCtxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useWorkspace must be inside WorkspaceProvider")
  return v
}
