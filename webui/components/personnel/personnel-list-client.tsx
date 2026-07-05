"use client"

import { useMemo, useState } from "react"

import { PersonnelCsvImport } from "@/components/personnel/personnel-csv-import"
import { PersonnelForm } from "@/components/personnel/personnel-form"
import { PersonnelTable } from "@/components/personnel/personnel-table"
import { Input } from "@/components/ui/input"
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

export function PersonnelListClient({
  personnel,
  workCenters,
  units,
  teams,
  sites,
  userRole,
}: Props) {
  const [query, setQuery] = useState("")
  const canEdit = userRole !== "viewer"

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
    </>
  )
}
