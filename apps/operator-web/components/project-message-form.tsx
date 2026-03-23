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
          Ask a question, queue a TODO, or hand Jarvis a much larger product idea. Long requests are
          captured as epics and decomposed into do-now, overnight, and decision tasks automatically.
        </p>
      </div>
      <textarea
        className="textarea"
        onChange={(event) => {
          setValue(event.target.value)
        }}
        placeholder="Example: Build a real social network for sharing papers, handle ORCID, anonymity, discovery, and queue the complex pieces for overnight."
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
