import type { ControlPlaneConfig } from "@jmcp/config"
import type { Project } from "@jmcp/contracts"
import type { ControlPlaneService } from "./service.js"

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number | string }
    text?: string
    caption?: string
    voice?: {
      file_id: string
      duration: number
      mime_type?: string
    }
  }
  callback_query?: {
    id: string
    data?: string
    message?: {
      chat: { id: number | string }
    }
  }
}

function normalizeProjectRef(input: string): string {
  return input.trim().toLowerCase()
}

export class TelegramPollingBot {
  readonly #config: ControlPlaneConfig
  readonly #service: ControlPlaneService
  #running = false
  #offset = 0

  constructor(config: ControlPlaneConfig, service: ControlPlaneService) {
    this.#config = config
    this.#service = service
  }

  get enabled(): boolean {
    return Boolean(this.#config.JMCP_TELEGRAM_BOT_TOKEN)
  }

  async start(): Promise<void> {
    if (!this.enabled || this.#running) {
      return
    }

    this.#running = true
    while (this.#running) {
      try {
        await this.#pollOnce()
      } catch {
        await sleep(this.#config.JMCP_TELEGRAM_POLL_INTERVAL_MS)
      }
    }
  }

  stop(): void {
    this.#running = false
  }

  async #pollOnce(): Promise<void> {
    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    if (!token) {
      return
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timeout: 20,
        offset: this.#offset,
        allowed_updates: ["message", "callback_query"],
      }),
    })

    if (!response.ok) {
      throw new Error(`telegram polling failed with ${response.status}`)
    }

    const payload = (await response.json()) as {
      ok: boolean
      result: TelegramUpdate[]
    }

    for (const update of payload.result) {
      this.#offset = Math.max(this.#offset, update.update_id + 1)
      await this.#handleUpdate(update)
    }
  }

  async #handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query?.data) {
      const callbackChatId = String(update.callback_query.message?.chat.id ?? "")
      if (callbackChatId) {
        await this.#service.registerTelegramThread({
          chatId: callbackChatId,
          lastUpdateId: update.update_id,
        })
      }
      await this.#handleCallback(
        update.callback_query.id,
        update.callback_query.data,
        callbackChatId,
      )
      return
    }

    if (!update.message) {
      return
    }

    const chatId = String(update.message.chat.id)
    if (this.#config.JMCP_TELEGRAM_CHAT_ID && this.#config.JMCP_TELEGRAM_CHAT_ID !== chatId) {
      return
    }

    await this.#service.registerTelegramThread({
      chatId,
      lastUpdateId: update.update_id,
    })

    if (update.message.voice) {
      await this.#handleVoiceMessage(
        chatId,
        update.message.voice.file_id,
        update.message.caption,
        update.message.voice.duration,
        update.message.voice.mime_type,
      )
      return
    }

    const text = update.message.text?.trim()
    if (!text) {
      return
    }

    await this.#handleCommand(chatId, text)
  }

  async #handleCommand(chatId: string, text: string): Promise<void> {
    const [command] = text.split(/\s+/)
    const remainder = text.slice(command.length).trim()

    switch (command) {
      case "/repos":
        await this.#sendRepos(chatId)
        return
      case "/open":
        await this.#openProject(chatId, remainder)
        return
      case "/epic":
        await this.#createEpic(chatId, remainder)
        return
      case "/projects":
        await this.#sendProjects(chatId)
        return
      case "/inbox":
        await this.#sendInbox(chatId)
        return
      case "/status":
        await this.#sendStatus(chatId, remainder)
        return
      case "/run":
        await this.#runProjectCommand(chatId, remainder)
        return
      case "/todo":
        await this.#queueTodo(chatId, remainder)
        return
      case "/pause":
        await this.#togglePause(chatId, remainder, true)
        return
      case "/resume":
        await this.#togglePause(chatId, remainder, false)
        return
      case "/nightly":
        await this.#toggleNightly(chatId, remainder)
        return
      default:
        await this.#sendMessage(
          chatId,
          "Unknown command. Use /repos, /open, /epic, /projects, /status, /run, /todo, /pause, /resume, /nightly, or /inbox.",
        )
    }
  }

  async #sendRepos(chatId: string): Promise<void> {
    const repos = await this.#service.listGitHubRepos()
    if (repos.length === 0) {
      await this.#sendMessage(chatId, "No GitHub repos available from the current laptop account.")
      return
    }

    await this.#sendMessage(
      chatId,
      `GitHub repos\n${repos
        .slice(0, 8)
        .map((repo) => `• ${repo.nameWithOwner}`)
        .join("\n")}`,
      repos.slice(0, 6).map((repo) => [
        {
          text: `Open ${repo.repo.slice(0, 22)}`,
          callback_data: `repo_open:${repo.owner}/${repo.repo}`,
        },
      ]),
    )
  }

  async #sendProjects(chatId: string): Promise<void> {
    const dashboard = await this.#service.getDashboardSnapshot()
    if (dashboard.projects.length === 0) {
      await this.#sendMessage(chatId, "No projects connected yet.")
      return
    }

    const lines = dashboard.projects.slice(0, 12).map((project) => {
      const policy = dashboard.automationPolicies.find((entry) => entry.projectId === project.id)
      return `${project.githubOwner}/${project.githubRepo} · ${policy?.paused ? "paused" : "live"}`
    })

    await this.#sendMessage(chatId, `Projects\n${lines.join("\n")}`)
  }

  async #openProject(chatId: string, remainder: string): Promise<void> {
    const reference = remainder.trim()
    if (!reference) {
      await this.#sendMessage(chatId, "Usage: /open owner/repo")
      return
    }

    const [githubOwner, githubRepo] = reference.split("/")
    if (!githubOwner || !githubRepo) {
      await this.#sendMessage(chatId, "Use owner/repo.")
      return
    }

    const project = await this.#service.createProjectFromGithub({
      githubOwner,
      githubRepo,
      nightlyEnabled: true,
    })

    await this.#sendMessage(chatId, `Opened ${project.githubOwner}/${project.githubRepo}.`, [
      [
        {
          text: "Open Jarvis",
          url: this.#buildProjectUrl(project.id),
        },
      ],
    ])
  }

  async #createEpic(chatId: string, remainder: string): Promise<void> {
    const [projectRef, ...descriptionParts] = remainder.split(/\s+/)
    const description = descriptionParts.join(" ").trim()

    if (!projectRef || !description) {
      await this.#sendMessage(
        chatId,
        "Usage: /epic owner/repo your large product or architecture request",
      )
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(projectRef, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${projectRef}`)
      return
    }

    const epic = await this.#service.createEpic(project.id, {
      description,
      source: "operator",
    })

    if (!epic) {
      await this.#sendMessage(chatId, "Failed to create the epic.")
      return
    }

    await this.#sendMessage(
      chatId,
      `Epic captured: ${epic.epic.title}\nTasks: ${epic.tasks.length}`,
      epic.tasks.slice(0, 3).map((task) => [
        {
          text: `Now ${task.title.slice(0, 18)}`,
          callback_data: `epic_run:${project.id}:${epic.epic.id}:${task.id}`,
        },
        {
          text: "Overnight",
          callback_data: `epic_overnight:${project.id}:${epic.epic.id}:${task.id}`,
        },
      ]),
    )
  }

  async #sendInbox(chatId: string): Promise<void> {
    const notifications = await this.#service.getInbox()
    if (notifications.length === 0) {
      await this.#sendMessage(chatId, "Inbox is empty.")
      return
    }

    const lines = notifications
      .slice(0, 6)
      .map((notification) => `• ${notification.title}: ${notification.body}`)
    await this.#sendMessage(chatId, `Inbox\n${lines.join("\n")}`)
  }

  async #sendStatus(chatId: string, remainder: string): Promise<void> {
    const dashboard = await this.#service.getDashboardSnapshot()
    if (!remainder) {
      const running = dashboard.taskRuns.filter((run) =>
        ["planning", "running", "validating", "merging"].includes(run.status),
      ).length
      const blocked = dashboard.taskRuns.filter((run) =>
        ["blocked", "needs_approval"].includes(run.status),
      ).length
      const queued = dashboard.todos.filter((todo) =>
        ["queued", "ready"].includes(todo.status),
      ).length
      const epics = dashboard.epics.filter((epic) =>
        ["planned", "active", "blocked"].includes(epic.status),
      ).length
      await this.#sendMessage(
        chatId,
        `Workspace status\nRunning: ${running}\nBlocked: ${blocked}\nQueued TODOs: ${queued}\nActive epics: ${epics}`,
      )
      return
    }

    const project = resolveProject(remainder, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${remainder}`)
      return
    }

    const summary = await this.#service.getProjectSummary(project.id)
    if (!summary) {
      await this.#sendMessage(chatId, "Project summary not available.")
      return
    }

    const queuedTodos = summary.todos.filter((todo) => ["queued", "ready"].includes(todo.status))
    const activeRuns = summary.taskRuns.filter((run) =>
      ["planning", "running", "validating", "merging"].includes(run.status),
    )
    const blockedRuns = summary.taskRuns.filter((run) =>
      ["blocked", "needs_approval"].includes(run.status),
    )
    const epicCount = summary.epics.filter((epic) =>
      ["planned", "active", "blocked"].includes(epic.status),
    ).length

    await this.#sendMessage(
      chatId,
      `${summary.project.githubOwner}/${summary.project.githubRepo}\nQueued TODOs: ${queuedTodos.length}\nRunning: ${activeRuns.length}\nBlocked: ${blockedRuns.length}\nActive epics: ${epicCount}`,
      queuedTodos.slice(0, 3).map((todo) => [
        {
          text: `Run ${todo.title.slice(0, 24)}`,
          callback_data: `todo_run:${summary.project.id}:${todo.id}`,
        },
      ]),
    )
  }

  async #runProjectCommand(chatId: string, remainder: string): Promise<void> {
    const [projectRef, ...objectiveParts] = remainder.split(/\s+/)
    const objective = objectiveParts.join(" ").trim()

    if (!projectRef || !objective) {
      await this.#sendMessage(chatId, "Usage: /run owner/repo your objective")
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(projectRef, dashboard.projects)

    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${projectRef}`)
      return
    }

    const response = await this.#service.postProjectMessage(project.id, {
      text: objective,
    })

    if (!response) {
      await this.#sendMessage(chatId, "Failed to queue the run.")
      return
    }

    await this.#sendMessage(
      chatId,
      `${response.reply.status}\n${response.reply.whatChanged.join("\n")}`,
      [
        [
          {
            text: "Open Jarvis",
            url: this.#buildProjectUrl(project.id),
          },
        ],
      ],
    )
  }

  async #queueTodo(chatId: string, remainder: string): Promise<void> {
    const [projectRef, ...titleParts] = remainder.split(/\s+/)
    const title = titleParts.join(" ").trim()

    if (!projectRef || !title) {
      await this.#sendMessage(chatId, "Usage: /todo owner/repo title")
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(projectRef, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${projectRef}`)
      return
    }

    const result = await this.#service.createTodo(project.id, {
      title,
      details: null,
      nightly: false,
      runAfter: null,
    })

    if (!result) {
      await this.#sendMessage(chatId, "Failed to save the TODO.")
      return
    }

    const todo = result.todo

    if (!todo) {
      await this.#sendMessage(chatId, "That task is already being tracked in this project.")
      return
    }

    const message = result.activeRunId
      ? `Saved TODO behind the active run: ${todo.title}`
      : result.created
        ? `Saved TODO: ${todo.title}`
        : `Already tracked: ${todo.title}`

    await this.#sendMessage(chatId, message, [
      [
        {
          text: "Run now",
          callback_data: `todo_run:${project.id}:${todo.id}`,
        },
      ],
    ])
  }

  async #togglePause(chatId: string, remainder: string, paused: boolean): Promise<void> {
    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(remainder, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${remainder}`)
      return
    }

    const policy = paused
      ? await this.#service.pauseProject(project.id)
      : await this.#service.resumeProject(project.id)

    await this.#sendMessage(
      chatId,
      policy?.paused
        ? `Paused ${project.githubOwner}/${project.githubRepo}.`
        : `Resumed ${project.githubOwner}/${project.githubRepo}.`,
    )
  }

  async #toggleNightly(chatId: string, remainder: string): Promise<void> {
    const [projectRef, value] = remainder.split(/\s+/)
    if (!projectRef || !value || !["on", "off"].includes(value)) {
      await this.#sendMessage(chatId, "Usage: /nightly owner/repo on|off")
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(projectRef, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${projectRef}`)
      return
    }

    await this.#service.setNightly(project.id, value === "on")
    await this.#sendMessage(
      chatId,
      `Nightly mode ${value} for ${project.githubOwner}/${project.githubRepo}.`,
    )
  }

  async #handleCallback(callbackId: string, data: string, chatId: string): Promise<void> {
    if (!chatId) {
      return
    }

    const [action, projectId, entityId, extraId] = data.split(":")

    switch (action) {
      case "repo_open": {
        const [owner, repo] = projectId.split("/")
        if (owner && repo) {
          const project = await this.#service.createProjectFromGithub({
            githubOwner: owner,
            githubRepo: repo,
            nightlyEnabled: true,
          })
          await this.#sendMessage(chatId, `Opened ${project.githubOwner}/${project.githubRepo}.`, [
            [
              {
                text: "Open Jarvis",
                url: this.#buildProjectUrl(project.id),
              },
            ],
          ])
        }
        break
      }
      case "todo_run": {
        const run = await this.#service.runTodoNow(projectId, entityId)
        await this.#sendMessage(chatId, run ? `Queued run: ${run.objective}` : "TODO not found.")
        break
      }
      case "todo_proposal_now": {
        const todo = await this.#service.reviewAssistantProposal(projectId, entityId, "now")
        await this.#sendMessage(
          chatId,
          todo ? `Proposal approved for execution: ${todo.title}` : "Proposal not found.",
        )
        break
      }
      case "todo_proposal_overnight": {
        const todo = await this.#service.reviewAssistantProposal(projectId, entityId, "overnight")
        await this.#sendMessage(
          chatId,
          todo ? `Proposal moved to overnight: ${todo.title}` : "Proposal not found.",
        )
        break
      }
      case "todo_proposal_reject": {
        const todo = await this.#service.reviewAssistantProposal(projectId, entityId, "reject")
        await this.#sendMessage(
          chatId,
          todo ? `Proposal rejected: ${todo.title}` : "Proposal not found.",
        )
        break
      }
      case "run_retry": {
        const run = await this.#service.retryTaskRun(entityId)
        await this.#sendMessage(chatId, run ? `Retry queued: ${run.objective}` : "Run not found.")
        break
      }
      case "run_approve": {
        const run = await this.#service.approveTaskRun(entityId)
        await this.#sendMessage(chatId, run ? `Approved: ${run.objective}` : "Run not found.")
        break
      }
      case "project_pause": {
        await this.#service.pauseProject(projectId)
        await this.#sendMessage(chatId, "Project paused.")
        break
      }
      case "project_resume": {
        await this.#service.resumeProject(projectId)
        await this.#sendMessage(chatId, "Project resumed.")
        break
      }
      case "epic_run": {
        const task = await this.#service.runEpicTaskNow(projectId, entityId, extraId)
        await this.#sendMessage(
          chatId,
          task ? `Epic task queued: ${task.title}` : "Epic task not found.",
        )
        break
      }
      case "epic_overnight": {
        const task = await this.#service.queueEpicTaskOvernight(projectId, entityId, extraId)
        await this.#sendMessage(
          chatId,
          task ? `Epic task moved to overnight: ${task.title}` : "Epic task not found.",
        )
        break
      }
      case "epic_reject": {
        const task = await this.#service.rejectEpicTask(projectId, entityId, extraId)
        await this.#sendMessage(
          chatId,
          task ? `Epic task rejected: ${task.title}` : "Epic task not found.",
        )
        break
      }
      default:
        break
    }

    await this.#answerCallback(callbackId)
  }

  async #handleVoiceMessage(
    chatId: string,
    fileId: string,
    caption: string | undefined,
    durationSeconds: number,
    mimeType: string | undefined,
  ): Promise<void> {
    const captionText = caption?.trim() ?? ""
    const [command, projectRef] = captionText.split(/\s+/)

    if (!command || !["/run", "/todo"].includes(command) || !projectRef) {
      await this.#sendMessage(
        chatId,
        "Voice notes need a caption like `/run owner/repo` or `/todo owner/repo` so Jarvis knows where to route them.",
      )
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(projectRef, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${projectRef}`)
      return
    }

    const audioBase64 = await this.#downloadVoiceFile(fileId)
    const result = await this.#service.ingestVoice({
      projectId: project.id,
      source: "telegram",
      transcript: null,
      audioBase64,
      mimeType: mimeType ?? "audio/ogg",
      durationMs: durationSeconds * 1000,
      fileName: `${fileId}.ogg`,
    })

    if (result.response) {
      await this.#sendMessage(chatId, result.response.reply.status)
      return
    }

    await this.#sendMessage(
      chatId,
      "Voice note stored. Add a local transcriber command to enable automatic task execution from Telegram voice messages.",
    )
  }

  async #downloadVoiceFile(fileId: string): Promise<string> {
    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    if (!token) {
      throw new Error("Telegram is not configured")
    }

    const fileResponse = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
    )
    const filePayload = (await fileResponse.json()) as {
      ok: boolean
      result: { file_path: string }
    }
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePayload.result.file_path}`
    const audioResponse = await fetch(fileUrl)
    const arrayBuffer = await audioResponse.arrayBuffer()
    return Buffer.from(arrayBuffer).toString("base64")
  }

  async #sendMessage(
    chatId: string,
    text: string,
    inlineKeyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>,
  ): Promise<void> {
    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    if (!token) {
      return
    }

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard
          ? {
              inline_keyboard: inlineKeyboard,
            }
          : undefined,
      }),
    }).catch(() => undefined)
  }

  async #answerCallback(callbackId: string): Promise<void> {
    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    if (!token) {
      return
    }

    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        callback_query_id: callbackId,
      }),
    }).catch(() => undefined)
  }

  #buildProjectUrl(projectId: string): string {
    const base = this.#config.JMCP_PUBLIC_WEB_URL?.replace(/\/$/, "")
    return base ? `${base}/projects/${projectId}` : `/projects/${projectId}`
  }
}

function resolveProject(reference: string, projects: Project[]): Project | null {
  const normalized = normalizeProjectRef(reference)
  return (
    projects.find(
      (project) =>
        normalizeProjectRef(`${project.githubOwner}/${project.githubRepo}`) === normalized,
    ) ??
    projects.find((project) => normalizeProjectRef(project.githubRepo) === normalized) ??
    projects.find((project) => normalizeProjectRef(project.name) === normalized) ??
    null
  )
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
