import { cookies } from "next/headers"
import { type NextRequest } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const API = process.env.API_URL!

export async function GET(req: NextRequest): Promise<Response> {
  const store = await cookies()
  const session = store.get("xcomm_hud_session")
  const headers: HeadersInit = session
    ? { Cookie: `xcomm_hud_session=${session.value}` }
    : {}

  const upstream = await fetch(`${API}/events/stream`, {
    method: "GET",
    headers,
    signal: req.signal,
    cache: "no-store",
  })

  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status || 502 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
