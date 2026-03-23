"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { createTodo } from "../lib/api"

export function TodoForm(props: { projectId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setStatus(null)

    try {
      await createTodo(props.projectId, {
        title: String(formData.get("title") ?? ""),
        details: String(formData.get("details") ?? "") || null,
        nightly: Boolean(formData.get("nightly")),
        runAfter: null,
      })
      setStatus("Saved to the queue.")
      startTransition(() => {
        router.refresh()
      })
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Failed to create TODO")
    }
  }

  return (
    <form className="panel stack" action={handleSubmit}>
      <div className="stack-tight">
        <h2>Quick TODO</h2>
        <p className="muted">
          Drop work here when you do not want to interrupt the current active loop.
        </p>
      </div>
      <input className="input" name="title" placeholder="Title" required />
      <textarea className="textarea" name="details" placeholder="Optional notes" rows={3} />
      <label className="toggle">
        <input name="nightly" type="checkbox" />
        <span>Route to the overnight queue</span>
      </label>
      {status ? <p className="success">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button className="button button-secondary" type="submit">
        Save TODO
      </button>
    </form>
  )
}
