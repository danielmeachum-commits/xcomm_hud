"use client"

import { Check, ScanLine, UserPlus, UserRoundCheck, UsersRound, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EscortCombobox } from "@/components/personnel/escort-combobox"
import {
  BRANCHES,
  BRANCH_LABELS,
  personName,
  ranksFor,
} from "@/lib/personnel-data"
import type {
  Branch,
  KioskPending,
  Person,
  Personnel,
  PersonnelType,
  Unit,
} from "@/lib/types"

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

type Action = "link" | "roster" | "guest"

function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleString()
}

/** "DOE" → "Doe", "MC-DONALD" → "Mc-Donald": cards are all caps. */
function titleCase(s: string | null): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
}

/** The app's rank for what the card says: the free-text rank first
 *  ("SSGT" → "SSgt"), then the pay grade ("E-5"). */
function guessRank(
  type: PersonnelType,
  branch: Branch | null,
  cardRank: string | null,
  payGrade: string | null,
): string {
  const list = ranksFor(type, branch)
  const byText = cardRank
    ? list.find((r) => r.short.toLowerCase() === cardRank.toLowerCase())
    : undefined
  if (byText) return byText.short
  const byGrade = payGrade ? list.find((r) => r.grade === payGrade) : undefined
  return byGrade?.short ?? ""
}

function cardName(p: KioskPending): string {
  if (!p.last_name) return "No name on card"
  // Typed at the kiosk, not read off a card: leave the casing alone.
  if (p.kind === "guest_request")
    return `${p.last_name}${p.first_name ? ", " + p.first_name : ""}`
  const first = [p.first_name, p.middle_initial].filter(Boolean).join(" ")
  return `${titleCase(p.last_name)}${first ? ", " + titleCase(first) : ""}`
}

interface Props {
  pending: KioskPending[]
  roster: Person[]
  personnel: Personnel[]
  units: Unit[]
}

/**
 * Cards a check-in station couldn't place. The operator says whose card it
 * is — an existing roster person, a new roster person, or a guest — and the
 * person is signed in where and when they scanned.
 */
export function KioskPendingPanel({ pending, roster, personnel, units }: Props) {
  const [done, setDone] = useState<string | null>(null)
  if (pending.length === 0 && !done) return null
  return (
    <section className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <ScanLine className="mt-0.5 size-4 text-amber-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            Unrecognized cards{pending.length > 0 && ` · ${pending.length}`}
          </h2>
          <p className="text-xs text-muted-foreground">
            Scanned at a check-in station but not matched to anyone here. Say
            whose card it is — they&apos;re signed in at the time and place
            they scanned, and their next scan is recognized.
          </p>
        </div>
      </div>
      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <Check className="size-4" /> {done}
        </p>
      )}
      {pending.length > 0 && (
      <ul className="mt-2 divide-y rounded-md border bg-background">
        {pending.map((p) => (
          <PendingRow
            key={p.id}
            item={p}
            roster={roster}
            personnel={personnel}
            units={units}
            onDone={setDone}
          />
        ))}
      </ul>
      )}
    </section>
  )
}

