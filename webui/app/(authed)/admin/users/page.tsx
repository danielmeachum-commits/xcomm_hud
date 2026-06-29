import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
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

  return <UsersAdminClient initialUsers={users} />
}
