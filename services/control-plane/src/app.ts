import cors from "@fastify/cors"
import type { ControlPlaneConfig } from "@jmcp/config"
import {
  approvalActionSchema,
  bridgeClaimInputSchema,
  bridgeHelloInputSchema,
  bridgeProgressEventSchema,
  createProjectInputSchema,
  createTodoInputSchema,
  githubWebhookEnvelopeSchema,
  projectMessageInputSchema,
  voiceIngestInputSchema,
} from "@jmcp/contracts"
import { verifyGitHubWebhookSignature, verifySharedToken } from "@jmcp/security"
import Fastify from "fastify"
import rawBody from "fastify-raw-body"
import { InMemoryFeedBus } from "./feed.js"
import { CompositeNotificationDispatcher } from "./notifications.js"
import { ControlPlaneService } from "./service.js"
import { SqliteWorkspaceStore } from "./store.js"

export function createControlPlaneRuntime(config: ControlPlaneConfig) {
  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
  })

  const store = new SqliteWorkspaceStore(config.JMCP_CONTROL_PLANE_DB_PATH)
  const feeds = new InMemoryFeedBus()
  const notifications = new CompositeNotificationDispatcher(config)
  const service = new ControlPlaneService({
    store,
    feeds,
    notifications,
    config,
  })

  void app.register(cors, {
    origin: true,
  })

  void app.register(rawBody, {
    encoding: "utf8",
    field: "rawBody",
    global: false,
    runFirst: true,
  })

  const nightlyTimer = setInterval(() => {
    void service.tickNightlyScheduler()
  }, 15_000)

  app.addHook("onClose", async () => {
    clearInterval(nightlyTimer)
    await store.close()
  })

  app.get("/health", async () => {
    return {
      ok: true,
      dbPath: store.databasePath,
    }
  })

  app.get("/dashboard", async () => {
    return service.getDashboardSnapshot()
  })

  app.get("/notifications/inbox", async () => {
    return service.getInbox()
  })

  app.post("/projects", async (request, reply) => {
    const input = createProjectInputSchema.parse(request.body)
    const project = await service.createProject(input)
    return reply.code(201).send(project)
  })

  app.get("/projects/:projectId", async (request, reply) => {
    const params = request.params as { projectId: string }
    const project = await service.getProjectSummary(params.projectId)

    if (!project) {
      return reply.code(404).send({ message: "Project not found" })
    }

    return project
  })

  app.get("/projects/:projectId/runs/:runId", async (request, reply) => {
    const params = request.params as { projectId: string; runId: string }
    const run = await service.getRunDetail(params.runId)

    if (!run || run.run.projectId !== params.projectId) {
      return reply.code(404).send({ message: "Run not found" })
    }

    return run
  })

  app.post("/projects/:projectId/messages", async (request, reply) => {
    const params = request.params as { projectId: string }
    const input = projectMessageInputSchema.parse(request.body)
    const result = await service.postProjectMessage(params.projectId, input)

    if (!result) {
      return reply.code(404).send({ message: "Project not found" })
    }

    return result
  })

  app.post("/projects/:projectId/todos", async (request, reply) => {
    const params = request.params as { projectId: string }
    const input = createTodoInputSchema.parse(request.body)
    const result = await service.createTodo(params.projectId, input)

    if (!result) {
      return reply.code(404).send({ message: "Project not found" })
    }

    return reply.code(result.created ? 201 : 200).send(result)
  })

  app.post("/projects/:projectId/todos/:todoId/run", async (request, reply) => {
    const params = request.params as { projectId: string; todoId: string }
    const run = await service.runTodoNow(params.projectId, params.todoId)

    if (!run) {
      return reply.code(404).send({ message: "TODO not found" })
    }

    return reply.code(201).send(run)
  })

  app.post("/projects/:projectId/pause", async (request, reply) => {
    const params = request.params as { projectId: string }
    const policy = await service.pauseProject(params.projectId)

    if (!policy) {
      return reply.code(404).send({ message: "Project not found" })
    }

    return policy
  })

  app.post("/projects/:projectId/resume", async (request, reply) => {
    const params = request.params as { projectId: string }
    const policy = await service.resumeProject(params.projectId)

    if (!policy) {
      return reply.code(404).send({ message: "Project not found" })
    }

    return policy
  })

  app.post("/projects/:projectId/nightly/:enabled", async (request, reply) => {
    const params = request.params as { projectId: string; enabled: string }
    const policy = await service.setNightly(params.projectId, params.enabled === "on")

    if (!policy) {
      return reply.code(404).send({ message: "Project not found" })
    }

    return policy
  })

  app.post("/task-runs/:taskRunId/approve", async (request, reply) => {
    approvalActionSchema.parse(request.body ?? {})
    const params = request.params as { taskRunId: string }
    const run = await service.approveTaskRun(params.taskRunId)

    if (!run) {
      return reply.code(404).send({ message: "Task run not found" })
    }

    return run
  })

  app.post("/task-runs/:taskRunId/cancel", async (request, reply) => {
    approvalActionSchema.parse(request.body ?? {})
    const params = request.params as { taskRunId: string }
    const run = await service.cancelTaskRun(params.taskRunId)

    if (!run) {
      return reply.code(404).send({ message: "Task run not found" })
    }

    return run
  })

  app.post("/task-runs/:taskRunId/retry", async (request, reply) => {
    approvalActionSchema.parse(request.body ?? {})
    const params = request.params as { taskRunId: string }
    const run = await service.retryTaskRun(params.taskRunId)

    if (!run) {
      return reply.code(404).send({ message: "Task run not found" })
    }

    return reply.code(201).send(run)
  })

  app.post("/voice/ingest", async (request, reply) => {
    const input = voiceIngestInputSchema.parse(request.body)
    const result = await service.ingestVoice(input)
    return reply.code(201).send(result)
  })

  app.get("/projects/:projectId/feed", async (request, reply) => {
    const params = request.params as { projectId: string }
    reply.raw.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    })

    const unsubscribe = feeds.subscribe((event) => {
      if (event.projectId && event.projectId !== params.projectId) {
        return
      }

      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    request.raw.on("close", () => {
      unsubscribe()
      reply.raw.end()
    })
  })

  app.post("/notifications/subscriptions", async (request, reply) => {
    const body = request.body as {
      endpoint: string
      expirationTime: number | null
      keys: { auth: string; p256dh: string }
    }

    await service.registerPushSubscription(body)
    return reply.code(204).send()
  })

  app.post("/github/webhooks", { config: { rawBody: true } }, async (request, reply) => {
    const rawPayload = getRawPayload(request)
    const signature = request.headers["x-hub-signature-256"]

    if (
      !verifyGitHubWebhookSignature(
        rawPayload,
        typeof signature === "string" ? signature : undefined,
        config.JMCP_GITHUB_WEBHOOK_SECRET,
      )
    ) {
      return reply.code(401).send({ message: "Invalid signature" })
    }

    const envelope = githubWebhookEnvelopeSchema.parse(JSON.parse(rawPayload))
    await service.ingestGitHubWebhook(envelope)
    return reply.code(202).send({ accepted: true })
  })

  app.post("/bridge/hello", async (request, reply) => {
    const input = bridgeHelloInputSchema.parse(request.body)

    if (!verifySharedToken(config.JMCP_BRIDGE_SHARED_TOKEN, input.token)) {
      return reply.code(401).send({ message: "Invalid bridge token" })
    }

    const executor = await service.registerBridge(input)
    return {
      executor,
    }
  })

  app.post("/bridge/claim", async (request, reply) => {
    const input = bridgeClaimInputSchema.parse(request.body)

    if (!verifySharedToken(config.JMCP_BRIDGE_SHARED_TOKEN, input.token)) {
      return reply.code(401).send({ message: "Invalid bridge token" })
    }

    const task = await service.claimBridgeTask(input.executorId)

    if (!task) {
      return {
        event: "noop",
      }
    }

    return {
      event: "task.assign",
      taskRun: task.taskRun,
      project: task.project,
      brief: task.brief,
      automationPolicy: task.automationPolicy,
      mergePolicy: task.mergePolicy,
    }
  })

  app.post("/bridge/events", async (request, reply) => {
    const input = bridgeProgressEventSchema.parse(request.body)

    if (!verifySharedToken(config.JMCP_BRIDGE_SHARED_TOKEN, input.token)) {
      return reply.code(401).send({ message: "Invalid bridge token" })
    }

    const run = await service.recordBridgeEvent(input)

    if (!run) {
      return reply.code(404).send({ message: "Task run not found" })
    }

    return {
      accepted: true,
    }
  })

  return {
    app,
    service,
    store,
  }
}

export function createControlPlaneApp(config: ControlPlaneConfig) {
  return createControlPlaneRuntime(config).app
}

function getRawPayload(request: { body?: unknown; rawBody?: string | Buffer }): string {
  if (typeof request.rawBody === "string") {
    return request.rawBody
  }

  if (Buffer.isBuffer(request.rawBody)) {
    return request.rawBody.toString("utf8")
  }

  return JSON.stringify(request.body ?? {})
}
