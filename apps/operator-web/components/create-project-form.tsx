"use client"

import type { RepoCatalogEntry } from "@jmcp/contracts"
import { useRouter } from "next/navigation"
import { startTransition, useEffect, useMemo, useState } from "react"
import { createProjectFromGithub, getGitHubRepos } from "../lib/api"

function parseGitHubReference(value: string): {
  githubOwner: string
  githubRepo: string
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
    }
  }

  try {
    const url = new URL(trimmed)
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")

    if (url.hostname.toLowerCase() !== "github.com" || parts.length < 2) {
      return null
    }

    return {
      githubOwner: parts[0],
      githubRepo: parts[1].replace(/\.git$/, ""),
    }
  } catch {
    return null
  }
}

export function CreateProjectForm() {
  const router = useRouter()
  const [repos, setRepos] = useState<RepoCatalogEntry[]>([])
  const [repoSearch, setRepoSearch] = useState("")
  const [githubRef, setGitHubRef] = useState("")
  const [name, setName] = useState("")
  const [summary, setSummary] = useState("")
  const [nightlyEnabled, setNightlyEnabled] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingRepos, setIsLoadingRepos] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const result = await getGitHubRepos()
        if (!cancelled) {
          setRepos(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load repos")
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRepos(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredRepos = useMemo(() => {
    const query = repoSearch.trim().toLowerCase()
    const pool = query
      ? repos.filter((repo) => repo.nameWithOwner.toLowerCase().includes(query))
      : repos

    return pool.slice(0, 8)
  }, [repoSearch, repos])

  function selectRepo(repo: RepoCatalogEntry) {
    setGitHubRef(repo.nameWithOwner)
    setName((current) => current || repo.repo)
    setSummary((current) => current || repo.description || "")
  }

  async function handleSubmit() {
    setIsSubmitting(true)
    setError(null)

    try {
      const reference = parseGitHubReference(githubRef)

      if (!reference) {
        throw new Error("Choose a repo or use owner/repo or a full GitHub URL.")
      }

      const project = await createProjectFromGithub({
        githubOwner: reference.githubOwner,
        githubRepo: reference.githubRepo,
        name: name.trim() || undefined,
        summary: summary.trim() || undefined,
        nightlyEnabled,
      })

      startTransition(() => {
        router.push(`/projects/${project.id}`)
        router.refresh()
      })
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Failed to open project",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="panel stack">
      <div className="stack-tight">
        <h2>Open a GitHub project</h2>
        <p className="muted">
          Choose from your authenticated GitHub account first. Paste `owner/repo` or a GitHub URL
          only when you need the fallback.
        </p>
      </div>

      <input
        className="input"
        onChange={(event) => {
          setRepoSearch(event.target.value)
        }}
        placeholder={isLoadingRepos ? "Loading GitHub repos..." : "Search your GitHub repos"}
        value={repoSearch}
      />

      <div className="stack-tight">
        {filteredRepos.length === 0 ? (
          <p className="muted">
            {isLoadingRepos ? "Loading repos…" : "No repo match. Use the fallback field below."}
          </p>
        ) : (
          filteredRepos.map((repo) => (
            <button
              className="project-card"
              key={repo.id}
              onClick={() => {
                selectRepo(repo)
              }}
              type="button"
            >
              <div className="project-card-top">
                <div className="stack-tight">
                  <strong>{repo.nameWithOwner}</strong>
                  <span className="muted">{repo.description ?? "No description"}</span>
                </div>
                <span className={repo.isPrivate ? "badge badge-muted" : "badge"}>
                  {repo.isPrivate ? "Private" : "Public"}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      <input
        className="input"
        name="githubRef"
        onChange={(event) => {
          setGitHubRef(event.target.value)
        }}
        placeholder="owner/repo or https://github.com/owner/repo"
        required
        value={githubRef}
      />
      <input
        className="input"
        name="name"
        onChange={(event) => {
          setName(event.target.value)
        }}
        placeholder="Display name (defaults to repo name)"
        value={name}
      />
      <textarea
        className="textarea"
        name="summary"
        onChange={(event) => {
          setSummary(event.target.value)
        }}
        placeholder="Optional operator summary. Leave blank to use repo description and repo facts."
        rows={4}
        value={summary}
      />
      <label className="toggle">
        <input
          checked={nightlyEnabled}
          name="nightlyEnabled"
          onChange={(event) => {
            setNightlyEnabled(event.target.checked)
          }}
          type="checkbox"
        />
        <span>Enable overnight queue by default</span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button
        className="button"
        disabled={isSubmitting}
        onClick={() => {
          void handleSubmit()
        }}
        type="button"
      >
        {isSubmitting ? "Opening..." : "Open project"}
      </button>
    </div>
  )
}
