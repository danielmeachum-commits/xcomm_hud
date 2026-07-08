import { Flag, Radio, TriangleAlert, Users } from "lucide-react"

import { Card } from "@/components/ui/card"
import { TimeAgo } from "@/components/time-display"
import { SEVERITY_LABELS, SEVERITY_ORDER, severityDotClass } from "@/lib/severity"
import { cn } from "@/lib/utils"
import type { EventSummary, Severity } from "@/lib/types"

/** Horizontal row of summary stat tiles above the events views.
 *
 * Fixed default set for v1; each tile is self-contained so more can be
 * added (or made user-configurable) later. Values wear text tokens —
 * color appears only in the marks (dots, sparkline) beside them.
 */
export function EventWidgets({ summary }: { summary: EventSummary }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {summary.exercise_phase && (
        <StatCard label="Exercise phase">
          <div className="flex items-baseline gap-2">
            <span className="inline-flex items-center gap-1.5 text-xl font-semibold tracking-tight">
              <Flag className="size-4 text-muted-foreground" />
              {summary.exercise_phase}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            <TimeAgo iso={summary.exercise_phase_at} />
          </p>
        </StatCard>
      )}

      <StatCard label="Events today">
        <div className="flex items-end justify-between gap-3">
          <span className="text-xl font-semibold tracking-tight">
            {summary.events_today}
          </span>
          <Sparkline points={summary.activity_24h} />
        </div>
        <p className="text-[11px] text-muted-foreground">last 24h activity</p>
      </StatCard>

      <StatCard label="By severity">
        <div className="flex items-center gap-3">
          {SEVERITY_ORDER.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 text-sm"
              title={SEVERITY_LABELS[s]}
            >
              <span className={cn("size-2 rounded-full", severityDotClass(s))} />
              <span className="font-semibold">{summary.by_severity[s] ?? 0}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {SEVERITY_LABELS[s].slice(0, 4)}
              </span>
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {summary.total_events} events · {summary.total_logs} logs
        </p>
      </StatCard>

      <StatCard label="Services down">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xl font-semibold tracking-tight",
              summary.services_down > 0 && "text-red-600 dark:text-red-400",
            )}
          >
            {summary.services_down > 0 && <TriangleAlert className="size-4" />}
            {summary.services_down}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          <Radio className="mr-1 inline size-3" />
          across all sites
        </p>
      </StatCard>

      <StatCard label="Personnel on-site">
        <span className="text-xl font-semibold tracking-tight">
          {summary.personnel_on_site}
        </span>
        <p className="text-[11px] text-muted-foreground">
          <Users className="mr-1 inline size-3" />
          signed in right now
        </p>
      </StatCard>
    </div>
  )
}

function StatCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Card className="min-w-44 shrink-0 gap-1.5 rounded-lg px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </Card>
  )
}

/** Tiny single-series trend line — de-emphasis hue, no axes, no legend
 *  (the tile label names the series). Purely decorative reinforcement of
 *  the number beside it, so it's aria-hidden. */
function Sparkline({ points }: { points: number[] }) {
  const w = 72
  const h = 24
  if (points.length < 2) return null
  const max = Math.max(...points, 1)
  const step = w / (points.length - 1)
  const y = (v: number) => h - 2 - (v / max) * (h - 4)
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ")
  const lastX = (points.length - 1) * step
  const lastY = y(points[points.length - 1])
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={path}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-muted-foreground/50"
      />
      <circle cx={lastX} cy={lastY} r="2.5" className="fill-primary" />
    </svg>
  )
}
