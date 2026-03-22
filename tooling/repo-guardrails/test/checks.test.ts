import path from "node:path"
import { describe, expect, it } from "vitest"
import { extractLocalLinks } from "../src/checks.js"

describe("extractLocalLinks", () => {
  it("keeps only local markdown links", () => {
    const markdown = `
      [Local](../docs/PLANS.md)
      [Directory](../security/)
      [Anchor](#overview)
      [External](https://example.com)
      [Mail](mailto:test@example.com)
    `

    expect(extractLocalLinks(markdown)).toEqual(["../docs/PLANS.md", "../security/"])
  })

  it("resolves repo root the way the CLI expects", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..")

    expect(repoRoot.endsWith("Jarvis")).toBe(true)
  })
})
