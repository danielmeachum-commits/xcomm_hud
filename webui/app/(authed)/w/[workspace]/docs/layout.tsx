import type { ReactNode } from "react"
import { RootProvider } from "fumadocs-ui/provider/next"
// Scoped fumadocs styling — loads only on docs routes (see docs.css).
import "./docs.css"

// Docs render inside the app shell (this layout is nested under the authed
// shell's sidebar + header). RootProvider supplies fumadocs' TOC/anchor context
// but its next-themes is disabled so we inherit the app's root ThemeProvider.
export default function DocsLayout({ children }: { children: ReactNode }) {
  // search disabled: fumadocs' built-in ⌘K indexes build-time files, but our
  // content is in the DB — we provide our own search (see docs-nav.tsx).
  // The app shell chain is all min-height (body min-h-full, wrapper min-h-svh),
  // so there's no definite height for the docs panes to scroll within — content
  // just grows the page. Anchor an explicit height here (viewport minus the
  // h-12 header, and the inset sidebar's m-2 margins at md+) so DocsPageView /
  // the editor can fill it and scroll their content internally.
  return (
    <RootProvider theme={{ enabled: false }} search={{ enabled: false }}>
      <div className="flex h-[calc(100dvh-3rem)] flex-col overflow-hidden md:h-[calc(100dvh-4rem)]">
        {children}
      </div>
    </RootProvider>
  )
}
