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
  const currentHour = new Date().getHours()
  const config = getControlPlaneConfig({
    JMCP_CONTROL_PLANE_DATA_DIR: dataDir,
    JMCP_TELEGRAM_BOT_TOKEN: "",
    JMCP_TELEGRAM_CHAT_ID: "",
    JMCP_NIGHTLY_START_HOUR: String(currentHour),
    JMCP_NIGHTLY_END_HOUR: String((currentHour + 1) % 24),
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

  it("queues overnight todos sequentially instead of scheduling the whole project at once", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    await service.createTodo(project.id, {
      title: "Nightly task one",
      details: null,
      nightly: true,
      runAfter: null,
    })
    await service.createTodo(project.id, {
      title: "Nightly task two",
      details: null,
      nightly: true,
      runAfter: null,
    })

    await service.tickNightlyScheduler()
    const summary = await service.getProjectSummary(project.id)
    const readyTodos = summary?.todos.filter((todo) => todo.status === "ready") ?? []
    const queuedRuns = summary?.taskRuns.filter((run) => run.status === "queued") ?? []

    expect(readyTodos).toHaveLength(1)
    expect(queuedRuns).toHaveLength(1)
  })

  it("uses last-edit-wins when two overnight tasks clearly ask for the same thing", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const older = await service.createTodo(project.id, {
      title: "Add project recap filters to the dashboard",
      details: "Create recap filters in the dashboard.",
      nightly: true,
      runAfter: null,
    })
    await service.createTodo(project.id, {
      title: "Update the dashboard with the final project recap filters",
      details: "Use the final recap filter version in the same dashboard view.",
      nightly: true,
      runAfter: null,
    })

    await service.tickNightlyScheduler()
    const summary = await service.getProjectSummary(project.id)
    const olderTodo = summary?.todos.find((todo) => todo.id === older?.todo?.id)

    expect(olderTodo?.status).toBe("cancelled")
    expect(olderTodo?.systemNote).toContain("Superseded")
  })

  it("blocks conflicting overnight tasks when JMCP is not confident about the tie-breaker", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Jarvis",
      githubOwner: "landigf",
      githubRepo: "JMCP",
      summary: "Operator workspace",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    await service.createTodo(project.id, {
      title: "Enable auto-merge for recap PRs",
      details: null,
      nightly: true,
      runAfter: null,
    })
    await service.createTodo(project.id, {
      title: "Disable auto-merge for recap PRs",
      details: null,
      nightly: true,
      runAfter: null,
    })

    await service.tickNightlyScheduler()
    const summary = await service.getProjectSummary(project.id)
    const blockedTodos = summary?.todos.filter((todo) => todo.status === "blocked") ?? []
    const dashboard = await service.getDashboardSnapshot()
    const conflictNotice = dashboard.notifications.find(
      (notification) =>
        notification.projectId === project.id &&
        notification.title.includes("Nightly queue conflict"),
    )

    expect(blockedTodos).toHaveLength(2)
    expect(conflictNotice).toBeTruthy()
  })

  it("turns a large Papers request into an epic with decomposed tasks", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Papers",
      githubOwner: "landigf",
      githubRepo: "Papers",
      summary: "Paper-sharing social network",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    const response = await service.postProjectMessage(project.id, {
      text: "I had this idea of building Paper, it’s like a social network for sharing papers, allow login, support ORCID, allow anonymous publication for conference submissions, and create discovery connected to my interests like Broletter. Start with the easy tasks now and queue the complex things for overnight.",
    })

    const summary = await service.getProjectSummary(project.id)

    expect(response?.reply.status).toBe("Epic captured and decomposed.")
    expect(summary?.epics.length).toBeGreaterThan(0)
    expect(summary?.epicTasks.length).toBeGreaterThan(4)
    expect(summary?.todos.some((todo) => todo.title.includes("ORCID"))).toBe(true)
  })

  it("queues all eligible todos for a project when requested", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Papers",
      githubOwner: "landigf",
      githubRepo: "Papers",
      summary: "Paper-sharing social network",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    await service.createTodo(project.id, {
      title: "Draft onboarding copy",
      details: null,
      nightly: false,
      runAfter: null,
    })
    await service.createTodo(project.id, {
      title: "Add recommendation explainer cards",
      details: null,
      nightly: false,
      runAfter: null,
    })

    const result = await service.queueAllTodos(project.id)
    const summary = await service.getProjectSummary(project.id)

    expect(result.queuedRuns).toHaveLength(1)
    expect(summary?.taskRuns.filter((run) => run.status === "queued")).toHaveLength(2)
  })

  it("stores and updates the focused Telegram project per chat", async () => {
    const service = await createService()
    const project = await service.createProject({
      name: "Papers",
      githubOwner: "landigf",
      githubRepo: "Papers",
      summary: "Paper-sharing social network",
      defaultBranch: "main",
      nightlyEnabled: true,
    })

    await service.registerTelegramThread({
      chatId: "chat-1",
    })
    const linked = await service.linkTelegramThreadToProject("chat-1", project.id)
    const stored = await service.getTelegramThread("chat-1")

    expect(linked.linkedProjectId).toBe(project.id)
    expect(stored?.linkedProjectId).toBe(project.id)
  })
})
