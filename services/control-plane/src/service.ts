import { exec as execCallback } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { ControlPlaneConfig } from "@jmcp/config"
import {
  type AssistantProposalInput,
  type AutomationPolicy,
  type BridgeHelloInput,
  type BridgeProgressEvent,
  type CreateProjectInput,
  type CreateTodoInput,
  type CreateTodoResult,
  type DashboardSnapshot,
  type Executor,
  type FeedEvent,
  type GitHubWebhookEnvelope,
  type MobileReply,
  type Notification,
  notificationSchema,
  type Project,
  type ProjectBrief,
  type ProjectMessageInput,
  type ProjectMessageResponse,
  type ProjectSummary,
  type ProposalDecision,
  projectSchema,
  projectSummarySchema,
  type RepoSyncState,
  type RunArtifact,
  type RunDetail,
  runDetailSchema,
  type TaskRun,
  type TodoItem,
  type VoiceIngestInput,
  type VoiceIngestResponse,
  voiceAssetSchema,
} from "@jmcp/contracts"
import { redactSecrets } from "@jmcp/security"
import { nanoid } from "nanoid"
import {
  classifyMessage,
  createAlreadyTrackedReply,
  createMobileReply,
  createQueuedBehindActiveRunReply,
  getMessageText,
} from "./intents.js"
import type {
  FeedPublisher,
  NotificationDispatcher,
  ProjectAggregate,
  WorkspaceStore,
} from "./types.js"

const exec = promisify(execCallback)

function nowIso(): string {
  return new Date().toISOString()
}

function parsePullRequestNumber(url: string | null | undefined): number | null {
  if (!url) {
    return null
  }

  const match = url.match(/\/pull\/(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : null
}

const openTaskRunStatuses = [
  "queued",
  "planning",
  "running",
  "validating",
  "merging",
  "needs_approval",
  "blocked",
] as const

const trackedTodoStatuses = ["queued", "ready", "in_progress", "blocked"] as const

const workStopWords = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "with",
  "from",
  "by",
  "into",
  "over",
  "after",
  "before",
  "then",
  "that",
  "this",
  "same",
  "thing",
  "feature",
  "page",
  "flow",
  "task",
  "todo",
  "project",
  "repo",
])

const actionAliasToGroup = new Map<string, string>([
  ["add", "add"],
  ["create", "add"],
  ["build", "add"],
  ["implement", "add"],
  ["introduce", "add"],
  ["write", "add"],
  ["enable", "enable"],
  ["turn", "enable"],
  ["fix", "modify"],
  ["update", "modify"],
  ["change", "modify"],
  ["modify", "modify"],
  ["refactor", "modify"],
  ["rework", "modify"],
  ["improve", "modify"],
  ["polish", "modify"],
  ["tune", "modify"],
  ["replace", "replace"],
  ["switch", "replace"],
  ["migrate", "replace"],
  ["rename", "rename"],
  ["remove", "remove"],
  ["delete", "remove"],
  ["drop", "remove"],
  ["revert", "remove"],
  ["disable", "disable"],
])

function normalizeWorkLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'.,!?;:()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeWorkToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`
  }

  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1)
  }

  return token
}

function extractWorkTokens(value: string): string[] {
  return normalizeWorkLabel(value)
    .split(" ")
    .map((token) => normalizeWorkToken(token))
    .filter((token) => token.length > 2 && !workStopWords.has(token))
}

function extractPrimaryAction(value: string): string | null {
  for (const token of extractWorkTokens(value)) {
    const group = actionAliasToGroup.get(token)
    if (group) {
      return group
    }
  }

  return null
}

function extractTargetTokens(value: string): string[] {
  return extractWorkTokens(value).filter((token) => !actionAliasToGroup.has(token))
}

function similarityScore(left: string[], right: string[]): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const union = new Set([...leftSet, ...rightSet])

  if (union.size === 0) {
    return 0
  }

  let intersection = 0
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1
    }
  }

  return intersection / union.size
}

function sharedTokenCount(left: string[], right: string[]): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1
    }
  }

  return intersection
}

function coverageScore(base: string[], candidate: string[]): number {
  const baseSet = new Set(base)

  if (baseSet.size === 0) {
    return 0
  }

  return sharedTokenCount(base, candidate) / baseSet.size
}

type NightlyTodoRelation =
  | { kind: "none" }
  | { kind: "superseded"; reason: string }
  | { kind: "conflict"; reason: string }

function compareNightlyTodos(older: TodoItem, newer: TodoItem): NightlyTodoRelation {
  const olderText = `${older.title} ${older.details ?? ""}`
  const newerText = `${newer.title} ${newer.details ?? ""}`
  const olderTargetTokens = extractTargetTokens(olderText)
  const newerTargetTokens = extractTargetTokens(newerText)
  const targetSimilarity = similarityScore(olderTargetTokens, newerTargetTokens)
  const labelSimilarity = similarityScore(
    extractWorkTokens(olderText),
    extractWorkTokens(newerText),
  )
  const targetSharedTokens = sharedTokenCount(olderTargetTokens, newerTargetTokens)
  const olderCoveredByNewer = coverageScore(olderTargetTokens, newerTargetTokens)
  const olderAction = extractPrimaryAction(olderText)
  const newerAction = extractPrimaryAction(newerText)
  const oppositeActions =
    (olderAction === "add" && newerAction === "remove") ||
    (olderAction === "remove" && newerAction === "add") ||
    (olderAction === "enable" && newerAction === "disable") ||
    (olderAction === "disable" && newerAction === "enable")

  if (
    normalizeWorkLabel(older.title) === normalizeWorkLabel(newer.title) ||
    labelSimilarity >= 0.86 ||
    (!oppositeActions &&
      targetSharedTokens >= 2 &&
      olderCoveredByNewer >= 0.74 &&
      (targetSimilarity >= 0.34 || labelSimilarity >= 0.25) &&
      (olderAction === newerAction || !olderAction || !newerAction || newerAction === "modify"))
  ) {
    return {
      kind: "superseded",
      reason: `Superseded by newer overnight task: ${newer.title}`,
    }
  }

  if (
    targetSimilarity >= 0.58 &&
    (oppositeActions || (olderAction && newerAction && olderAction !== newerAction))
  ) {
    return {
      kind: "conflict",
      reason: `Potential conflict with "${newer.title}". Jarvis was not confident enough to resolve it automatically.`,
    }
  }

  return {
    kind: "none",
  }
}

