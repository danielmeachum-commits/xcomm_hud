"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { CopyField } from "@/components/personnel/copy-field"
import { RankInsignia } from "@/components/personnel/rank-insignia"
import { PersonnelCheckInDialog } from "@/components/personnel/personnel-checkin-dialog"
import { PersonnelForm } from "@/components/personnel/personnel-form"
import { PersonnelPill } from "@/components/personnel/personnel-pill"
import { PersonnelStatusBadge } from "@/components/personnel/personnel-status-badge"
import { PersonnelStatusPill } from "@/components/personnel/personnel-status-pill"
import { Button } from "@/components/ui/button"
import { BRANCH_LABELS, branchColor } from "@/lib/personnel-data"
import type {
  Personnel,
  PersonnelLocationEvent,
  Role,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"
import { formatLocal } from "@/lib/time"

interface Props {
  person: Personnel
  allPersonnel: Personnel[]
  workCenters: WorkCenter[]
  units: Unit[]
  teams: Team[]
  sites: Site[]
  history: PersonnelLocationEvent[]
  userRole: Role
}

export function PersonnelDetailClient({
  person,
  allPersonnel,
  workCenters,
  units,
  teams,
  sites,
  history,
  userRole,
}: Props) {
  const router = useRouter()
  const { w } = useWorkspace()
  const searchParams = useSearchParams()
  const canEdit = userRole !== "viewer"
  const canDelete = userRole === "admin"
  const [deleting, setDeleting] = useState(false)
  const [quickPending, setQuickPending] = useState(false)

  // When arriving from a site personnel tab, `from`/`fromLabel` let the
  // breadcrumb point back there instead of the full personnel list.
  const fromPath = searchParams.get("from")
  const fromLabel = searchParams.get("fromLabel")
  const parentCrumb =
    fromPath && fromLabel
      ? { label: fromLabel, href: fromPath }
      : { label: "Personnel", href: w("/personnel") }

  const personById = useMemo(
    () => new Map(allPersonnel.map((p) => [p.id, p])),
    [allPersonnel],
  )
  const wcById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc])),
    [workCenters],
  )
  const unitById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  )
  const siteById = useMemo(
    () => new Map(sites.map((s) => [s.id, s])),
    [sites],
  )
  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  )

  const supervisor = person.supervisor_id
    ? personById.get(person.supervisor_id)
    : null
  const reports = allPersonnel.filter((p) => p.supervisor_id === person.id)

  const bg = branchColor(person.branch, person.personnel_type)

  async function del() {
    if (!confirm(`Delete ${person.last_name}, ${person.first_name}?`)) return
    setDeleting(true)
    const res = await fetch(`/api/be/personnel/${person.id}`, {
      method: "DELETE",
    })
    if (res.ok) {
      router.push(w("/personnel"))
      router.refresh()
    } else {
      setDeleting(false)
      alert("Failed to delete")
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          parentCrumb,
          { label: `${person.last_name}, ${person.first_name}` },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex size-12 items-center justify-center rounded-lg bg-background p-1 shadow-sm ring-1"
            style={{
              backgroundColor: `${bg}15`,
              // @ts-expect-error — CSS var for the ring color
              "--tw-ring-color": bg,
            }}
          >
            <RankInsignia
              branch={person.branch}
              personnelType={person.personnel_type}
              rank={person.rank}
              size={40}
            />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {person.rank ? `${person.rank} ` : ""}
              {person.last_name}, {person.first_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <PersonnelStatusPill
                person={person}
                sites={sites}
                canEdit={canEdit}
                size="md"
              />
              {canEdit &&
                person.current_status !== "on_site" &&
                person.assigned_site_id && (
                  <QuickOnSiteButton
                    person={person}
                    disabled={quickPending}
                    setDisabled={setQuickPending}
                  />
                )}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <PersonnelCheckInDialog person={person} sites={sites} />
            <PersonnelForm
              person={person}
              workCenters={workCenters}
              units={units}
              teams={teams}
              sites={sites}
              supervisors={allPersonnel}
            />
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={del}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contact
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <CopyField
              label="Cellphone"
              value={person.cellphone}
              linkPrefix="tel:"
            />
            <CopyField label="DSN" value={person.dsn} linkPrefix="tel:" />
            <CopyField label="SIPR number" value={person.sipr_number} />
            <CopyField
              label="Email"
              value={person.email}
              linkPrefix="mailto:"
            />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assignment
          </h2>
          <dl className="grid grid-cols-1 gap-2 rounded-md border border-input p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[10px] uppercase text-muted-foreground">
                Branch
              </dt>
              <dd>
                {person.personnel_type === "civilian"
                  ? person.branch
                    ? `Civilian · ${BRANCH_LABELS[person.branch]}`
                    : "Civilian"
                  : person.branch
                    ? BRANCH_LABELS[person.branch]
                    : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-muted-foreground">
                Unit
              </dt>
              <dd>
                {person.unit_id ? unitById.get(person.unit_id)?.name : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-muted-foreground">
                Work center
              </dt>
              <dd>
                {person.work_center_id
                  ? wcById.get(person.work_center_id)?.name
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-muted-foreground">
                Assigned site
              </dt>
              <dd>
                {person.assigned_site_id
                  ? siteById.get(person.assigned_site_id)?.name
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-muted-foreground">
                Room
              </dt>
              <dd>{person.room_number || "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Chain of command
          </h2>
          <div className="space-y-2 rounded-md border border-input p-3 text-sm">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">
                Supervisor
              </div>
              {supervisor ? (
                <PersonnelPill
                  person={supervisor}
                  href={w(`/personnel/${supervisor.id}`)}
                  showFirstName
                />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">
                Direct reports ({reports.length})
              </div>
              {reports.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {reports.map((r) => (
                    <PersonnelPill
                      key={r.id}
                      person={r}
                      href={w(`/personnel/${r.id}`)}
                      size="sm"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Teams
          </h2>
          <div className="rounded-md border border-input p-3">
            {person.team_ids.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                Not on any teams.
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {person.team_ids.map((tid) => {
                  const t = teamById.get(tid)
                  if (!t) return null
                  return (
                    <span
                      key={tid}
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                      style={{
                        borderColor: t.color ?? undefined,
                        color: t.color ?? undefined,
                      }}
                    >
                      {t.name}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {person.notes && (
          <section className="space-y-2 md:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes
            </h2>
            <div className="whitespace-pre-wrap rounded-md border border-input p-3 text-sm">
              {person.notes}
            </div>
          </section>
        )}

        <section className="space-y-2 md:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Location history
          </h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5">When</th>
                  <th className="px-3 py-1.5">Status</th>
                  <th className="px-3 py-1.5">Site</th>
                  <th className="px-3 py-1.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-muted-foreground"
                    >
                      No history yet.
                    </td>
                  </tr>
                )}
                {history.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {formatLocal(h.changed_at)}
                    </td>
                    <td className="px-3 py-1.5">
                      <PersonnelStatusBadge status={h.status} />
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {h.site_id ? siteById.get(h.site_id)?.name ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {h.note ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function QuickOnSiteButton({
  person,
  disabled,
  setDisabled,
}: {
  person: Personnel
  disabled: boolean
  setDisabled: (v: boolean) => void
}) {
  const router = useRouter()
  async function checkin() {
    if (!person.assigned_site_id) return
    setDisabled(true)
    try {
      const res = await fetch(`/api/be/personnel/${person.id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "on_site",
          site_id: person.assigned_site_id,
          changed_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        alert("Failed to check in")
        return
      }
      router.refresh()
    } finally {
      setDisabled(false)
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={checkin} disabled={disabled}>
      {disabled ? "…" : "Check in now"}
    </Button>
  )
}
