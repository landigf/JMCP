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
  #botConfigured = false

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

    await this.#configureBot()
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

  async #configureBot(): Promise<void> {
    if (this.#botConfigured) {
      return
    }

    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    if (!token) {
      return
    }

    const commands = [
      ["start", "Open the Jarvis Telegram cockpit"],
      ["projects", "List connected projects"],
      ["focus", "Focus this chat on a specific project"],
      ["project", "Show the focused project dashboard"],
      ["dashboard", "Alias for the focused project dashboard"],
      ["repos", "List GitHub repos from this laptop account"],
      ["open", "Open owner/repo or a GitHub URL in Jarvis"],
      ["newrepo", "Create a new GitHub repo and connect it"],
      ["status", "Workspace or project status"],
      ["next", "Show the next actionable work"],
      ["decisions", "Show items waiting for your decision"],
      ["proposals", "Show ideas proposed by Jarvis"],
      ["todos", "Queued TODOs, grouped by project"],
      ["runs", "Running, blocked, and approval-needed work"],
      ["run", "Queue an immediate task on a project"],
      ["runall", "Queue all queued TODOs"],
      ["todo", "Save a TODO for the focused or specified project"],
      ["epic", "Create a large multi-task epic"],
      ["pause", "Pause a project"],
      ["resume", "Resume a project"],
      ["nightly", "Toggle nightly mode"],
      ["inbox", "Show recent Jarvis notifications"],
      ["help", "Show command help"],
    ].map(([command, description]) => ({ command, description }))

    await Promise.allSettled([
      this.#telegramApi("setMyCommands", { commands }),
      this.#telegramApi("setMyDescription", {
        description:
          "Jarvis is your private mobile control plane for GitHub projects, TODOs, approvals, and Claude-powered execution on your laptop.",
      }),
      this.#telegramApi("setMyShortDescription", {
        short_description: "Jarvis for projects, TODOs, approvals, and overnight runs.",
      }),
      this.#configureDefaultMenuButton(),
    ])

    this.#botConfigured = true
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
    if (!text.startsWith("/")) {
      const directRepoReference = parseGitHubProjectReference(text)
      if (directRepoReference && text.trim().split(/\s+/).length === 1) {
        await this.#openProject(chatId, text)
        return
      }

      const dashboard = await this.#service.getDashboardSnapshot()
      const focusedProject = await this.#getFocusedProject(chatId, dashboard.projects)
      if (!focusedProject) {
        await this.#sendMessage(
          chatId,
          "No focused project for this chat yet. Use /open owner/repo first, then you can send plain task messages directly.",
        )
        return
      }

      await this.#runProjectCommand(chatId, text)
      return
    }

    const [command] = text.split(/\s+/)
    const remainder = text.slice(command.length).trim()

    switch (command) {
      case "/start":
      case "/help":
        await this.#sendWelcome(chatId)
        return
      case "/repos":
        await this.#sendRepos(chatId)
        return
      case "/open":
        await this.#openProject(chatId, remainder)
        return
      case "/newrepo":
        await this.#createRepo(chatId, remainder)
        return
      case "/epic":
        await this.#createEpic(chatId, remainder)
        return
      case "/projects":
        await this.#sendProjects(chatId)
        return
      case "/focus":
        await this.#focusProject(chatId, remainder)
        return
      case "/project":
      case "/dashboard":
        await this.#sendProjectDashboard(chatId, remainder)
        return
      case "/inbox":
        await this.#sendInbox(chatId)
        return
      case "/status":
        await this.#sendStatus(chatId, remainder)
        return
      case "/next":
        await this.#sendNext(chatId, remainder)
        return
      case "/decisions":
        await this.#sendDecisions(chatId, remainder)
        return
      case "/proposals":
        await this.#sendProposals(chatId, remainder)
        return
      case "/todos":
        await this.#sendTodos(chatId, remainder)
        return
      case "/runs":
        await this.#sendRuns(chatId, remainder)
        return
      case "/run":
        await this.#runProjectCommand(chatId, remainder)
        return
      case "/runall":
        await this.#runAllTodos(chatId, remainder)
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
          "Unknown command. Use /start, /projects, /focus, /project, /repos, /open, /newrepo, /status, /next, /decisions, /proposals, /todos, /runs, /run, /runall, /todo, /epic, /pause, /resume, /nightly, or /inbox.",
        )
    }
  }

  async #sendWelcome(chatId: string): Promise<void> {
    const dashboard = await this.#service.getDashboardSnapshot()
    const focusedProject = await this.#getFocusedProject(chatId, dashboard.projects)
    const projects = dashboard.projects.slice(0, 4)

    await this.#sendMessage(
      chatId,
      [
        "Jarvis Telegram cockpit",
        focusedProject
          ? `Focused project: ${focusedProject.githubOwner}/${focusedProject.githubRepo}`
          : "No focused project yet. Use /open owner/repo or tap a project below.",
        "",
        "Core flows",
        "• /projects to inspect your connected repos",
        "• /project to open the focused project dashboard",
        "• /todos to see queued work grouped by project",
        "• /runall to queue all queued TODOs for the focused project or the whole workspace",
        "• /newrepo repo-name | description to create and connect a new GitHub repo",
      ].join("\n"),
      [
        [
          { text: "Projects", callback_data: "nav_projects" },
          { text: "Status", callback_data: "nav_status" },
        ],
        [
          { text: "Next", callback_data: "nav_next" },
          { text: "TODOs", callback_data: "nav_todos" },
        ],
        [
          { text: "Decisions", callback_data: "nav_decisions" },
          { text: "Proposals", callback_data: "nav_proposals" },
        ],
        ...(projects[0]
          ? [
              [
                {
                  text: `Focus ${projects[0].githubRepo.slice(0, 18)}`,
                  callback_data: `project_focus:${projects[0].id}`,
                },
              ],
            ]
          : []),
        ...(focusedProject
          ? [
              [
                {
                  text: "Open dashboard",
                  url: this.#buildProjectUrl(focusedProject.id),
                },
              ],
            ]
          : this.#config.JMCP_PUBLIC_WEB_URL
            ? [[{ text: "Open Jarvis", url: this.#config.JMCP_PUBLIC_WEB_URL }]]
            : []),
      ],
    )
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
      const queuedTodos = dashboard.todos.filter(
        (todo) => todo.projectId === project.id && ["queued", "ready"].includes(todo.status),
      ).length
      const running = dashboard.taskRuns.filter(
        (run) =>
          run.projectId === project.id &&
          ["planning", "running", "validating", "merging"].includes(run.status),
      ).length
      return `${project.githubOwner}/${project.githubRepo} · ${policy?.paused ? "paused" : "live"} · ${queuedTodos} queued · ${running} running`
    })

    await this.#sendMessage(
      chatId,
      `Projects\n${lines.join("\n")}`,
      dashboard.projects.slice(0, 4).flatMap((project) => [
        [
          {
            text: `Focus ${project.githubRepo.slice(0, 16)}`,
            callback_data: `project_focus:${project.id}`,
          },
          {
            text: "Status",
            callback_data: `project_status:${project.id}`,
          },
        ],
        [
          {
            text: "TODOs",
            callback_data: `project_todos:${project.id}`,
          },
          {
            text: "Run all",
            callback_data: `project_runall:${project.id}`,
          },
        ],
      ]),
    )
  }

  async #focusProject(chatId: string, remainder: string): Promise<void> {
    const reference = remainder.trim()
    if (!reference) {
      await this.#sendMessage(chatId, "Usage: /focus owner/repo")
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const project = resolveProject(reference, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${reference}`)
      return
    }

    await this.#service.linkTelegramThreadToProject(chatId, project.id)
    await this.#sendProjectDashboard(chatId, project.id)
  }

  async #openProject(chatId: string, remainder: string): Promise<void> {
    const reference = remainder.trim()
    if (!reference) {
      await this.#sendMessage(
        chatId,
        "Usage: /open owner/repo or /open https://github.com/owner/repo",
      )
      return
    }

    const parsed = parseGitHubProjectReference(reference)
    if (!parsed) {
      await this.#sendMessage(chatId, "Use owner/repo or a GitHub repo URL.")
      return
    }

    const project = await this.#service.createProjectFromGithub({
      githubOwner: parsed.owner,
      githubRepo: parsed.repo,
      nightlyEnabled: true,
    })
    await this.#service.linkTelegramThreadToProject(chatId, project.id)

    await this.#sendMessage(
      chatId,
      `Opened ${project.githubOwner}/${project.githubRepo} and set it as the focused project for this chat.`,
      this.#buildProjectActionRows(project.id),
    )
  }

  async #createRepo(chatId: string, remainder: string): Promise<void> {
    const parsed = parseNewRepoCommand(remainder)
    if (!parsed) {
      await this.#sendMessage(
        chatId,
        "Usage: /newrepo [--public|--private] repo-name | optional description",
      )
      return
    }

    const project = await this.#service.createGitHubRepo(parsed)
    await this.#service.linkTelegramThreadToProject(chatId, project.id)

    await this.#sendMessage(
      chatId,
      `GitHub repo ready: ${project.githubOwner}/${project.githubRepo}\nJarvis linked it and focused this chat on the new project.`,
      this.#buildProjectActionRows(project.id),
    )
  }

  async #createEpic(chatId: string, remainder: string): Promise<void> {
    const resolved = await this.#resolveProjectAndText(chatId, remainder, {
      allowFocusedProject: true,
      usage: "Usage: /epic owner/repo your large product or architecture request",
    })

    if (!resolved?.project || !resolved.text) {
      return
    }

    const project = resolved.project
    const description = resolved.text
    await this.#service.linkTelegramThreadToProject(chatId, project.id)

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

  async #sendProjectDashboard(chatId: string, remainder: string): Promise<void> {
    const { project } = await this.#resolveProjectForCommand(chatId, remainder, {
      allowFocusedProject: true,
      usage: "Usage: /project owner/repo",
    })

    if (!project) {
      return
    }

    await this.#service.linkTelegramThreadToProject(chatId, project.id)
    const summary = await this.#service.getProjectSummary(project.id)
    if (!summary) {
      await this.#sendMessage(chatId, "Project summary not available.")
      return
    }

    const queuedTodos = summary.todos.filter((todo) => ["queued", "ready"].includes(todo.status))
    const runningRuns = summary.taskRuns.filter((run) =>
      ["planning", "running", "validating", "merging"].includes(run.status),
    )
    const blockedRuns = summary.taskRuns.filter((run) =>
      ["blocked", "needs_approval"].includes(run.status),
    )
    const pendingProposals = summary.todos.filter(
      (todo) => todo.source === "assistant" && todo.approvalStatus === "pending",
    )
    const pendingDecisions = summary.epicTasks.filter((task) => task.status === "needs_decision")

    await this.#sendMessage(
      chatId,
      [
        `${summary.project.githubOwner}/${summary.project.githubRepo}`,
        `Queued TODOs: ${queuedTodos.length}`,
        `Running: ${runningRuns.length}`,
        `Blocked or approval-needed: ${blockedRuns.length}`,
        `Needs decision: ${pendingDecisions.length}`,
        `Jarvis proposals: ${pendingProposals.length}`,
        queuedTodos[0] ? `Next TODO: ${queuedTodos[0].title}` : "Next TODO: none",
        runningRuns[0] ? `Active run: ${runningRuns[0].objective}` : "Active run: none",
      ].join("\n"),
      [
        [
          { text: "Open dashboard", url: this.#buildProjectUrl(project.id) },
          { text: "Run all", callback_data: `project_runall:${project.id}` },
        ],
        [
          { text: "Next", callback_data: `project_next:${project.id}` },
          { text: "Decisions", callback_data: `project_decisions:${project.id}` },
        ],
        [
          { text: "TODOs", callback_data: `project_todos:${project.id}` },
          { text: "Runs", callback_data: `project_runs:${project.id}` },
        ],
        [
          { text: "Proposals", callback_data: `project_proposals:${project.id}` },
          {
            text: summary.automationPolicy.paused ? "Resume" : "Pause",
            callback_data: `${summary.automationPolicy.paused ? "project_resume" : "project_pause"}:${project.id}`,
          },
        ],
        [
          {
            text: `Nightly ${summary.automationPolicy.nightlyEnabled ? "on" : "off"}`,
            callback_data: `project_nightly_toggle:${project.id}`,
          },
        ],
      ],
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
    const explicitProject = remainder.trim()
    if (!explicitProject) {
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
      const projectLines = dashboard.projects
        .map((project) => {
          const queuedTodos = dashboard.todos.filter(
            (todo) => todo.projectId === project.id && ["queued", "ready"].includes(todo.status),
          ).length
          const activeRuns = dashboard.taskRuns.filter(
            (run) =>
              run.projectId === project.id &&
              ["planning", "running", "validating", "merging"].includes(run.status),
          ).length
          const blockedRuns = dashboard.taskRuns.filter(
            (run) =>
              run.projectId === project.id && ["blocked", "needs_approval"].includes(run.status),
          ).length

          if (queuedTodos === 0 && activeRuns === 0 && blockedRuns === 0) {
            return null
          }

          return `• ${project.githubRepo}: ${queuedTodos} queued, ${activeRuns} running, ${blockedRuns} blocked`
        })
        .filter(Boolean)
        .slice(0, 8)

      await this.#sendMessage(
        chatId,
        [
          "Workspace status",
          `Running: ${running}`,
          `Blocked: ${blocked}`,
          `Queued TODOs: ${queued}`,
          `Active epics: ${epics}`,
          projectLines.length > 0 ? "" : null,
          projectLines.length > 0 ? "Queued work by project" : null,
          ...projectLines,
        ]
          .filter(Boolean)
          .join("\n"),
        [
          [
            { text: "Next", callback_data: "nav_next" },
            { text: "TODOs", callback_data: "nav_todos" },
          ],
          [
            { text: "Decisions", callback_data: "nav_decisions" },
            { text: "Proposals", callback_data: "nav_proposals" },
          ],
          [
            { text: "Run all queued", callback_data: "workspace_runall" },
            { text: "Runs", callback_data: "nav_runs" },
          ],
        ],
      )
      return
    }

    const project = resolveProject(explicitProject, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${explicitProject}`)
      return
    }
    await this.#sendProjectDashboard(chatId, `${project.githubOwner}/${project.githubRepo}`)
  }

  async #sendNext(chatId: string, remainder: string): Promise<void> {
    const explicitProject = remainder.trim()
    if (explicitProject) {
      const dashboard = await this.#service.getDashboardSnapshot()
      const project = resolveProject(explicitProject, dashboard.projects)
      if (!project) {
        await this.#sendMessage(chatId, `Project not found: ${explicitProject}`)
        return
      }
      await this.#service.linkTelegramThreadToProject(chatId, project.id)
      const summary = await this.#service.getProjectSummary(project.id)
      if (!summary) {
        await this.#sendMessage(chatId, "Project summary not available.")
        return
      }

      const activeRun = summary.taskRuns.find((run) =>
        ["planning", "running", "validating", "merging"].includes(run.status),
      )
      const blockedRun = summary.taskRuns.find((run) =>
        ["blocked", "needs_approval"].includes(run.status),
      )
      const nextTodo = summary.todos.find((todo) => ["queued", "ready"].includes(todo.status))
      const nextDecision = summary.epicTasks.find((task) => task.status === "needs_decision")
      const nextProposal = summary.todos.find(
        (todo) => todo.source === "assistant" && todo.approvalStatus === "pending",
      )

      await this.#sendMessage(
        chatId,
        [
          `Next actions for ${summary.project.githubOwner}/${summary.project.githubRepo}`,
          activeRun ? `Active run: ${activeRun.objective}` : "Active run: none",
          blockedRun ? `Blocked or approval: ${blockedRun.objective}` : "Blocked or approval: none",
          nextTodo ? `Next TODO: ${nextTodo.title}` : "Next TODO: none",
          nextDecision ? `Decision needed: ${nextDecision.title}` : "Decision needed: none",
          nextProposal ? `Jarvis proposal: ${nextProposal.title}` : "Jarvis proposal: none",
        ].join("\n"),
        [
          [
            { text: "Run all", callback_data: `project_runall:${project.id}` },
            { text: "TODOs", callback_data: `project_todos:${project.id}` },
          ],
          [
            { text: "Decisions", callback_data: `project_decisions:${project.id}` },
            { text: "Proposals", callback_data: `project_proposals:${project.id}` },
          ],
        ],
      )
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const lines = dashboard.projects
      .map((project) => {
        const activeRun = dashboard.taskRuns.find(
          (run) =>
            run.projectId === project.id &&
            ["planning", "running", "validating", "merging"].includes(run.status),
        )
        const blockedRun = dashboard.taskRuns.find(
          (run) =>
            run.projectId === project.id && ["blocked", "needs_approval"].includes(run.status),
        )
        const nextTodo = dashboard.todos.find(
          (todo) => todo.projectId === project.id && ["queued", "ready"].includes(todo.status),
        )
        const nextDecision = dashboard.epicTasks.find(
          (task) => task.projectId === project.id && task.status === "needs_decision",
        )

        const topItem =
          blockedRun?.objective ?? activeRun?.objective ?? nextDecision?.title ?? nextTodo?.title

        if (!topItem) {
          return null
        }

        return `• ${project.githubRepo}: ${topItem}`
      })
      .filter(Boolean)
      .slice(0, 8)

    if (lines.length === 0) {
      await this.#sendMessage(chatId, "No next actions right now.")
      return
    }

    await this.#sendMessage(chatId, ["Next actions", ...lines].join("\n"), [
      [
        { text: "Decisions", callback_data: "nav_decisions" },
        { text: "Proposals", callback_data: "nav_proposals" },
      ],
      [
        { text: "TODOs", callback_data: "nav_todos" },
        { text: "Runs", callback_data: "nav_runs" },
      ],
    ])
  }

  async #sendDecisions(chatId: string, remainder: string): Promise<void> {
    const explicitProject = remainder.trim()
    if (explicitProject) {
      const dashboard = await this.#service.getDashboardSnapshot()
      const project = resolveProject(explicitProject, dashboard.projects)
      if (!project) {
        await this.#sendMessage(chatId, `Project not found: ${explicitProject}`)
        return
      }
      await this.#service.linkTelegramThreadToProject(chatId, project.id)
      const summary = await this.#service.getProjectSummary(project.id)
      if (!summary) {
        await this.#sendMessage(chatId, "Project summary not available.")
        return
      }
      const decisions = summary.epicTasks.filter((task) => task.status === "needs_decision")
      if (decisions.length === 0) {
        await this.#sendMessage(
          chatId,
          `${summary.project.githubOwner}/${summary.project.githubRepo}\nNo pending decisions right now.`,
          this.#buildProjectActionRows(project.id),
        )
        return
      }

      await this.#sendMessage(
        chatId,
        [
          `Decisions for ${summary.project.githubOwner}/${summary.project.githubRepo}`,
          ...decisions.slice(0, 8).map((task) => `• ${task.title}`),
        ].join("\n"),
        [[{ text: "Open dashboard", url: this.#buildProjectUrl(project.id) }]],
      )
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const lines = dashboard.projects
      .map((project) => {
        const decisions = dashboard.epicTasks.filter(
          (task) => task.projectId === project.id && task.status === "needs_decision",
        )
        if (decisions.length === 0) {
          return null
        }
        return `${project.githubOwner}/${project.githubRepo} (${decisions.length})\n${decisions
          .slice(0, 2)
          .map((task) => `• ${task.title}`)
          .join("\n")}`
      })
      .filter(Boolean)
      .slice(0, 6)

    if (lines.length === 0) {
      await this.#sendMessage(chatId, "No pending decisions right now.")
      return
    }

    await this.#sendMessage(chatId, ["Pending decisions", ...lines].join("\n"), [
      [
        { text: "Next", callback_data: "nav_next" },
        { text: "Projects", callback_data: "nav_projects" },
      ],
    ])
  }

  async #sendProposals(chatId: string, remainder: string): Promise<void> {
    const explicitProject = remainder.trim()
    if (explicitProject) {
      const dashboard = await this.#service.getDashboardSnapshot()
      const project = resolveProject(explicitProject, dashboard.projects)
      if (!project) {
        await this.#sendMessage(chatId, `Project not found: ${explicitProject}`)
        return
      }
      await this.#service.linkTelegramThreadToProject(chatId, project.id)
      const summary = await this.#service.getProjectSummary(project.id)
      if (!summary) {
        await this.#sendMessage(chatId, "Project summary not available.")
        return
      }
      const proposals = summary.todos.filter(
        (todo) => todo.source === "assistant" && todo.approvalStatus === "pending",
      )
      if (proposals.length === 0) {
        await this.#sendMessage(
          chatId,
          `${summary.project.githubOwner}/${summary.project.githubRepo}\nNo pending Jarvis proposals right now.`,
          this.#buildProjectActionRows(project.id),
        )
        return
      }

      await this.#sendMessage(
        chatId,
        [
          `Jarvis proposals for ${summary.project.githubOwner}/${summary.project.githubRepo}`,
          ...proposals.slice(0, 6).map((todo) => `• ${todo.title}`),
        ].join("\n"),
        proposals.slice(0, 2).flatMap((todo) => [
          [
            { text: "Do now", callback_data: `todo_proposal_now:${project.id}:${todo.id}` },
            {
              text: "Overnight",
              callback_data: `todo_proposal_overnight:${project.id}:${todo.id}`,
            },
          ],
          [{ text: "Reject", callback_data: `todo_proposal_reject:${project.id}:${todo.id}` }],
        ]),
      )
      return
    }

    const dashboard = await this.#service.getDashboardSnapshot()
    const grouped = dashboard.projects
      .map((project) => ({
        project,
        proposals: dashboard.todos.filter(
          (todo) =>
            todo.projectId === project.id &&
            todo.source === "assistant" &&
            todo.approvalStatus === "pending",
        ),
      }))
      .filter((entry) => entry.proposals.length > 0)

    if (grouped.length === 0) {
      await this.#sendMessage(chatId, "No pending Jarvis proposals right now.")
      return
    }

    await this.#sendMessage(
      chatId,
      [
        "Jarvis proposals",
        ...grouped
          .slice(0, 6)
          .flatMap((entry) => [
            `${entry.project.githubOwner}/${entry.project.githubRepo} (${entry.proposals.length})`,
            ...entry.proposals.slice(0, 2).map((todo) => `• ${todo.title}`),
          ]),
      ].join("\n"),
      grouped.slice(0, 4).flatMap((entry) => [
        [
          {
            text: `Open ${entry.project.githubRepo.slice(0, 14)}`,
            callback_data: `project_proposals:${entry.project.id}`,
          },
        ],
      ]),
    )
  }

  async #sendTodos(chatId: string, remainder: string): Promise<void> {
    const dashboard = await this.#service.getDashboardSnapshot()
    const explicitProject = remainder.trim()

    if (!explicitProject) {
      const groups = dashboard.projects
        .map((project) => ({
          project,
          todos: dashboard.todos.filter(
            (todo) => todo.projectId === project.id && ["queued", "ready"].includes(todo.status),
          ),
        }))
        .filter((entry) => entry.todos.length > 0)

      if (groups.length === 0) {
        await this.#sendMessage(chatId, "No queued TODOs right now.")
        return
      }

      await this.#sendMessage(
        chatId,
        [
          "Queued TODOs",
          ...groups
            .slice(0, 6)
            .flatMap((entry) => [
              `${entry.project.githubOwner}/${entry.project.githubRepo} (${entry.todos.length})`,
              ...entry.todos.slice(0, 3).map((todo) => `• ${todo.title}`),
            ]),
        ].join("\n"),
        groups.slice(0, 4).flatMap((entry) => [
          [
            {
              text: `TODOs ${entry.project.githubRepo.slice(0, 14)}`,
              callback_data: `project_todos:${entry.project.id}`,
            },
            {
              text: "Run all",
              callback_data: `project_runall:${entry.project.id}`,
            },
          ],
        ]),
      )
      return
    }

    const project = resolveProject(explicitProject, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${explicitProject}`)
      return
    }

    await this.#service.linkTelegramThreadToProject(chatId, project.id)
    const summary = await this.#service.getProjectSummary(project.id)
    if (!summary) {
      await this.#sendMessage(chatId, "Project summary not available.")
      return
    }

    const queuedTodos = summary.todos.filter((todo) => ["queued", "ready"].includes(todo.status))
    if (queuedTodos.length === 0) {
      await this.#sendMessage(
        chatId,
        `${summary.project.githubOwner}/${summary.project.githubRepo}\nNo queued TODOs right now.`,
        this.#buildProjectActionRows(project.id),
      )
      return
    }

    await this.#sendMessage(
      chatId,
      [
        `${summary.project.githubOwner}/${summary.project.githubRepo}`,
        ...queuedTodos.slice(0, 8).map((todo, index) => `${index + 1}. ${todo.title}`),
      ].join("\n"),
      [
        [
          { text: "Run all", callback_data: `project_runall:${project.id}` },
          { text: "Open dashboard", url: this.#buildProjectUrl(project.id) },
        ],
        ...queuedTodos.slice(0, 4).map((todo, index) => [
          {
            text: `Run ${index + 1}`,
            callback_data: `todo_run:${project.id}:${todo.id}`,
          },
        ]),
      ],
    )
  }

  async #sendRuns(chatId: string, remainder: string): Promise<void> {
    const dashboard = await this.#service.getDashboardSnapshot()
    const explicitProject = remainder.trim()

    if (!explicitProject) {
      const interestingRuns = dashboard.taskRuns.filter((run) =>
        ["planning", "running", "validating", "merging", "blocked", "needs_approval"].includes(
          run.status,
        ),
      )

      if (interestingRuns.length === 0) {
        await this.#sendMessage(chatId, "No active or blocked runs right now.")
        return
      }

      await this.#sendMessage(
        chatId,
        [
          "Runs in progress",
          ...interestingRuns.slice(0, 8).map((run) => {
            const project = dashboard.projects.find((entry) => entry.id === run.projectId)
            return `• ${project?.githubRepo ?? run.projectId} · ${run.status} · ${run.objective}`
          }),
        ].join("\n"),
        [
          [
            { text: "Status", callback_data: "nav_status" },
            { text: "TODOs", callback_data: "nav_todos" },
          ],
        ],
      )
      return
    }

    const project = resolveProject(explicitProject, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${explicitProject}`)
      return
    }

    await this.#service.linkTelegramThreadToProject(chatId, project.id)
    const summary = await this.#service.getProjectSummary(project.id)
    if (!summary) {
      await this.#sendMessage(chatId, "Project summary not available.")
      return
    }

    const interestingRuns = summary.taskRuns.filter((run) =>
      ["planning", "running", "validating", "merging", "blocked", "needs_approval"].includes(
        run.status,
      ),
    )

    if (interestingRuns.length === 0) {
      await this.#sendMessage(
        chatId,
        `${summary.project.githubOwner}/${summary.project.githubRepo}\nNo active or blocked runs right now.`,
        this.#buildProjectActionRows(project.id),
      )
      return
    }

    await this.#sendMessage(
      chatId,
      [
        `${summary.project.githubOwner}/${summary.project.githubRepo}`,
        ...interestingRuns
          .slice(0, 6)
          .map(
            (run) =>
              `• ${run.status} · ${run.objective}${run.resultSummary ? ` · ${run.resultSummary}` : ""}`,
          ),
      ].join("\n"),
      [
        [
          { text: "Open dashboard", url: this.#buildProjectUrl(project.id) },
          { text: "TODOs", callback_data: `project_todos:${project.id}` },
        ],
        ...interestingRuns
          .filter((run) => ["blocked", "needs_approval"].includes(run.status))
          .slice(0, 2)
          .map((run) => [
            {
              text: run.status === "needs_approval" ? "Approve" : "Retry",
              callback_data:
                run.status === "needs_approval"
                  ? `run_approve:${project.id}:${run.id}`
                  : `run_retry:${project.id}:${run.id}`,
            },
          ]),
      ],
    )
  }

  async #runAllTodos(chatId: string, remainder: string): Promise<void> {
    const explicit = remainder.trim()

    if (explicit === "all") {
      const result = await this.#service.queueAllTodos(null)
      await this.#sendMessage(chatId, this.#formatRunAllResult("workspace", result), [
        [
          { text: "Status", callback_data: "nav_status" },
          { text: "Runs", callback_data: "nav_runs" },
        ],
      ])
      return
    }

    const { project } = await this.#resolveProjectForCommand(chatId, explicit, {
      allowFocusedProject: true,
      usage: "Usage: /runall owner/repo or /runall all",
    })

    const result = await this.#service.queueAllTodos(project?.id ?? null)
    await this.#sendMessage(
      chatId,
      this.#formatRunAllResult(
        project ? `${project.githubOwner}/${project.githubRepo}` : "workspace",
        result,
      ),
      project
        ? [
            [
              { text: "Open dashboard", url: this.#buildProjectUrl(project.id) },
              { text: "Runs", callback_data: `project_runs:${project.id}` },
            ],
          ]
        : [
            [
              { text: "Status", callback_data: "nav_status" },
              { text: "Runs", callback_data: "nav_runs" },
            ],
          ],
    )
  }

  async #runProjectCommand(chatId: string, remainder: string): Promise<void> {
    const resolved = await this.#resolveProjectAndText(chatId, remainder, {
      allowFocusedProject: true,
      usage: "Usage: /run owner/repo your objective",
    })

    if (!resolved?.project || !resolved.text) {
      return
    }

    const project = resolved.project
    const objective = resolved.text
    await this.#service.linkTelegramThreadToProject(chatId, project.id)

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
    const resolved = await this.#resolveProjectAndText(chatId, remainder, {
      allowFocusedProject: true,
      usage: "Usage: /todo owner/repo title",
    })

    if (!resolved?.project || !resolved.text) {
      return
    }

    const project = resolved.project
    const title = resolved.text
    await this.#service.linkTelegramThreadToProject(chatId, project.id)

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
    const { project } = await this.#resolveProjectForCommand(chatId, remainder, {
      allowFocusedProject: true,
      usage: `Usage: /${paused ? "pause" : "resume"} owner/repo`,
    })
    if (!project) {
      return
    }

    await this.#service.linkTelegramThreadToProject(chatId, project.id)
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
    const tokens = remainder.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) {
      await this.#sendMessage(chatId, "Usage: /nightly owner/repo on|off")
      return
    }

    const lastToken = tokens.at(-1)?.toLowerCase() ?? ""
    if (!["on", "off"].includes(lastToken)) {
      await this.#sendMessage(chatId, "Usage: /nightly owner/repo on|off")
      return
    }

    const maybeProjectRef = tokens.slice(0, -1).join(" ")

    const { project } = await this.#resolveProjectForCommand(chatId, maybeProjectRef, {
      allowFocusedProject: true,
      usage: "Usage: /nightly owner/repo on|off",
    })
    if (!project) {
      return
    }

    await this.#service.linkTelegramThreadToProject(chatId, project.id)
    await this.#service.setNightly(project.id, lastToken === "on")
    await this.#sendMessage(
      chatId,
      `Nightly mode ${lastToken} for ${project.githubOwner}/${project.githubRepo}.`,
    )
  }

  async #handleCallback(callbackId: string, data: string, chatId: string): Promise<void> {
    if (!chatId) {
      return
    }

    const [action, projectId, entityId, extraId] = data.split(":")

    switch (action) {
      case "nav_projects": {
        await this.#sendProjects(chatId)
        break
      }
      case "nav_status": {
        await this.#sendStatus(chatId, "")
        break
      }
      case "nav_todos": {
        await this.#sendTodos(chatId, "")
        break
      }
      case "nav_runs": {
        await this.#sendRuns(chatId, "")
        break
      }
      case "nav_next": {
        await this.#sendNext(chatId, "")
        break
      }
      case "nav_decisions": {
        await this.#sendDecisions(chatId, "")
        break
      }
      case "nav_proposals": {
        await this.#sendProposals(chatId, "")
        break
      }
      case "repo_open": {
        const [owner, repo] = projectId.split("/")
        if (owner && repo) {
          const project = await this.#service.createProjectFromGithub({
            githubOwner: owner,
            githubRepo: repo,
            nightlyEnabled: true,
          })
          await this.#service.linkTelegramThreadToProject(chatId, project.id)
          await this.#sendMessage(
            chatId,
            `Opened ${project.githubOwner}/${project.githubRepo} and focused this chat on it.`,
            this.#buildProjectActionRows(project.id),
          )
        }
        break
      }
      case "project_focus": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendProjectDashboard(chatId, projectId)
        break
      }
      case "project_status": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendProjectDashboard(chatId, projectId)
        break
      }
      case "project_todos": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendTodos(chatId, projectId)
        break
      }
      case "project_runs": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendRuns(chatId, projectId)
        break
      }
      case "project_next": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendNext(chatId, projectId)
        break
      }
      case "project_decisions": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendDecisions(chatId, projectId)
        break
      }
      case "project_proposals": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#sendProposals(chatId, projectId)
        break
      }
      case "project_runall": {
        await this.#service.linkTelegramThreadToProject(chatId, projectId)
        await this.#runAllTodos(chatId, projectId)
        break
      }
      case "workspace_runall": {
        await this.#runAllTodos(chatId, "all")
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
      case "project_nightly_toggle": {
        const dashboard = await this.#service.getDashboardSnapshot()
        const policy = dashboard.automationPolicies.find((entry) => entry.projectId === projectId)
        if (policy) {
          await this.#service.setNightly(projectId, !policy.nightlyEnabled)
          await this.#sendProjectDashboard(chatId, projectId)
        }
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

  async #resolveProjectForCommand(
    chatId: string,
    reference: string,
    options: {
      allowFocusedProject: boolean
      usage: string
    },
  ): Promise<{ project: Project | null }> {
    const dashboard = await this.#service.getDashboardSnapshot()
    const trimmed = reference.trim()
    const focusedProject = options.allowFocusedProject
      ? await this.#getFocusedProject(chatId, dashboard.projects)
      : null

    if (!trimmed) {
      if (focusedProject) {
        return { project: focusedProject }
      }

      await this.#sendMessage(chatId, options.usage)
      return { project: null }
    }

    const project = resolveProject(trimmed, dashboard.projects)
    if (!project) {
      await this.#sendMessage(chatId, `Project not found: ${trimmed}`)
      return { project: null }
    }

    return { project }
  }

  async #resolveProjectAndText(
    chatId: string,
    remainder: string,
    options: {
      allowFocusedProject: boolean
      usage: string
    },
  ): Promise<{ project: Project | null; text: string }> {
    const dashboard = await this.#service.getDashboardSnapshot()
    const trimmed = remainder.trim()
    const focusedProject = options.allowFocusedProject
      ? await this.#getFocusedProject(chatId, dashboard.projects)
      : null

    if (!trimmed) {
      await this.#sendMessage(chatId, options.usage)
      return { project: null, text: "" }
    }

    const [firstToken, ...restTokens] = trimmed.split(/\s+/)
    const explicitProject = resolveProject(firstToken, dashboard.projects)
    const explicitGitHubRef = parseGitHubProjectReference(firstToken)

    if (explicitProject && restTokens.length > 0) {
      return {
        project: explicitProject,
        text: restTokens.join(" ").trim(),
      }
    }

    if (explicitGitHubRef) {
      const created = await this.#service.createProjectFromGithub({
        githubOwner: explicitGitHubRef.owner,
        githubRepo: explicitGitHubRef.repo,
        nightlyEnabled: true,
      })
      return {
        project: created,
        text: restTokens.join(" ").trim(),
      }
    }

    if (focusedProject) {
      return {
        project: focusedProject,
        text: trimmed,
      }
    }

    await this.#sendMessage(chatId, options.usage)
    return { project: null, text: "" }
  }

  async #getFocusedProject(chatId: string, projects: Project[]): Promise<Project | null> {
    const thread = await this.#service.getTelegramThread(chatId)
    if (!thread?.linkedProjectId) {
      return null
    }

    return projects.find((project) => project.id === thread.linkedProjectId) ?? null
  }

  #buildProjectActionRows(
    projectId: string,
  ): Array<Array<{ text: string; callback_data?: string; url?: string }>> {
    return [
      [
        { text: "Open dashboard", url: this.#buildProjectUrl(projectId) },
        { text: "Status", callback_data: `project_status:${projectId}` },
      ],
      [
        { text: "Next", callback_data: `project_next:${projectId}` },
        { text: "TODOs", callback_data: `project_todos:${projectId}` },
      ],
      [
        { text: "Runs", callback_data: `project_runs:${projectId}` },
        { text: "Proposals", callback_data: `project_proposals:${projectId}` },
      ],
      [{ text: "Run all", callback_data: `project_runall:${projectId}` }],
    ]
  }

  #formatRunAllResult(
    scopeLabel: string,
    result: {
      queuedRuns: Array<{ objective: string }>
      touchedProjects: Array<{ githubOwner: string; githubRepo: string }>
      skippedPausedProjects: Array<{ githubOwner: string; githubRepo: string }>
    },
  ): string {
    if (result.queuedRuns.length === 0) {
      if (result.skippedPausedProjects.length > 0) {
        return `${scopeLabel}: no runs queued.\nPaused projects were skipped: ${result.skippedPausedProjects
          .map((project) => `${project.githubOwner}/${project.githubRepo}`)
          .join(", ")}`
      }

      return `${scopeLabel}: no queued TODOs were ready to run.`
    }

    return [
      `${scopeLabel}: queued ${result.queuedRuns.length} run${result.queuedRuns.length === 1 ? "" : "s"}.`,
      `Projects touched: ${result.touchedProjects.map((project) => `${project.githubOwner}/${project.githubRepo}`).join(", ")}`,
      result.skippedPausedProjects.length > 0
        ? `Paused projects skipped: ${result.skippedPausedProjects
            .map((project) => `${project.githubOwner}/${project.githubRepo}`)
            .join(", ")}`
        : null,
      "Jarvis will notify this Telegram chat when runs complete, block, or need approval.",
    ]
      .filter(Boolean)
      .join("\n")
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

  async #configureDefaultMenuButton(): Promise<void> {
    const publicUrl = this.#config.JMCP_PUBLIC_WEB_URL?.trim()
    if (publicUrl?.startsWith("https://")) {
      await this.#telegramApi("setChatMenuButton", {
        menu_button: {
          type: "web_app",
          text: "Open Jarvis",
          web_app: {
            url: publicUrl,
          },
        },
      })
      return
    }

    await this.#telegramApi("setChatMenuButton", {
      menu_button: {
        type: "commands",
      },
    })
  }

  async #telegramApi(method: string, payload: Record<string, unknown>): Promise<void> {
    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    if (!token) {
      return
    }

    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }).catch(() => undefined)
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
    projects.find((project) => normalizeProjectRef(project.id) === normalized) ??
    projects.find(
      (project) =>
        normalizeProjectRef(`${project.githubOwner}/${project.githubRepo}`) === normalized,
    ) ??
    projects.find((project) => normalizeProjectRef(project.githubRepo) === normalized) ??
    projects.find((project) => normalizeProjectRef(project.name) === normalized) ??
    null
  )
}

function parseGitHubProjectReference(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim()
  const directMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (directMatch) {
    return {
      owner: directMatch[1],
      repo: directMatch[2],
    }
  }

  try {
    const parsed = new URL(trimmed)
    if (!["github.com", "www.github.com"].includes(parsed.hostname)) {
      return null
    }
    const [owner, repo] = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/, "")
      .split("/")
    if (!owner || !repo) {
      return null
    }
    return { owner, repo }
  } catch {
    return null
  }
}

function parseNewRepoCommand(
  input: string,
): { name: string; description?: string | null; visibility: "public" | "private" } | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const [head, ...tail] = trimmed.split("|")
  const tokens = head.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return null
  }

  let visibility: "public" | "private" = "private"
  if (tokens[0] === "--public" || tokens[0] === "public") {
    visibility = "public"
    tokens.shift()
  } else if (tokens[0] === "--private" || tokens[0] === "private") {
    visibility = "private"
    tokens.shift()
  }

  const name = tokens.join("-").trim()
  if (!name) {
    return null
  }

  return {
    name,
    description: tail.join("|").trim() || null,
    visibility,
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
