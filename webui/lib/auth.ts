import { redirect } from "next/navigation"
import { apiGet } from "./api"
import type { Me } from "./types"

export async function getSession(): Promise<Me | null> {
  try {
    return await apiGet<Me>("/me")
  } catch {
    return null
  }
}

export async function requireSession(): Promise<Me> {
  const session = await getSession()
  if (!session) {
    redirect("/login")
  }
  return session
}
