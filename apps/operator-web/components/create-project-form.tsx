"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { createProject } from "../lib/api"

export function CreateProjectForm() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true)
    setError(null)

    try {
      await createProject({
        name: String(formData.get("name") ?? ""),
        githubOwner: String(formData.get("githubOwner") ?? ""),
        githubRepo: String(formData.get("githubRepo") ?? ""),
        summary: String(formData.get("summary") ?? ""),
        defaultBranch: String(formData.get("defaultBranch") ?? "main"),
        nightlyEnabled: Boolean(formData.get("nightlyEnabled")),
      })

      startTransition(() => {
        router.refresh()
      })
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Failed to create project",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="panel stack" action={handleSubmit}>
      <div className="stack-tight">
        <h2>Open a GitHub project</h2>
        <p className="muted">
          Create the project workspace, chat thread, TODO queue, and overnight runway.
        </p>
      </div>
      <input className="input" name="name" placeholder="Display name" required />
      <div className="grid-two">
        <input className="input" name="githubOwner" placeholder="Owner" required />
        <input className="input" name="githubRepo" placeholder="Repo" required />
      </div>
      <input className="input" name="defaultBranch" placeholder="main" defaultValue="main" />
      <textarea
        className="textarea"
        name="summary"
        placeholder="What should Jarvis know about this project?"
        required
        rows={4}
      />
      <label className="toggle">
        <input name="nightlyEnabled" type="checkbox" defaultChecked />
        <span>Enable overnight queue by default</span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="button" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating..." : "Create project"}
      </button>
    </form>
  )
}
