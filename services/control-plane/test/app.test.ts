import { createHmac } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getControlPlaneConfig } from "@jmcp/config"
import { describe, expect, it } from "vitest"
import { createControlPlaneApp } from "../src/app.js"

describe("control-plane app", () => {
  it("accepts a correctly signed GitHub webhook", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "jmcp-webhook-"))
    const config = getControlPlaneConfig({
      JMCP_CONTROL_PLANE_DATA_DIR: dataDir,
      JMCP_GITHUB_WEBHOOK_SECRET: "webhook-secret",
    })
    const app = createControlPlaneApp(config)

    await app.ready()

    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: "Webhook Project",
        githubOwner: "landigf",
        githubRepo: "JMCP",
        summary: "project for webhook test",
        defaultBranch: "main",
        nightlyEnabled: true,
      },
    })

    const payload = JSON.stringify({
      event: "pull_request",
      action: "opened",
      repository: {
        full_name: "landigf/JMCP",
        html_url: "https://github.com/landigf/JMCP",
      },
      pull_request: {
        html_url: "https://github.com/landigf/JMCP/pull/1",
        number: 1,
        draft: true,
        title: "Draft PR",
      },
    })
    const signature = `sha256=${createHmac("sha256", "webhook-secret").update(payload).digest("hex")}`

    const response = await app.inject({
      method: "POST",
      url: "/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      payload,
    })

    expect(response.statusCode).toBe(202)
    await app.close()
  })
})
