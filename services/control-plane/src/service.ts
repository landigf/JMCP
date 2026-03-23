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
  type CreateEpicInput,
  type CreateProjectFromGithubInput,
  type CreateProjectInput,
  type CreateTodoInput,
  type CreateTodoResult,
  type DashboardSnapshot,
  type Epic,
  type EpicTask,
  type Executor,
  epicSchema,
  epicTaskSchema,
  type FeedEvent,
  type GitHubWebhookEnvelope,
  type MobileReply,
  type Notification,
  notificationSchema,
  type Project,
  type ProjectBrief,
  type ProjectMemory,
  type ProjectMessageInput,
  type ProjectMessageResponse,
  type ProjectSummary,
  type ProposalDecision,
  projectMemorySchema,
  projectSchema,
  projectSummarySchema,
  type RepoCatalogEntry,
  type RepoSyncState,
  type RunArtifact,
  type RunDetail,
  repoCatalogEntrySchema,
  runDetailSchema,
  type TaskRun,
  type TelegramThreadState,
  type TodoItem,
  telegramThreadStateSchema,
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

const JARVIS_TEMPLATE_NAME = "jarvis-managed-default"
const JARVIS_TEMPLATE_VERSION = "2026-03-23b"
const JARVIS_OPERATOR_DEFAULTS = [
  "Jarvis writes the code and preserves existing repo conventions.",
  "Large goals become epics with decomposed tasks instead of one giant TODO.",
  "Complex or ambiguous work is queued for overnight or surfaced for approval.",
  "Jarvis proposes bounded follow-up improvements explicitly instead of hiding them.",
]
const JARVIS_TEMPLATE_INSTRUCTIONS = [
  "Coordinate all work through Jarvis project memory and queued tasks.",
  "Prefer safe, production-ready changes with explicit validation commands.",
  "Do not introduce secrets, unsafe crypto, or silent external side effects.",
  "Keep the repo agent-friendly and propose AGENTS.md if it is missing.",
]

type RepoInspection = {
  defaultBranch: string
  repoUrl: string
  description: string | null
  isPrivate: boolean
  stackProfile: string[]
  testCommands: string[]
  dangerousPaths: string[]
  repoFacts: string[]
  instructionSources: string[]
  readmeExcerpt: string | null
  hasAgentsGuide: boolean
}

type EpicTaskBlueprint = {
  title: string
  details: string | null
  kind: "do_now" | "overnight" | "needs_decision" | "idea_from_jarvis"
}

