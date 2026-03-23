"use client"

import type { FeedEvent } from "@jmcp/contracts"
import { useEffect, useState } from "react"
import { getProjectFeedUrl } from "../lib/api"

export function ProjectFeed(props: { projectId: string }) {
  const [events, setEvents] = useState<FeedEvent[]>([])

  useEffect(() => {
    const source = new EventSource(getProjectFeedUrl(props.projectId))
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as FeedEvent
      setEvents((current) => [parsed, ...current].slice(0, 10))
    }

    return () => {
      source.close()
    }
  }, [props.projectId])

  return (
    <div className="panel stack-tight">
      <h2>Live feed</h2>
      <div className="stack-tight">
        {events.length === 0 ? <p className="muted">Waiting for new project events.</p> : null}
        {events.map((event) => (
          <div className="event" key={event.id}>
            <strong>{event.type}</strong>
            <span>{new Date(event.occurredAt).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
