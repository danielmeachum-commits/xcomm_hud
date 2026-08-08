"use client"

import { Boxes, Save, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { EquipmentKit, PackageInstance } from "@/lib/types"

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

async function send(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.ok) return null
  const payload = await res.json().catch(() => null)
  const detail = payload?.detail
  if (detail && typeof detail === "object" && detail.message) return detail.message
  return typeof detail === "string" ? detail : `Request failed (${res.status})`
}

/** Save a live package as a reusable kit.
 *
 *  The path that matters. Configure the FCP once by hand — unavoidable the
 *  first time — then keep it, so the next deployment checks items off instead
 *  of retyping serials. Authoring a kit from an empty form uses the same
 *  tables, but nobody would. */
export function SaveAsKitButton({
  packageInstance,
  pinnedCount,
  existingKits,
}: {
  packageInstance: PackageInstance
  pinnedCount: number
  existingKits: EquipmentKit[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(packageInstance.name)
  const [description, setDescription] = useState("")
  // Refreshing an existing kit rather than making another one: the real-world
  // set changes (a radio goes to depot, a replacement arrives) and the kit
  // should follow rather than accumulating near-duplicates.
  const [targetKitId, setTargetKitId] = useState<number | "new">("new")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    const err =
      targetKitId === "new"
        ? await send("/api/be/kits/capture", "POST", {
            package_instance_id: packageInstance.id,
            name: name.trim(),
            description: description.trim() || null,
          })
        : await send(`/api/be/kits/${targetKitId}/refresh`, "POST", {
            package_instance_id: packageInstance.id,
          })
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setName(packageInstance.name)
          setError(null)
        }
      }}
    >
      <DialogTrigger
        render={<Button size="sm" variant="ghost" className="gap-1.5" />}
      >
        <Save className="size-3.5" />
        Save as kit
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save “{packageInstance.name}” as a kit</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pins the {pinnedCount} serialized item
            {pinnedCount === 1 ? "" : "s"} currently on this package, plus its
            bulk counts, so the next deployment starts from them instead of a
            blank form. Nothing about this deployment changes.
          </p>

          {existingKits.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium">Save to</label>
              <select
                className={inputClass}
                value={targetKitId}
                onChange={(e) =>
                  setTargetKitId(
                    e.target.value === "new" ? "new" : Number(e.target.value),
                  )
                }
              >
                <option value="new">A new kit</option>
                {existingKits.map((k) => (
                  <option key={k.id} value={k.id}>
                    Replace “{k.name}” ({k.item_count} pinned)
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetKitId === "new" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Kit name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="FCP — 6th Comm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Description{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={run}
            disabled={pending || (targetKitId === "new" && !name.trim())}
          >
            {pending
              ? "Saving…"
              : targetKitId === "new"
                ? "Save kit"
                : "Replace kit contents"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Can we field this kit right now?
 *
 *  Three numbers answering different questions. `free` is gear no picture is
 *  currently using. `committed` is gear some picture already has in play —
 *  possibly this one, which is why the chip says "in use" rather than
 *  "elsewhere" —
 *  still deployable here, since workspaces are separate operating pictures and
 *  nothing is taken from anyone, but worth knowing when planning around a
 *  finite pool. `retired` is a pin whose asset has been struck from the
 *  property book, which is the one that actually blocks. */
function kitHealth(kit: EquipmentKit) {
  let free = 0
  let committed = 0
  let retired = 0
  for (const ku of kit.utcs) {
    for (const item of ku.items) {
      if (item.retired) retired++
      else if (item.commitments.length > 0) committed++
      else free++
    }
  }
  return { free, committed, retired }
}

export function KitsView({ kits }: { kits: EquipmentKit[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  async function remove(kit: EquipmentKit) {
    if (
      !confirm(
        `Delete the kit “${kit.name}”? No equipment is deleted — only the saved roster.`,
      )
    )
      return
    setBusyId(kit.id)
    setError(null)
    const err = await send(`/api/be/kits/${kit.id}`, "DELETE")
    setBusyId(null)
    if (err) {
      setError(err)
      return
    }
    router.refresh()
  }

  if (kits.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
        <Boxes className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No kits saved yet.</p>
        <p className="max-w-md text-xs text-muted-foreground">
          A kit remembers which UTCs go out and exactly which gear is in them,
          by name, from the unit&apos;s property book. Kits are global — save
          one here and every workspace can deploy it. Build a package the hard
          way once, then use <span className="font-medium">Save as kit</span> on
          the UTCs tab.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {kits.map((kit) => {
        const health = kitHealth(kit)
        const isOpen = expanded === kit.id
        return (
          <section key={kit.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : kit.id)}
                    className="font-medium hover:underline"
                  >
                    {kit.name}
                  </button>
                  {kit.package_def_code && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {kit.package_def_code}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {kit.is_global ? "Global" : "This workspace"}
                  </span>
                  {kit.retired_at && (
                    <span className="text-[11px] text-muted-foreground">
                      retired
                    </span>
                  )}
                </div>
                {kit.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {kit.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {kit.utcs.length} UTC{kit.utcs.length === 1 ? "" : "s"} ·{" "}
                  {kit.item_count} serialized
                  {kit.bulk_count > 0 && ` · ${kit.bulk_count} bulk units`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Delete kit"
                  disabled={busyId === kit.id}
                  onClick={() => remove(kit)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* The "can we field this right now?" line. Committed gear is not a
                problem — it is deployable, it just has to come off something
                else first, and knowing that before promising the package is
                the whole point. */}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5",
                  health.free > 0
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : "border-border text-muted-foreground",
                )}
              >
                {health.free} free
              </span>
              {health.committed > 0 && (
                <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-amber-600 dark:text-amber-400">
                  {health.committed} in use
                </span>
              )}
              {health.retired > 0 && (
                <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-destructive">
                  {health.retired} struck from the property book
                </span>
              )}
            </div>

            {isOpen && (
              <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                {kit.utcs.map((ku) => (
                  <div key={ku.id}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{ku.name}</span>
                      {ku.utc_def_code && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {ku.utc_def_code}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {ku.role_hint}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {ku.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-0.5 last:border-b-0"
                        >
                          <span>
                            <span className="font-mono">
                              {item.equipment_code ?? "—"}
                            </span>
                            <span className="ml-2 text-muted-foreground">
                              {item.type_short_name ?? item.type_title}
                            </span>
                            {item.serial_number && (
                              <span className="ml-2 text-muted-foreground">
                                {item.serial_number}
                              </span>
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            {item.retired
                              ? "struck from the property book"
                              : item.commitments.length === 0
                                ? "free"
                                : item.commitments
                                    .map(
                                      (c) =>
                                        `${c.workspace_name}${
                                          c.utc_name ? ` · ${c.utc_name}` : ""
                                        }`,
                                    )
                                    .join(", ")}
                          </span>
                        </li>
                      ))}
                      {ku.bulk.map((b) => (
                        <li
                          key={`b-${b.id}`}
                          className="flex justify-between gap-2 text-muted-foreground"
                        >
                          <span>{b.type_short_name ?? b.type_title}</span>
                          <span className="font-mono">×{b.quantity}</span>
                        </li>
                      ))}
                      {ku.items.length === 0 && ku.bulk.length === 0 && (
                        <li className="text-muted-foreground">
                          Nothing pinned.
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
