"use client"

import { useRouter } from "next/navigation"
import { FileText, Globe } from "lucide-react"
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
  const go = (slug: string) => {
    onOpenChange(false)
    router.push(`${base}/${slug}`)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search the Knowledge Hub"
      description="Find a documentation page by title or content"
    >
      <Command>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No matching pages.</CommandEmpty>
          <CommandGroup heading="Pages">
            {pages.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.title} ${p.slug} ${p.description ?? ""} ${p.content}`}
                onSelect={() => go(p.slug)}
              >
                {p.is_global ? (
                  <Globe className="size-4 opacity-70" />
                ) : (
                  <FileText className="size-4 opacity-70" />
                )}
                <span className="font-medium">{p.title}</span>
                {p.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {p.description}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
