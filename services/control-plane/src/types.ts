import type {
  ApprovalRequest,
  AutomationPolicy,
  ConversationMessage,
  Epic,
  EpicTask,
  Executor,
  FeedEvent,
  Notification,
  Project,
  ProjectBrief,
  ProjectConversation,
  ProjectMemory,
  PushSubscriptionRecord,
  Recap,
  RepoSyncState,
  RunArtifact,
  RunStep,
  TaskRun,
  TodoItem,
  VoiceAsset,
  WorkspaceSnapshot,
} from "@jmcp/contracts"

export type MutableWorkspaceSnapshot = WorkspaceSnapshot

export type SnapshotMutator<Result> = (snapshot: MutableWorkspaceSnapshot) => Result

export interface WorkspaceStore {
  getSnapshot(): Promise<WorkspaceSnapshot>
  mutate<Result>(mutator: SnapshotMutator<Result>): Promise<Result>
}

export interface FeedPublisher {
  publish(event: FeedEvent): void
}

export interface NotificationDispatcher {
  deliver(notification: Notification, snapshot: WorkspaceSnapshot): Promise<void>
}

export interface TaskLifecycleHooks {
  createConversationMessage(message: ConversationMessage): Promise<void>
  publishFeed(event: FeedEvent): void
  deliverNotification(notification: Notification, snapshot: WorkspaceSnapshot): Promise<void>
}

export interface ProjectAggregate {
  project: Project
  brief: ProjectBrief
  projectMemory: ProjectMemory
  automationPolicy: AutomationPolicy
  mergePolicy: WorkspaceSnapshot["mergePolicies"][number]
  repoSyncState: RepoSyncState | null
  conversation: ProjectConversation
  epics: Epic[]
  epicTasks: EpicTask[]
  todos: TodoItem[]
  taskRuns: TaskRun[]
  runSteps: RunStep[]
  artifacts: RunArtifact[]
  recaps: Recap[]
  approvals: ApprovalRequest[]
  executors: Executor[]
  notifications: Notification[]
  pushSubscriptions: PushSubscriptionRecord[]
  voiceAssets: VoiceAsset[]
}
