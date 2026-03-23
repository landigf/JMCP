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
  it("reuses an existing project instead of duplicating the same repo", async () => {
    const service = await createService()

    const first = await service.createProject({
      name: "Website",
      githubOwner: "landigf",
      githubRepo: "landigf.github.io",
      summary: "Website repo",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const second = await service.createProject({
      name: "Website again",
      githubOwner: "landigf",
      githubRepo: "landigf.github.io",
      summary: "Duplicate website repo",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    expect(second.id).toBe(first.id)
  })

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

  it("dedupes an identical todo request instead of creating a second copy", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const first = await service.createTodo(project.id, {
      title: "Document the laptop bridge flow",
      details: null,
      nightly: false,
      runAfter: null,
    })
    const second = await service.createTodo(project.id, {
      title: "Document the laptop bridge flow",
      details: null,
      nightly: false,
      runAfter: null,
    })
    const dashboard = await service.getDashboardSnapshot()

    expect(first?.created).toBe(true)
    expect(second?.created).toBe(false)
    expect(dashboard.todos.filter((todo) => todo.projectId === project.id)).toHaveLength(1)
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

  it("queues a new run_now request as a todo when the project already has open work", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const first = await service.postProjectMessage(project.id, {
      text: "build the onboarding flow and open a draft pr",
    })
    const second = await service.postProjectMessage(project.id, {
      text: "then add a mobile recap page",
    })
    const summary = await service.getProjectSummary(project.id)

    expect(first?.createdTaskRunId).toBeTruthy()
    expect(second?.createdTaskRunId).toBeNull()
    expect(second?.createdTodoId).toBeTruthy()
    expect(second?.reply.status).toBe("Project already has active work.")
    expect(summary?.todos.some((todo) => todo.title.includes("then add a mobile recap page"))).toBe(
      true,
    )
  })

  it("stores assistant proposals as pending items and lets the operator approve them", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const proposal = await service.createAssistantProposal(project.id, {
      title: "Add a morning recap filter",
      details: "Useful after the current recap flow landed.",
      proposedFromTaskRunId: null,
    })

    expect(proposal?.source).toBe("assistant")
    expect(proposal?.approvalStatus).toBe("pending")

    const approved = await service.reviewAssistantProposal(project.id, proposal?.id ?? "", "now")
    const summary = await service.getProjectSummary(project.id)

    expect(approved?.approvalStatus).toBe("approved")
    expect(
      summary?.taskRuns.some((run) => run.sourceTodoId === proposal?.id && run.status === "queued"),
    ).toBe(true)
  })

  it("creates a pending assistant proposal from a completed bridge event", async () => {
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

    await service.recordBridgeEvent({
      token: "bridge-token",
      executorId: "executor-1",
      event: "task.result",
      taskRunId: response?.createdTaskRunId ?? "",
      message: "Run completed and result bundle prepared.",
      proposedTodo: {
        title: "Add a polished review drawer",
        details: "The current recap exists, but a tighter review drawer would improve triage.",
        proposedFromTaskRunId: null,
      },
    })

    const summary = await service.getProjectSummary(project.id)
    const proposal = summary?.todos.find((todo) => todo.title === "Add a polished review drawer")

    expect(proposal?.source).toBe("assistant")
    expect(proposal?.approvalStatus).toBe("pending")
  })
})
