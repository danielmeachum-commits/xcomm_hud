import type { NextConfig } from "next"
import { createMDX } from "fumadocs-mdx/next"

// fumadocs-mdx is ESM-only. We keep next.config.ts (Next 16 resolves the
// ESM import via native TS config support). If ESM resolution ever fails
// here, rename this file to next.config.mjs and convert the type import to
// plain JS — nothing else needs to change.
const withMDX = createMDX()

const nextConfig: NextConfig = {}

export default withMDX(nextConfig)
