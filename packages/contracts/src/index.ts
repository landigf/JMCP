import { z } from "zod"

export const taskIntentKindSchema = z.enum(["question", "run_now", "save_todo", "schedule_nightly"])

export const taskRunStatusSchema = z.enum([
  "queued",
  "planning",
  "running",
  "validating",
  "merging",
  "needs_approval",
  "completed",
  "blocked",
  "paused",
  "cancelled",
  "failed",
])

export const todoStatusSchema = z.enum([
  "queued",
  "ready",
  "in_progress",
  "done",
  "blocked",
  "cancelled",
])
export const todoApprovalStatusSchema = z.enum(["approved", "pending", "rejected"])
export const executorStatusSchema = z.enum(["online", "offline"])
export const executorKindSchema = z.enum(["mock", "shell", "claude_code"])
export const notificationChannelSchema = z.enum(["in_app", "web_push", "telegram"])
export const notificationTypeSchema = z.enum([
  "task_update",
  "task_completed",
  "task_blocked",
  "approval_requested",
  "morning_recap",
  "project_update",
  "voice_update",
])
export const mergeModeSchema = z.enum(["pr_ready", "auto_merge_protected_green"])
export const runArtifactKindSchema = z.enum([
  "note",
  "log",
  "check",
  "pull_request",
  "voice_note",
  "plan",
  "bundle",
  "audio",
  "diff",
  "transcript",
])
export const runStepKindSchema = z.enum([
  "plan",
  "executor",
  "validation",
  "review",
  "repair",
  "git",
  "github",
  "merge",
  "recap",
  "system",
])
export const runStepStatusSchema = z.enum(["info", "running", "completed", "failed"])
export const attemptPhaseSchema = z.enum(["planner", "executor", "repair", "reviewer", "recap"])
export const attemptStatusSchema = z.enum(["running", "completed", "failed"])

export const replyLinkSchema = z.object({
  label: z.string(),
  href: z.string(),
})

export const mobileReplySchema = z.object({
  status: z.string(),
  whatChanged: z.array(z.string()),
  needsDecision: z.array(z.string()),
  next: z.array(z.string()),
  links: z.array(replyLinkSchema),
})

export const mergePolicySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  mode: mergeModeSchema,
  requireProtectedBranch: z.boolean(),
  requireChecks: z.boolean(),
  requireReviews: z.boolean(),
  allowAutoMerge: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const automationPolicySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  paused: z.boolean(),
  nightlyEnabled: z.boolean(),
  autoRunOnTodo: z.boolean(),
  maxConcurrentRuns: z.number().int().positive(),
  mergePolicyId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const repoCatalogEntrySchema = z.object({
  id: z.string(),
  owner: z.string(),
  repo: z.string(),
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  url: z.string().url(),
  defaultBranch: z.string(),
  isPrivate: z.boolean(),
})

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  githubOwner: z.string(),
  githubRepo: z.string(),
  summary: z.string(),
  defaultBranch: z.string(),
  nightlyEnabled: z.boolean(),
  repoUrl: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const projectBriefSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  summary: z.string(),
  codingNorms: z.array(z.string()),
  testCommands: z.array(z.string()),
  dangerousPaths: z.array(z.string()),
  releaseConstraints: z.array(z.string()),
  stackProfile: z.array(z.string()).default([]),
  instructionSources: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const projectMemorySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  templateName: z.string(),
  templateVersion: z.string(),
  stackProfile: z.array(z.string()),
  repoFacts: z.array(z.string()),
  operatorDefaults: z.array(z.string()),
  instructions: z.array(z.string()),
  readmeExcerpt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const epicStatusSchema = z.enum(["planned", "active", "blocked", "completed", "cancelled"])
export const epicTaskKindSchema = z.enum([
  "do_now",
  "overnight",
  "needs_decision",
  "idea_from_jarvis",
])
export const epicTaskStatusSchema = z.enum([
  "planned",
  "queued",
  "in_progress",
  "needs_decision",
  "blocked",
  "done",
  "cancelled",
  "rejected",
])