function nowIso(): string {
  return new Date().toISOString()
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function shouldCreateEpic(text: string): boolean {
  const normalized = text.trim()
  if (normalized.length >= 260) {
    return true
  }

  const lower = normalized.toLowerCase()
  return [
    "idea of building",
    "social network",
    "revoluzion",
    "allow login",
    "anonymous publish",
    "orcid",
    "research id",
    "architecture",
    "workstream",
  ].some((needle) => lower.includes(needle))
}

function createEpicTitle(project: Project, description: string): string {
  const firstSentence = description.replace(/\s+/g, " ").split(/[.!?]/)[0]?.trim()

  if (firstSentence) {
    return truncateText(firstSentence, 96)
  }

  return `Jarvis epic for ${project.name}`
}

function createRepoSummary(
  input: CreateProjectInput,
  inspection: RepoInspection,
  owner: string,
  repo: string,
): string {
  const explicit = input.summary?.trim()
  if (explicit) {
    return explicit
  }

  if (inspection.description) {
    return inspection.description
  }

  return `GitHub repo ${owner}/${repo}. Preserve existing conventions and ship safe, production-ready changes.`
}

function selectNodeTestCommands(
  packageJson: {
    scripts?: Record<string, string>
  } | null,
): string[] {
  if (!packageJson?.scripts) {
    return ["npm run test", "npm run check", "npm run lint"]
  }

  const preferred = ["test", "check", "lint", "build"]
  return preferred
    .filter((script) => packageJson.scripts?.[script])
    .map((script) => `npm run ${script}`)
}

function buildGenericEpicBlueprints(project: Project, description: string): EpicTaskBlueprint[] {
  return [
    {
      title: `Map architecture and execution plan for ${project.name}`,
      details: truncateText(description, 400),
      kind: "do_now",
    },
    {
      title: `Implement the first safe slice for ${project.name}`,
      details:
        "Start with bounded repo-local work that unlocks the product direction without overcommitting to unresolved choices.",
      kind: "overnight",
    },
    {
      title: `Review unresolved product decisions for ${project.name}`,
      details:
        "Keep ambiguous or high-impact choices visible for operator approval instead of guessing.",
      kind: "needs_decision",
    },
  ]
}

function buildPapersEpicBlueprints(_description: string): EpicTaskBlueprint[] {
  return [
    {
      title: "Foundation and architecture for Papers",
      details:
        "Create the monorepo structure, global repo instructions, auth/data boundaries, and an execution-ready architecture for a full social paper-sharing product.",
      kind: "do_now",
    },
    {
      title: "Auth and profile system for Papers",
      details:
        "Ship the first profile and session flow with secure defaults, so researchers can create an account and prepare a public identity.",
      kind: "do_now",
    },
    {
      title: "ORCID linking for research identity",
      details:
        "Add ORCID-based identity linking so Papers can attach a real research identity when users want verified ownership.",
      kind: "overnight",
    },
    {
      title: "Paper publishing flow and metadata model",
      details:
        "Create the post/paper model, metadata capture, upload boundaries, and a creation flow that supports paper-first sharing instead of LinkedIn posts.",
      kind: "overnight",
    },
    {
      title: "Blind anonymous publication mode",
      details:
        "Support conference-safe anonymous sharing by hiding author identity everywhere publicly, scrubbing upload metadata, and keeping internal ownership private.",
      kind: "overnight",
    },
    {
      title: "Social feed and follow graph",
      details:
        "Implement the first social-network slice: follow researchers or interests, see a home feed, and surface paper activity clearly.",
      kind: "overnight",
    },
    {
      title: "Discovery and recommendation engine inspired by Broletter",
      details:
        "Use interest modeling and explanation-style recommendations to connect papers to the reader’s research interests and curiosity graph.",
      kind: "idea_from_jarvis",
    },
    {
      title: "Moderation, abuse prevention, and anonymity safety review",
      details:
        "Define moderation boundaries, abuse controls, and leak-prevention rules for blind submissions and identity protection.",
      kind: "needs_decision",
    },
    {
      title: "Deployment and observability plan for Papers",
      details:
        "Prepare deployment, storage, job execution, and observability choices without over-coupling the first product slice.",
      kind: "idea_from_jarvis",
    },
  ]
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

function createDefaultBrief(
  projectId: string,
  summary: string,
  inspection: RepoInspection,
): ProjectBrief {
  const timestamp = nowIso()

  return {
    id: nanoid(),
    projectId,
    summary,
    codingNorms: dedupeStrings([
      "Preserve existing repo conventions before introducing new patterns.",
      "Prefer explicit validation, defensive defaults, and concise commits.",
      "Never introduce secrets, unsafe crypto, or silent network side effects.",
      ...JARVIS_TEMPLATE_INSTRUCTIONS,
    ]),
    testCommands: inspection.testCommands,
    dangerousPaths: inspection.dangerousPaths,
    releaseConstraints: [
      "Open a PR with a concise summary.",
      "Run project checks before marking complete.",
      "Respect protected branch and required checks rules.",
    ],
    stackProfile: inspection.stackProfile,
    instructionSources: inspection.instructionSources,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createProjectMemory(
  projectId: string,
  inspection: RepoInspection,
  summary: string,
): ProjectMemory {
  const timestamp = nowIso()

  return projectMemorySchema.parse({
    id: nanoid(),
    projectId,
    templateName: JARVIS_TEMPLATE_NAME,
    templateVersion: JARVIS_TEMPLATE_VERSION,
    stackProfile: inspection.stackProfile,
    repoFacts: dedupeStrings([summary, ...inspection.repoFacts]),
    operatorDefaults: JARVIS_OPERATOR_DEFAULTS,
    instructions: dedupeStrings([
      ...JARVIS_TEMPLATE_INSTRUCTIONS,
      `Default validation commands: ${inspection.testCommands.join(" | ")}`,
    ]),
    readmeExcerpt: inspection.readmeExcerpt,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
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

  async listGitHubRepos(): Promise<RepoCatalogEntry[]> {
    const { stdout: loginStdout } = await exec("gh api user --jq .login", {
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
      maxBuffer: 10 * 1024 * 1024,
    })
    const login = loginStdout.trim()
    const { stdout } = await exec(
      `gh repo list ${login} --limit 100 --json name,nameWithOwner,isPrivate,description,defaultBranchRef,url`,
      {
        env: {
          ...process.env,
          HOME: process.env.HOME ?? os.homedir(),
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    )

    const parsed = JSON.parse(stdout) as Array<{
      name: string
      nameWithOwner: string
      isPrivate: boolean
      description: string | null
      defaultBranchRef: { name: string | null } | null
      url: string
    }>

    return parsed
      .map((entry) => {
        const [owner, repo] = entry.nameWithOwner.split("/")
        return repoCatalogEntrySchema.parse({
          id: entry.nameWithOwner,
          owner,
          repo,
          nameWithOwner: entry.nameWithOwner,
          description: entry.description ?? null,
          url: entry.url,
          defaultBranch: entry.defaultBranchRef?.name || "main",
          isPrivate: entry.isPrivate,
        })
      })
      .sort((left, right) => left.nameWithOwner.localeCompare(right.nameWithOwner))
  }

  async createProjectFromGithub(input: CreateProjectFromGithubInput): Promise<Project> {
    const inspection = await this.#inspectGitHubRepo(input.githubOwner, input.githubRepo)
    return this.createProject({
      name: input.name?.trim() || input.githubRepo,
      githubOwner: input.githubOwner,
      githubRepo: input.githubRepo,
      summary: input.summary?.trim() || inspection.description || undefined,
      defaultBranch: inspection.defaultBranch,
      nightlyEnabled: input.nightlyEnabled,
      repoUrl: inspection.repoUrl,
    })
  }

  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    const snapshot = await this.#store.getSnapshot()
    const projectMemories = snapshot.projects.map((project) => {
      const brief = snapshot.briefs.find((entry) => entry.projectId === project.id)
      return this.#getProjectMemory(snapshot, project.id, project, brief ?? null)
    })
    const epicTasks = snapshot.epicTasks.map((entry) => this.#resolveEpicTask(snapshot, entry))
    const epics = snapshot.epics.map((entry) =>
      this.#resolveEpic(
        snapshot,
        entry,
        epicTasks.filter((task) => task.epicId === entry.id),
      ),
    )

    return {
      projects: [...snapshot.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      briefs: snapshot.briefs,
      projectMemories,
      automationPolicies: snapshot.automationPolicies,
      epics: [...epics].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      epicTasks: [...epicTasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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

  async registerTelegramThread(input: {
    chatId: string
    lastUpdateId?: number | null
    linkedProjectId?: string | null
  }): Promise<TelegramThreadState> {
    return this.#store.mutate((snapshot) => {
      const timestamp = nowIso()
      const existing = snapshot.telegramThreads.find((thread) => thread.chatId === input.chatId)

      if (existing) {
        existing.lastUpdateId = input.lastUpdateId ?? existing.lastUpdateId
        existing.linkedProjectId = input.linkedProjectId ?? existing.linkedProjectId
        existing.updatedAt = timestamp
        return existing
      }

      const created = telegramThreadStateSchema.parse({
        id: nanoid(),
        chatId: input.chatId,
        linkedProjectId: input.linkedProjectId ?? null,
        lastUpdateId: input.lastUpdateId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      snapshot.telegramThreads.unshift(created)
      return created
    })
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const existingSnapshot = await this.#store.getSnapshot()
    const existing = existingSnapshot.projects.find(
      (entry) =>
        entry.githubOwner.toLowerCase() === input.githubOwner.toLowerCase() &&
        entry.githubRepo.toLowerCase() === input.githubRepo.toLowerCase(),
    )

    if (existing) {
      return existing
    }

    const inspection = await this.#inspectGitHubRepo(input.githubOwner, input.githubRepo)
    const summary = createRepoSummary(input, inspection, input.githubOwner, input.githubRepo)

    const project = await this.#store.mutate((snapshot) => {
      const duplicate = snapshot.projects.find(
        (entry) =>
          entry.githubOwner.toLowerCase() === input.githubOwner.toLowerCase() &&
          entry.githubRepo.toLowerCase() === input.githubRepo.toLowerCase(),
      )

      if (duplicate) {
        return duplicate
      }

      const timestamp = nowIso()
      const created = projectSchema.parse({
        id: nanoid(),
        name: input.name,
        githubOwner: input.githubOwner,
        githubRepo: input.githubRepo,
        summary,
        defaultBranch: inspection.defaultBranch || input.defaultBranch,
        nightlyEnabled: input.nightlyEnabled,
        repoUrl: input.repoUrl ?? inspection.repoUrl ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      const brief = createDefaultBrief(created.id, summary, inspection)
      const projectMemory = createProjectMemory(created.id, inspection, summary)
      const mergePolicy = createDefaultMergePolicy(created.id)
      const automationPolicy = createDefaultAutomationPolicy(created.id, mergePolicy.id)
      automationPolicy.nightlyEnabled = input.nightlyEnabled

      snapshot.projects.unshift(created)
      snapshot.briefs.unshift(brief)
      snapshot.projectMemories.unshift(projectMemory)
      snapshot.mergePolicies.unshift(mergePolicy)
      snapshot.automationPolicies.unshift(automationPolicy)
      snapshot.repoSyncStates.unshift(createDefaultRepoSyncState(created.id))
      snapshot.conversations.push({
        projectId: created.id,
        messages: [
          {
            id: nanoid(),
            projectId: created.id,
            role: "system",
            kind: "text",
            text: `Project created for ${created.githubOwner}/${created.githubRepo}.`,
            createdAt: timestamp,
          },
        ],
      })

      this.#feeds.publish(
        createFeedEvent("message.created", created.id, {
          projectId: created.id,
          kind: "project_created",
        }),
      )

      return created
    })

    if (!inspection.hasAgentsGuide) {
      await this.createAssistantProposal(project.id, {
        title: "Add AGENTS.md for Jarvis-managed workflow",
        details:
          "This repo does not expose an AGENTS.md yet. Add one so future coding agents inherit the same project-specific guardrails automatically.",
        proposedFromTaskRunId: null,
      })
    }

    return project
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
      projectMemory: aggregate.projectMemory,
      automationPolicy: aggregate.automationPolicy,
      mergePolicy: aggregate.mergePolicy,
      repoSyncState: aggregate.repoSyncState,
      conversation: aggregate.conversation,
      epics: aggregate.epics,
      epicTasks: aggregate.epicTasks,
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

  async createEpic(
    projectId: string,
    input: CreateEpicInput,
    createdFromMessageId: string | null = null,
  ): Promise<{ epic: Epic; tasks: EpicTask[] } | null> {
    const snapshot = await this.#store.getSnapshot()
    const aggregate = this.#getProjectAggregate(snapshot, projectId)

    if (!aggregate) {
      return null
    }

    const description = redactSecrets(input.description.trim())
    const title = input.title?.trim() || createEpicTitle(aggregate.project, description)
    const blueprints =
      aggregate.project.githubRepo.toLowerCase() === "papers"
        ? buildPapersEpicBlueprints(description)
        : buildGenericEpicBlueprints(aggregate.project, description)

    const notifications: Notification[] = []

    const created = await this.#store.mutate((draft) => {
      const timestamp = nowIso()
      const policy = this.#getAutomationPolicy(draft, projectId)
      const existingActiveRun = this.#findOpenTaskRun(draft, projectId)
      let runScheduled = existingActiveRun !== null

      const epic = epicSchema.parse({
        id: nanoid(),
        projectId,
        title,
        description,
        status: "active",
        source: input.source,
        createdFromMessageId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      const tasks = blueprints.map((blueprint) => {
        const epicTask = epicTaskSchema.parse({
          id: nanoid(),
          epicId: epic.id,
          projectId,
          title: blueprint.title,
          details: blueprint.details,
          kind: blueprint.kind,
          status: blueprint.kind === "needs_decision" ? "needs_decision" : "planned",
          linkedTodoId: null,
          linkedTaskRunId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })

        if (blueprint.kind === "needs_decision") {
          notifications.push(
            notificationSchema.parse({
              id: nanoid(),
              projectId,
              type: "project_update",
              title: `Decision needed: ${blueprint.title}`,
              body:
                blueprint.details ??
                "Jarvis needs operator confirmation before moving this epic task.",
              channel: "in_app",
              href: `/projects/${projectId}#epic-task-${epicTask.id}`,
              createdAt: timestamp,
              readAt: null,
            }),
          )
          return epicTask
        }

        const duplicateTodo = this.#findTrackedTodo(draft, projectId, blueprint.title)
        const duplicateRun = this.#findOpenTaskRun(draft, projectId, blueprint.title)

        if (duplicateRun) {
          epicTask.linkedTaskRunId = duplicateRun.id
          epicTask.linkedTodoId = duplicateRun.sourceTodoId
          epicTask.status = "in_progress"
          return epicTask
        }

        if (duplicateTodo) {
          epicTask.linkedTodoId = duplicateTodo.id
          epicTask.status =
            duplicateTodo.source === "assistant" && duplicateTodo.approvalStatus === "pending"
              ? "planned"
              : duplicateTodo.status === "blocked"
                ? "blocked"
                : duplicateTodo.status === "done"
                  ? "done"
                  : "queued"
          return epicTask
        }

        if (blueprint.kind === "idea_from_jarvis") {
          const proposal = this.#createTodoRecord(projectId, {
            title: blueprint.title,
            details: blueprint.details,
            source: "assistant",
            approvalStatus: "pending",
            proposedFromTaskRunId: null,
            nightly: false,
            runAfter: null,
            systemNote: `Generated from epic "${epic.title}".`,
          })
          draft.todos.unshift(proposal)
          this.#feeds.publish(createFeedEvent("todo.created", projectId, proposal))
          epicTask.linkedTodoId = proposal.id
          epicTask.status = "planned"
          return epicTask
        }

        const nightly = blueprint.kind === "overnight"
        const todo = this.#createTodoRecord(projectId, {
          title: blueprint.title,
          details: blueprint.details,
          source: nightly ? "nightly" : "chat",
          nightly,
          runAfter: null,
          systemNote: `Generated from epic "${epic.title}".`,
        })

        if (!nightly && policy?.autoRunOnTodo && !runScheduled) {
          todo.status = "ready"
          const run = this.#queueTaskRun(draft, {
            projectId,
            sourceTodoId: todo.id,
            objective: todo.title,
            priority: 18,
          })
          epicTask.linkedTaskRunId = run.id
          runScheduled = true
          epicTask.status = "in_progress"
        } else {
          epicTask.status = nightly ? "queued" : "queued"
        }

        draft.todos.unshift(todo)
        this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))
        epicTask.linkedTodoId = todo.id
        return epicTask
      })

      draft.epics.unshift(epic)
      draft.epicTasks.unshift(...tasks)
      return { epic, tasks }
    })

    if (notifications.length > 0) {
      await this.#store.mutate((draft) => {
        draft.notifications.unshift(...notifications)
        for (const notification of notifications) {
          this.#feeds.publish(createFeedEvent("notification.created", projectId, notification))
        }
      })
      const refreshed = await this.#store.getSnapshot()
      await Promise.all(
        notifications.map((notification) => this.#notifications.deliver(notification, refreshed)),
      )
    }

    return created
  }

  async getEpic(
    projectId: string,
    epicId: string,
  ): Promise<{ epic: Epic; tasks: EpicTask[] } | null> {
    const snapshot = await this.#store.getSnapshot()
    const epic = snapshot.epics.find(
      (entry) => entry.id === epicId && entry.projectId === projectId,
    )

    if (!epic) {
      return null
    }

    const tasks = snapshot.epicTasks
      .filter((entry) => entry.epicId === epicId && entry.projectId === projectId)
      .map((entry) => this.#resolveEpicTask(snapshot, entry))

    return {
      epic: this.#resolveEpic(snapshot, epic, tasks),
      tasks,
    }
  }

  async runEpicTaskNow(
    projectId: string,
    epicId: string,
    epicTaskId: string,
  ): Promise<EpicTask | null> {
    const snapshot = await this.#store.getSnapshot()
    const epicTask = snapshot.epicTasks.find(
      (entry) =>
        entry.id === epicTaskId && entry.projectId === projectId && entry.epicId === epicId,
    )

    if (!epicTask) {
      return null
    }

    if (epicTask.linkedTodoId) {
      await this.runTodoNow(projectId, epicTask.linkedTodoId)
    } else {
      await this.#store.mutate((draft) => {
        const task = draft.epicTasks.find((entry) => entry.id === epicTaskId)
        const epic = draft.epics.find((entry) => entry.id === epicId)
        if (!task || !epic) {
          return
        }

        const todo = this.#createTodoRecord(projectId, {
          title: task.title,
          details: task.details,
          source: "chat",
          nightly: false,
          runAfter: null,
          systemNote: `Generated from epic "${epic.title}".`,
        })
        todo.status = "ready"
        draft.todos.unshift(todo)
        const run = this.#queueTaskRun(draft, {
          projectId,
          sourceTodoId: todo.id,
          objective: todo.title,
          priority: 14,
        })
        task.linkedTodoId = todo.id
        task.linkedTaskRunId = run.id
        task.status = "in_progress"
        task.updatedAt = nowIso()
        this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))
      })
    }

    const refreshed = await this.#store.getSnapshot()
    const updated = refreshed.epicTasks.find((entry) => entry.id === epicTaskId)
    return updated ? this.#resolveEpicTask(refreshed, updated) : null
  }

  async queueEpicTaskOvernight(
    projectId: string,
    epicId: string,
    epicTaskId: string,
  ): Promise<EpicTask | null> {
    await this.#store.mutate((draft) => {
      const task = draft.epicTasks.find(
        (entry) =>
          entry.id === epicTaskId && entry.projectId === projectId && entry.epicId === epicId,
      )
      const epic = draft.epics.find((entry) => entry.id === epicId)
      if (!task || !epic) {
        return
      }

      const linkedTodo = task.linkedTodoId
        ? draft.todos.find((entry) => entry.id === task.linkedTodoId)
        : null

      if (linkedTodo) {
        linkedTodo.nightly = true
        linkedTodo.source = "nightly"
        linkedTodo.status = linkedTodo.status === "done" ? "done" : "queued"
        linkedTodo.updatedAt = nowIso()
        task.status = linkedTodo.status === "done" ? "done" : "queued"
        task.updatedAt = nowIso()
        return
      }

      const todo = this.#createTodoRecord(projectId, {
        title: task.title,
        details: task.details,
        source: "nightly",
        nightly: true,
        runAfter: null,
        systemNote: `Generated from epic "${epic.title}".`,
      })
      draft.todos.unshift(todo)
      task.linkedTodoId = todo.id
      task.linkedTaskRunId = null
      task.status = "queued"
      task.updatedAt = nowIso()
      this.#feeds.publish(createFeedEvent("todo.created", projectId, todo))
    })

    const refreshed = await this.#store.getSnapshot()
    const updated = refreshed.epicTasks.find((entry) => entry.id === epicTaskId)
    return updated ? this.#resolveEpicTask(refreshed, updated) : null
  }

  async rejectEpicTask(
    projectId: string,
    epicId: string,
    epicTaskId: string,
  ): Promise<EpicTask | null> {
    await this.#store.mutate((draft) => {
      const task = draft.epicTasks.find(
        (entry) =>
          entry.id === epicTaskId && entry.projectId === projectId && entry.epicId === epicId,
      )
      if (!task) {
        return
      }

      task.status = "rejected"
      task.updatedAt = nowIso()

      const linkedTodo = task.linkedTodoId
        ? draft.todos.find((entry) => entry.id === task.linkedTodoId)
        : null

      if (linkedTodo) {
        linkedTodo.status = "cancelled"
        linkedTodo.updatedAt = nowIso()
        linkedTodo.systemNote = "Rejected from epic task review."
      }
    })

    const refreshed = await this.#store.getSnapshot()
    const updated = refreshed.epicTasks.find((entry) => entry.id === epicTaskId)
    return updated ? this.#resolveEpicTask(refreshed, updated) : null
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
    const isEpic = shouldCreateEpic(text)

    let createdTodoId: string | null = null
    let createdTaskRunId: string | null = null
    let reply: MobileReply | null = null
    let operatorMessageId: string | null = null

    await this.#store.mutate((draft) => {
      const conversation = draft.conversations.find((entry) => entry.projectId === projectId)

      if (!conversation) {
        throw new Error("Project not found")
      }

      const messageId = nanoid()
      conversation.messages.push({
        id: messageId,
        projectId,
        role: "operator",
        kind: input.voiceNote ? "voice_note" : "text",
        text,
        createdAt: nowIso(),
      })
      operatorMessageId = messageId
    })

    if (isEpic) {
      const createdEpic = await this.createEpic(
        projectId,
        {
          description: text,
          source: "operator",
        },
        operatorMessageId,
      )

      if (!createdEpic) {
        return null
      }

      createdTodoId = createdEpic.tasks.find((task) => task.linkedTodoId)?.linkedTodoId ?? null
      createdTaskRunId =
        createdEpic.tasks.find((task) => task.linkedTaskRunId)?.linkedTaskRunId ?? null
      reply = {
        status: "Epic captured and decomposed.",
        whatChanged: [
          `Jarvis stored ${createdEpic.epic.title} as an epic.`,
          `Split it into ${createdEpic.tasks.length} project tasks.`,
        ],
        needsDecision: createdEpic.tasks
          .filter((task) => task.kind === "needs_decision")
          .map((task) => task.title)
          .slice(0, 3),
        next: [
          "Run the immediate tasks now, let the overnight queue pick up the deeper work, and review any flagged decisions from the project page or Telegram.",
        ],
        links: [
          {
            label: "Open project",
            href: `/projects/${projectId}`,
          },
        ],
      }

      await this.#store.mutate((draft) => {
        const conversation = draft.conversations.find((entry) => entry.projectId === projectId)
        if (!conversation) {
          throw new Error("Project not found")
        }

        conversation.messages.push({
          id: nanoid(),
          projectId,
          role: "assistant",
          kind: "text",
          text: JSON.stringify(reply),
          createdAt: nowIso(),
        })
        this.#feeds.publish(
          createFeedEvent("message.created", projectId, {
            role: "assistant",
            reply,
          }),
        )
      })

      return {
        intent: {
          kind: "save_todo",
          confidence: 0.94,
          summary: "Capture this as an epic and split it into executable work.",
        },
        reply,
        createdTodoId,
        createdTaskRunId,
      }
    }

    await this.#store.mutate((draft) => {
      const conversation = draft.conversations.find((entry) => entry.projectId === projectId)
      const project = draft.projects.find((entry) => entry.id === projectId)

      if (!conversation || !project) {
        throw new Error("Project not found")
      }
      const timestamp = nowIso()

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
    projectMemory: ProjectMemory
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
        projectMemory: aggregate.projectMemory,
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
    const projectMemory = this.#getProjectMemory(snapshot, projectId, project, brief)

    const taskRuns = snapshot.taskRuns.filter((entry) => entry.projectId === projectId)
    const epicTasks = snapshot.epicTasks
      .filter((entry) => entry.projectId === projectId)
      .map((entry) => this.#resolveEpicTask(snapshot, entry))
    const epics = snapshot.epics
      .filter((entry) => entry.projectId === projectId)
      .map((entry) =>
        this.#resolveEpic(
          snapshot,
          entry,
          epicTasks.filter((task) => task.epicId === entry.id),
        ),
      )

    return {
      project,
      brief,
      projectMemory,
      automationPolicy,
      mergePolicy,
      repoSyncState: snapshot.repoSyncStates.find((entry) => entry.projectId === projectId) ?? null,
      conversation,
      epics,
      epicTasks,
      todos: snapshot.todos.filter((entry) => entry.projectId === projectId),
      taskRuns,
      runSteps: snapshot.runSteps.filter((entry) =>
        taskRuns.some((run) => run.id === entry.taskRunId),
      ),
      artifacts: snapshot.artifacts.filter((entry) =>
        taskRuns.some((run) => run.id === entry.taskRunId),
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

  #getProjectMemory(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    projectId: string,
    project: Project,
    brief: ProjectBrief | null,
  ): ProjectMemory {
    const existing = snapshot.projectMemories.find((entry) => entry.projectId === projectId)
    if (existing) {
      return existing
    }

    return projectMemorySchema.parse({
      id: `memory-${projectId}`,
      projectId,
      templateName: JARVIS_TEMPLATE_NAME,
      templateVersion: JARVIS_TEMPLATE_VERSION,
      stackProfile: brief?.stackProfile ?? [],
      repoFacts: dedupeStrings([
        project.summary,
        `Default branch: ${project.defaultBranch}`,
        `Repository: ${project.githubOwner}/${project.githubRepo}`,
      ]),
      operatorDefaults: JARVIS_OPERATOR_DEFAULTS,
      instructions: JARVIS_TEMPLATE_INSTRUCTIONS,
      readmeExcerpt: null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
  }

  #resolveEpicTask(
    snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    epicTask: EpicTask,
  ): EpicTask {
    const resolved: EpicTask = { ...epicTask }

    if (epicTask.linkedTaskRunId) {
      const run = snapshot.taskRuns.find((entry) => entry.id === epicTask.linkedTaskRunId)
      if (run) {
        resolved.status =
          run.status === "completed"
            ? "done"
            : run.status === "blocked" || run.status === "needs_approval"
              ? "blocked"
              : run.status === "cancelled"
                ? "cancelled"
                : "in_progress"
        return resolved
      }
    }

    if (epicTask.linkedTodoId) {
      const todo = snapshot.todos.find((entry) => entry.id === epicTask.linkedTodoId)
      if (todo) {
        if (todo.source === "assistant" && todo.approvalStatus === "pending") {
          resolved.status = "planned"
          return resolved
        }

        resolved.status =
          todo.status === "done"
            ? "done"
            : todo.status === "blocked"
              ? "blocked"
              : todo.status === "cancelled"
                ? epicTask.status === "rejected"
                  ? "rejected"
                  : "cancelled"
                : todo.status === "in_progress"
                  ? "in_progress"
                  : "queued"
        return resolved
      }
    }

    if (resolved.kind === "needs_decision" && resolved.status === "planned") {
      resolved.status = "needs_decision"
    }

    return resolved
  }

  #resolveEpic(
    _snapshot: Awaited<ReturnType<WorkspaceStore["getSnapshot"]>>,
    epic: Epic,
    tasks: EpicTask[],
  ): Epic {
    const resolved: Epic = { ...epic }

    if (tasks.length === 0) {
      return resolved
    }

    if (tasks.every((task) => ["done", "cancelled", "rejected"].includes(task.status))) {
      resolved.status = "completed"
      return resolved
    }

    if (tasks.some((task) => task.status === "blocked")) {
      resolved.status = "blocked"
      return resolved
    }

    resolved.status = "active"
    return resolved
  }

  async #inspectGitHubRepo(owner: string, repo: string): Promise<RepoInspection> {
    const meta = await this.#readGitHubJson<{
      default_branch: string
      description: string | null
      html_url: string
      private: boolean
    }>(`repos/${owner}/${repo}`)
    const tree = await this.#readGitHubJson<{ tree?: Array<{ path: string }> } | null>(
      `repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`,
      { allowFailure: true },
    )
    const paths = (tree?.tree ?? []).map((entry) => entry.path)
    const lowered = paths.map((entry) => entry.toLowerCase())
    const hasPath = (needle: string) => lowered.includes(needle.toLowerCase())
    const hasPrefix = (needle: string) =>
      lowered.some((entry) => entry.startsWith(`${needle.toLowerCase()}/`))

    let packageJson: { scripts?: Record<string, string> } | null = null
    if (hasPath("package.json")) {
      packageJson = await this.#readGitHubFile<{ scripts?: Record<string, string> }>(
        owner,
        repo,
        "package.json",
        true,
      )
    }

    const readme = await this.#readGitHubTextFile(owner, repo, "README.md", true)
    const stackProfile: string[] = []
    if (hasPath("package.json")) {
      stackProfile.push("node")
    }
    if (hasPath("tsconfig.json") || hasPrefix("src") || hasPrefix("app")) {
      stackProfile.push("typescript")
    }
    if (
      hasPath("next.config.js") ||
      hasPath("next.config.mjs") ||
      hasPath("next.config.ts") ||
      hasPrefix("app")
    ) {
      stackProfile.push("nextjs")
    }
    if (hasPath("requirements.txt") || hasPath("pyproject.toml")) {
      stackProfile.push("python")
    }
    if (stackProfile.length === 0) {
      stackProfile.push("unknown")
    }

    const dangerousPaths = dedupeStrings([
      ".env",
      hasPrefix(".github/workflows") ? ".github/workflows" : "",
      hasPrefix("infra") ? "infra" : "",
      hasPrefix("terraform") ? "terraform" : "",
      hasPrefix("prisma") ? "prisma" : "",
      hasPrefix("supabase") ? "supabase" : "",
      "secrets",
    ])

    const repoFacts = dedupeStrings([
      `Default branch: ${meta.default_branch}`,
      meta.private ? "Visibility: private GitHub repo." : "Visibility: public GitHub repo.",
      stackProfile[0] ? `Primary stack: ${stackProfile.join(", ")}` : "",
      readme ? `README starts with: ${truncateText(readme.replace(/\s+/g, " "), 180)}` : "",
    ])

    return {
      defaultBranch: meta.default_branch,
      repoUrl: meta.html_url,
      description: meta.description ?? null,
      isPrivate: Boolean(meta.private),
      stackProfile,
      testCommands:
        stackProfile.includes("node") || hasPath("package.json")
          ? selectNodeTestCommands(packageJson)
          : stackProfile.includes("python")
            ? ["pytest", "python -m pytest"]
            : ["npm run test", "npm run check", "npm run lint"],
      dangerousPaths,
      repoFacts,
      instructionSources: dedupeStrings([
        "jarvis-global-template",
        readme ? "repo-readme" : "",
        paths.length > 0 ? "repo-tree" : "",
      ]),
      readmeExcerpt: readme ? truncateText(readme.replace(/\s+/g, " "), 800) : null,
      hasAgentsGuide: hasPath("AGENTS.md"),
    }
  }

  async #readGitHubJson<T>(apiPath: string, options?: { allowFailure?: boolean }): Promise<T> {
    try {
      const safePath = apiPath.replaceAll("'", "'\\''")
      const { stdout } = await exec(`gh api '${safePath}'`, {
        env: {
          ...process.env,
          HOME: process.env.HOME ?? os.homedir(),
        },
        maxBuffer: 20 * 1024 * 1024,
      })
      return JSON.parse(stdout) as T
    } catch (error) {
      if (options?.allowFailure) {
        return null as T
      }
      throw error
    }
  }

  async #readGitHubTextFile(
    owner: string,
    repo: string,
    filePath: string,
    allowFailure = false,
  ): Promise<string | null> {
    try {
      const safePath = `repos/${owner}/${repo}/contents/${filePath}`.replaceAll("'", "'\\''")
      const { stdout } = await exec(
        `gh api '${safePath}' --jq '.content' | tr -d '\\n' | base64 -d`,
        {
          env: {
            ...process.env,
            HOME: process.env.HOME ?? os.homedir(),
          },
          maxBuffer: 20 * 1024 * 1024,
          shell: "/bin/zsh",
        },
      )
      return stdout.trim() || null
    } catch (error) {
      if (allowFailure) {
        return null
      }
      throw error
    }
  }

  async #readGitHubFile<T>(
    owner: string,
    repo: string,
    filePath: string,
    allowFailure = false,
  ): Promise<T | null> {
    const raw = await this.#readGitHubTextFile(owner, repo, filePath, allowFailure)
    if (!raw) {
      return null
    }

    return JSON.parse(raw) as T
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
