// Shared grouping logic for personnel views — used by the workspace roster
// and the site personnel tab, in both the list rendering (sections of tables)
// and the graph rendering (PersonnelCanvas lanes).

import {
  PERSONNEL_STATUSES,
  PERSONNEL_STATUS_COLORS,
  PERSONNEL_STATUS_LABELS,
} from "@/lib/personnel-data"
import type { Personnel, Team, Unit, WorkCenter } from "@/lib/types"

export type PersonnelGroupBy = "status" | "work_center" | "team" | "unit"

export interface PersonnelGroup {
  key: string
  label: string
  /** Accent color (team color, status color); null → neutral styling. */
  color: string | null
  /** True for the catch-all bucket of people outside every group. */
  ungrouped?: boolean
  people: Personnel[]
}

export interface PersonnelGroupContext {
  workCenters: WorkCenter[]
  units: Unit[]
  teams: Team[]
}

/**
 * Bucket people along one grouping dimension. Empty groups are dropped;
 * people who fit no bucket land in a trailing "No …" group so they stay
 * visible rather than silently disappearing. Team is many-to-many, so a
 * person can appear in several team groups. Unit here is the flat direct
 * assignment — the unit *tree* rendering lives in PersonnelCanvas.
 */
export function buildPersonnelGroups(
  people: Personnel[],
  groupBy: PersonnelGroupBy,
  ctx: PersonnelGroupContext,
): PersonnelGroup[] {
  switch (groupBy) {
    case "status":
      // Keeps PERSONNEL_STATUSES order (not alphabetical) — it mirrors the
      // check-in dropdown, with "unknown" last.
      return PERSONNEL_STATUSES.map((status) => ({
        key: `status-${status}`,
        label: PERSONNEL_STATUS_LABELS[status],
        color: PERSONNEL_STATUS_COLORS[status],
        people: people.filter((p) => p.current_status === status),
      })).filter((g) => g.people.length > 0)
    case "work_center":
      return withNoneBucket(
        ctx.workCenters.map((wc) => ({
          key: `wc-${wc.id}`,
          label: wc.name,
          color: null,
          people: people.filter((p) => p.work_center_id === wc.id),
        })),
        people.filter((p) => p.work_center_id == null),
        "No work center",
      )
    case "team":
      return withNoneBucket(
        ctx.teams.map((t) => ({
          key: `team-${t.id}`,
          label: t.name,
          color: t.color,
          people: people.filter((p) => p.team_ids.includes(t.id)),
        })),
        people.filter((p) => p.team_ids.length === 0),
        "No team",
      )
    case "unit":
      return withNoneBucket(
        ctx.units.map((u) => ({
          key: `unit-${u.id}`,
          label: u.name,
          color: null,
          people: people.filter((p) => p.unit_id === u.id),
        })),
        people.filter((p) => p.unit_id == null),
        "No unit",
      )
  }
}

function withNoneBucket(
  groups: PersonnelGroup[],
  none: Personnel[],
  noneLabel: string,
): PersonnelGroup[] {
  const withMembers = groups
    .filter((g) => g.people.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
  return none.length > 0
    ? [
        ...withMembers,
        { key: "none", label: noneLabel, color: null, ungrouped: true, people: none },
      ]
    : withMembers
}
