import type { ReactNode } from "react"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { RootProvider } from "fumadocs-ui/provider/next"
import { requireSession } from "@/lib/auth"
import { source } from "@/lib/source"
// Scoped fumadocs + tailwind styling for the /docs subtree only. Because this
// CSS is imported in the (docs) layout (a sibling route group to the app
// shell), Next only loads it on /docs routes — the main app is untouched.
import "./docs.css"

// This layout owns the whole page for /docs — fumadocs renders its own sidebar,
// search and TOC, so we deliberately do NOT nest inside the (authed) app shell.
// Auth is still enforced here via requireSession(), matching the rest of the app.
export default async function DocsRootLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireSession()

  return (
    // theme.enabled=false: inherit the app's root next-themes ThemeProvider
    // instead of nesting a second one.
    <RootProvider theme={{ enabled: false }}>
      <DocsLayout
        tree={source.pageTree}
        nav={{ title: "xCOMM HUD Docs" }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  )
}
