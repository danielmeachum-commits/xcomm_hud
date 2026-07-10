import { createMarkdownRenderer } from "fumadocs-core/content/md"
import { getTableOfContents } from "fumadocs-core/content/toc"
import { rehypeCode } from "fumadocs-core/mdx-plugins/rehype-code"
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading"
import defaultMdxComponents from "fumadocs-ui/mdx"
import remarkGfm from "remark-gfm"
import { Mermaid } from "@/components/docs/mermaid"
import { rehypeMermaid } from "@/lib/rehype-mermaid"

// Component map: fumadocs defaults + our <mermaid> handler. Shared by the page
// and (re-created) by the editor preview.
const components = { ...defaultMdxComponents, mermaid: Mermaid }

// Server-side markdown → fumadocs-styled React. Runs the full pipeline:
// GitHub-flavored markdown, heading slug ids (so the TOC anchors resolve),
// mermaid diagrams (before Shiki so they aren't highlighted as code), and Shiki
// syntax highlighting (async — server only). The live editor preview uses a
// lighter synchronous renderer without Shiki (see doc-page-editor.tsx).
const { MarkdownServer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
  rehypePlugins: [rehypeMermaid, rehypeCode],
})

/** The component map, shared by the page and the editor preview. */
export const docMdxComponents = components

/** Render a doc page's markdown body. Use inside `<DocsBody>`. */
export function DocMarkdown({ content }: { content: string }) {
  return <MarkdownServer components={components}>{content}</MarkdownServer>
}

/** Table of contents extracted from the markdown headings. */
export function getDocToc(content: string) {
  return getTableOfContents(content)
}
