"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { runTodoNow } from "../lib/api"

export function TodoRunButton(props: { projectId: string; todoId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleRun() {
    setBusy(true)

    try {
      await runTodoNow(props.projectId, props.todoId)
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className="button"
      disabled={busy}
      onClick={() => {
        void handleRun()
      }}
      type="button"
    >
      {busy ? "Starting..." : "Run now"}
    </button>
  )
}
