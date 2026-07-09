"use client"

import { DocumentsBrowser } from "@/components/documents/documents-browser"
import type { Document, Folder } from "@/lib/types"

interface Props {
  siteId: number
  folders: Folder[]
  documents: Document[]
}

/** Thin wrapper so the site detail page slots documents in like its other
 *  tabs — data is fetched by the server page and threaded through as props. */
export function SiteDocumentsTab({ siteId, folders, documents }: Props) {
  return (
    <DocumentsBrowser folders={folders} documents={documents} siteId={siteId} />
  )
}
