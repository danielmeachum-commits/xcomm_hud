"use client"

import { Plus, Search, Trash2, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type {
  AssetImportResult,
  EquipmentAsset,
  EquipmentType,
} from "@/lib/types"

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
  if (detail && typeof detail === "object" && detail.message)
    return detail.message
  return typeof detail === "string" ? detail : `Request failed (${res.status})`
}

function AddAssetButton({ types }: { types: EquipmentType[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typeId, setTypeId] = useState<number | "">("")
  const [serial, setSerial] = useState("")
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const serialized = types.filter((t) => t.serialized && !t.retired_at)

  async function run() {
    setPending(true)
    setError(null)
    const err = await send("/api/be/assets", "POST", {
      equipment_type_id: Number(typeId),
      serial_number: serial.trim() || null,
      // Left blank means "derive it" — same prefix + last-4 rule the deploy
      // wizard shows, resolved server-side against the global namespace.
      equipment_code: code.trim() || null,
    })
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setOpen(false)
    setTypeId("")
    setSerial("")
    setCode("")
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="size-4" />
        Add asset
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to the property book</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            One row per physical box the unit owns. Every workspace draws from
            this list, so the serial is typed once here and never again.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium">Type</label>
            <select
              className={inputClass}
              value={typeId}
              onChange={(e) =>
                setTypeId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Select a type…</option>
              {serialized.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.short_name ?? t.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Serial number
            </label>
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Equipment ID{" "}
              <span className="text-muted-foreground">
                (blank to derive from the serial)
              </span>
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={cn(inputClass, "font-mono")}
            />
          </div>
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
            disabled={pending || typeId === ""}
          >
            {pending ? "Adding…" : "Add asset"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Sweep the current workspace's registered gear into the property book.
 *
 *  The bridge from before assets existed: a workspace that already typed its
 *  serials contributes them once instead of anyone retyping them globally.
 *  Matching is by serial then equipment ID, and it links rather than
 *  duplicates — running it twice is a no-op. */
function ImportButton({ workspaceName }: { workspaceName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AssetImportResult | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    const res = await fetch("/api/be/assets/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    setPending(false)
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      setError(payload?.detail ?? `Import failed (${res.status})`)
      return
    }
    setResult((await res.json()) as AssetImportResult)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setResult(null)
          setError(null)
        }
      }}
    >
      <DialogTrigger
        render={<Button size="sm" variant="outline" className="gap-1.5" />}
      >
        <Upload className="size-4" />
        Import from this workspace
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import gear from {workspaceName}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{result.created.length}</span> added
              to the property book,{" "}
              <span className="font-medium">{result.linked}</span> already
              linked.
            </p>
            {result.skipped.length > 0 && (
              <div>
                <p className="text-xs font-medium text-destructive">
                  {result.skipped.length} skipped
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {result.skipped.map((sk, i) => (
                    <li key={i}>{sk}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Adds every serialized item registered in this workspace to the
            global property book, matching on serial first and equipment ID
            second. Nothing in the workspace changes, and running it again does
            nothing — gear already linked is left alone.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button type="button" size="sm" onClick={run} disabled={pending}>
              {pending ? "Importing…" : "Import"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PropertyBookClient({
  assets,
  types,
  workspaceName,
  canEdit,
}: {
  assets: EquipmentAsset[]
  types: EquipmentType[]
  workspaceName: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assets
    return assets.filter((a) =>
      [a.equipment_code, a.serial_number, a.type_title, a.type_short_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    )
  }, [assets, search])

  const free = assets.filter(
    (a) => !a.retired_at && a.commitments.length === 0,
  ).length
  const busyCount = assets.filter(
    (a) => !a.retired_at && a.commitments.length > 0,
  ).length

  async function retire(asset: EquipmentAsset) {
    if (
      !confirm(
        `Strike ${asset.equipment_code} from the property book? Workspaces that already deployed it keep their records.`,
      )
    )
      return
    setBusy(asset.id)
    setError(null)
    const err = await send(`/api/be/assets/${asset.id}`, "DELETE")
    setBusy(null)
    if (err) {
      setError(err)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, serial, type…"
              className="h-9 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-sm"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {assets.length} owned · {free} free · {busyCount} in use
          </span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <ImportButton workspaceName={workspaceName} />
            <AddAssetButton types={types} />
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {assets.length === 0
              ? "The property book is empty."
              : `Nothing matches “${search}”.`}
          </p>
          {assets.length === 0 && (
            <p className="max-w-md text-xs text-muted-foreground">
              This is the unit&apos;s gear, held once and shared by every
              workspace. The quickest start is{" "}
              <span className="font-medium">Import from this workspace</span> —
              it promotes serials you have already typed.
            </p>
          )}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left">Equipment ID</th>
              <th className="py-2 text-left">Type</th>
              <th className="py-2 text-left">Serial</th>
              <th className="py-2 text-left">In use by</th>
              {canEdit && <th className="py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr
                key={a.id}
                className={cn(
                  "border-b last:border-0 align-top",
                  a.retired_at && "opacity-50",
                )}
              >
                <td className="py-2 font-mono">
                  {a.equipment_code}
                  {a.retired_at && (
                    <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                      struck
                    </span>
                  )}
                </td>
                <td className="py-2">{a.type_short_name ?? a.type_title}</td>
                <td className="py-2 text-muted-foreground">
                  {a.serial_number ?? "—"}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {a.commitments.length === 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      free
                    </span>
                  ) : (
                    a.commitments
                      .map(
                        (c) =>
                          `${c.workspace_name}${
                            c.utc_name ? ` · ${c.utc_name}` : ""
                          }`,
                      )
                      .join(", ")
                  )}
                </td>
                {canEdit && (
                  <td className="py-2 text-right">
                    {!a.retired_at && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Strike from the property book"
                        disabled={busy === a.id}
                        onClick={() => retire(a)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