function PendingRow({
  item,
  roster,
  personnel,
  units,
  onDone,
}: {
  item: KioskPending
  roster: Person[]
  personnel: Personnel[]
  units: Unit[]
  onDone: (msg: string) => void
}) {
  const router = useRouter()
  const [action, setAction] = useState<Action | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signIn, setSignIn] = useState(item.can_sign_in)

  async function post(path: string, body?: object, method = "POST") {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/kiosk-pending/${item.id}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify({ ...body, sign_in: signIn }) : undefined,
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(
          typeof d.detail === "string" ? d.detail : "Couldn't save that",
        )
      }
      if (res.status !== 204) {
        const out = await res.json()
        onDone(
          out.signed_in
            ? `${out.name} signed in at ${out.site_name}.`
            : `${out.name} enrolled.`,
        )
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that")
    } finally {
      setPending(false)
    }
  }

  const where = [item.station_name, item.site_name].filter(Boolean).join(" · ")
  const signInLabel = item.can_sign_in
    ? `Sign them in at ${item.site_name}`
    : null

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            {cardName(item)}
            {item.kind === "guest_request" && (
              <span className="ml-2 rounded bg-sky-500/10 px-1.5 py-0.5 text-xs font-normal text-sky-700 dark:text-sky-400">
                guest · no CAC
              </span>
            )}
            {(item.rank || item.pay_grade) && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                card: {[item.rank, item.pay_grade].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {where || "station removed"} ·{" "}
            {ago(item.last_scanned_at)}
            {item.scan_count > 1 &&
              (item.kind === "guest_request"
                ? ` · asked ${item.scan_count}×`
                : ` · scanned ${item.scan_count}×`)}
            {item.card_expired && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                card expired
              </span>
            )}
          </div>
          {item.kind === "guest_request" &&
            (item.affiliation || item.escort) && (
              <div className="mt-1 text-xs">
                {item.affiliation && <>From <b>{item.affiliation}</b></>}
                {item.affiliation && item.escort && " · "}
                {item.escort && <>visiting <b>{item.escort}</b></>}
              </div>
            )}
          {item.kind === "not_in_workspace" && (
            <div className="mt-1 text-xs">
              On the roster as <b>{item.person_name}</b>, not in this workspace.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.kind === "not_in_workspace" ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => post("/link", { person_id: item.person_id })}
            >
              <UserRoundCheck className="size-4" />
              {item.can_sign_in ? "Add here & sign in" : "Add to this workspace"}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant={action === "link" ? "default" : "outline"}
                onClick={() => setAction(action === "link" ? null : "link")}
              >
                <UserRoundCheck className="size-4" /> Link to roster
              </Button>
              <Button
                size="sm"
                variant={action === "roster" ? "default" : "outline"}
                onClick={() => setAction(action === "roster" ? null : "roster")}
              >
                <UserPlus className="size-4" /> Add to roster
              </Button>
              <Button
                size="sm"
                variant={action === "guest" ? "default" : "outline"}
                onClick={() => setAction(action === "guest" ? null : "guest")}
              >
                <UsersRound className="size-4" /> Guest
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            title="Dismiss — not someone to sign in"
            disabled={pending}
            onClick={() => post("", undefined, "DELETE")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {action === "link" && (
        <LinkForm
          item={item}
          roster={roster}
          pending={pending}
          onSubmit={(personId) => post("/link", { person_id: personId })}
        />
      )}
      {(action === "roster" || action === "guest") && (
        <NewPersonForm
          key={action}
          item={item}
          guest={action === "guest"}
          units={units}
          personnel={personnel}
          pending={pending}
          onSubmit={(body) => post(action === "guest" ? "/guest" : "/roster", body)}
        />
      )}

      {action && signInLabel && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={signIn}
            onChange={(e) => setSignIn(e.target.checked)}
            disabled={pending}
          />
          {signInLabel}
        </label>
      )}
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

function LinkForm({
  item,
  roster,
  pending,
  onSubmit,
}: {
  item: KioskPending
  roster: Person[]
  pending: boolean
  onSubmit: (personId: number) => void
}) {
  const [query, setQuery] = useState("")
  const [chosen, setChosen] = useState<number | null>(
    item.suggestions[0]?.person_id ?? null,
  )
  // Only people without a card yet: linking never reassigns a DoD ID.
  const unlinked = useMemo(() => roster.filter((p) => !p.has_cac), [roster])
  const q = query.trim().toLowerCase()
  const results = q
    ? unlinked
        .filter((p) =>
          `${p.last_name} ${p.first_name} ${p.rank ?? ""}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 8)
    : []
  const chosenPerson = unlinked.find((p) => p.id === chosen)

  return (
    <div className="mt-3 space-y-2 rounded-md border p-3">
      {item.suggestions.length > 0 && (
        <div className="space-y-1">
          <Label>Same surname on the roster</Label>
          <div className="flex flex-wrap gap-1.5">
            {item.suggestions.map((s) => (
              <Button
                key={s.person_id}
                size="sm"
                variant={chosen === s.person_id ? "default" : "outline"}
                onClick={() => setChosen(s.person_id)}
              >
                {s.rank ? `${s.rank} ` : ""}
                {s.name}
                {s.in_workspace && (
                  <span className="text-xs opacity-70">· here</span>
                )}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`link-q-${item.id}`}>Find on the roster</Label>
        <Input
          id={`link-q-${item.id}`}
          value={query}
          placeholder="Name or rank"
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {results.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={chosen === p.id ? "default" : "outline"}
                onClick={() => setChosen(p.id)}
              >
                {p.rank ? `${p.rank} ` : ""}
                {personName(p)}
              </Button>
            ))}
          </div>
        )}
        {q && results.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No one on the roster without a DoD ID matches.
          </p>
        )}
      </div>
      <Button
        size="sm"
        disabled={pending || chosen == null}
        onClick={() => chosen != null && onSubmit(chosen)}
      >
        {chosenPerson
          ? `Link to ${chosenPerson.rank ? chosenPerson.rank + " " : ""}${personName(chosenPerson)}`
          : "Pick someone"}
      </Button>
    </div>
  )
}

function NewPersonForm({
  item,
  guest,
  units,
  personnel,
  pending,
  onSubmit,
}: {
  item: KioskPending
  guest: boolean
  units: Unit[]
  personnel: Personnel[]
  pending: boolean
  onSubmit: (body: object) => void
}) {
  const startType: PersonnelType = item.is_civilian ? "civilian" : "military"
  const startBranch: Branch | null =
    item.branch ?? (startType === "military" ? "air_force" : null)
  const [type, setType] = useState<PersonnelType>(startType)
  const [branch, setBranch] = useState<Branch | null>(startBranch)
  const [rank, setRank] = useState(
    guessRank(startType, startBranch, item.rank, item.pay_grade),
  )
  const [last, setLast] = useState(titleCase(item.last_name))
  const [first, setFirst] = useState(titleCase(item.first_name))
  const [unitId, setUnitId] = useState("")
  const [affiliation, setAffiliation] = useState(item.affiliation ?? "")
  const [escort, setEscort] = useState(item.escort ?? "")
  const ranks = ranksFor(type, branch)
  const id = (k: string) => `np-${item.id}-${k}`

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={id("last")}>Last name</Label>
        <Input
          id={id("last")}
          value={last}
          onChange={(e) => setLast(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("first")}>First name</Label>
        <Input
          id={id("first")}
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("type")}>Type</Label>
        <select
          id={id("type")}
          className={selectClass}
          value={type}
          disabled={pending}
          onChange={(e) => {
            const t = e.target.value as PersonnelType
            setType(t)
            setRank(guessRank(t, branch, item.rank, item.pay_grade))
          }}
        >
          <option value="military">Military</option>
          <option value="civilian">Civilian</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("branch")}>Branch</Label>
        <select
          id={id("branch")}
          className={selectClass}
          value={branch ?? ""}
          disabled={pending}
          onChange={(e) => {
            const b = (e.target.value || null) as Branch | null
            setBranch(b)
            setRank(guessRank(type, b, item.rank, item.pay_grade))
          }}
        >
          {type === "civilian" && <option value="">— None —</option>}
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {BRANCH_LABELS[b]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("rank")}>Rank</Label>
        <select
          id={id("rank")}
          className={selectClass}
          value={rank}
          disabled={pending}
          onChange={(e) => setRank(e.target.value)}
        >
          <option value="">— None —</option>
          {ranks.map((r) => (
            <option key={r.grade + r.short} value={r.short}>
              {r.grade} · {r.short}
            </option>
          ))}
        </select>
      </div>
      {guest ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={id("aff")}>Affiliation</Label>
            <Input
              id={id("aff")}
              value={affiliation}
              placeholder="Their unit or organization"
              onChange={(e) => setAffiliation(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Escort</Label>
            <EscortCombobox
              value={escort}
              onChange={setEscort}
              personnel={personnel.filter((p) => !p.is_guest)}
              disabled={pending}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={id("unit")}>Unit</Label>
          <select
            id={id("unit")}
            className={selectClass}
            value={unitId}
            disabled={pending}
            onChange={(e) => setUnitId(e.target.value)}
          >
            <option value="">— None —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button
          size="sm"
          disabled={pending || !last.trim()}
          onClick={() =>
            onSubmit({
              personnel_type: type,
              branch,
              rank: rank || null,
              last_name: last.trim(),
              first_name: first.trim(),
              unit_id: !guest && unitId ? Number(unitId) : null,
              affiliation: guest ? affiliation.trim() || null : null,
              escort: guest ? escort.trim() || null : null,
            })
          }
        >
          {guest ? "Add guest" : "Add to roster"}
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">
          Prefilled from the card — check before saving.
        </span>
      </div>
    </div>
  )
}
