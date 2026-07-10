import { defineDocs, defineConfig } from "fumadocs-mdx/config"

// Docs MDX lives in content/docs; fumadocs-mdx compiles it into the
// generated `.source` directory (see next.config.ts createMDX plugin).
export const docs = defineDocs({
  dir: "content/docs",
})

export default defineConfig()
