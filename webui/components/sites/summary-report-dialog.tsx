"use client"

import { FileDown } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Site } from "@/lib/types"

/** Filename from `Content-Disposition: attachment; filename="…"`. */
function filenameFrom(disposition: string | null): string {
  const m = disposition?.match(/filename="([^"]+)"/)
  return m ? m[1] : "xcomm-summary.pdf"
}

/**
 * The status summary as a PDF: every site's posture, services and gateways,
 * with remarks typed here. The remarks go into the PDF only — nothing is
 * saved, so writing a SITREP remark never changes anything in the app.
 */
export function SummaryReportDialog({ sites }: { sites: Site[] }) {
  const [open, setOpen] = useState(false)
  const [remark, setRemark] = useState("")
  const [siteRemarks, setSiteRemarks] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function download() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/reports/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remark,
          site_remarks: Object.fromEntries(
            Object.entries(siteRemarks).filter(([, v]) => v.trim() !== ""),
          ),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't build the report")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filenameFrom(res.headers.get("Content-Disposition"))
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the report")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <FileDown className="size-3.5" />
            Summary report
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Summary report</DialogTitle>
          <DialogDescription>
            A PDF of every site&apos;s status, services and gateways as they
            stand now. Remarks go into the PDF only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="report-remark">Remarks</Label>
          <Textarea
            id="report-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Overall situation, issues, next update…"
            className="min-h-24"
            maxLength={4000}
            disabled={pending}
          />
        </div>

        {sites.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium">
              Site remarks <span className="font-normal text-muted-foreground">(optional)</span>
            </div>
            <ul className="divide-y rounded-md border">
              {sites.map((s) => {
                const has = (siteRemarks[s.id] ?? "").trim() !== ""
                return (
                  <li key={s.id} className="px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left text-sm"
                      onClick={() => toggle(s.id)}
                      aria-expanded={expanded.has(s.id)}
                    >
                      <span>{s.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {has ? "remark added" : expanded.has(s.id) ? "hide" : "add remark"}
                      </span>
                    </button>
                    {expanded.has(s.id) && (
                      <Textarea
                        aria-label={`Remark for ${s.name}`}
                        value={siteRemarks[s.id] ?? ""}
                        onChange={(e) =>
                          setSiteRemarks((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        className="mt-2 min-h-16"
                        disabled={pending}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={download} disabled={pending} className="gap-1.5">
            <FileDown className="size-3.5" />
            {pending ? "Building…" : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
