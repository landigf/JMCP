import type {
  CreateProjectInput,
  CreateTodoInput,
  CreateTodoResult,
  DashboardSnapshot,
  Notification,
  Project,
  ProjectMessageInput,
  ProjectMessageResponse,
  ProjectSummary,
  RunDetail,
  TaskRun,
  VoiceIngestResponse,
} from "@jmcp/contracts"

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? "http://127.0.0.1:4000"

async function parseJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(fallback)
  }

  return response.json()
}

export async function getDashboard(): Promise<DashboardSnapshot> {
  const response = await fetch(`${CONTROL_PLANE_URL}/dashboard`, {
    cache: "no-store",
  })

  return parseJsonResponse(response, "Failed to load dashboard")
}

export async function getInbox(): Promise<Notification[]> {
  const response = await fetch(`${CONTROL_PLANE_URL}/notifications/inbox`, {
    cache: "no-store",
  })

  return parseJsonResponse(response, "Failed to load inbox")
}

export async function getProject(projectId: string): Promise<ProjectSummary> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}`, {
    cache: "no-store",
  })

  return parseJsonResponse(response, "Failed to load project")
}

export async function getRunDetail(projectId: string, runId: string): Promise<RunDetail> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}/runs/${runId}`, {
    cache: "no-store",
  })

  return parseJsonResponse(response, "Failed to load run detail")
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  return parseJsonResponse(response, "Failed to create project")
}

export async function postProjectMessage(
  projectId: string,
  input: ProjectMessageInput,
): Promise<ProjectMessageResponse> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  return parseJsonResponse(response, "Failed to send message")
}

export async function createTodo(
  projectId: string,
  input: CreateTodoInput,
): Promise<CreateTodoResult> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}/todos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  return parseJsonResponse(response, "Failed to create TODO")
}

export async function runTodoNow(projectId: string, todoId: string): Promise<TaskRun> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}/todos/${todoId}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })

  return parseJsonResponse(response, "Failed to start TODO")
}

export async function approveProposalNow(projectId: string, todoId: string): Promise<void> {
  const response = await fetch(
    `${CONTROL_PLANE_URL}/projects/${projectId}/todos/${todoId}/approve-now`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  )

  if (!response.ok) {
    throw new Error("Failed to approve proposal")
  }
}

export async function approveProposalOvernight(projectId: string, todoId: string): Promise<void> {
  const response = await fetch(
    `${CONTROL_PLANE_URL}/projects/${projectId}/todos/${todoId}/approve-overnight`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  )

  if (!response.ok) {
    throw new Error("Failed to move proposal to overnight")
  }
}

export async function rejectProposal(projectId: string, todoId: string): Promise<void> {
  const response = await fetch(
    `${CONTROL_PLANE_URL}/projects/${projectId}/todos/${todoId}/reject`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  )

  if (!response.ok) {
    throw new Error("Failed to reject proposal")
  }
}

export async function approveTaskRun(taskRunId: string): Promise<void> {
  const response = await fetch(`${CONTROL_PLANE_URL}/task-runs/${taskRunId}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    throw new Error("Failed to approve task run")
  }
}

export async function cancelTaskRun(taskRunId: string): Promise<void> {
  const response = await fetch(`${CONTROL_PLANE_URL}/task-runs/${taskRunId}/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    throw new Error("Failed to cancel task run")
  }
}

export async function retryTaskRun(taskRunId: string): Promise<TaskRun> {
  const response = await fetch(`${CONTROL_PLANE_URL}/task-runs/${taskRunId}/retry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })

  return parseJsonResponse(response, "Failed to retry task run")
}

export async function pauseProject(projectId: string): Promise<void> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}/pause`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    throw new Error("Failed to pause project")
  }
}

export async function resumeProject(projectId: string): Promise<void> {
  const response = await fetch(`${CONTROL_PLANE_URL}/projects/${projectId}/resume`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    throw new Error("Failed to resume project")
  }
}

export async function setNightly(projectId: string, enabled: boolean): Promise<void> {
  const response = await fetch(
    `${CONTROL_PLANE_URL}/projects/${projectId}/nightly/${enabled ? "on" : "off"}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  )

  if (!response.ok) {
    throw new Error("Failed to update nightly mode")
  }
}

export async function ingestVoice(input: {
  projectId: string | null
  transcript: string | null
  file: File | null
}): Promise<VoiceIngestResponse> {
  const audioBase64 = input.file ? await fileToBase64(input.file) : null
  const response = await fetch(`${CONTROL_PLANE_URL}/voice/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      projectId: input.projectId,
      source: "pwa",
      transcript: input.transcript,
      audioBase64,
      mimeType: input.file?.type ?? null,
      durationMs: null,
      fileName: input.file?.name ?? null,
    }),
  })

  return parseJsonResponse(response, "Failed to ingest voice note")
}

export async function registerPushSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON()
  const response = await fetch(`${CONTROL_PLANE_URL}/notifications/subscriptions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(json),
  })

  if (!response.ok) {
    throw new Error("Failed to register push subscription")
  }
}

export function getProjectFeedUrl(projectId: string): string {
  return `${CONTROL_PLANE_URL}/projects/${projectId}/feed`
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
