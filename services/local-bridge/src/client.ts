import type { BridgeConfig } from "@jmcp/config"
import type { BridgeClaimResponse, BridgeHelloResponse, BridgeProgressEvent } from "@jmcp/contracts"
import { bridgeClaimResponseSchema, bridgeHelloResponseSchema } from "@jmcp/contracts"
import type { ExecutorProgressEvent } from "./executor.js"

export class ControlPlaneClient {
  readonly #config: BridgeConfig

  constructor(config: BridgeConfig) {
    this.#config = config
  }

  async hello(): Promise<BridgeHelloResponse> {
    const response = await fetch(`${this.#config.JMCP_BRIDGE_CONTROL_PLANE_URL}/bridge/hello`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: this.#config.JMCP_BRIDGE_SHARED_TOKEN,
        name: this.#config.JMCP_BRIDGE_NAME,
        kind: this.#config.JMCP_BRIDGE_KIND,
        hostLabel: this.#config.JMCP_BRIDGE_HOST_LABEL,
        capabilities: ["project-chat", "todo-dispatch", "safe-autonomy", "voice", "auto-merge"],
      }),
    })

    if (!response.ok) {
      throw new Error(`bridge hello failed with ${response.status}`)
    }

    return bridgeHelloResponseSchema.parse(await response.json())
  }

  async claim(executorId: string): Promise<BridgeClaimResponse> {
    const response = await fetch(`${this.#config.JMCP_BRIDGE_CONTROL_PLANE_URL}/bridge/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: this.#config.JMCP_BRIDGE_SHARED_TOKEN,
        executorId,
      }),
    })

    if (!response.ok) {
      throw new Error(`bridge claim failed with ${response.status}`)
    }

    return bridgeClaimResponseSchema.parse(await response.json())
  }

  async sendEvent(
    executorId: string,
    taskRunId: string,
    event: ExecutorProgressEvent,
  ): Promise<void> {
    const body: BridgeProgressEvent = {
      token: this.#config.JMCP_BRIDGE_SHARED_TOKEN,
      executorId,
      event: event.event,
      taskRunId,
      message: event.message,
      branchName: event.branchName ?? null,
      artifact: event.artifact
        ? {
            ...event.artifact,
            text: event.artifact.text ?? null,
            url: event.artifact.url ?? null,
          }
        : undefined,
      proposedTodo: event.proposedTodo
        ? {
            title: event.proposedTodo.title,
            details: event.proposedTodo.details ?? null,
            proposedFromTaskRunId: null,
          }
        : undefined,
      step: event.step,
      attempt: event.attempt,
      checkpointBundle: event.checkpointBundle,
    }

    const response = await fetch(`${this.#config.JMCP_BRIDGE_CONTROL_PLANE_URL}/bridge/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`bridge event failed with ${response.status}`)
    }
  }
}
