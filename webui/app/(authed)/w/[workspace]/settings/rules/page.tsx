import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { RulesManager } from "@/components/rules/rules-manager"
import type { EventTypeDef, Rule, RulesMeta } from "@/lib/types"

export default async function RulesPage() {
  const me = await requireSession()

  const [rules, meta, eventTypes] = await Promise.all([
    apiGet<Rule[]>("/rules").catch(() => [] as Rule[]),
    apiGet<RulesMeta>("/rules/meta").catch(
      () => ({ triggers: [], enrichers: [], actions: [] }) as RulesMeta,
    ),
    apiGet<EventTypeDef[]>("/event-types").catch(() => [] as EventTypeDef[]),
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "Rules" }]} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Rules</h1>
        <p className="text-xs text-muted-foreground">
          When something happens (a trigger), rules decide the reaction —
          today that's recording events and logs; notifications and more
          plug in later. Built-in rules are the system record-keeping.
        </p>
      </div>
      <RulesManager
        me={me}
        initialRules={rules}
        meta={meta}
        eventTypes={eventTypes}
      />
    </div>
  )
}
