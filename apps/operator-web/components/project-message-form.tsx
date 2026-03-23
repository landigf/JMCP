"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { postProjectMessage } from "../lib/api"

export function ProjectMessageForm(props: { projectId: string }) {
  const router = useRouter()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [lastStatus, setLastStatus] = useState<string | null>(null)

  async function handleSubmit() {
    if (!value.trim()) {
      return
    }

    setError(null)

    try {
      const response = await postProjectMessage(props.projectId, {
        text: value,
      })
      setLastStatus(response.reply.status)
      setValue("")
      startTransition(() => {
        router.refresh()
      })
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Failed to send message",
      )
    }
  }

  return (
    <div className="panel stack">
      <div className="stack-tight">
        <h2>Project chat</h2>
        <p className="muted">
          Ask a question, queue a TODO, or tell JMCP to run something now. Mention “TODO” or
          “overnight” when you want the intent classified that way.
        </p>
      </div>
      <textarea
        className="textarea"
        onChange={(event) => {
          setValue(event.target.value)
        }}
        placeholder="Example: TODO profile the bridge tonight and keep iterating until latency is under 200ms"
        rows={5}
        value={value}
      />
      <div className="inline-actions">
        <button
          className="button"
          onClick={() => {
            void handleSubmit()
          }}
          type="button"
        >
          Send
        </button>
      </div>
      {lastStatus ? <p className="success">{lastStatus}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">
        Voice notes are transcript-first in this version. Add the transcript in chat now; audio
        upload can sit behind an API-backed speech path later.
      </p>
    </div>
  )
}
