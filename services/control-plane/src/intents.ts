import type {
  MobileReply,
  Project,
  ProjectMessageInput,
  TaskIntent,
  TaskIntentKind,
} from "@jmcp/contracts"

export function getMessageText(input: ProjectMessageInput): string {
  return input.text?.trim() || input.voiceNote?.transcript?.trim() || ""
}

export function classifyMessage(input: ProjectMessageInput): TaskIntent {
  const text = getMessageText(input).toLowerCase()

  if (
    text.includes("night") ||
    text.includes("overnight") ||
    text.includes("while i sleep") ||
    text.includes("tomorrow recap")
  ) {
    return {
      kind: "schedule_nightly",
      confidence: 0.88,
      summary: "Schedule this as overnight work.",
    }
  }

  if (
    text.includes("todo") ||
    text.includes("remember") ||
    text.includes("later") ||
    text.includes("at some point")
  ) {
    return {
      kind: "save_todo",
      confidence: 0.82,
      summary: "Store this as queued work.",
    }
  }

  if (text.endsWith("?") || /^(how|what|why|can|should|is)\b/.test(text)) {
    return {
      kind: "question",
      confidence: 0.74,
      summary: "Treat this as a question or steering request.",
    }
  }

  return {
    kind: "run_now",
    confidence: 0.76,
    summary: "Run this as active work now.",
  }
}

export function createMobileReply(args: {
  intentKind: TaskIntentKind
  project: Project
  executorAvailable: boolean
  title: string
  runId?: string | null
  todoId?: string | null
}): MobileReply {
  const links = []

  if (args.runId) {
    links.push({
      label: "Open run",
      href: `/projects/${args.project.id}#run-${args.runId}`,
    })
  }

  if (args.todoId) {
    links.push({
      label: "Open TODO",
      href: `/projects/${args.project.id}#todo-${args.todoId}`,
    })
  }

  switch (args.intentKind) {
    case "run_now":
      return {
        status: args.executorAvailable ? "Run queued on an available executor." : "Run queued.",
        whatChanged: [`Created active work for ${args.title}.`],
        needsDecision: args.executorAvailable
          ? []
          : ["Bring an executor online to start this run."],
        next: [
          args.executorAvailable
            ? "Watch the activity feed for progress and approval requests."
            : "Once an executor connects, Jarvis will assign the run automatically.",
        ],
        links,
      }
    case "save_todo":
      return {
        status: "Saved to the project backlog.",
        whatChanged: [`Queued ${args.title} as a TODO.`],
        needsDecision: [],
        next: ["Run it later manually or let night mode pick it up."],
        links,
      }
    case "schedule_nightly":
      return {
        status: "Saved for the overnight queue.",
        whatChanged: [`Marked ${args.title} for night mode.`],
        needsDecision: [],
        next: ["Jarvis will dispatch it automatically during the nightly window."],
        links,
      }
    default:
      return {
        status: "No task was queued.",
        whatChanged: ["Stored your question in the project chat."],
        needsDecision: ["Decide whether this should become a run or a TODO."],
        next: ["If you want execution, rephrase it as an action request."],
        links,
      }
  }
}

export function createAlreadyTrackedReply(args: {
  project: Project
  title: string
  runId?: string | null
  todoId?: string | null
  blocked?: boolean
}): MobileReply {
  const links = []

  if (args.runId) {
    links.push({
      label: "Open run",
      href: `/projects/${args.project.id}#run-${args.runId}`,
    })
  }

  if (args.todoId) {
    links.push({
      label: "Open TODO",
      href: `/projects/${args.project.id}#todo-${args.todoId}`,
    })
  }

  return {
    status: "Already tracked in this project.",
    whatChanged: [`Jarvis kept the existing work item for ${args.title}.`],
    needsDecision: args.blocked
      ? ["Resolve or retry the blocked work instead of creating a duplicate task."]
      : [],
    next: [
      args.runId
        ? "Open the current run to follow progress, approve, or retry it."
        : "Open the queued TODO when you want to work on it.",
    ],
    links,
  }
}

export function createQueuedBehindActiveRunReply(args: {
  project: Project
  title: string
  activeRunId: string
  todoId: string
}): MobileReply {
  return {
    status: "Project already has active work.",
    whatChanged: [`Queued ${args.title} behind the current run.`],
    needsDecision: [],
    next: ["Let the current run finish, then launch this queued TODO with one tap."],
    links: [
      {
        label: "Open current run",
        href: `/projects/${args.project.id}#run-${args.activeRunId}`,
      },
      {
        label: "Open queued TODO",
        href: `/projects/${args.project.id}#todo-${args.todoId}`,
      },
    ],
  }
}
