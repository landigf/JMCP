import { mkdirSync } from "node:fs"
import path from "node:path"
import { type WorkspaceSnapshot, workspaceSnapshotSchema } from "@jmcp/contracts"
import Database from "better-sqlite3"
import { Kysely, SqliteDialect } from "kysely"
import type { SnapshotMutator, WorkspaceStore } from "./types.js"

type PersistedRow = {
  id: string
  payload: string
}

interface WorkspaceDatabase {
  projects: PersistedRow
  briefs: PersistedRow
  project_memories: PersistedRow
  merge_policies: PersistedRow
  automation_policies: PersistedRow
  conversations: PersistedRow
  epics: PersistedRow
  epic_tasks: PersistedRow
  todos: PersistedRow
  task_runs: PersistedRow
  run_attempts: PersistedRow
  run_steps: PersistedRow
  checkpoint_bundles: PersistedRow
  artifacts: PersistedRow
  notifications: PersistedRow
  recaps: PersistedRow
  executors: PersistedRow
  approvals: PersistedRow
  repo_sync_states: PersistedRow
  voice_assets: PersistedRow
  telegram_threads: PersistedRow
  kernel_sessions: PersistedRow
  kernel_turns: PersistedRow
  push_subscriptions: PersistedRow
}

type SnapshotCollection = keyof WorkspaceSnapshot

type TableConfig = {
  collection: SnapshotCollection
  table: keyof WorkspaceDatabase
  getId: (entry: unknown) => string
}

const tableConfigs: TableConfig[] = [
  { collection: "projects", table: "projects", getId: getEntityId },
  { collection: "briefs", table: "briefs", getId: getEntityId },
  { collection: "projectMemories", table: "project_memories", getId: getEntityId },
  { collection: "mergePolicies", table: "merge_policies", getId: getEntityId },
  { collection: "automationPolicies", table: "automation_policies", getId: getEntityId },
  { collection: "conversations", table: "conversations", getId: getConversationId },
  { collection: "epics", table: "epics", getId: getEntityId },
  { collection: "epicTasks", table: "epic_tasks", getId: getEntityId },
  { collection: "todos", table: "todos", getId: getEntityId },
  { collection: "taskRuns", table: "task_runs", getId: getEntityId },
  { collection: "runAttempts", table: "run_attempts", getId: getEntityId },
  { collection: "runSteps", table: "run_steps", getId: getEntityId },
  { collection: "checkpointBundles", table: "checkpoint_bundles", getId: getEntityId },
  { collection: "artifacts", table: "artifacts", getId: getEntityId },
  { collection: "notifications", table: "notifications", getId: getEntityId },
  { collection: "recaps", table: "recaps", getId: getEntityId },
  { collection: "executors", table: "executors", getId: getEntityId },
  { collection: "approvals", table: "approvals", getId: getEntityId },
  { collection: "repoSyncStates", table: "repo_sync_states", getId: getEntityId },
  { collection: "voiceAssets", table: "voice_assets", getId: getEntityId },
  { collection: "telegramThreads", table: "telegram_threads", getId: getEntityId },
  { collection: "kernelSessions", table: "kernel_sessions", getId: getEntityId },
  { collection: "kernelTurns", table: "kernel_turns", getId: getEntityId },
  { collection: "pushSubscriptions", table: "push_subscriptions", getId: getEntityId },
]

function emptySnapshot(): WorkspaceSnapshot {
  return workspaceSnapshotSchema.parse({
    projects: [],
    briefs: [],
    projectMemories: [],
    mergePolicies: [],
    automationPolicies: [],
    conversations: [],
    epics: [],
    epicTasks: [],
    todos: [],
    taskRuns: [],
    runAttempts: [],
    runSteps: [],
    checkpointBundles: [],
    artifacts: [],
    notifications: [],
    recaps: [],
    executors: [],
    approvals: [],
    repoSyncStates: [],
    voiceAssets: [],
    telegramThreads: [],
    kernelSessions: [],
    kernelTurns: [],
    pushSubscriptions: [],
  })
}

function getEntityId(entry: unknown): string {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "id" in entry &&
    typeof entry.id === "string"
  ) {
    return entry.id
  }

  throw new Error("Entity is missing an id field")
}

function getConversationId(entry: unknown): string {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "projectId" in entry &&
    typeof entry.projectId === "string"
  ) {
    return entry.projectId
  }

  throw new Error("Conversation is missing a projectId")
}

export class SqliteWorkspaceStore implements WorkspaceStore {
  readonly #databasePath: string
  readonly #sqlite: Database.Database
  readonly #db: Kysely<WorkspaceDatabase>
  #writeChain: Promise<unknown> = Promise.resolve()

  constructor(databasePath: string) {
    this.#databasePath = resolveDatabasePath(databasePath)
    mkdirSync(path.dirname(this.#databasePath), { recursive: true })
    this.#sqlite = new Database(this.#databasePath)
    this.#sqlite.pragma("journal_mode = WAL")
    this.#sqlite.pragma("synchronous = NORMAL")
    this.#db = new Kysely({
      dialect: new SqliteDialect({
        database: this.#sqlite,
      }),
    })
    this.#ensureTables()
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    return this.#load()
  }

  async mutate<Result>(mutator: SnapshotMutator<Result>): Promise<Result> {
    const operation = this.#writeChain.then(async () => {
      const snapshot = await this.#load()
      const result = mutator(snapshot)
      await this.#save(snapshot)
      return result
    })

    this.#writeChain = operation.catch(() => undefined)
    return operation
  }

  get databasePath(): string {
    return this.#databasePath
  }

  async close(): Promise<void> {
    await this.#db.destroy()
    this.#sqlite.close()
  }

  #ensureTables(): void {
    for (const config of tableConfigs) {
      this.#sqlite.exec(
        `CREATE TABLE IF NOT EXISTS ${config.table} (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)`,
      )
    }
  }

  async #load(): Promise<WorkspaceSnapshot> {
    const snapshot = emptySnapshot()

    for (const config of tableConfigs) {
      const rows = await this.#db.selectFrom(config.table).select(["id", "payload"]).execute()

      ;(snapshot[config.collection] as unknown[]) = rows.map((row) => JSON.parse(row.payload))
    }

    return workspaceSnapshotSchema.parse(snapshot)
  }

  async #save(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.#db.transaction().execute(async (trx) => {
      for (const config of tableConfigs) {
        await trx.deleteFrom(config.table).execute()
        const records = snapshot[config.collection]

        if (records.length === 0) {
          continue
        }

        await trx
          .insertInto(config.table)
          .values(
            records.map((entry) => ({
              id: config.getId(entry),
              payload: JSON.stringify(entry),
            })),
          )
          .execute()
      }
    })
  }
}

export { SqliteWorkspaceStore as FileWorkspaceStore }

function resolveDatabasePath(value: string): string {
  const extension = path.extname(value)
  if (extension === ".sqlite" || extension === ".db") {
    return value
  }

  return path.join(value, "jmcp.sqlite")
}
