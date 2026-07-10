import { createMarkdownRenderer } from "fumadocs-core/content/md"
import { getTableOfContents } from "fumadocs-core/content/toc"
import { rehypeCode } from "fumadocs-core/mdx-plugins/rehype-code"
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading"
import defaultMdxComponents from "fumadocs-ui/mdx"
import remarkGfm from "remark-gfm"

// Server-side markdown → fumadocs-styled React. Runs the full pipeline:
// GitHub-flavored markdown, heading slug ids (so the TOC anchors resolve), and
// Shiki syntax highlighting (async — server only). The live editor preview uses
// a lighter synchronous renderer without Shiki (see doc-page-editor.tsx).
const { MarkdownServer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
  rehypePlugins: [rehypeCode],
})

/** The fumadocs default component map, shared by the page and the editor preview. */
export const docMdxComponents = defaultMdxComponents

/** Render a doc page's markdown body. Use inside `<DocsBody>`. */
export function DocMarkdown({ content }: { content: string }) {
  return (
    <MarkdownServer components={defaultMdxComponents}>{content}</MarkdownServer>
  )
}

/** Table of contents extracted from the markdown headings. */
export function getDocToc(content: string) {
  return getTableOfContents(content)
}
