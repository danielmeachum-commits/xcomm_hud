import { cookies, headers } from "next/headers"

const API = process.env.API_URL!

async function getForwardHeaders(): Promise<HeadersInit> {
  const cookieStore = await cookies()
  const session = cookieStore.get("xcomm_hud_session")
  const out: Record<string, string> = {}
  if (session) out["Cookie"] = `xcomm_hud_session=${session.value}`
  // The middleware injects `x-workspace-slug` for URLs matching /w/<slug>/...
  // Forward it so backend endpoints scope to the workspace shown in the URL.
  const reqHeaders = await headers()
  const slug = reqHeaders.get("x-workspace-slug")
  if (slug) out["X-Workspace-Slug"] = slug
  return out
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
    this.name = "ApiError"
  }
}

// Page components routinely swallow failures to keep rendering — the
// `apiGet<T>(...).catch(() => [])` pattern is everywhere — which means a broken
// endpoint shows up as an empty table with no clue that anything went wrong.
// Logging here, at the one place every request passes through, guarantees a
// trace in the server logs no matter what the caller does with the rejection.
// 401 is excluded: that is the ordinary unauthenticated path, where the caller
// redirects to /login rather than hiding a real fault.
function logFailure(
  method: string,
  path: string,
  status: number | null,
  detail: string,
) {
  if (status === 401) return
  console.error(
    `[api] ${method} ${path} failed (${status ?? "no response"}): ${detail.slice(0, 500)}`,
  )
}

async function handleResponse<T>(
  method: string,
  path: string,
  res: Response,
): Promise<T> {
  if (!res.ok) {
    const raw = await res.text()
    let detail = res.statusText
    try {
      const body = JSON.parse(raw)
      if (typeof body?.detail === "string") detail = body.detail
    } catch {
      // ignore parse errors
    }
    logFailure(method, path, res.status, raw || detail)
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const authHeader = await getForwardHeaders()
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    })
  } catch (err) {
    // The API being unreachable is swallowed by callers just like an HTTP error.
    logFailure(method, path, null, String(err))
    throw err
  }
  return handleResponse<T>(method, path, res)
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>("PATCH", path, body)
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>("DELETE", path)
}

/**
 * Raw fetch with full response access — used for login to capture Set-Cookie.
 */
export async function apiPostRaw(
  path: string,
  body: unknown,
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  return res
}
