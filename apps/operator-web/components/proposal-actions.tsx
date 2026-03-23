"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { approveProposalNow, approveProposalOvernight, rejectProposal } from "../lib/api"

export function ProposalActions(props: { projectId: string; todoId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<"now" | "overnight" | "reject" | null>(null)

  async function handleAction(action: "now" | "overnight" | "reject") {
    setBusy(action)

    try {
      if (action === "now") {
        await approveProposalNow(props.projectId, props.todoId)
      } else if (action === "overnight") {
        await approveProposalOvernight(props.projectId, props.todoId)
      } else {
        await rejectProposal(props.projectId, props.todoId)
      }

      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="inline-actions">
      <button
        className="button"
        disabled={busy !== null}
        onClick={() => {
          void handleAction("now")
        }}
        type="button"
      >
        {busy === "now" ? "Starting..." : "Do now"}
      </button>
      <button
        className="button button-secondary"
        disabled={busy !== null}
        onClick={() => {
          void handleAction("overnight")
        }}
        type="button"
      >
        {busy === "overnight" ? "Saving..." : "Overnight"}
      </button>
      <button
        className="button button-danger"
        disabled={busy !== null}
        onClick={() => {
          void handleAction("reject")
        }}
        type="button"
      >
        {busy === "reject" ? "Removing..." : "Reject"}
      </button>
    </div>
  )
}
