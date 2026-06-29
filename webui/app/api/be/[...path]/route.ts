import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

const API = process.env.API_URL!

async function cookieHeader(): Promise<HeadersInit> {
  const store = await cookies()
  const session = store.get("xcomm_hud_session")
  return session ? { Cookie: `xcomm_hud_session=${session.value}` } : {}
}

async function proxy(req: NextRequest, path: string): Promise<NextResponse> {
  const search = req.nextUrl.search
  const url = `${API}/${path}${search}`

  const authHeader = await cookieHeader()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...authHeader,
  }

  let body: string | undefined
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = await req.text()
  }

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
  })

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 })
  }

  const data = await upstream.text()
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  })
}

type RouteContext = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(req, path.join("/"))
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(req, path.join("/"))
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(req, path.join("/"))
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(req, path.join("/"))
}
