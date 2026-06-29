import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete("xcomm_hud_session")

  // Also tell the API to invalidate the session
  const API = process.env.API_URL
  if (API) {
    try {
      const session = cookieStore.get("xcomm_hud_session")
      await fetch(`${API}/auth/logout`, {
        method: "POST",
        headers: session ? { Cookie: `xcomm_hud_session=${session.value}` } : {},
        cache: "no-store",
      })
    } catch {
      // Ignore — local cookie is deleted regardless
    }
  }

  return NextResponse.json({ ok: true })
}