export const epicSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  status: epicStatusSchema,
  source: z.enum(["operator", "jarvis"]),
  createdFromMessageId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const epicTaskSchema = z.object({
  id: z.string(),
  epicId: z.string(),
  projectId: z.string(),
  title: z.string(),
  details: z.string().nullable(),
  kind: epicTaskKindSchema,
  status: epicTaskStatusSchema,
  linkedTodoId: z.string().nullable().default(null),
  linkedTaskRunId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const conversationMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  role: z.enum(["operator", "assistant", "system"]),
  kind: z.enum(["text", "voice_note"]),
  text: z.string(),
  createdAt: z.string(),
})

export const projectConversationSchema = z.object({
  projectId: z.string(),
  messages: z.array(conversationMessageSchema),
})

export const todoItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  details: z.string().nullable(),
  systemNote: z.string().nullable().default(null),
  status: todoStatusSchema,
  source: z.enum(["chat", "manual", "nightly", "telegram", "assistant"]),
  approvalStatus: todoApprovalStatusSchema.default("approved"),
  proposedFromTaskRunId: z.string().nullable().default(null),
  nightly: z.boolean(),
  runAfter: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const taskIntentSchema = z.object({
  kind: taskIntentKindSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
})

export const pullRequestLinkSchema = z.object({
  provider: z.literal("github"),
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
  isDraft: z.boolean(),
})

export const runArtifactSchema = z.object({
  id: z.string(),
  taskRunId: z.string(),
  kind: runArtifactKindSchema,
  title: z.string(),
  text: z.string().nullable(),
  url: z.string().nullable(),
  createdAt: z.string(),
})

export const taskRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceTodoId: z.string().nullable(),
  objective: z.string(),
  status: taskRunStatusSchema,
  branchName: z.string().nullable(),
  executorId: z.string().nullable(),
  approvalReason: z.string().nullable(),
  resultSummary: z.string().nullable(),
  prUrl: z.string().nullable().default(null),
  prNumber: z.number().int().nullable().default(null),
  priority: z.number().int().default(50),
  attemptCount: z.number().int().nonnegative().default(0),
  lastErrorSignature: z.string().nullable().default(null),
  mergeState: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const runAttemptSchema = z.object({
  id: z.string(),
  taskRunId: z.string(),
  phase: attemptPhaseSchema,
  number: z.number().int().positive(),
  status: attemptStatusSchema,
  promptPackVersion: z.string(),
  summary: z.string().nullable(),
  totalCostUsd: z.number().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})

export const runStepSchema = z.object({
  id: z.string(),
  taskRunId: z.string(),
  attemptId: z.string().nullable(),
  kind: runStepKindSchema,
  status: runStepStatusSchema,
  title: z.string(),
  body: z.string().nullable(),
  createdAt: z.string(),
})

export const checkpointBundleSchema = z.object({
  id: z.string(),
  taskRunId: z.string(),
  attemptId: z.string().nullable(),
  path: z.string(),
  summary: z.string(),
  createdAt: z.string(),
})

export const notificationSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  channel: notificationChannelSchema,
  href: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
})

export const recapSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  createdAt: z.string(),
})

export const executorSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: executorKindSchema,
  hostLabel: z.string(),
  status: executorStatusSchema,
  capabilities: z.array(z.string()),
  lastSeenAt: z.string(),
})

export const approvalRequestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskRunId: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
})

export const repoSyncStateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  branchProtected: z.boolean(),
  requiredChecks: z.array(z.string()),
  currentPrUrl: z.string().nullable(),
  currentPrNumber: z.number().int().nullable(),
  lastHeadSha: z.string().nullable(),
  lastBaseSha: z.string().nullable(),
  lastBranchProtectionCheckAt: z.string().nullable(),
  lastSyncAt: z.string(),
})

export const voiceAssetSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  source: z.enum(["pwa", "telegram"]),
  transcript: z.string().nullable(),
  audioPath: z.string().nullable(),
  responseAudioPath: z.string().nullable(),
  mimeType: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
})

export const telegramThreadStateSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  linkedProjectId: z.string().nullable(),
  lastUpdateId: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const pushSubscriptionRecordSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  expirationTime: z.number().nullable(),
  keys: z.object({
    auth: z.string(),
    p256dh: z.string(),
  }),
  createdAt: z.string(),
})