function isTrackedTodoStatus(status: TodoItem["status"]): boolean {
  return trackedTodoStatuses.includes(status as (typeof trackedTodoStatuses)[number])
}

function isOpenTaskRunStatus(status: TaskRun["status"]): boolean {
  return openTaskRunStatuses.includes(status as (typeof openTaskRunStatuses)[number])
}

function isTrackedTodo(todo: TodoItem): boolean {
  return todo.approvalStatus !== "rejected" && isTrackedTodoStatus(todo.status)
}

function createFeedEvent(
  type: FeedEvent["type"],
  projectId: string | null,
  payload: Record<string, unknown>,
): FeedEvent {
  return {
    id: nanoid(),
    projectId,
    type,
    occurredAt: nowIso(),
    payload,
  }
}

function createDefaultBrief(projectId: string, summary: string): ProjectBrief {
  const timestamp = nowIso()

  return {
    id: nanoid(),
    projectId,
    summary,
    codingNorms: [
      "Preserve existing repo conventions before introducing new patterns.",
      "Prefer explicit validation, defensive defaults, and concise commits.",
      "Never introduce secrets, unsafe crypto, or silent network side effects.",
    ],
    testCommands: ["npm run test", "npm run check", "npm run lint"],
    dangerousPaths: [".env", ".github/workflows", "infra", "secrets"],
    releaseConstraints: [
      "Open a PR with a concise summary.",
      "Run project checks before marking complete.",
      "Respect protected branch and required checks rules.",
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createDefaultMergePolicy(projectId: string) {
  const timestamp = nowIso()

  return {
    id: nanoid(),
    projectId,
    mode: "auto_merge_protected_green" as const,
    requireProtectedBranch: true,
    requireChecks: true,
    requireReviews: false,
    allowAutoMerge: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createDefaultAutomationPolicy(projectId: string, mergePolicyId: string): AutomationPolicy {
  const timestamp = nowIso()

  return {
    id: nanoid(),
    projectId,
    paused: false,
    nightlyEnabled: true,
    autoRunOnTodo: true,
    maxConcurrentRuns: 1,
    mergePolicyId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createDefaultRepoSyncState(projectId: string): RepoSyncState {
  return {
    id: nanoid(),
    projectId,
    branchProtected: false,
    requiredChecks: [],
    currentPrUrl: null,
    currentPrNumber: null,
    lastHeadSha: null,
    lastBaseSha: null,
    lastBranchProtectionCheckAt: null,
    lastSyncAt: nowIso(),
  }
}

export class ControlPlaneService {
  readonly #store: WorkspaceStore
  readonly #feeds: FeedPublisher
  readonly #notifications: NotificationDispatcher
  readonly #config: ControlPlaneConfig

  constructor(args: {
    store: WorkspaceStore
    feeds: FeedPublisher
    notifications: NotificationDispatcher
    config: ControlPlaneConfig
  }) {
    this.#store = args.store
    this.#feeds = args.feeds
    this.#notifications = args.notifications
    this.#config = args.config
  }

  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    const snapshot = await this.#store.getSnapshot()

    return {
      projects: [...snapshot.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      briefs: snapshot.briefs,
      automationPolicies: snapshot.automationPolicies,
      todos: [...snapshot.todos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      taskRuns: [...snapshot.taskRuns].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      notifications: [...snapshot.notifications].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      recaps: [...snapshot.recaps].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      executors: snapshot.executors,
    }
  }

  async getInbox(): Promise<Notification[]> {
    const snapshot = await this.#store.getSnapshot()
    return [...snapshot.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.#store.mutate((snapshot) => {
      const existing = snapshot.projects.find(
        (entry) =>
          entry.githubOwner.toLowerCase() === input.githubOwner.toLowerCase() &&
          entry.githubRepo.toLowerCase() === input.githubRepo.toLowerCase(),
      )

      if (existing) {
        return existing
      }

      const timestamp = nowIso()
      const project = projectSchema.parse({
        id: nanoid(),
        name: input.name,
        githubOwner: input.githubOwner,
        githubRepo: input.githubRepo,
        summary: input.summary,
        defaultBranch: input.defaultBranch,
        nightlyEnabled: input.nightlyEnabled,
        repoUrl: input.repoUrl ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      const brief = createDefaultBrief(project.id, input.summary)
      const mergePolicy = createDefaultMergePolicy(project.id)
      const automationPolicy = createDefaultAutomationPolicy(project.id, mergePolicy.id)
      automationPolicy.nightlyEnabled = input.nightlyEnabled

      snapshot.projects.unshift(project)
      snapshot.briefs.unshift(brief)
      snapshot.mergePolicies.unshift(mergePolicy)
      snapshot.automationPolicies.unshift(automationPolicy)
      snapshot.repoSyncStates.unshift(createDefaultRepoSyncState(project.id))
      snapshot.conversations.push({
        projectId: project.id,
        messages: [
          {
            id: nanoid(),
            projectId: project.id,
            role: "system",
            kind: "text",
            text: `Project created for ${project.githubOwner}/${project.githubRepo}.`,
            createdAt: timestamp,
          },
        ],
      })

      this.#feeds.publish(
        createFeedEvent("message.created", project.id, {
          projectId: project.id,
          kind: "project_created",
        }),
      )

      return project
    })
  }

  async getProjectSummary(projectId: string): Promise<ProjectSummary | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    return projectSummarySchema.parse({
      project: aggregate.project,
      brief: aggregate.brief,
      automationPolicy: aggregate.automationPolicy,
      mergePolicy: aggregate.mergePolicy,
      repoSyncState: aggregate.repoSyncState,
      conversation: aggregate.conversation,
      todos: aggregate.todos,
      taskRuns: aggregate.taskRuns,
      runSteps: aggregate.runSteps,
      artifacts: aggregate.artifacts,
      recaps: aggregate.recaps,
      approvals: aggregate.approvals,
      voiceAssets: aggregate.voiceAssets,
    })
  }

  async getRunDetail(taskRunId: string): Promise<RunDetail | null> {
    const snapshot = await this.#store.getSnapshot()
    const run = snapshot.taskRuns.find((entry) => entry.id === taskRunId)

    if (!run) {
      return null
    }

    return runDetailSchema.parse({
      run,
      attempts: snapshot.runAttempts.filter((entry) => entry.taskRunId === taskRunId),
      steps: snapshot.runSteps.filter((entry) => entry.taskRunId === taskRunId),
      artifacts: snapshot.artifacts.filter((entry) => entry.taskRunId === taskRunId),
      approvals: snapshot.approvals.filter((entry) => entry.taskRunId === taskRunId),
      checkpointBundles: snapshot.checkpointBundles.filter(
        (entry) => entry.taskRunId === taskRunId,
      ),
    })
  }

  async postProjectMessage(
    projectId: string,
    input: ProjectMessageInput,
  ): Promise<ProjectMessageResponse | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    const text = redactSecrets(getMessageText(input))
    const title = text.slice(0, 120) || "Voice note"
    const intent = classifyMessage(input)
    const executorAvailable = aggregate.executors.some((executor) => executor.status === "online")

    let createdTodoId: string | null = null
    let createdTaskRunId: string | null = null
    let reply: MobileReply | null = null

    await this.#store.mutate((draft) => {
      const timestamp = nowIso()
      const conversation = draft.conversations.find((entry) => entry.projectId === projectId)
      const project = draft.projects.find((entry) => entry.id === projectId)

      if (!conversation || !project) {
        throw new Error("Project not found")
      }

      conversation.messages.push({
        id: nanoid(),
        projectId,
        role: "operator",
        kind: input.voiceNote ? "voice_note" : "text",
        text,
        createdAt: timestamp,
      })

      const duplicateTodo = this.#findTrackedTodo(draft, projectId, title)
      const duplicateRun = this.#findOpenTaskRun(draft, projectId, title)
      const activeRun = this.#findOpenTaskRun(draft, projectId)

      if (duplicateTodo || duplicateRun) {
        createdTodoId = duplicateTodo?.id ?? null
        createdTaskRunId = duplicateRun?.id ?? null
        reply = this.#createDuplicateReply({
          project,
          title,
          existingTodo: duplicateTodo,
          existingRun: duplicateRun,
        })
      } else if (intent.kind === "save_todo" || intent.kind === "schedule_nightly") {
        const todo = this.#createTodoRecord(projectId, {
          title,
          details: text,
          source: intent.kind === "schedule_nightly" ? "nightly" : "chat",
          nightly: intent.kind === "schedule_nightly",
          runAfter: null,
        })

        createdTodoId = todo.id
        draft.todos.unshift(todo)
        this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))
        reply = createMobileReply({
          intentKind: intent.kind,
          project,
          executorAvailable,
          title,
          runId: createdTaskRunId,
          todoId: createdTodoId,
        })
      } else if (intent.kind === "run_now" && activeRun) {
        const todo = this.#createTodoRecord(projectId, {
          title,
          details: text,
          source: "chat",
          nightly: false,
          runAfter: null,
        })

        createdTodoId = todo.id
        draft.todos.unshift(todo)
        this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))
        reply = createQueuedBehindActiveRunReply({
          project,
          title,
          activeRunId: activeRun.id,
          todoId: todo.id,
        })
      } else if (intent.kind === "run_now") {
        createdTaskRunId = this.#queueTaskRun(draft, {
          projectId,
          objective: title,
          sourceTodoId: null,
          priority: 20,
        }).id
        reply = createMobileReply({
          intentKind: intent.kind,
          project,
          executorAvailable,
          title,
          runId: createdTaskRunId,
          todoId: createdTodoId,
        })
      } else {
        reply = createMobileReply({
          intentKind: intent.kind,
          project,
          executorAvailable,
          title,
          runId: createdTaskRunId,
          todoId: createdTodoId,
        })
      }

      conversation.messages.push({
        id: nanoid(),
        projectId,
        role: "assistant",
        kind: "text",
        text: JSON.stringify(reply),
        createdAt: timestamp,
      })
      this.#feeds.publish(
        createFeedEvent("message.created", projectId, {
          role: "assistant",
          reply,
        }),
      )
    })

    return {
      intent,
      reply:
        reply ??
        createMobileReply({
          intentKind: intent.kind,
          project: aggregate.project,
          executorAvailable,
          title,
          runId: createdTaskRunId,
          todoId: createdTodoId,
        }),
      createdTodoId,
      createdTaskRunId,
    }
  }

  async createTodo(projectId: string, input: CreateTodoInput): Promise<CreateTodoResult | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    return this.#store.mutate((draft) => {
      const duplicateTodo = this.#findTrackedTodo(draft, projectId, input.title)
      const duplicateRun = this.#findOpenTaskRun(draft, projectId, input.title)

      if (duplicateTodo || duplicateRun) {
        return {
          todo: duplicateTodo,
          created: false,
          duplicateTodoId: duplicateTodo?.id ?? null,
          duplicateTaskRunId: duplicateRun?.id ?? null,
          activeRunId: null,
        }
      }

      const todo = this.#createTodoRecord(projectId, {
        title: input.title,
        details: input.details,
        source: input.nightly ? "nightly" : "manual",
        nightly: input.nightly,
        runAfter: input.runAfter,
      })

      draft.todos.unshift(todo)
      this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))

      let activeRunId: string | null = null
      const activeRun = this.#findOpenTaskRun(draft, projectId)

      if (
        this.#getAutomationPolicy(draft, projectId)?.autoRunOnTodo &&
        !input.nightly &&
        !activeRun
      ) {
        todo.status = "ready"
        this.#queueTaskRun(draft, {
          projectId,
          sourceTodoId: todo.id,
          objective: todo.title,
          priority: 30,
        })
      } else if (activeRun) {
        activeRunId = activeRun.id
      }

      return {
        todo,
        created: true,
        duplicateTodoId: null,
        duplicateTaskRunId: null,
        activeRunId,
      }
    })
  }

  async createAssistantProposal(
    projectId: string,
    input: AssistantProposalInput,
  ): Promise<TodoItem | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    let createdNew = false

    const created = await this.#store.mutate((draft) => {
      const duplicateTodo = this.#findTrackedTodo(draft, projectId, input.title)
      const duplicateRun = this.#findOpenTaskRun(draft, projectId, input.title)

      if (duplicateTodo || duplicateRun) {
        return duplicateTodo
      }

      const todo = this.#createTodoRecord(projectId, {
        title: input.title,
        details: input.details,
        source: "assistant",
        approvalStatus: "pending",
        proposedFromTaskRunId: input.proposedFromTaskRunId,
        nightly: false,
        runAfter: null,
      })

      draft.todos.unshift(todo)
      this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))
      createdNew = true
      return todo
    })

    if (
      !created ||
      !createdNew ||
      created.source !== "assistant" ||
      created.approvalStatus !== "pending"
    ) {
      return created
    }

    const notification = notificationSchema.parse({
      id: nanoid(),
      projectId,
      type: "project_update",
      title: "Jarvis proposed follow-up work",
      body: created.title,
      channel: "in_app",
      href: `/projects/${projectId}#todo-${created.id}`,
      createdAt: nowIso(),
      readAt: null,
    })

    await this.#store.mutate((draft) => {
      draft.notifications.unshift(notification)
      this.#feeds.publish(createFeedEvent("notification.created", projectId, notification))
    })

    const refreshed = await this.#store.getSnapshot()
    await this.#notifications.deliver(notification, refreshed)

    return created
  }

  async reviewAssistantProposal(
    projectId: string,
    todoId: string,
    decision: ProposalDecision,
  ): Promise<TodoItem | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    return this.#store.mutate((draft) => {
      const todo = draft.todos.find((entry) => entry.id === todoId && entry.projectId === projectId)

      if (!todo || todo.source !== "assistant") {
        return null
      }

      const timestamp = nowIso()
      todo.updatedAt = timestamp

      if (decision === "reject") {
        todo.approvalStatus = "rejected"
        todo.status = "cancelled"
        todo.nightly = false
        this.#feeds.publish(createFeedEvent("todo.updated", projectId, todo))
        return todo
      }

      todo.approvalStatus = "approved"

      if (decision === "overnight") {
        todo.nightly = true
        todo.status = "queued"
        this.#feeds.publish(createFeedEvent("todo.updated", projectId, todo))
        return todo
      }

      todo.nightly = false
      todo.status = "ready"
      this.#feeds.publish(createFeedEvent("todo.updated", projectId, todo))

      const duplicateRun =
        draft.taskRuns.find(
          (entry) =>
            entry.projectId === projectId &&
            isOpenTaskRunStatus(entry.status) &&
            (entry.sourceTodoId === todo.id ||
              normalizeWorkLabel(entry.objective) === normalizeWorkLabel(todo.title)),
        ) ?? null

      if (!duplicateRun) {
        this.#queueTaskRun(draft, {
          projectId,
          sourceTodoId: todo.id,
          objective: todo.title,
          priority: 12,
        })
      }

      return todo
    })
  }

  async runTodoNow(projectId: string, todoId: string): Promise<TaskRun | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    return this.#store.mutate((draft) => {
      const todo = draft.todos.find((entry) => entry.id === todoId && entry.projectId === projectId)

      if (!todo) {
        return null
      }

      const existingRun =
        draft.taskRuns.find(
          (entry) =>
            entry.projectId === projectId &&
            isOpenTaskRunStatus(entry.status) &&
            (entry.sourceTodoId === todo.id ||
              normalizeWorkLabel(entry.objective) === normalizeWorkLabel(todo.title)),
        ) ?? null

      if (existingRun) {
        return existingRun
      }

      todo.status = "ready"
      todo.updatedAt = nowIso()
      this.#feeds.publish(createFeedEvent("todo.updated", projectId, todo))

      return this.#queueTaskRun(draft, {
        projectId,
        sourceTodoId: todo.id,
        objective: todo.title,
        priority: 10,
      })
    })
  }

  async retryTaskRun(taskRunId: string): Promise<TaskRun | null> {
    const snapshot = await this.#store.getSnapshot()
    const existing = snapshot.taskRuns.find((entry) => entry.id === taskRunId)

    if (!existing) {
      return null
    }

    return this.#store.mutate((draft) => {
      const original = draft.taskRuns.find((entry) => entry.id === taskRunId)

      if (!original) {
        return null
      }

      return this.#queueTaskRun(draft, {
        projectId: original.projectId,
        sourceTodoId: original.sourceTodoId,
        objective: original.objective,
        priority: 15,
      })
    })
  }

  async pauseProject(projectId: string): Promise<AutomationPolicy | null> {
    return this.#store.mutate((snapshot) => {
      const policy = this.#getAutomationPolicy(snapshot, projectId)

      if (!policy) {
        return null
      }

      policy.paused = true
      policy.updatedAt = nowIso()
      return policy
    })
  }

  async resumeProject(projectId: string): Promise<AutomationPolicy | null> {
    return this.#store.mutate((snapshot) => {
      const policy = this.#getAutomationPolicy(snapshot, projectId)

      if (!policy) {
        return null
      }

      policy.paused = false
      policy.updatedAt = nowIso()
      return policy
    })
  }

  async setNightly(projectId: string, enabled: boolean): Promise<AutomationPolicy | null> {
    return this.#store.mutate((snapshot) => {
      const policy = this.#getAutomationPolicy(snapshot, projectId)
      const project = snapshot.projects.find((entry) => entry.id === projectId)

      if (!policy || !project) {
        return null
      }

      policy.nightlyEnabled = enabled
      policy.updatedAt = nowIso()
      project.nightlyEnabled = enabled
      project.updatedAt = nowIso()
      return policy
    })
  }

  async approveTaskRun(taskRunId: string): Promise<TaskRun | null> {
    return this.#store.mutate((snapshot) => {
      const run = snapshot.taskRuns.find((entry) => entry.id === taskRunId)
      const approval = snapshot.approvals.find(
        (entry) => entry.taskRunId === taskRunId && entry.status === "pending",
      )

      if (!run || !approval) {
        return null
      }

      const timestamp = nowIso()
      run.status = "queued"
      run.updatedAt = timestamp
      run.approvalReason = null
      approval.status = "approved"
      approval.decidedAt = timestamp

      this.#feeds.publish(createFeedEvent("task.run.updated", run.projectId, run))
      return run
    })
  }

  async cancelTaskRun(taskRunId: string): Promise<TaskRun | null> {
    return this.#store.mutate((snapshot) => {
      const run = snapshot.taskRuns.find((entry) => entry.id === taskRunId)

      if (!run) {
        return null
      }

      run.status = "cancelled"
      run.updatedAt = nowIso()
      this.#feeds.publish(createFeedEvent("task.run.updated", run.projectId, run))
      return run
    })
  }

  async registerPushSubscription(subscription: {
    endpoint: string
    expirationTime: number | null
    keys: { auth: string; p256dh: string }
  }): Promise<void> {
    await this.#store.mutate((snapshot) => {
      const existing = snapshot.pushSubscriptions.find(
        (entry) => entry.endpoint === subscription.endpoint,
      )

      if (existing) {
        return
      }

      snapshot.pushSubscriptions.push({
        id: nanoid(),
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: subscription.keys,
        createdAt: nowIso(),
      })
    })
  }

  async registerBridge(input: BridgeHelloInput): Promise<Executor> {
    return this.#store.mutate((snapshot) => {
      const timestamp = nowIso()
      const existing = snapshot.executors.find((entry) => entry.name === input.name)

      if (existing) {
        existing.status = "online"
        existing.kind = input.kind
        existing.hostLabel = input.hostLabel
        existing.capabilities = input.capabilities
        existing.lastSeenAt = timestamp
        return existing
      }

      const executor: Executor = {
        id: nanoid(),
        name: input.name,
        kind: input.kind,
        hostLabel: input.hostLabel,
        status: "online",
        capabilities: input.capabilities,
        lastSeenAt: timestamp,
      }

      snapshot.executors.unshift(executor)
      return executor
    })
  }

  async claimBridgeTask(executorId: string): Promise<{
    taskRun: TaskRun
    project: Project
    brief: ProjectBrief
    automationPolicy: AutomationPolicy
    mergePolicy: ProjectAggregate["mergePolicy"]
  } | null> {
    return this.#store.mutate((snapshot) => {
      const executor = snapshot.executors.find((entry) => entry.id === executorId)

      if (!executor) {
        return null
      }

      executor.status = "online"
      executor.lastSeenAt = nowIso()

      const run = [...snapshot.taskRuns]
        .filter((entry) => entry.status === "queued")
        .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
        .find((entry) => {
          const policy = this.#getAutomationPolicy(snapshot, entry.projectId)
          if (!policy || policy.paused) {
            return false
          }

          return !snapshot.taskRuns.some(
            (other) =>
              other.projectId === entry.projectId &&
              other.id !== entry.id &&
              ["planning", "running", "validating", "merging", "needs_approval"].includes(
                other.status,
              ),
          )
        })

      if (!run) {
        return null
      }

      const aggregate = this.#getProjectAggregate(snapshot, run.projectId)

      if (!aggregate) {
        return null
      }

      run.executorId = executorId
      run.status = "planning"
      run.updatedAt = nowIso()
      this.#feeds.publish(createFeedEvent("task.run.updated", run.projectId, run))

      return {
        taskRun: run,
        project: aggregate.project,
        brief: aggregate.brief,
        automationPolicy: aggregate.automationPolicy,
        mergePolicy: aggregate.mergePolicy,
      }
    })
  }

  async recordBridgeEvent(input: BridgeProgressEvent): Promise<TaskRun | null> {
    const updatedRun = await this.#store.mutate((draft) => {
      const currentRun = draft.taskRuns.find((entry) => entry.id === input.taskRunId)

      if (!currentRun) {
        return null
      }

      const timestamp = nowIso()
      currentRun.updatedAt = timestamp

      if (input.branchName) {
        currentRun.branchName = input.branchName
      }

      if (input.attempt) {
        const existingAttempt = draft.runAttempts.find(
          (entry) =>
            entry.taskRunId === currentRun.id &&
            entry.phase === input.attempt?.phase &&
            entry.number === input.attempt?.number,
        )

        if (existingAttempt) {
          existingAttempt.status = input.attempt.status
          existingAttempt.summary = input.attempt.summary ?? existingAttempt.summary
          existingAttempt.totalCostUsd = input.attempt.totalCostUsd ?? existingAttempt.totalCostUsd
          existingAttempt.finishedAt =
            input.attempt.status === "running" ? null : (existingAttempt.finishedAt ?? timestamp)
        } else {
          draft.runAttempts.unshift({
            id: nanoid(),
            taskRunId: currentRun.id,
            phase: input.attempt.phase,
            number: input.attempt.number,
            status: input.attempt.status,
            promptPackVersion: input.attempt.promptPackVersion,
            summary: input.attempt.summary ?? null,
            totalCostUsd: input.attempt.totalCostUsd ?? null,
            startedAt: timestamp,
            finishedAt: input.attempt.status === "running" ? null : timestamp,
          })
        }

        currentRun.attemptCount = Math.max(currentRun.attemptCount, input.attempt.number)
      }

      if (input.step) {
        draft.runSteps.unshift({
          id: nanoid(),
          taskRunId: currentRun.id,
          attemptId:
            draft.runAttempts.find(
              (entry) =>
                entry.taskRunId === currentRun.id &&
                entry.phase === input.attempt?.phase &&
                entry.number === input.attempt?.number,
            )?.id ?? null,
          kind: input.step.kind,
          status: input.step.status,
          title: input.step.title,
          body: input.step.body ?? null,
          createdAt: timestamp,
        })
        this.#feeds.publish(
          createFeedEvent("run.step", currentRun.projectId, {
            taskRunId: currentRun.id,
            kind: input.step.kind,
            status: input.step.status,
            title: input.step.title,
          }),
        )
      }

      const artifactBase: RunArtifact | null = input.artifact
        ? {
            id: nanoid(),
            taskRunId: currentRun.id,
            kind: input.artifact.kind,
            title: input.artifact.title,
            text: input.artifact.text ?? null,
            url: input.artifact.url ?? null,
            createdAt: timestamp,
          }
        : null

      if (artifactBase) {
        draft.artifacts.unshift(artifactBase)
        if (artifactBase.kind === "pull_request") {
          currentRun.prUrl = artifactBase.url ?? currentRun.prUrl
          currentRun.prNumber = parsePullRequestNumber(artifactBase.url) ?? currentRun.prNumber
          const repoSyncState = draft.repoSyncStates.find(
            (entry) => entry.projectId === currentRun.projectId,
          )
          if (repoSyncState) {
            repoSyncState.currentPrUrl = currentRun.prUrl
            repoSyncState.currentPrNumber = currentRun.prNumber
            repoSyncState.lastSyncAt = timestamp
          }
        }
      }

      if (input.checkpointBundle) {
        draft.checkpointBundles.unshift({
          id: nanoid(),
          taskRunId: currentRun.id,
          attemptId:
            draft.runAttempts.find(
              (entry) =>
                entry.taskRunId === currentRun.id &&
                entry.phase === input.attempt?.phase &&
                entry.number === input.attempt?.number,
            )?.id ?? null,
          path: input.checkpointBundle.path,
          summary: input.checkpointBundle.summary,
          createdAt: timestamp,
        })
      }

      if (input.event === "task.progress") {
        currentRun.status =
          input.step?.kind === "validation"
            ? "validating"
            : input.step?.kind === "merge" || input.step?.kind === "github"
              ? "merging"
              : "running"
      }

      if (input.event === "task.retrying") {
        currentRun.status = "running"
        this.#feeds.publish(
          createFeedEvent("run.retrying", currentRun.projectId, {
            taskRunId: currentRun.id,
            message: input.message,
          }),
        )
      }

      if (input.event === "task.blocked") {
        currentRun.status = "blocked"
        currentRun.resultSummary = input.message
      }

      if (input.event === "task.result") {
        currentRun.status = "completed"
        currentRun.resultSummary = input.message
        this.#completeLinkedTodo(draft, currentRun.sourceTodoId, timestamp)
        this.#createRecap(draft, currentRun, "Run completed", input.message, timestamp)
      }

      if (input.event === "task.approval_required") {
        currentRun.status = "needs_approval"
        currentRun.approvalReason = input.message
        draft.approvals.unshift({
          id: nanoid(),
          projectId: currentRun.projectId,
          taskRunId: currentRun.id,
          reason: input.message,
          status: "pending",
          createdAt: timestamp,
          decidedAt: null,
        })
      }

      if (input.event === "task.checks_green") {
        currentRun.status = "merging"
        currentRun.mergeState = "checks_green"
        this.#feeds.publish(
          createFeedEvent("run.checks_green", currentRun.projectId, {
            taskRunId: currentRun.id,
            prUrl: currentRun.prUrl,
          }),
        )
      }

      if (input.event === "task.merge_ready") {
        currentRun.status = "merging"
        currentRun.mergeState = "merge_ready"
        this.#feeds.publish(
          createFeedEvent("run.merge_ready", currentRun.projectId, {
            taskRunId: currentRun.id,
            prUrl: currentRun.prUrl,
          }),
        )
      }

      if (input.event === "task.merged") {
        currentRun.status = "completed"
        currentRun.mergeState = "merged"
        currentRun.resultSummary = input.message
        this.#completeLinkedTodo(draft, currentRun.sourceTodoId, timestamp)
        this.#createRecap(draft, currentRun, "Merged overnight", input.message, timestamp)
        this.#feeds.publish(
          createFeedEvent("run.merged", currentRun.projectId, {
            taskRunId: currentRun.id,
            prUrl: currentRun.prUrl,
          }),
        )
      }

      this.#feeds.publish(createFeedEvent("task.run.updated", currentRun.projectId, currentRun))

      return currentRun
    })

    if (!updatedRun) {
      return null
    }

    const freshSnapshot = await this.#store.getSnapshot()
    if (["completed", "needs_approval", "blocked", "failed"].includes(updatedRun.status)) {
      await this.#emitRunNotification(updatedRun, input.message, freshSnapshot)
    }

    if (input.proposedTodo) {
      await this.createAssistantProposal(updatedRun.projectId, {
        title: input.proposedTodo.title,
        details: input.proposedTodo.details ?? null,
        proposedFromTaskRunId: updatedRun.id,
      })
    }

    return updatedRun
  }

  async ingestGitHubWebhook(envelope: GitHubWebhookEnvelope): Promise<void> {
    const repoFullName = envelope.repository?.full_name

    if (!repoFullName) {
      return
    }

    const snapshot = await this.#store.getSnapshot()
    const project = snapshot.projects.find(
      (entry) =>
        `${entry.githubOwner}/${entry.githubRepo}`.toLowerCase() === repoFullName.toLowerCase(),
    )

    if (!project) {
      return
    }

    const notification = notificationSchema.parse({
      id: nanoid(),
      projectId: project.id,
      type: "project_update",
      title: `GitHub ${envelope.event}`,
      body: envelope.pull_request
        ? `${envelope.action ?? "updated"} PR #${envelope.pull_request.number}: ${envelope.pull_request.title}`
        : `${envelope.action ?? "updated"} on ${repoFullName}`,
      channel: "in_app",
      href: envelope.pull_request?.html_url ?? envelope.repository?.html_url ?? null,
      createdAt: nowIso(),
      readAt: null,
    })

    await this.#store.mutate((draft) => {
      draft.notifications.unshift(notification)
      this.#feeds.publish(createFeedEvent("notification.created", project.id, notification))
    })

    const refreshed = await this.#store.getSnapshot()
    await this.#notifications.deliver(notification, refreshed)
  }

  async tickNightlyScheduler(): Promise<void> {
    if (!this.#config.JMCP_AUTORUN_ENABLED || !this.#isInNightlyWindow()) {
      return
    }

    const pendingNotifications: Notification[] = []

    await this.#store.mutate((snapshot) => {
      const timestamp = nowIso()
      const projectIds = snapshot.projects.map((project) => project.id)

      for (const projectId of projectIds) {
        const policy = this.#getAutomationPolicy(snapshot, projectId)
        if (!policy || policy.paused || !policy.nightlyEnabled) {
          continue
        }

        const projectHasOpenRun = snapshot.taskRuns.some(
          (run) => run.projectId === projectId && isOpenTaskRunStatus(run.status),
        )
        if (projectHasOpenRun) {
          continue
        }

        const queuedNightlyTodos = snapshot.todos
          .filter(
            (todo) =>
              todo.projectId === projectId &&
              todo.nightly &&
              todo.approvalStatus === "approved" &&
              todo.status === "queued",
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

        if (queuedNightlyTodos.length === 0) {
          continue
        }

        const blockedIds = new Set<string>()

        for (let newerIndex = 1; newerIndex < queuedNightlyTodos.length; newerIndex += 1) {
          const newer = queuedNightlyTodos[newerIndex]

          if (blockedIds.has(newer.id) || newer.status !== "queued") {
            continue
          }

          for (let olderIndex = 0; olderIndex < newerIndex; olderIndex += 1) {
            const older = queuedNightlyTodos[olderIndex]

            if (blockedIds.has(older.id) || older.status !== "queued") {
              continue
            }

            const relation = compareNightlyTodos(older, newer)

            if (relation.kind === "superseded") {
              older.status = "cancelled"
              older.systemNote = relation.reason
              older.updatedAt = timestamp
              blockedIds.add(older.id)
              this.#feeds.publish(createFeedEvent("todo.updated", older.projectId, older))
              continue
            }

            if (relation.kind === "conflict") {
              older.status = "blocked"
              older.systemNote = relation.reason
              older.updatedAt = timestamp
              newer.status = "blocked"
              newer.systemNote = `Potential conflict with "${older.title}". Jarvis paused both overnight tasks for manual confirmation.`
              newer.updatedAt = timestamp
              blockedIds.add(older.id)
              blockedIds.add(newer.id)
              this.#feeds.publish(createFeedEvent("todo.updated", older.projectId, older))
              this.#feeds.publish(createFeedEvent("todo.updated", newer.projectId, newer))
              pendingNotifications.push(
                notificationSchema.parse({
                  id: nanoid(),
                  projectId,
                  type: "project_update",
                  title: "Nightly queue conflict needs confirmation",
                  body: `${older.title} conflicts with ${newer.title}. Jarvis paused both tasks instead of guessing.`,
                  channel: "in_app",
                  href: `/projects/${projectId}#todo-${newer.id}`,
                  createdAt: timestamp,
                  readAt: null,
                }),
              )
              break
            }
          }
        }

        const nextTodo = queuedNightlyTodos.find((todo) => todo.status === "queued")
        if (!nextTodo) {
          continue
        }

        nextTodo.status = "ready"
        nextTodo.systemNote =
          queuedNightlyTodos.length > 1
            ? `Nightly queue prepared. Jarvis will run this first, then continue sequentially.`
            : nextTodo.systemNote
        nextTodo.updatedAt = timestamp
        this.#queueTaskRun(snapshot, {
          projectId: nextTodo.projectId,
          sourceTodoId: nextTodo.id,
          objective: nextTodo.title,
          priority: 25,
        })
        this.#feeds.publish(createFeedEvent("todo.updated", nextTodo.projectId, nextTodo))
      }

      for (const notification of pendingNotifications) {
        snapshot.notifications.unshift(notification)
        this.#feeds.publish(
          createFeedEvent("notification.created", notification.projectId, notification),
        )
      }
    })

    if (pendingNotifications.length > 0) {
      const refreshed = await this.#store.getSnapshot()
      await Promise.all(
        pendingNotifications.map((notification) =>
          this.#notifications.deliver(notification, refreshed),
        ),
      )
    }
  }

  async ingestVoice(input: VoiceIngestInput): Promise<VoiceIngestResponse> {
    const timestamp = nowIso()
    await mkdir(this.#config.JMCP_VOICE_ASSET_DIR, { recursive: true })

    let audioPath: string | null = null
    if (input.audioBase64) {
      const fileExtension = input.mimeType?.includes("ogg")
        ? "ogg"
        : input.mimeType?.includes("webm")
          ? "webm"
          : input.mimeType?.includes("wav")
            ? "wav"
            : "bin"
      audioPath = path.join(this.#config.JMCP_VOICE_ASSET_DIR, `${nanoid()}.${fileExtension}`)
      await writeFile(audioPath, Buffer.from(input.audioBase64, "base64"))
    }

    const transcript = redactSecrets(
      input.transcript ?? (await this.#transcribeIfPossible(audioPath)) ?? "",
    )

    const asset = voiceAssetSchema.parse({
      id: nanoid(),
      projectId: input.projectId,
      source: input.source,
      transcript: transcript || null,
      audioPath,
      responseAudioPath: null,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      createdAt: timestamp,
    })

    const resolvedAsset = await this.#store.mutate((snapshot) => {
      snapshot.voiceAssets.unshift(asset)
      if (asset.projectId) {
        this.#feeds.publish(
          createFeedEvent("voice.transcribed", asset.projectId, {
            voiceAssetId: asset.id,
            transcript: asset.transcript,
          }),
        )
      }
      return asset
    })

    let response: ProjectMessageResponse | null = null

    if (resolvedAsset.projectId && resolvedAsset.transcript) {
      response = await this.postProjectMessage(resolvedAsset.projectId, {
        voiceNote: {
          transcript: resolvedAsset.transcript,
          durationMs: resolvedAsset.durationMs ?? undefined,
          hasAudio: Boolean(resolvedAsset.audioPath),
        },
      })
    }

    return {
      voiceAsset: resolvedAsset,
      response,
    }
  }

  #queueTaskRun(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    args: {
      projectId: string
      sourceTodoId: string | null
      objective: string
      priority: number
    },
  ): TaskRun {
    const timestamp = nowIso()
    const run: TaskRun = {
      id: nanoid(),
      projectId: args.projectId,
      sourceTodoId: args.sourceTodoId,
      objective: args.objective,
      status: "queued",
      branchName: null,
      executorId: null,
      approvalReason: null,
      resultSummary: null,
      prUrl: null,
      prNumber: null,
      priority: args.priority,
      attemptCount: 0,
      lastErrorSignature: null,
      mergeState: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    snapshot.taskRuns.unshift(run)
    this.#feeds.publish(createFeedEvent("task.run.created", args.projectId, run))
    return run
  }

  #completeLinkedTodo(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    sourceTodoId: string | null,
    timestamp: string,
  ): void {
    if (!sourceTodoId) {
      return
    }

    const linkedTodo = snapshot.todos.find((entry) => entry.id === sourceTodoId)
    if (!linkedTodo) {
      return
    }

    linkedTodo.status = "done"
    linkedTodo.updatedAt = timestamp
    this.#feeds.publish(createFeedEvent("todo.updated", linkedTodo.projectId, linkedTodo))
  }

  #createRecap(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    run: TaskRun,
    title: string,
    summary: string,
    timestamp: string,
  ): void {
    snapshot.recaps.unshift({
      id: nanoid(),
      projectId: run.projectId,
      title,
      summary,
      highlights: [
        run.objective,
        run.branchName ? `Branch: ${run.branchName}` : "No branch recorded",
        run.prUrl ? `PR: ${run.prUrl}` : "No PR recorded",
      ],
      createdAt: timestamp,
    })
    this.#feeds.publish(
      createFeedEvent("recap.created", run.projectId, {
        title,
        taskRunId: run.id,
      }),
    )
  }

  #getProjectAggregate(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    projectId: string,
  ): ProjectAggregate | null {
    const project = snapshot.projects.find((entry) => entry.id === projectId)
    const brief = snapshot.briefs.find((entry) => entry.projectId === projectId)
    const automationPolicy = snapshot.automationPolicies.find(
      (entry) => entry.projectId === projectId,
    )
    const mergePolicy = snapshot.mergePolicies.find((entry) => entry.projectId === projectId)
    const conversation = snapshot.conversations.find((entry) => entry.projectId === projectId)

    if (!project || !brief || !automationPolicy || !mergePolicy || !conversation) {
      return null
    }

    return {
      project,
      brief,
      automationPolicy,
      mergePolicy,
      repoSyncState: snapshot.repoSyncStates.find((entry) => entry.projectId === projectId) ?? null,
      conversation,
      todos: snapshot.todos.filter((entry) => entry.projectId === projectId),
      taskRuns: snapshot.taskRuns.filter((entry) => entry.projectId === projectId),
      runSteps: snapshot.runSteps.filter((entry) =>
        snapshot.taskRuns
          .filter((run) => run.projectId === projectId)
          .some((run) => run.id === entry.taskRunId),
      ),
      artifacts: snapshot.artifacts.filter((entry) =>
        snapshot.taskRuns
          .filter((run) => run.projectId === projectId)
          .some((run) => run.id === entry.taskRunId),
      ),
      recaps: snapshot.recaps.filter((entry) => entry.projectId === projectId),
      approvals: snapshot.approvals.filter((entry) => entry.projectId === projectId),
      executors: snapshot.executors,
      notifications: snapshot.notifications.filter((entry) => entry.projectId === projectId),
      pushSubscriptions: snapshot.pushSubscriptions,
      voiceAssets: snapshot.voiceAssets.filter((entry) => entry.projectId === projectId),
    }
  }

  #getAutomationPolicy(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    projectId: string,
  ): AutomationPolicy | undefined {
    return snapshot.automationPolicies.find((entry) => entry.projectId === projectId)
  }

  #findTrackedTodo(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    projectId: string,
    title: string,
  ): TodoItem | null {
    const normalizedTitle = normalizeWorkLabel(title)

    return (
      snapshot.todos.find(
        (entry) =>
          entry.projectId === projectId &&
          isTrackedTodo(entry) &&
          normalizeWorkLabel(entry.title) === normalizedTitle,
      ) ?? null
    )
  }

  #findOpenTaskRun(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    projectId: string,
    objective?: string | null,
  ): TaskRun | null {
    const normalizedObjective = objective ? normalizeWorkLabel(objective) : null

    return (
      snapshot.taskRuns.find(
        (entry) =>
          entry.projectId === projectId &&
          isOpenTaskRunStatus(entry.status) &&
          (normalizedObjective === null ||
            normalizeWorkLabel(entry.objective) === normalizedObjective),
      ) ?? null
    )
  }

  #createTodoRecord(
    projectId: string,
    input: {
      title: string
      details: string | null
      systemNote?: string | null
      nightly: boolean
      source: TodoItem["source"]
      approvalStatus?: TodoItem["approvalStatus"]
      proposedFromTaskRunId?: string | null
      runAfter: string | null
    },
  ): TodoItem {
    const timestamp = nowIso()

    return {
      id: nanoid(),
      projectId,
      title: input.title,
      details: input.details,
      systemNote: input.systemNote ?? null,
      status: "queued",
      source: input.source,
      approvalStatus: input.approvalStatus ?? "approved",
      proposedFromTaskRunId: input.proposedFromTaskRunId ?? null,
      nightly: input.nightly,
      runAfter: input.runAfter,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  #createDuplicateReply(args: {
    project: Project
    title: string
    existingTodo: TodoItem | null
    existingRun: TaskRun | null
  }): MobileReply {
    return createAlreadyTrackedReply({
      project: args.project,
      title: args.title,
      todoId: args.existingTodo?.id ?? null,
      runId: args.existingRun?.id ?? null,
      blocked: args.existingRun?.status === "blocked",
    })
  }

  async #emitRunNotification(
    run: TaskRun,
    message: string,
    _snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
  ): Promise<void> {
    const notification = notificationSchema.parse({
      id: nanoid(),
      projectId: run.projectId,
      type:
        run.status === "completed"
          ? "task_completed"
          : run.status === "needs_approval"
            ? "approval_requested"
            : run.status === "blocked" || run.status === "failed"
              ? "task_blocked"
              : "task_update",
      title: run.objective,
      body: message,
      channel: "in_app",
      href: `/projects/${run.projectId}#run-${run.id}`,
      createdAt: nowIso(),
      readAt: null,
    })

    await this.#store.mutate((draft) => {
      draft.notifications.unshift(notification)
      this.#feeds.publish(createFeedEvent("notification.created", run.projectId, notification))
    })

    const freshSnapshot = await this.#store.getSnapshot()
    await this.#notifications.deliver(notification, freshSnapshot)
  }

  async #transcribeIfPossible(audioPath: string | null): Promise<string | null> {
    if (!audioPath || !this.#config.JMCP_VOICE_TRANSCRIBE_COMMAND) {
      return null
    }

    try {
      const result = await exec(this.#config.JMCP_VOICE_TRANSCRIBE_COMMAND, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JMCP_VOICE_INPUT_PATH: audioPath,
          HOME: process.env.HOME ?? os.homedir(),
        },
      })
      return result.stdout.trim() || null
    } catch {
      return null
    }
  }

  #isInNightlyWindow(): boolean {
    const hour = new Date().getHours()
    const start = this.#config.JMCP_NIGHTLY_START_HOUR
    const end = this.#config.JMCP_NIGHTLY_END_HOUR

    if (start < end) {
      return hour >= start && hour < end
    }

    return hour >= start || hour < end
  }
}
