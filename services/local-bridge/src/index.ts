import { getBridgeConfig } from "@jmcp/config"
import type { BridgeClaimResponse } from "@jmcp/contracts"
import { ControlPlaneClient } from "./client.js"
import { ClaudeCodeExecutor, type ExecutorAdapter, MockExecutorAdapter } from "./executor.js"

const config = getBridgeConfig()
const client = new ControlPlaneClient(config)
const executor = createExecutor()
const BRIDGE_HEARTBEAT_INTERVAL_MS = 30_000

async function main(): Promise<void> {
  const activeRuns = new Map<string, Promise<void>>()
  let executorId: string | null = null
  let executorName: string | null = null
  let lastHelloAt = 0

  for (;;) {
    try {
      if (!executorId || Date.now() - lastHelloAt >= BRIDGE_HEARTBEAT_INTERVAL_MS) {
        const hello = await client.hello()
        if (executorId !== hello.executor.id || executorName !== hello.executor.name) {
          console.log(`JMCP local-bridge connected as ${hello.executor.name}`)
        }
        executorId = hello.executor.id
        executorName = hello.executor.name
        lastHelloAt = Date.now()
      }

      while (activeRuns.size < config.JMCP_BRIDGE_MAX_PARALLEL_RUNS && executorId) {
        const claimed = await client.claim(executorId)

        if (claimed.event === "noop") {
          break
        }

        const claimedExecutorId = executorId
        const promise = handleClaim(claimedExecutorId, claimed)
          .catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            await client.sendEvent(claimedExecutorId, claimed.taskRun.id, {
              event: "task.blocked",
              message,
            })
          })
          .finally(() => {
            activeRuns.delete(claimed.taskRun.id)
          })

        activeRuns.set(claimed.taskRun.id, promise)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`JMCP local-bridge loop error: ${message}`)
      executorId = null
      executorName = null
    }

    await Promise.race([
      sleep(config.JMCP_BRIDGE_POLL_INTERVAL_MS),
      ...(activeRuns.size > 0 ? [...activeRuns.values()] : []),
    ])
  }
}

async function handleClaim(
  executorId: string,
  claim: Extract<BridgeClaimResponse, { event: "task.assign" }>,
): Promise<void> {
  await executor.run(claim, async (event) => {
    await client.sendEvent(executorId, claim.taskRun.id, event)
  })
}

function createExecutor(): ExecutorAdapter {
  if (config.JMCP_BRIDGE_KIND === "mock") {
    return new MockExecutorAdapter()
  }

  return new ClaudeCodeExecutor(config)
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
