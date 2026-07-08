"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Copy, Plus, Zap, ZapOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LocalTime } from "@/components/time-display"
import { REGISTRY_TYPE_LABELS } from "@/lib/event-type-labels"
import { SEVERITY_LABELS } from "@/lib/severity"
import { cn } from "@/lib/utils"
import type {
  EventTypeDef,
  Me,
  Rule,
  RuleExecution,
  RulesMeta,
  Severity,
} from "@/lib/types"

import { RuleWizard } from "./rule-wizard"

interface Props {
  me: Me
  initialRules: Rule[]
  meta: RulesMeta
  eventTypes: EventTypeDef[]
}

function conditionCount(cond: unknown): number {
  if (cond == null) return 0
  if (typeof cond !== "object") return 1
  const obj = cond as Record<string, unknown>
  if (Array.isArray(obj.and)) return obj.and.length
  if (Array.isArray(obj.or)) return obj.or.length
  return 1
}

export function RulesManager({ me, initialRules, meta, eventTypes }: Props) {
  const [rules, setRules] = useState<Rule[]>(initialRules)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [executions, setExecutions] = useState<Record<number, RuleExecution[]>>({})
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(
    null,
  )

  const isAdmin = me.role === "admin"
  const isOperator = isAdmin || me.role === "operator"

  const triggerLabels = useMemo(
    () => new Map(meta.triggers.map((t) => [t.key, t.label])),
    [meta],
  )
  const typeLabels = useMemo(() => {
    const m = new Map<string, string>(Object.entries(REGISTRY_TYPE_LABELS))
    for (const t of eventTypes) m.set(t.slug, t.label)
    return m
  }, [eventTypes])

  const builtinRules = rules.filter((r) => r.is_builtin)
  const customRules = rules.filter((r) => !r.is_builtin)

  function canManage(r: Rule): boolean {
    return r.is_builtin ? isAdmin : isOperator
  }

  function summarize(r: Rule): string {
    const parts: string[] = []
    const n = conditionCount(r.conditions)
    if (n > 0) parts.push(`if ${n} condition${n === 1 ? "" : "s"}`)
    for (const step of r.actions) {
      if (step.action === "create_event") {
        const slug = String(step.params.type_slug ?? "note.general")
        const sev = step.params.severity as Severity | undefined
        const sevFrom = step.params.severity_from as string | undefined
        const sevPart = sevFrom
          ? ` (severity from {${sevFrom}})`
          : sev
            ? ` (${SEVERITY_LABELS[sev].toLowerCase()})`
            : ""
        parts.push(`create “${typeLabels.get(slug) ?? slug}”${sevPart}`)
      } else {
        parts.push(step.action)
      }
    }
    return parts.join(" → ")
  }

  async function toggleEnabled(r: Rule) {
    setRowError(null)
    try {
      const res = await fetch(`/api/be/rules/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !r.enabled }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Toggle failed (${res.status})`,
        )
      }
      const updated = (await res.json()) as Rule
      setRules((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (err) {
      setRowError({
        id: r.id,
        message: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  async function handleDelete(r: Rule) {
    setRowError(null)
    try {
      const res = await fetch(`/api/be/rules/${r.id}`, { method: "DELETE" })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Delete failed (${res.status})`,
        )
      }
      setRules((prev) => prev.filter((x) => x.id !== r.id))
    } catch (err) {
      setRowError({
        id: r.id,
        message: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  async function toggleExpanded(r: Rule) {
    const next = expanded === r.id ? null : r.id
    setExpanded(next)
    if (next !== null && executions[r.id] === undefined) {
      try {
        const res = await fetch(`/api/be/rules/${r.id}/executions?limit=10`)
        const rows = res.ok ? ((await res.json()) as RuleExecution[]) : []
        setExecutions((prev) => ({ ...prev, [r.id]: rows }))
      } catch {
        setExecutions((prev) => ({ ...prev, [r.id]: [] }))
      }
    }
  }

  function handleSaved(saved: Rule) {
    setRules((prev) => {
      const exists = prev.some((x) => x.id === saved.id)
      return exists
        ? prev.map((x) => (x.id === saved.id ? saved : x))
        : [...prev, saved]
    })
    setEditing(null)
  }

  function renderRow(r: Rule) {
    const isExpanded = expanded === r.id
    const runs = executions[r.id]
    return (
      <li
        key={r.id}
        className={cn("border-t first:border-t-0", !r.enabled && "opacity-55")}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <button
            type="button"
            onClick={() => toggleExpanded(r)}
            className="rounded-md p-0.5 text-muted-foreground hover:bg-accent"
            aria-label="Recent activity"
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{r.name}</span>
              {!r.enabled && (
                <span className="rounded border border-border bg-muted/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Disabled
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              When {lowerFirst(triggerLabels.get(r.trigger) ?? r.trigger)}
              {summarize(r) ? ` · ${summarize(r)}` : ""}
            </p>
            {rowError?.id === r.id && (
              <p className="mt-0.5 text-xs text-destructive" role="alert">
                {rowError.message}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isOperator && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(r)
                  setDuplicating(true)
                  setWizardOpen(true)
                }}
                title="Duplicate — new rule prefilled with these settings"
                aria-label={`Duplicate ${r.name}`}
              >
                <Copy className="size-3.5" />
              </Button>
            )}
            {canManage(r) && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleEnabled(r)}
                  className="gap-1.5"
                >
                  {r.enabled ? (
                    <>
                      <ZapOff className="size-3.5" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Zap className="size-3.5" />
                      Enable
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(r)
                    setDuplicating(false)
                    setWizardOpen(true)
                  }}
                >
                  Edit
                </Button>
                {!r.is_builtin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(r)}
                    className="text-destructive"
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="border-t bg-muted/20 px-9 py-2">
            {r.description && (
              <p className="pb-1.5 text-xs text-muted-foreground">{r.description}</p>
            )}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </p>
            {runs === undefined ? (
              <p className="py-1 text-xs text-muted-foreground">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="py-1 text-xs text-muted-foreground">
                This rule hasn't fired yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5 py-1">
                {runs.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        e.status === "ok" ? "bg-emerald-500" : "bg-red-500",
                      )}
                    />
                    <LocalTime iso={e.fired_at} className="font-mono text-[11px]" />
                    {e.error ? (
                      <span className="text-destructive">{e.error}</span>
                    ) : (
                      <span className="truncate text-muted-foreground">
                        {contextSummary(e.context)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {isOperator && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setWizardOpen(true)
            }}
          >
            <Plus data-icon="inline-start" />
            New rule
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Workspace rules</h2>
        <ul className="overflow-hidden rounded-md border">
          {customRules.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              No custom rules yet — create one to react to status changes,
              sign-ins, and posture changes.
            </li>
          )}
          {customRules.map(renderRow)}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Built-in</h2>
        <p className="text-xs text-muted-foreground">
          The system record-keeping — these rules write the feed rows for
          validations, sign-ins, and posture changes. Admins can retune or
          disable them.
        </p>
        <ul className="overflow-hidden rounded-md border">
          {builtinRules.map(renderRow)}
        </ul>
      </section>

      {wizardOpen && (
        <RuleWizard
          key={editing ? `${duplicating ? "dup" : "edit"}-${editing.id}` : "new"}
          open={wizardOpen}
          onOpenChange={(o) => {
            setWizardOpen(o)
            if (!o) {
              setEditing(null)
              setDuplicating(false)
            }
          }}
          meta={meta}
          eventTypes={eventTypes}
          rule={editing}
          duplicate={duplicating}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

/** Lowercase only the leading letter so acronyms (FPCON, EMCON) keep their
 *  casing mid-sentence. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function contextSummary(ctx: Record<string, unknown> | null): string {
  if (!ctx) return ""
  const bits: string[] = []
  for (const key of [
    "service_name",
    "gateway_name",
    "site_name",
    "personnel_name",
  ]) {
    if (ctx[key]) {
      bits.push(String(ctx[key]))
      break
    }
  }
  if (ctx.prev_status && ctx.new_status) {
    bits.push(`${ctx.prev_status} → ${ctx.new_status}`)
  } else if (ctx.new_status) {
    bits.push(String(ctx.new_status))
  }
  return bits.join(" · ")
}
