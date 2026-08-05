import { visit } from "unist-util-visit"

/** Minimal hast shapes — enough to walk a fenced code block without taking a
 *  hard @types/hast dependency, and specific enough that the visitor doesn't
 *  need `any`. Everything optional, because this runs over untyped input. */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

// Converts ```mermaid fenced code blocks into a <mermaid> element BEFORE Shiki
// (rehypeCode) runs, so mermaid source renders as a diagram instead of being
// syntax-highlighted as code. The <mermaid> element is mapped to the client
// Mermaid component in the render component map.
export function rehypeMermaid() {
  return (tree: unknown) => {
    visit(
      tree as never,
      "element",
      (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
        if (node.tagName !== "pre" || !parent?.children || index == null) return
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
          .map((c) => (c.type === "text" ? (c.value ?? "") : ""))
          .join("")
        parent.children[index] = {
          type: "element",
          tagName: "mermaid",
          properties: {},
          children: [{ type: "text", value }],
        }
      },
    )
  }
}
