"use client"

import { useState, type ReactNode, type RefObject } from "react"
import {
  Bold,
  Code,
  FileImage,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  Paperclip,
  Quote,
  Table as TableIcon,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import type { Document } from "@/lib/types"

const TABLE_SNIPPET = "\n| Column | Column |\n| --- | --- |\n| Cell | Cell |\n"

/** Formatting toolbar over the markdown source. Every action reads the
 * textarea's live selection, rewrites it with setRangeText (native undo works),
 * and syncs React state via onChange. */
export function EditorToolbar({
  textareaRef,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
}) {
  function withTextarea(fn: (ta: HTMLTextAreaElement) => void) {
    const ta = textareaRef.current
    if (!ta) return
    ta.focus()
    fn(ta)
    onChange(ta.value)
  }

  function surround(before: string, after = before) {
    withTextarea((ta) => {
      const { selectionStart: s, selectionEnd: e, value } = ta
      const sel = value.slice(s, e)
      ta.setRangeText(before + sel + after, s, e, "end")
      ta.setSelectionRange(s + before.length, s + before.length + sel.length)
    })
  }

  function link() {
    withTextarea((ta) => {
      const { selectionStart: s, selectionEnd: e, value } = ta
      const sel = value.slice(s, e) || "text"
      ta.setRangeText(`[${sel}](url)`, s, e, "end")
      const urlStart = s + 1 + sel.length + 2
      ta.setSelectionRange(urlStart, urlStart + 3)
    })
  }

  function prefixLines(transform: (line: string) => string) {
    withTextarea((ta) => {
      const { selectionStart: s, selectionEnd: e, value } = ta
      const lineStart = value.lastIndexOf("\n", s - 1) + 1
      let lineEnd = value.indexOf("\n", e)
      if (lineEnd === -1) lineEnd = value.length
      const block = value.slice(lineStart, lineEnd)
      const next = block.split("\n").map(transform).join("\n")
      ta.setRangeText(next, lineStart, lineEnd, "end")
      ta.setSelectionRange(lineStart, lineStart + next.length)
    })
  }

  function heading(level: number) {
    const hashes = "#".repeat(level)
    prefixLines((line) => `${hashes} ${line.replace(/^#{1,6}\s+/, "")}`)
  }

  function insert(text: string) {
    withTextarea((ta) => {
      const { selectionStart: s, selectionEnd: e } = ta
      ta.setRangeText(text, s, e, "end")
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1">
      <TbBtn label="Heading 1" onClick={() => heading(1)}>
        <Heading1 />
      </TbBtn>
      <TbBtn label="Heading 2" onClick={() => heading(2)}>
        <Heading2 />
      </TbBtn>
      <TbBtn label="Heading 3" onClick={() => heading(3)}>
        <Heading3 />
      </TbBtn>
      <Divider />
      <TbBtn label="Bold" onClick={() => surround("**")}>
        <Bold />
      </TbBtn>
      <TbBtn label="Italic" onClick={() => surround("*")}>
        <Italic />
      </TbBtn>
      <TbBtn label="Inline code" onClick={() => surround("`")}>
        <Code />
      </TbBtn>
      <TbBtn label="Link" onClick={link}>
        <Link2 />
      </TbBtn>
      <Divider />
      <TbBtn
        label="Bulleted list"
        onClick={() =>
          prefixLines((l) => (l.startsWith("- ") ? l.slice(2) : `- ${l}`))
        }
      >
        <List />
      </TbBtn>
      <TbBtn
        label="Quote"
        onClick={() =>
          prefixLines((l) => (l.startsWith("> ") ? l.slice(2) : `> ${l}`))
        }
      >
        <Quote />
      </TbBtn>
      <TbBtn label="Table" onClick={() => insert(TABLE_SNIPPET)}>
        <TableIcon />
      </TbBtn>
      <Divider />
      <DocumentPicker onInsert={insert} />
    </div>
  )
}

function TbBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-border" />
}

/** Browse this workspace's files and insert a markdown image (for images) or a
 * link (everything else) pointing at the document's inline download URL. */
function DocumentPicker({ onInsert }: { onInsert: (md: string) => void }) {
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<Document[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/be/documents")
      if (!res.ok) throw new Error("Failed to load documents")
      setDocs(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents")
      setDocs([])
    } finally {
      setLoading(false)
    }
  }

  function handleOpen(o: boolean) {
    setOpen(o)
    if (o && docs === null) load()
  }

  function pick(doc: Document) {
    const url = `/api/documents/${doc.id}/download?inline=1`
    const label = (doc.title?.trim() || doc.filename).replace(/[[\]]/g, "")
    const md = doc.content_type.startsWith("image/")
      ? `![${label}](${url})`
      : `[${label}](${url})`
    onInsert(md)
    setOpen(false)
  }

  const shown = (docs ?? []).filter((d) =>
    `${d.title ?? ""} ${d.filename}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  )

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger
        title="Insert document"
        aria-label="Insert document"
        className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground [&_svg]:size-4"
      >
        <Paperclip />
        Document
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search documents…"
          className="mb-2 h-8"
        />
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              Loading…
            </p>
          ) : error ? (
            <p className="px-1 py-4 text-center text-xs text-destructive">
              {error}
            </p>
          ) : shown.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {docs && docs.length === 0
                ? "No documents in this workspace."
                : "No matches."}
            </p>
          ) : (
            <ul className="flex flex-col">
              {shown.map((d) => {
                const isImage = d.content_type.startsWith("image/")
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => pick(d)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {isImage ? (
                        <FileImage className="size-4 shrink-0 opacity-70" />
                      ) : (
                        <FileText className="size-4 shrink-0 opacity-70" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {d.title?.trim() || d.filename}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {d.filename}
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                        {isImage ? "img" : "link"}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <p className="mt-2 border-t border-border px-1 pt-2 text-[11px] text-muted-foreground">
          Workspace files — images embed inline, others insert as links.
        </p>
      </PopoverContent>
    </Popover>
  )
}
