"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { PersonnelCsvImportResult } from "@/lib/types"

const SAMPLE_HEADER =
  "first_name,last_name,personnel_type,branch,rank,cellphone,dsn,sipr_number,email,notes,work_center,unit,room_number"

export function PersonnelCsvImport() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [csvText, setCsvText] = useState("")
  const [createMissing, setCreateMissing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PersonnelCsvImportResult | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/be/personnel/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv_text: csvText,
          create_missing: createMissing,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to import CSV")
      }
      const body: PersonnelCsvImportResult = await res.json()
      setResult(body)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setCsvText("")
          setError(null)
          setResult(null)
        }
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            Import CSV
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import personnel from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Paste CSV content below. Required columns:{" "}
            <code className="rounded bg-muted px-1">first_name</code>,{" "}
            <code className="rounded bg-muted px-1">last_name</code>. Optional
            columns are matched by header name (case-insensitive):
            personnel_type, branch, rank, cellphone, dsn, sipr_number, email,
            notes, work_center, unit, room_number.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="csv">CSV</Label>
            <Textarea
              id="csv"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={SAMPLE_HEADER}
              rows={12}
              className="font-mono text-xs"
              disabled={pending}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(e) => setCreateMissing(e.target.checked)}
              disabled={pending}
            />
            Auto-create missing work centers and units
          </label>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="rounded-md border border-input bg-muted/40 px-3 py-2 text-xs">
              <p className="font-medium text-foreground">
                Imported {result.imported}, skipped {result.skipped}
              </p>
              {result.created_work_centers.length > 0 && (
                <p className="text-muted-foreground">
                  Created work centers: {result.created_work_centers.join(", ")}
                </p>
              )}
              {result.created_units.length > 0 && (
                <p className="text-muted-foreground">
                  Created units: {result.created_units.join(", ")}
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-destructive">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {result.errors.length > 10 && (
                    <li>… and {result.errors.length - 10} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || !csvText.trim()}
          >
            {pending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
