"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { apiPostRaw } from "@/lib/api"

export type LoginResult = { ok: true } | { ok: false; error: string }

export async function login(
  _prevState: LoginResult | null,
  formData: FormData,
): Promise<LoginResult> {
  const username = formData.get("username") as string
  const password = formData.get("password") as string

  if (!username || !password) {
    return { ok: false, error: "Username and password are required." }
  }

  let res: Response
  try {
    res = await apiPostRaw("/auth/login", { username, password })
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error. Try again.",
    }
  }

  if (!res.ok) {
    let detail = "Invalid credentials."
    try {
      const body = await res.json()
      if (typeof body?.detail === "string") detail = body.detail
    } catch {
      // ignore
    }
    return { ok: false, error: detail }
  }

  // Forward the httpOnly cookie set by the API
  const setCookie = res.headers.get("set-cookie")
  if (setCookie) {
    // Parse "xcomm_hud_session=<value>; Path=/; ..." — split only on the FIRST '='
    // since the itsdangerous token can contain '=' padding chars.
    const parts = setCookie.split(";").map((p) => p.trim())
    const nameVal = parts[0]
    const eqIdx = nameVal.indexOf("=")
    const value = eqIdx >= 0 ? nameVal.substring(eqIdx + 1) : nameVal

    const cookieStore = await cookies()
    cookieStore.set("xcomm_hud_session", value, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      // Inherit secure flag from API's cookie if present
      secure: setCookie.toLowerCase().includes("secure"),
    })
  }

  redirect("/")
}
