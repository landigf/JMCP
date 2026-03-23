"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"
import { approveTaskRun, cancelTaskRun, retryTaskRun } from "../lib/api"

export function RunActions(props: { taskRunId: string; status: string }) {
  const router = useRouter()

  async function handleApprove() {
    await approveTaskRun(props.taskRunId)
    startTransition(() => {
      router.refresh()
    })
  }

  async function handleCancel() {
    await cancelTaskRun(props.taskRunId)
    startTransition(() => {
      router.refresh()
    })
  }

  async function handleRetry() {
    await retryTaskRun(props.taskRunId)
    startTransition(() => {
      router.refresh()
    })
  }

  const canRetry = ["blocked", "failed", "cancelled"].includes(props.status)
  const canCancel = !["completed", "cancelled"].includes(props.status)

  return (
    <div className="inline-actions">
      {props.status === "needs_approval" ? (
        <button
          className="button"
          onClick={() => {
            void handleApprove()
          }}
          type="button"
        >
          Approve
        </button>
      ) : null}
      {canRetry ? (
        <button
          className="button button-secondary"
          onClick={() => {
            void handleRetry()
          }}
          type="button"
        >
          Retry
        </button>
      ) : null}
      {canCancel ? (
        <button
          className="button button-danger"
          onClick={() => {
            void handleCancel()
          }}
          type="button"
        >
          Cancel
        </button>
      ) : null}
    </div>
  )
}
