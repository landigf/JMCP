import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getControlPlaneConfig } from "@jmcp/config"
import { describe, expect, it } from "vitest"
import { InMemoryFeedBus } from "../src/feed.js"
import { CompositeNotificationDispatcher } from "../src/notifications.js"
import { ControlPlaneService } from "../src/service.js"
import { FileWorkspaceStore } from "../src/store.js"

async function createService() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jmcp-control-plane-"))
  const config = getControlPlaneConfig({
    JMCP_CONTROL_PLANE_DATA_DIR: dataDir,
    JMCP_TELEGRAM_BOT_TOKEN: "",
    JMCP_TELEGRAM_CHAT_ID: "",
  })

  return new ControlPlaneService({
    store: new FileWorkspaceStore(dataDir),
    feeds: new InMemoryFeedBus(),
    notifications: new CompositeNotificationDispatcher(config),
    config,
  })
}

describe("control plane service", () => {
  it("creates a todo from a save_todo style message", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const response = await service.postProjectMessage(project.id, {
      text: "TODO remember to profile the bridge latency later",
    })

    expect(response?.intent.kind).toBe("save_todo")
    expect(response?.createdTodoId).toBeTruthy()
  })

  it("creates a queued task run from an execution request", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const response = await service.postProjectMessage(project.id, {
      text: "build the onboarding flow and open a draft pr",
    })

    expect(response?.intent.kind).toBe("run_now")
    expect(response?.createdTaskRunId).toBeTruthy()
  })
})
