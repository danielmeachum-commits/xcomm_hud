"use client"

import {
  AlertTriangle,
  Check,
  HelpCircle,
  PackagePlus,
  Pencil,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  Enclave,
  UtcCompleteness,
  UtcCompletenessLine,
  UtcCompletenessStatus,
  UtcInstance,
  UtcInstanceLine,
} from "@/lib/types"
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import { cn } from "@/lib/utils"

const STATUS_META: Record<
  UtcCompletenessStatus,
  { label: string; className: string; icon: typeof Check }
> = {
  complete: {
    label: "Complete",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    icon: Check,
  },
  short: {
    label: "Short",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600",
    icon: AlertTriangle,
  },
  over: {
    label: "Unplanned gear",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-600",
    icon: PackagePlus,
  },
  unknown: {
    label: "No expected list",
    className: "border-border bg-muted/40 text-muted-foreground",
    icon: HelpCircle,
  },
}

export function CompletenessBadge({
  status,
  className,
}: {
  status: UtcCompletenessStatus
  className?: string
}) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        meta.className,
        className,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  )
}

function label(line: { type_short_name: string | null; type_title: string | null }) {
  return line.type_short_name ?? line.type_title ?? "Unknown type"
}

/** Expected-vs-actual for one deployed UTC, with an inline editor for the
 *  expected list. Editing after deploy is the point: "we're leaving the SIPR
 *  stack home" is sometimes decided mid-mission, and without this the operator
 *  stares at a shortfall they have no way to acknowledge. */
