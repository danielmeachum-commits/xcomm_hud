import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { UsersAdminClient } from "@/components/users-admin-client"
import type { User } from "@/lib/types"

export default async function UsersAdminPage() {
  const me = await requireSession()
  if (me.role !== "admin") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    )
  }

  let users: User[] = []
  try {
    users = await apiGet<User[]>("/users")
  } catch {
    // ignore
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Admin" }, { label: "Users" }]} />
      <UsersAdminClient initialUsers={users} />
    </div>
  )
}
