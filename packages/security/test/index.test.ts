import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { redactSecrets, verifyGitHubWebhookSignature, verifySharedToken } from "../src/index.js"

describe("security helpers", () => {
  it("verifies shared tokens", () => {
    expect(verifySharedToken("abc", "abc")).toBe(true)
    expect(verifySharedToken("abc", "def")).toBe(false)
  })

  it("verifies GitHub webhook signatures", () => {
    const payload = JSON.stringify({ hello: "world" })
    const secret = "test-secret"
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`

    expect(verifyGitHubWebhookSignature(payload, signature, secret)).toBe(true)
    expect(verifyGitHubWebhookSignature(payload, "sha256=deadbeef", secret)).toBe(false)
  })

  it("redacts common secret shapes", () => {
    expect(redactSecrets("token ghp_abc123")).toContain("[REDACTED]")
    expect(redactSecrets("plain text")).toBe("plain text")
  })
})
