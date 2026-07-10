import type { ReactNode } from "react"
import { RootProvider } from "fumadocs-ui/provider/next"
// Scoped fumadocs styling — loads only on docs routes (see docs.css).
import "./docs.css"

// Docs render inside the app shell (this layout is nested under the authed
// shell's sidebar + header). RootProvider supplies fumadocs' TOC/anchor context
// but its next-themes is disabled so we inherit the app's root ThemeProvider.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
}
