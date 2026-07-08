import Link from "next/link"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { EventTypesManager } from "@/components/event-types/event-types-manager"
import type { EventTypeDef } from "@/lib/types"

interface PageProps {
  params: Promise<{ workspace: string }>
}

export default async function EventTypesPage({ params }: PageProps) {
  const me = await requireSession()
  const { workspace } = await params

  const eventTypes = await apiGet<EventTypeDef[]>(
    "/event-types?include_retired=true",
  ).catch(() => [] as EventTypeDef[])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Settings" }, { label: "Event Types" }]}
      />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Event Types</h1>
        <p className="text-xs text-muted-foreground">
          Vocabulary of declarable events — built-in baseline plus custom types
          for this workspace. Automatic records (validations, sign-ins, posture
          changes) are created by{" "}
          <Link
            href={`/w/${workspace}/settings/rules`}
            className="underline underline-offset-2"
          >
            Rules
          </Link>
          .
        </p>
      </div>
      <EventTypesManager me={me} initialTypes={eventTypes} />
    </div>
  )
}