export const workspaceSnapshotSchema = z.object({
  projects: z.array(projectSchema),
  briefs: z.array(projectBriefSchema),
  projectMemories: z.array(projectMemorySchema),
  mergePolicies: z.array(mergePolicySchema),
  automationPolicies: z.array(automationPolicySchema),
  conversations: z.array(projectConversationSchema),
  epics: z.array(epicSchema),
  epicTasks: z.array(epicTaskSchema),
  todos: z.array(todoItemSchema),
  taskRuns: z.array(taskRunSchema),
  runAttempts: z.array(runAttemptSchema),
  runSteps: z.array(runStepSchema),
  checkpointBundles: z.array(checkpointBundleSchema),
  artifacts: z.array(runArtifactSchema),
  notifications: z.array(notificationSchema),
  recaps: z.array(recapSchema),
  executors: z.array(executorSchema),
  approvals: z.array(approvalRequestSchema),
  repoSyncStates: z.array(repoSyncStateSchema),
  voiceAssets: z.array(voiceAssetSchema),
  telegramThreads: z.array(telegramThreadStateSchema),
  pushSubscriptions: z.array(pushSubscriptionRecordSchema),
})

export const projectSummarySchema = z.object({
  project: projectSchema,
  brief: projectBriefSchema,
  projectMemory: projectMemorySchema,
  automationPolicy: automationPolicySchema,
  mergePolicy: mergePolicySchema,
  repoSyncState: repoSyncStateSchema.nullable(),
  conversation: projectConversationSchema,
  epics: z.array(epicSchema),
  epicTasks: z.array(epicTaskSchema),
  todos: z.array(todoItemSchema),
  taskRuns: z.array(taskRunSchema),
  runSteps: z.array(runStepSchema),
  artifacts: z.array(runArtifactSchema),
  recaps: z.array(recapSchema),
  approvals: z.array(approvalRequestSchema),
  voiceAssets: z.array(voiceAssetSchema),
})

export const runDetailSchema = z.object({
  run: taskRunSchema,
  attempts: z.array(runAttemptSchema),
  steps: z.array(runStepSchema),
  artifacts: z.array(runArtifactSchema),
  approvals: z.array(approvalRequestSchema),
  checkpointBundles: z.array(checkpointBundleSchema),
})

export const dashboardSnapshotSchema = z.object({
  projects: z.array(projectSchema),
  briefs: z.array(projectBriefSchema),
  projectMemories: z.array(projectMemorySchema),
  automationPolicies: z.array(automationPolicySchema),
  epics: z.array(epicSchema),
  epicTasks: z.array(epicTaskSchema),
  todos: z.array(todoItemSchema),
  taskRuns: z.array(taskRunSchema),
  notifications: z.array(notificationSchema),
  recaps: z.array(recapSchema),
  executors: z.array(executorSchema),
})

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  githubOwner: z.string().min(1),
  githubRepo: z.string().min(1),
  summary: z.string().min(1).optional(),
  defaultBranch: z.string().default("main"),
  nightlyEnabled: z.boolean().default(true),
  repoUrl: z.string().url().nullable().optional(),
})

export const createProjectFromGithubInputSchema = z.object({
  githubOwner: z.string().min(1),
  githubRepo: z.string().min(1),
  name: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  nightlyEnabled: z.boolean().default(true),
})

export const createEpicInputSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  source: z.enum(["operator", "jarvis"]).default("operator"),
})

export const voiceNoteInputSchema = z.object({
  transcript: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  hasAudio: z.boolean().default(false),
})

export const projectMessageInputSchema = z.object({
  text: z.string().trim().optional(),
  voiceNote: voiceNoteInputSchema.optional(),
})

export const projectMessageResponseSchema = z.object({
  intent: taskIntentSchema,
  reply: mobileReplySchema,
  createdTodoId: z.string().nullable(),
  createdTaskRunId: z.string().nullable(),
})

export const createTodoInputSchema = z.object({
  title: z.string().min(1),
  details: z.string().nullable().default(null),
  nightly: z.boolean().default(false),
  runAfter: z.string().nullable().default(null),
})

export const assistantProposalInputSchema = z.object({
  title: z.string().min(1),
  details: z.string().nullable().default(null),
  proposedFromTaskRunId: z.string().nullable().default(null),
})

export const proposalDecisionSchema = z.enum(["now", "overnight", "reject"])

