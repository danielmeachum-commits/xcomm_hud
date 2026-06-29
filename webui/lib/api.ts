import { cookies } from "next/headers"

const API = process.env.API_URL!

async function getAuthHeader(): Promise<HeadersInit> {
  const cookieStore = await cookies()
  const session = cookieStore.get("xcomm_hud_session")
  return session ? { Cookie: `xcomm_hud_session=${session.value}` } : {}
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

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (typeof body?.detail === "string") detail = body.detail
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string): Promise<T> {
  const authHeader = await getAuthHeader()
  const res = await fetch(`${API}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    cache: "no-store",
  })
  return handleResponse<T>(res)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const authHeader = await getAuthHeader()
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  return handleResponse<T>(res)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const authHeader = await getAuthHeader()
  const res = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  return handleResponse<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const authHeader = await getAuthHeader()
  const res = await fetch(`${API}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    cache: "no-store",
  })
  return handleResponse<T>(res)
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