export function UtcCompletenessPanel({
  utc,
  enclaves = [],
}: {
  utc: UtcInstance
  enclaves?: Enclave[]
}) {
  const router = useRouter()
  const [data, setData] = useState<UtcCompleteness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<number, number>>({})
  const [pending, setPending] = useState(false)

  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )

  /** Rows bucketed by enclave, with untagged gear last under "common". Order
   *  follows the enclave list so the grouping is stable between UTCs. */
  const grouped = useMemo(() => {
    if (!data) return []
    const buckets = new Map<number | null, UtcCompletenessLine[]>()
    for (const line of data.lines) {
      const key = line.enclave_id ?? null
      const bucket = buckets.get(key)
      if (bucket) bucket.push(line)
      else buckets.set(key, [line])
    }
    const out: { enclave: Enclave | null; lines: UtcCompletenessLine[] }[] = []
    for (const e of enclaves) {
      const lines = buckets.get(e.id)
      if (lines) out.push({ enclave: e, lines })
    }
    // Anything tagged with an enclave we can't resolve still has to render.
    for (const [key, lines] of buckets) {
      if (key !== null && !enclaveById.has(key)) out.push({ enclave: null, lines })
    }
    const common = buckets.get(null)
    if (common) out.push({ enclave: null, lines: common })
    return out
  }, [data, enclaves, enclaveById])

  /** Every enclave this UTC's definition covers, ticked where the deployment
   *  brought its stack and crossed where it deliberately didn't.
   *
   *  This replaces a paragraph explaining that an unsupported enclave is a
   *  decision rather than a shortfall — a ✓/✗ roster says the same thing at a
   *  glance, and says it about the supported ones too, which the prose never
   *  did. Enclaves the definition never mentioned stay out: this is what was
   *  on the table for this UTC, not the whole catalog. */
  const enclaveRoster = useMemo(() => {
    if (!data) return []
    // From the API's own sets, not from `lines`: a type carried on two
    // enclaves collapses to one unlabelled row there, so a UTC with a TACLANE
    // on both NIPR and SIPR would have shown an empty roster.
    const supported = new Set(data.supported_enclave_ids ?? [])
    const unsupported = new Set(data.unsupported_enclave_ids ?? [])
    return enclaves
      .filter((e) => supported.has(e.id) || unsupported.has(e.id))
      .map((enclave) => ({ enclave, on: supported.has(enclave.id) }))
  }, [data, enclaves])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/be/utcs/${utc.id}/completeness`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`)
        return (await res.json()) as UtcCompleteness
      })
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [utc.id])

  function startEdit() {
    if (!data) return
    // Seed from expected, but include types that are only present physically —
    // adopting unplanned gear into the expected list is the common fix for it.
    const seed: Record<number, number> = {}
    for (const line of data.lines) {
      seed[line.equipment_type_id] = line.expected || line.actual
    }
    setDraft(seed)
    setEditing(true)
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const body: Pick<UtcInstanceLine, "equipment_type_id" | "quantity">[] =
        Object.entries(draft)
          .map(([id, qty]) => ({
            equipment_type_id: Number(id),
            quantity: Number(qty) || 0,
          }))
          .filter((l) => l.quantity > 0)
      const res = await fetch(`/api/be/utcs/${utc.id}/lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save")
      }
      const fresh = await fetch(`/api/be/utcs/${utc.id}/completeness`)
      if (fresh.ok) setData((await fresh.json()) as UtcCompleteness)
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setPending(false)
    }
  }

  if (loading)
    return <p className="text-xs text-muted-foreground">Checking contents…</p>
  if (error && !data)
    return <p className="text-xs text-destructive">{error}</p>
  if (!data) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* The rollup badge is hidden for now — the table's deltas and the
            enclave roster below carry the same news. `CompletenessBadge` stays
            exported so putting it back is one line. */}
        {data.status === "unknown" && (
          <span className="text-xs text-muted-foreground">
            Deployed before expected contents were recorded — set them to start
            tracking shortfalls.
          </span>
        )}
        <div className="ml-auto">
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save expected"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={startEdit}>
              <Pencil className="size-3.5" />
              Edit expected
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {data.lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Nothing expected and nothing present.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 text-left font-medium">Type</th>
              <th className="w-24 py-1 text-right font-medium">Expected</th>
              <th className="w-20 py-1 text-right font-medium">Actual</th>
              <th className="w-24 py-1 text-right font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ enclave, lines }) => (
              <Fragment key={enclave?.id ?? "common"}>
                {grouped.length > 1 && (
                  <tr>
                    <td colSpan={4} className="pt-3 pb-1">
                      {enclave ? (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            enclaveChipClass(enclave.color),
                          )}
                          style={enclaveChipStyle(enclave.color)}
                        >
                          {enclave.short_name || enclave.name}
                        </span>
                      ) : (
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {/* Covers both gear common to every enclave and a
                              type that spans more than one, which the API
                              deliberately leaves unlabelled. */}
                          Not enclave-specific
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {lines.map((line) => (
              <tr
                key={line.equipment_type_id}
                className="border-t border-border/50"
              >
                <td className="py-1.5">
                  {label(line)}
                  {!line.serialized && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (bulk)
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {editing ? (
                    <Input
                      type="number"
                      min={0}
                      className="ml-auto h-7 w-20 text-right"
                      value={draft[line.equipment_type_id] ?? 0}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [line.equipment_type_id]: Number(e.target.value),
                        })
                      }
                      disabled={pending}
                    />
                  ) : (
                    <span className="font-mono">{line.expected}</span>
                  )}
                </td>
                <td className="py-1.5 text-right font-mono">{line.actual}</td>
                <td
                  className={cn(
                    "py-1.5 text-right font-mono",
                    line.delta < 0 && "text-amber-600",
                    line.delta > 0 && "text-sky-600",
                    line.delta === 0 && "text-muted-foreground",
                  )}
                >
                  {line.delta > 0 ? `+${line.delta}` : line.delta}
                </td>
              </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {enclaveRoster.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Enclaves
          </span>
          {enclaveRoster.map(({ enclave, on }) => (
            <span
              key={enclave.id}
              title={
                on
                  ? "Supported on this deployment"
                  : `${utc.utc_def_code ?? "The definition"} includes a stack for this enclave; this deployment left it home`
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                on
                  ? enclaveChipClass(enclave.color)
                  : "border-dashed text-muted-foreground",
              )}
              style={on ? enclaveChipStyle(enclave.color) : undefined}
            >
              {on ? <Check className="size-3" /> : <X className="size-3" />}
              {enclave.short_name || enclave.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
