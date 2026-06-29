"use client"

import { Pencil, Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useDashboard } from "./dashboard-context"

export function EditToggle() {
  const { editMode, setEditMode } = useDashboard()
  return (
    <Button
      type="button"
      variant={editMode ? "default" : "outline"}
      size="sm"
      onClick={() => setEditMode(!editMode)}
      className="gap-1.5"
    >
      {editMode ? <Eye data-icon="inline-start" /> : <Pencil data-icon="inline-start" />}
      {editMode ? "Done" : "Edit"}
    </Button>
  )
}
