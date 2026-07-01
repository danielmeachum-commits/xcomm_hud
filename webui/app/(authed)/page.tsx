import { redirect } from "next/navigation"

import { requireSession } from "@/lib/auth"

export default async function RootRedirect() {
  const me = await requireSession()
  redirect(`/w/${me.current_workspace.slug}/sites`)
}
