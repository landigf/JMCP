"use client"

import { useRouter } from "next/navigation"
import { startTransition, useState } from "react"
import { ingestVoice } from "../lib/api"

export function VoiceComposer(props: { projectId: string }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [transcript, setTranscript] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit() {
    if (!file && !transcript.trim()) {
      return
    }

    setBusy(true)
    setStatus(null)
    setError(null)

    try {
      const response = await ingestVoice({
        projectId: props.projectId,
        transcript: transcript.trim() || null,
        file,
      })
      setStatus(response.response?.reply.status ?? "Voice note stored.")
      setTranscript("")
      setFile(null)
      startTransition(() => {
        router.refresh()
      })
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Failed to ingest voice note",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel stack">
      <div className="stack-tight">
        <h2>Voice lane</h2>
        <p className="muted">
          Record from iPhone or drop in a transcript. Jarvis will store the audio and route the note
          into the project queue when transcription is available.
        </p>
      </div>
      <input
        accept="audio/*"
        className="input"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null)
        }}
        type="file"
      />
      <textarea
        className="textarea"
        onChange={(event) => {
          setTranscript(event.target.value)
        }}
        placeholder="Optional transcript or fallback note"
        rows={3}
        value={transcript}
      />
      <div className="inline-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            void handleSubmit()
          }}
          type="button"
        >
          {busy ? "Uploading..." : "Send voice note"}
        </button>
      </div>
      {status ? <p className="success">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