export const createTodoResultSchema = z.object({
  todo: todoItemSchema.nullable(),
  created: z.boolean(),
  duplicateTodoId: z.string().nullable().default(null),
  duplicateTaskRunId: z.string().nullable().default(null),
  activeRunId: z.string().nullable().default(null),
})

export const voiceIngestInputSchema = z.object({
  projectId: z.string().nullable().default(null),
  source: z.enum(["pwa", "telegram"]),
  transcript: z.string().nullable().default(null),
  audioBase64: z.string().nullable().default(null),
  mimeType: z.string().nullable().default(null),
  durationMs: z.number().int().nullable().default(null),
  fileName: z.string().nullable().default(null),
})

export const voiceIngestResponseSchema = z.object({
  voiceAsset: voiceAssetSchema,
  response: projectMessageResponseSchema.nullable(),
})

export const approvalActionSchema = z.object({
  note: z.string().optional(),
})

export const feedEventSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  type: z.enum([
    "message.created",
    "todo.created",
    "todo.updated",
    "task.run.created",
    "task.run.updated",
    "notification.created",
    "recap.created",
    "run.step",
    "run.retrying",
    "run.checks_green",
    "run.merge_ready",
    "run.merged",
    "repo.sync",
    "voice.transcribed",
  ]),
  occurredAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
})

export const bridgeHelloInputSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  kind: executorKindSchema,
  hostLabel: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
})

export const bridgeHelloResponseSchema = z.object({
  executor: executorSchema,
})

export const bridgeClaimInputSchema = z.object({
  token: z.string().min(1),
  executorId: z.string().min(1),
})

export const bridgeTaskAssignPayloadSchema = z.object({
  event: z.literal("task.assign"),
  taskRun: taskRunSchema,
  project: projectSchema,
  brief: projectBriefSchema,
  projectMemory: projectMemorySchema,
  automationPolicy: automationPolicySchema,
  mergePolicy: mergePolicySchema,
})

export const providerConfigSchema = z.object({
  defaultTextProvider: z.enum(["disabled", "xai_grok"]),
  xaiEnabled: z.boolean(),
  xaiModel: z.string().nullable(),
})

export const bridgeNoopPayloadSchema = z.object({
  event: z.literal("noop"),
})

export const bridgeClaimResponseSchema = z.union([
  bridgeTaskAssignPayloadSchema,
  bridgeNoopPayloadSchema,
])

export const bridgeAttemptEventSchema = z.object({
  phase: attemptPhaseSchema,
  number: z.number().int().positive(),
  status: attemptStatusSchema,
  promptPackVersion: z.string(),
  summary: z.string().nullable().optional(),
  totalCostUsd: z.number().nullable().optional(),
})

export const bridgeStepEventSchema = z.object({
  kind: runStepKindSchema,
  status: runStepStatusSchema,
  title: z.string(),
  body: z.string().nullable().optional(),
})

export const bridgeCheckpointBundleInputSchema = z.object({
  path: z.string(),
  summary: z.string(),
})

export const bridgeProgressEventSchema = z.object({
  token: z.string().min(1),
  executorId: z.string().min(1),
  event: z.enum([
    "task.progress",
    "task.retrying",
    "task.blocked",
    "task.result",
    "task.approval_required",
    "task.checks_green",
    "task.merge_ready",
    "task.merged",
  ]),
  taskRunId: z.string().min(1),
  message: z.string().min(1),
  branchName: z.string().nullable().optional(),
  artifact: runArtifactSchema.omit({ id: true, createdAt: true, taskRunId: true }).optional(),
  proposedTodo: assistantProposalInputSchema.optional(),
  step: bridgeStepEventSchema.optional(),
  attempt: bridgeAttemptEventSchema.optional(),
  checkpointBundle: bridgeCheckpointBundleInputSchema.optional(),
})

export const githubWebhookEnvelopeSchema = z.object({
  event: z.string(),
  action: z.string().optional(),
  repository: z
    .object({
      full_name: z.string(),
      html_url: z.string(),
    })
    .optional(),
  pull_request: z
    .object({
      html_url: z.string(),
      number: z.number().int(),
      draft: z.boolean().default(false),
      title: z.string(),
    })
    .optional(),
  sender: z
    .object({
      login: z.string(),
    })
    .optional(),
})

