"use client"

import { personName } from "@/lib/personnel-data"
import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { CommanderStar } from "@/components/personnel/commander-star"
import { PersonnelCsvImport } from "@/components/personnel/personnel-csv-import"
import { RosterPersonDialog } from "@/components/personnel/roster-person-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Person, Unit } from "@/lib/types"

interface Props {
  people: Person[]
  units: Unit[]
}

/**
 * The global roster: everyone on the unit's books, and which workspaces each
 * person is in. People are entered here once and then added to workspaces
 * from each one's Personnel page, so nobody is retyped per exercise.
 */
export function RosterAdmin({ people, units }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState("")

  const unitName = useMemo(
    () => new Map(units.map((u) => [u.id, u.name])),
    [units],
  )
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter((p) =>
      [p.rank, p.last_name, p.first_name, p.email, unitName.get(p.unit_id ?? -1)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [people, query, unitName])

  async function del(p: Person) {
    if (!confirm(`Delete ${personName(p)} from the roster?`))
      return
    const res = await fetch(`/api/be/people/${p.id}`, { method: "DELETE" })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      alert(detail.detail ?? "Failed to delete")
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Roster</h1>
          <p className="text-xs text-muted-foreground">
            Everyone on the unit&apos;s books. Enter people here once, then
            add them to a workspace from its Personnel page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PersonnelCsvImport target="roster" />
          <RosterPersonDialog roster={people} units={units} />
        </div>
      </div>
      <div className="max-w-xs">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, rank, unit, email…"
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Workspaces</th>
              <th className="w-1 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {people.length === 0 ? "Nobody on the roster yet." : "No one matches."}
                </td>
              </tr>
            )}
            {shown.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {p.is_commander && <CommanderStar size={12} />}
                    {p.rank ? `${p.rank} ` : ""}
                    {personName(p)}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {(p.unit_id && unitName.get(p.unit_id)) || "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[p.email, p.cellphone].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2">
                  {p.workspaces.length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <span className="flex flex-wrap gap-x-2">
                      {p.workspaces.map((w) => (
                        <Link
                          key={w.workspace_id}
                          href={`/w/${w.slug}/personnel/${w.personnel_id}`}
                          className="text-primary hover:underline"
                        >
                          {w.name}
                        </Link>
                      ))}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <RosterPersonDialog person={p} roster={people} units={units} />
                  <Button
                    className="ml-2"
                    size="sm"
                    variant="outline"
                    onClick={() => del(p)}
                    disabled={p.workspaces.length > 0}
                    title={
                      p.workspaces.length > 0
                        ? "Remove them from each workspace first"
                        : undefined
                    }
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
