import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

const API = process.env.API_URL!
const WORKSPACE_URL_RE = /\/w\/([^/?#]+)/

// The generic /api/be proxy always responds with application/json, so file
// bytes need this dedicated streaming route.

async function cookieHeader(): Promise<Record<string, string>> {
  const store = await cookies()
  const session = store.get("xcomm_hud_session")
  return session ? { Cookie: `xcomm_hud_session=${session.value}` } : {}
}

function workspaceSlugFromReferer(referer: string | null): string | null {
  if (!referer) return null
  try {
    const url = new URL(referer)
    const match = url.pathname.match(WORKSPACE_URL_RE)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params

  const headers: Record<string, string> = await cookieHeader()
  const explicitSlug = req.headers.get("x-workspace-slug")
  const inferredSlug = workspaceSlugFromReferer(req.headers.get("referer"))
  const slug = explicitSlug ?? inferredSlug
  if (slug) headers["X-Workspace-Slug"] = slug

  // Forward the query string (e.g. ?inline=1) so the API can choose inline
  // vs attachment disposition.
  const upstream = await fetch(
    `${API}/documents/${id}/download${req.nextUrl.search}`,
    {
      method: "GET",
      headers,
      cache: "no-store",
    },
  )

  const responseHeaders = new Headers()
  const contentType = upstream.headers.get("content-type")
  if (contentType) responseHeaders.set("Content-Type", contentType)
  const disposition = upstream.headers.get("content-disposition")
  if (disposition) responseHeaders.set("Content-Disposition", disposition)
  const nosniff = upstream.headers.get("x-content-type-options")
  if (nosniff) responseHeaders.set("X-Content-Type-Options", nosniff)

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}
