/** Team / work-center filtering for the events feed.
 *
 *  An Event row carries no team or work-center column, so membership is
 *  resolved at read time from two directions:
 *
 *    1. The event is *about* the org unit — subject_kind "team" /
 *       "work_center", subject_id pointing at it.
 *    2. The event is about a *person in* it — a personnel_location row whose
 *       subject is someone with that team or work center.
 *
 *  Both count. Filtering to "Alpha Team" and getting back only the two notes
 *  someone logged against the team, while every sign-in by its members sits
 *  there unmatched, is not what the filter is for.
 *
 *  Shared by the table and the timeline so the two views can't drift on what
 *  "this team" means.
 */
import type { MultiSelectOption } from "@/components/multi-select-filter"
import type { Event, Personnel } from "@/lib/types"

export interface EventOrgIndex {
  /** Team ids this event touches (subject or via its person). */
  teamsFor: (v: Event) => number[]
  /** Work-center ids this event touches — at most one, people have one. */
  workCentersFor: (v: Event) => number[]
}

export function buildEventOrgIndex(personnel: Personnel[]): EventOrgIndex {
  const teamsByPerson = new Map<number, number[]>()
  const workCenterByPerson = new Map<number, number>()
  for (const p of personnel) {
    if (p.team_ids.length > 0) teamsByPerson.set(p.id, p.team_ids)
    if (p.work_center_id != null) workCenterByPerson.set(p.id, p.work_center_id)
  }

  return {
    teamsFor(v) {
      if (v.subject_id == null) return []
      if (v.subject_kind === "team") return [v.subject_id]
      if (v.subject_kind === "personnel_location") {
        return teamsByPerson.get(v.subject_id) ?? []
      }
      return []
    },
    workCentersFor(v) {
      if (v.subject_id == null) return []
      if (v.subject_kind === "work_center") return [v.subject_id]
      if (v.subject_kind === "personnel_location") {
        const wc = workCenterByPerson.get(v.subject_id)
        return wc == null ? [] : [wc]
      }
      return []
    },
  }
}

/** True when `selected` is empty (no filter) or the event touches one of them. */
export function matchesOrgFilter(
  ids: number[],
  selected: Set<string>,
): boolean {
  if (selected.size === 0) return true
  return ids.some((id) => selected.has(String(id)))
}

/** Options for a team/work-center funnel, narrowed to org units that actually
 *  appear in the current rows — same convention as the Site and Type funnels,
 *  which never offer a value that would return nothing. */
export function orgFilterOptions(
  events: Event[],
  idsFor: (v: Event) => number[],
  names: Map<number, string>,
): MultiSelectOption[] {
  const present = new Set<number>()
  for (const v of events) for (const id of idsFor(v)) present.add(id)
  return Array.from(present)
    .map((id) => ({ value: String(id), label: names.get(id) ?? `#${id}` }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
