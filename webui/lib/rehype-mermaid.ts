import { visit } from "unist-util-visit"

// Converts ```mermaid fenced code blocks into a <mermaid> element BEFORE Shiki
// (rehypeCode) runs, so mermaid source renders as a diagram instead of being
// syntax-highlighted as code. The <mermaid> element is mapped to the client
// Mermaid component in the render component map.
export function rehypeMermaid() {
  return (tree: unknown) => {
    // Loosely typed to avoid a hard @types/hast dependency.
    visit(tree as never, "element", (node: any, index: number | undefined, parent: any) => {
      if (node.tagName !== "pre" || !parent || index == null) return
      const code = node.children?.[0]
      if (!code || code.type !== "element" || code.tagName !== "code") return
      const className = code.properties?.className
      const classes = Array.isArray(className)
        ? className
        : className
          ? [className]
          : []
      if (!classes.some((c: unknown) => String(c).includes("language-mermaid"))) {
        return
      }
      const value = (code.children ?? [])
        .map((c: any) => (c.type === "text" ? c.value : ""))
        .join("")
      parent.children[index] = {
        type: "element",
        tagName: "mermaid",
        properties: {},
        children: [{ type: "text", value }],
      }
    })
  }
}
