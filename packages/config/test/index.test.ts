import { describe, expect, it } from "vitest"
import { getBridgeConfig, getControlPlaneConfig, getWebConfig } from "../src/index.js"

describe("config", () => {
  it("parses control plane defaults", () => {
    const config = getControlPlaneConfig({})
    expect(config.JMCP_CONTROL_PLANE_PORT).toBe(4000)
    expect(config.JMCP_AUTORUN_ENABLED).toBe(true)
  })

  it("parses web defaults", () => {
    const config = getWebConfig({})
    expect(config.NEXT_PUBLIC_CONTROL_PLANE_URL).toContain("4000")
  })

  it("parses bridge defaults", () => {
    const config = getBridgeConfig({})
    expect(config.JMCP_BRIDGE_KIND).toBe("claude_code")
    expect(config.JMCP_BRIDGE_DEFAULT_TEST_COMMANDS.length).toBeGreaterThan(0)
  })
})
