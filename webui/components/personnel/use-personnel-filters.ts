"use client"

import { useMemo, useState } from "react"

import type { FilterBankItem } from "@/components/multi-select-filter"
import {
  PERSONNEL_STATUS_LABELS,
  PERSONNEL_STATUSES,
} from "@/lib/personnel-data"
import type { Personnel, Site, Unit, WorkCenter } from "@/lib/types"

export type PersonnelFilterKey =
  | "status"
  | "work_center"
  | "unit"
  | "assigned_site"

const ALL_KEYS: PersonnelFilterKey[] = [
  "status",
  "work_center",
  "unit",
  "assigned_site",
]

function byLabel(a: { label: string }, b: { label: string }): number {
  return a.label.localeCompare(b.label)
}

/** Column-style filtering for the personnel table, lifted to the page so it
 *  applies before grouping (which renders one table per group). Returns a
 *  filter bank for the funnel bar + chips, and `apply` to narrow a list. */
export function usePersonnelFilters({
  personnel,
  workCenters,
  units,
  sites,
  include = ALL_KEYS,
}: {
  personnel: Personnel[]
  workCenters: WorkCenter[]
  units: Unit[]
  sites: Site[]
  include?: PersonnelFilterKey[]
}): {
  bank: FilterBankItem[]
  apply: (list: Personnel[]) => Personnel[]
  active: boolean
} {
  const [statusF, setStatusF] = useState<Set<string>>(new Set())
  const [wcF, setWcF] = useState<Set<string>>(new Set())
  const [unitF, setUnitF] = useState<Set<string>>(new Set())
  const [siteF, setSiteF] = useState<Set<string>>(new Set())

  // Only offer values that are actually present in this list, so the funnels
  // don't list empty work centers / units / sites.
  const present = useMemo(() => {
    const wc = new Set<number>()
    const un = new Set<number>()
    const st = new Set<number>()
    const status = new Set<string>()
    for (const p of personnel) {
      if (p.work_center_id != null) wc.add(p.work_center_id)
      if (p.unit_id != null) un.add(p.unit_id)
      if (p.assigned_site_id != null) st.add(p.assigned_site_id)
      status.add(p.current_status)
    }
    return { wc, un, st, status }
  }, [personnel])

  const bank = useMemo<FilterBankItem[]>(() => {
    const all: Record<PersonnelFilterKey, FilterBankItem> = {
      status: {
        key: "status",
        label: "Status",
        options: PERSONNEL_STATUSES.filter((s) => present.status.has(s)).map(
          (s) => ({ value: s, label: PERSONNEL_STATUS_LABELS[s] }),
        ),
        selected: statusF,
        onChange: setStatusF,
      },
      work_center: {
        key: "work_center",
        label: "Work Center",
        searchable: true,
        options: workCenters
          .filter((w) => present.wc.has(w.id))
          .map((w) => ({ value: String(w.id), label: w.name }))
          .sort(byLabel),
        selected: wcF,
        onChange: setWcF,
      },
      unit: {
        key: "unit",
        label: "Unit",
        searchable: true,
        options: units
          .filter((u) => present.un.has(u.id))
          .map((u) => ({ value: String(u.id), label: u.name }))
          .sort(byLabel),
        selected: unitF,
        onChange: setUnitF,
      },
      assigned_site: {
        key: "assigned_site",
        label: "Site",
        searchable: true,
        options: sites
          .filter((s) => present.st.has(s.id))
          .map((s) => ({ value: String(s.id), label: s.name }))
          .sort(byLabel),
        selected: siteF,
        onChange: setSiteF,
      },
    }
    return include.map((k) => all[k])
  }, [include, present, workCenters, units, sites, statusF, wcF, unitF, siteF])

  const apply = (list: Personnel[]) =>
    list.filter((p) => {
      if (statusF.size > 0 && !statusF.has(p.current_status)) return false
      if (
        wcF.size > 0 &&
        !(p.work_center_id != null && wcF.has(String(p.work_center_id)))
      )
        return false
      if (
        unitF.size > 0 &&
        !(p.unit_id != null && unitF.has(String(p.unit_id)))
      )
        return false
      if (
        siteF.size > 0 &&
        !(p.assigned_site_id != null && siteF.has(String(p.assigned_site_id)))
      )
        return false
      return true
    })

  const active =
    statusF.size + wcF.size + unitF.size + siteF.size > 0

  return { bank, apply, active }
}
