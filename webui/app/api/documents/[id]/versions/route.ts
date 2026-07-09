import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

const API = process.env.API_URL!
const WORKSPACE_URL_RE = /\/w\/([^/?#]+)/

// The generic /api/be proxy hardcodes Content-Type: application/json and
// reads the body as text, so it can't carry multipart uploads. This route
// forwards FormData straight through — fetch sets the multipart boundary.

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

export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params

  const headers: Record<string, string> = await cookieHeader()
  const explicitSlug = req.headers.get("x-workspace-slug")
  const inferredSlug = workspaceSlugFromReferer(req.headers.get("referer"))
  const slug = explicitSlug ?? inferredSlug
  if (slug) headers["X-Workspace-Slug"] = slug

  const form = await req.formData()

  const upstream = await fetch(`${API}/documents/${id}/versions`, {
    method: "POST",
    headers,
    body: form,
    cache: "no-store",
  })

  const data = await upstream.text()
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  })
}
