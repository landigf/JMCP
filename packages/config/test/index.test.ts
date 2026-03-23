import { describe, expect, it } from "vitest"
import {
  getBridgeConfig,
  getControlPlaneConfig,
  getWebConfig,
  resolveControlPlaneConfig,
} from "../src/index.js"

describe("config", () => {
  it("parses control plane defaults", () => {
    const config = getControlPlaneConfig({})
    expect(config.JMCP_CONTROL_PLANE_PORT).toBe(4000)
    expect(config.JMCP_AUTORUN_ENABLED).toBe(true)
    expect(config.JMCP_XAI_API_KEY_SOURCE).toBe("none")
  })

  it("prefers the xAI key from env", async () => {
    const config = await resolveControlPlaneConfig(
      {
        JMCP_XAI_API_KEY: "env-key",
      },
      {
        keychainLookup: async () => "keychain-key",
      },
    )

    expect(config.JMCP_XAI_API_KEY).toBe("env-key")
    expect(config.JMCP_XAI_API_KEY_SOURCE).toBe("env")
  })

  it("loads the xAI key from Keychain when env is missing", async () => {
    const config = await resolveControlPlaneConfig(
      {
        USER: "landigf",
      },
      {
        keychainLookup: async ({ service, account }) => {
          expect(account).toBe("landigf")
          if (service === "JMCP_TELEGRAM_BOT_TOKEN") {
            return null
          }

          expect(service).toBe("JMCP_XAI_API_KEY")
          return "keychain-key"
        },
      },
    )

    expect(config.JMCP_XAI_API_KEY).toBe("keychain-key")
    expect(config.JMCP_XAI_API_KEY_SOURCE).toBe("keychain")
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
