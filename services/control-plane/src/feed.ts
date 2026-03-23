import { EventEmitter } from "node:events"
import type { FeedEvent } from "@jmcp/contracts"
import type { FeedPublisher } from "./types.js"

export class InMemoryFeedBus implements FeedPublisher {
  readonly #events = new EventEmitter()

  publish(event: FeedEvent): void {
    this.#events.emit("event", event)
  }

  subscribe(listener: (event: FeedEvent) => void): () => void {
    this.#events.on("event", listener)
    return () => {
      this.#events.off("event", listener)
    }
  }
}
