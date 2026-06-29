"use client"

import { useState } from "react"
import {
  ArrowUpFromLine,
  Columns2,
  PlusCircle,
  RotateCcw,
  Rows2,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { findNode } from "@/lib/dashboard/default"
import { getWidget, listWidgets } from "@/lib/dashboard/widgets"
import type { LayoutNode } from "@/lib/dashboard/types"

import { useDashboard } from "./dashboard-context"

export function SidebarEditor() {
  const {
    layout,
    selectedId,
    addWidget,
    removeNode,
    toggleOrientation,
    promoteToStandalone,
    wrapInSplit,
    resetLayout,
  } = useDashboard()

  const selected: { node: LayoutNode; parent: ReturnType<typeof findNode> } =
    selectedId
      ? (() => {
          const hit = findNode(layout.root, selectedId)
          return hit
            ? { node: hit.node, parent: hit }
            : { node: layout.root, parent: null }
        })()
      : { node: layout.root, parent: null }

  const widgets = listWidgets()
  const root = layout.root

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-3 py-4">
      <Section title="Layout">
        <KV
          label="Root orientation"
          value={root.orientation === "h" ? "Horizontal" : "Vertical"}
          action={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Toggle root orientation"
              onClick={() => toggleOrientation(root.id)}
            >
              {root.orientation === "h" ? <Rows2 /> : <Columns2 />}
            </Button>
          }
        />
      </Section>

      <Separator className="bg-sidebar-border" />

      {selected.node.id !== root.id && (
        <>
          <Section title="Selected">
            <KV
              label="Type"
              value={
                selected.node.kind === "split"
                  ? "Stack"
                  : getWidget(selected.node.widgetId)?.title ?? "Widget"
              }
            />
            {selected.node.kind === "split" && (
              <KV
                label="Orientation"
                value={selected.node.orientation === "h" ? "Horizontal" : "Vertical"}
                action={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Toggle orientation"
                    onClick={() => toggleOrientation(selected.node.id)}
                  >
                    {selected.node.orientation === "h" ? <Rows2 /> : <Columns2 />}
                  </Button>
                }
              />
            )}
            <div className="grid gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start gap-2"
                onClick={() => wrapInSplit(selected.node.id, "h")}
              >
                <Columns2 className="size-3.5" />
                Wrap in horizontal stack
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start gap-2"
                onClick={() => wrapInSplit(selected.node.id, "v")}
              >
                <Rows2 className="size-3.5" />
                Wrap in vertical stack
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start gap-2"
                onClick={() => promoteToStandalone(selected.node.id)}
              >
                <ArrowUpFromLine className="size-3.5" />
                Move to root
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start gap-2 text-destructive hover:text-destructive"
                onClick={() => removeNode(selected.node.id)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          </Section>
          <Separator className="bg-sidebar-border" />
        </>
      )}

      <Section title="Add widget">
        <div className="flex flex-col gap-1.5">
          {widgets.map((w) => {
            const eligibleParent =
              selected.node.kind === "split" ? selected.node.id : root.id
            const targetId = w.standaloneOnly ? root.id : eligibleParent
            const disabledReason =
              w.standaloneOnly && eligibleParent !== root.id
                ? "Standalone widgets attach to root."
                : null
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => addWidget(w.id, targetId)}
                className={cn(
                  "group flex flex-col rounded-md border border-sidebar-border bg-sidebar-accent/30 p-2 text-left transition-colors hover:border-primary/50 hover:bg-sidebar-accent/60",
                )}
                title={disabledReason ?? "Add to selected stack"}
              >
                <div className="flex items-center justify-between text-xs font-medium text-sidebar-foreground">
                  {w.title}
                  <PlusCircle className="size-3.5 text-sidebar-foreground/40 group-hover:text-primary" />
                </div>
                {w.description && (
                  <div className="mt-0.5 text-[11px] text-sidebar-foreground/60">
                    {w.description}
                  </div>
                )}
                {w.standaloneOnly && (
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-primary/80">
                    Standalone
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </Section>
      </div>

      <div className="border-t border-sidebar-border px-3 py-3">
        <ResetButton onConfirm={resetLayout} />
      </div>
    </div>
  )
}

function ResetButton({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground/80"
          />
        }
      >
        <RotateCcw className="size-3.5" />
        Reset to default
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset dashboard?</DialogTitle>
          <DialogDescription>
            This replaces your current layout with the default. Any widgets
            you&apos;ve added or rearranged will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              setOpen(false)
            }}
          >
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

function KV({
  label,
  value,
  action,
}: {
  label: string
  value: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-sidebar-border bg-sidebar-accent/20 px-2.5 py-1.5">
      <div className="flex flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">
          {label}
        </span>
        <span className="text-sm">{value}</span>
      </div>
      {action}
    </div>
  )
}
