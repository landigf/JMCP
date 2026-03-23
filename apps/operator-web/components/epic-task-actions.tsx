"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { queueEpicTaskOvernight, rejectEpicTask, runEpicTaskNow } from "../lib/api"

export function EpicTaskActions(props: {
  projectId: string
  epicId: string
  taskId: string
  kind: "do_now" | "overnight" | "needs_decision" | "idea_from_jarvis"
  status: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"run" | "overnight" | "reject" | null>(null)

  async function handleRun() {
    setBusy("run")

    try {
      await runEpicTaskNow(props.projectId, props.epicId, props.taskId)
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleOvernight() {
    setBusy("overnight")

    try {
      await queueEpicTaskOvernight(props.projectId, props.epicId, props.taskId)
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleReject() {
    setBusy("reject")

    try {
      await rejectEpicTask(props.projectId, props.epicId, props.taskId)
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(null)
    }
  }

  const settled = ["done", "cancelled", "rejected"].includes(props.status)

  return (
    <div className="inline-actions">
      {!settled && props.kind !== "idea_from_jarvis" ? (
        <button
          className="button"
          disabled={busy !== null}
          onClick={() => {
            void handleRun()
          }}
          type="button"
        >
          {busy === "run" ? "Starting..." : "Do now"}
        </button>
      ) : null}
      {!settled ? (
        <button
          className="button button-secondary"
          disabled={busy !== null}
          onClick={() => {
            void handleOvernight()
          }}
          type="button"
        >
          {busy === "overnight" ? "Saving..." : "Overnight"}
        </button>
      ) : null}
      {!settled ? (
        <button
          className="button button-danger"
          disabled={busy !== null}
          onClick={() => {
            void handleReject()
          }}
          type="button"
        >
          {busy === "reject" ? "Removing..." : "Reject"}
        </button>
      ) : null}
    </div>
  )
}
