"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FileText } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { DocPage } from "@/lib/types"

/** ⌘K search over the workspace's knowledge hub. cmdk filters on each item's
 * `value`, which includes the page body — so matches come from content, not
 * just titles (this is why the old fumadocs ⌘K returned nothing: its index was
 * built from files, but our content lives in the database). */
export function DocsSearch({
  open,
  onOpenChange,
  pages,
  base,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: DocPage[]
  base: string
}) {
  const router = useRouter()
  // Controlled so each result can highlight where the query hit the body — a
  // content match otherwise renders as a bare (unrelated-looking) title.
  const [query, setQuery] = useState("")

  const close = () => {
    setQuery("")
    onOpenChange(false)
  }
  const go = (slug: string) => {
    close()
    router.push(`${base}/${slug}`)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Search the Knowledge Hub"
      description="Find a documentation page by title or content"
    >
      <Command>
        <CommandInput
          placeholder="Search pages…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matching pages.</CommandEmpty>
          <CommandGroup heading="Pages">
            {pages.map((p) => {
              const snippet = matchSnippet(p.content, query)
              return (
                <CommandItem
                  key={p.id}
                  value={`${p.title} ${p.slug} ${p.description ?? ""} ${p.content}`}
                  onSelect={() => go(p.slug)}
                  className="items-start"
                >
                  <FileText className="mt-0.5 size-4 shrink-0 opacity-70" />
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{p.title}</span>
                    {snippet ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {snippet.before}
                        <mark className="rounded-sm bg-yellow-500/30 px-0.5 font-medium text-foreground">
                          {snippet.match}
                        </mark>
                        {snippet.after}
                      </span>
                    ) : p.description ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {p.description}
                      </span>
                    ) : null}
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

/** Find where `query` lands in a page's body and return a short window around
 * it (with the matched run isolated so the caller can highlight it). Tries the
 * whole query first, then the longest single token — mirrors how someone reads
 * a multi-word search. Returns null when nothing matches (title-only hit). */
function matchSnippet(
  content: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const q = query.trim()
  if (!q) return null
  const text = content.replace(/\s+/g, " ").trim()
  const hay = text.toLowerCase()

  let idx = hay.indexOf(q.toLowerCase())
  let len = q.length
  if (idx === -1) {
    // Fall back to the longest word the user typed — cmdk still fuzzy-matched
    // the page, but we want a concrete anchor to show.
    const tokens = q
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .sort((a, b) => b.length - a.length)
    for (const t of tokens) {
      const at = hay.indexOf(t.toLowerCase())
      if (at !== -1) {
        idx = at
        len = t.length
        break
      }
    }
  }
  if (idx === -1) return null

  const radius = 40
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + len + radius)
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, idx),
    match: text.slice(idx, idx + len),
    after: text.slice(idx + len, end) + (end < text.length ? "…" : ""),
  }
}
