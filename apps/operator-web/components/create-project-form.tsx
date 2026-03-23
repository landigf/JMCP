"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { createProject } from "../lib/api"

function parseGitHubReference(value: string): {
  githubOwner: string
  githubRepo: string
  repoUrl: string | null
} | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const ownerRepoMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)

  if (ownerRepoMatch) {
    return {
      githubOwner: ownerRepoMatch[1],
      githubRepo: ownerRepoMatch[2],
      repoUrl: `https://github.com/${ownerRepoMatch[1]}/${ownerRepoMatch[2]}`,
    }
  }

  try {
    const url = new URL(trimmed)
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")

    if (url.hostname.toLowerCase() !== "github.com" || parts.length < 2) {
      return null
    }

    const githubOwner = parts[0]
    const githubRepo = parts[1].replace(/\.git$/, "")

    if (!githubOwner || !githubRepo) {
      return null
    }

    return {
      githubOwner,
      githubRepo,
      repoUrl: `https://github.com/${githubOwner}/${githubRepo}`,
    }
  } catch {
    return null
  }
}

export function CreateProjectForm() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true)
    setError(null)

    try {
      const reference = parseGitHubReference(String(formData.get("githubRef") ?? ""))

      if (!reference) {
        throw new Error("Use owner/repo or a full GitHub repository URL.")
      }

      const name = String(formData.get("name") ?? "").trim() || reference.githubRepo
      const summary =
        String(formData.get("summary") ?? "").trim() ||
        `GitHub repo ${reference.githubOwner}/${reference.githubRepo}. Preserve existing conventions and ship safe, production-ready changes.`

      const project = await createProject({
        name,
        githubOwner: reference.githubOwner,
        githubRepo: reference.githubRepo,
        repoUrl: reference.repoUrl,
        summary,
        defaultBranch: String(formData.get("defaultBranch") ?? "main"),
        nightlyEnabled: Boolean(formData.get("nightlyEnabled")),
      })

      startTransition(() => {
        router.push(`/projects/${project.id}`)
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
          Paste a GitHub repo URL or `owner/repo` to create the project workspace, chat thread, TODO
          queue, and overnight runway.
        </p>
      </div>
      <input
        className="input"
        name="githubRef"
        placeholder="https://github.com/owner/repo"
        required
      />
      <input className="input" name="name" placeholder="Display name (defaults to repo name)" />
      <input className="input" name="defaultBranch" placeholder="main" defaultValue="main" />
      <textarea
        className="textarea"
        name="summary"
        placeholder="What should Jarvis know about this project? Leave blank for a safe default."
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
