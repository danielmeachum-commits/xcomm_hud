import { NextResponse, type NextRequest } from "next/server"

// Extracts the workspace slug from URLs like /w/<slug>/... and forwards it
// via the `x-workspace-slug` request header. Server components and the
// `/api/be/*` proxy read this header to scope backend calls to the workspace
// shown in the URL — making the URL, not server-side session state, the
// authoritative "which workspace am I in" signal.

const WORKSPACE_PREFIX = /^\/w\/([^/]+)(?:\/|$)/

export function proxy(req: NextRequest) {
  const match = req.nextUrl.pathname.match(WORKSPACE_PREFIX)
  if (!match) return NextResponse.next()

  const slug = decodeURIComponent(match[1])
  const headers = new Headers(req.headers)
  headers.set("x-workspace-slug", slug)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Skip static assets and Next internals; run on everything else so both
  // /w/<slug>/... page routes AND client-side fetches to /api/be/* get the
  // header (client fetches inherit the browser URL, not the middleware URL,
  // so we also handle that in the fetch client).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
