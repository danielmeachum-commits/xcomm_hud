"use client"

import { useCallback, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { EndOfDayButton } from "@/components/personnel/end-of-day-button"
import { PersonnelCanvas } from "@/components/personnel/personnel-canvas"
import { PersonnelCsvImport } from "@/components/personnel/personnel-csv-import"
import { PersonnelForm } from "@/components/personnel/personnel-form"
import { PersonnelTable } from "@/components/personnel/personnel-table"
import { Input } from "@/components/ui/input"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  buildPersonnelGroups,
  type PersonnelGroupBy,
} from "@/lib/personnel-grouping"
import {
  Activity,
  Building2,
  Flag,
  LayoutGrid,
  Network,
  Users,
  UsersRound,
} from "lucide-react"
import type {
  Personnel,
  Role,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

interface Props {
  personnel: Personnel[]
  workCenters: WorkCenter[]
  units: Unit[]
  teams: Team[]
  sites: Site[]
  userRole: Role
}

type GroupMode = "all" | PersonnelGroupBy

const GROUP_MODES: GroupMode[] = ["all", "status", "work_center", "team", "unit"]

// The graph view shows structure, not groupings: the supervisor org chart
// or the team breakdown. List groupings live on the list view only.
type GraphMode = "org" | "teams"

export function PersonnelListClient({
  personnel,
  workCenters,
  units,
  teams,
  sites,
  userRole,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState("")
  const canEdit = userRole !== "viewer"

  // Group + view live in the URL (?group=&view=&graph=) so returning to this
  // page — via the detail-page breadcrumb or the browser back button —
  // restores the active tab. Defaults are omitted to keep the URL clean.
  const groupParam = searchParams.get("group") as GroupMode | null
  const groupMode: GroupMode =
    groupParam && GROUP_MODES.includes(groupParam) ? groupParam : "all"
  const view: "list" | "graph" =
    searchParams.get("view") === "graph" ? "graph" : "list"
  const graphMode: GraphMode =
    searchParams.get("graph") === "teams" ? "teams" : "org"
  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )
  const setGroupMode = (next: GroupMode) =>
    replaceParams((params) => {
      if (next === "all") params.delete("group")
      else params.set("group", next)
    })
  const setView = (next: "list" | "graph") =>
    replaceParams((params) => {
      if (next === "list") {
        params.delete("view")
        params.delete("graph")
      } else params.set("view", next)
    })
  const setGraphMode = (next: GraphMode) =>
    replaceParams((params) => {
      if (next === "org") params.delete("graph")
      else params.set("graph", next)
    })

  // Person links carry the current URL so the detail page breadcrumbs back to
  // the same group/view.
  const qs = searchParams.toString()
  const linkFrom = {
    path: qs ? `${pathname}?${qs}` : pathname,
    label: "Personnel",
  }

  const wcById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc])),
    [workCenters],
  )
  const unitById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return personnel
    return personnel.filter((p) => {
      const bits = [
        p.last_name,
        p.first_name,
        p.rank,
        p.email,
        p.cellphone,
        p.dsn,
        p.room_number,
        p.work_center_id ? wcById.get(p.work_center_id)?.name : null,
        p.unit_id ? unitById.get(p.unit_id)?.name : null,
      ]
      return bits.some((b) => b?.toLowerCase().includes(q))
    })
  }, [personnel, query, wcById, unitById])

  // Search applies before grouping, so the graph shows only matches too.
  const groups = useMemo(
    () =>
      groupMode === "all"
        ? []
        : buildPersonnelGroups(filtered, groupMode, { workCenters, units, teams }),
    [groupMode, filtered, workCenters, units, teams],
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Personnel</h1>
          <p className="text-xs text-muted-foreground">
            {personnel.length === 0
              ? "No personnel yet. Add one manually or import from CSV."
              : `${personnel.length} member${personnel.length === 1 ? "" : "s"} across ${workCenters.length} work center${workCenters.length === 1 ? "" : "s"} and ${units.length} unit${units.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <EndOfDayButton />
            <PersonnelCsvImport />
            <PersonnelForm
              workCenters={workCenters}
              units={units}
              teams={teams}
              sites={sites}
              supervisors={personnel}
            />
          </div>
        )}
      </div>

      <div className="max-w-sm">
        <Input
          placeholder="Search by name, rank, work center, unit…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* View toggle on the left; the right side switches with it — list
          groupings for the list, structure pick for the graph. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs<"list" | "graph">
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List", icon: LayoutGrid },
            { value: "graph", label: "Graph", icon: Network },
          ]}
        />
        {view === "graph" ? (
          <ViewTabs<GraphMode>
            value={graphMode}
            onChange={setGraphMode}
            options={[
              { value: "org", label: "Organization", icon: Flag },
              { value: "teams", label: "Teams", icon: UsersRound },
            ]}
          />
        ) : (
          <ViewTabs<GroupMode>
            value={groupMode}
            onChange={setGroupMode}
            options={[
              { value: "all", label: "All", icon: Users },
              { value: "status", label: "Status", icon: Activity },
              { value: "work_center", label: "Work Center", icon: Building2 },
              { value: "team", label: "Team", icon: UsersRound },
              { value: "unit", label: "Unit", icon: Flag },
            ]}
          />
        )}
      </div>

      {view === "graph" ? (
        graphMode === "org" ? (
          <PersonnelCanvas
            mode="org-tree"
            people={filtered}
            units={units}
            sites={sites}
            canEdit={canEdit}
            linkFrom={linkFrom}
          />
        ) : (
          <PersonnelCanvas
            mode="team-tree"
            teams={teams}
            workCenters={workCenters}
            people={filtered}
            sites={sites}
            canEdit={canEdit}
            linkFrom={linkFrom}
          />
        )
      ) : groupMode === "all" ? (
        <PersonnelTable
          personnel={filtered}
          workCenters={workCenters}
          units={units}
          sites={sites}
          canEdit={canEdit}
          emptyMessage={
            personnel.length === 0
              ? "No personnel."
              : "No matches for that search."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {personnel.length === 0
                ? "No personnel."
                : "No matches for that search."}
            </p>
          )}
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label} ({g.people.length})
              </h2>
              <PersonnelTable
                personnel={g.people}
                workCenters={workCenters}
                units={units}
                sites={sites}
                canEdit={canEdit}
                linkFrom={linkFrom}
              />
            </section>
          ))}
        </div>
      )}
    </>
  )
}