export type TaskIntentKind = z.infer<typeof taskIntentKindSchema>
export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>
export type TodoStatus = z.infer<typeof todoStatusSchema>
export type TodoApprovalStatus = z.infer<typeof todoApprovalStatusSchema>
export type NotificationChannel = z.infer<typeof notificationChannelSchema>
export type MergePolicy = z.infer<typeof mergePolicySchema>
export type AutomationPolicy = z.infer<typeof automationPolicySchema>
export type MobileReply = z.infer<typeof mobileReplySchema>
export type RepoCatalogEntry = z.infer<typeof repoCatalogEntrySchema>
export type Project = z.infer<typeof projectSchema>
export type ProjectBrief = z.infer<typeof projectBriefSchema>
export type ProjectMemory = z.infer<typeof projectMemorySchema>
export type EpicStatus = z.infer<typeof epicStatusSchema>
export type EpicTaskKind = z.infer<typeof epicTaskKindSchema>
export type EpicTaskStatus = z.infer<typeof epicTaskStatusSchema>
export type Epic = z.infer<typeof epicSchema>
export type EpicTask = z.infer<typeof epicTaskSchema>
export type ConversationMessage = z.infer<typeof conversationMessageSchema>
export type ProjectConversation = z.infer<typeof projectConversationSchema>
export type TodoItem = z.infer<typeof todoItemSchema>
export type TaskIntent = z.infer<typeof taskIntentSchema>
export type PullRequestLink = z.infer<typeof pullRequestLinkSchema>
export type RunArtifact = z.infer<typeof runArtifactSchema>
export type TaskRun = z.infer<typeof taskRunSchema>
export type RunAttempt = z.infer<typeof runAttemptSchema>
export type RunStep = z.infer<typeof runStepSchema>
export type CheckpointBundle = z.infer<typeof checkpointBundleSchema>
export type Notification = z.infer<typeof notificationSchema>
export type Recap = z.infer<typeof recapSchema>
export type Executor = z.infer<typeof executorSchema>
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>
export type RepoSyncState = z.infer<typeof repoSyncStateSchema>
export type VoiceAsset = z.infer<typeof voiceAssetSchema>
export type TelegramThreadState = z.infer<typeof telegramThreadStateSchema>
export type PushSubscriptionRecord = z.infer<typeof pushSubscriptionRecordSchema>
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>
export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type RunDetail = z.infer<typeof runDetailSchema>
export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>
export type CreateProjectFromGithubInput = z.infer<typeof createProjectFromGithubInputSchema>
export type CreateEpicInput = z.infer<typeof createEpicInputSchema>
export type ProjectMessageInput = z.infer<typeof projectMessageInputSchema>
export type ProjectMessageResponse = z.infer<typeof projectMessageResponseSchema>
export type CreateTodoInput = z.infer<typeof createTodoInputSchema>
export type CreateTodoResult = z.infer<typeof createTodoResultSchema>
export type AssistantProposalInput = z.infer<typeof assistantProposalInputSchema>
export type ProposalDecision = z.infer<typeof proposalDecisionSchema>
export type VoiceIngestInput = z.infer<typeof voiceIngestInputSchema>
export type VoiceIngestResponse = z.infer<typeof voiceIngestResponseSchema>
export type ApprovalAction = z.infer<typeof approvalActionSchema>
export type FeedEvent = z.infer<typeof feedEventSchema>
export type BridgeHelloInput = z.infer<typeof bridgeHelloInputSchema>
export type BridgeHelloResponse = z.infer<typeof bridgeHelloResponseSchema>
export type BridgeClaimInput = z.infer<typeof bridgeClaimInputSchema>
export type BridgeClaimResponse = z.infer<typeof bridgeClaimResponseSchema>
export type BridgeProgressEvent = z.infer<typeof bridgeProgressEventSchema>
export type BridgeAttemptEvent = z.infer<typeof bridgeAttemptEventSchema>
export type BridgeStepEvent = z.infer<typeof bridgeStepEventSchema>
export type GitHubWebhookEnvelope = z.infer<typeof githubWebhookEnvelopeSchema>
export type ProviderConfig = z.infer<typeof providerConfigSchema>
