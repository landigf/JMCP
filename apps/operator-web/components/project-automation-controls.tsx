"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { pauseProject, resumeProject, setNightly } from "../lib/api"

export function ProjectAutomationControls(props: {
  projectId: string
  paused: boolean
  nightlyEnabled: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"pause" | "resume" | "nightly" | null>(null)

  async function handlePauseResume() {
    setBusy(props.paused ? "resume" : "pause")

    try {
      if (props.paused) {
        await resumeProject(props.projectId)
      } else {
        await pauseProject(props.projectId)
      }

      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleNightly() {
    setBusy("nightly")

    try {
      await setNightly(props.projectId, !props.nightlyEnabled)
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
        className="button button-secondary"
        disabled={busy !== null}
        onClick={() => {
          void handlePauseResume()
        }}
        type="button"
      >
        {busy === "pause" || busy === "resume"
          ? "Updating..."
          : props.paused
            ? "Resume project"
            : "Pause project"}
      </button>
      <button
        className="button button-secondary"
        disabled={busy !== null}
        onClick={() => {
          void handleNightly()
        }}
        type="button"
      >
        {busy === "nightly"
          ? "Updating..."
          : props.nightlyEnabled
            ? "Night queue on"
            : "Night queue off"}
      </button>
    </div>
  )
}
