import { describe, expect, it } from "vitest"
import { MockExecutorAdapter } from "../src/executor.js"

describe("mock executor", () => {
  it("requests approval for protected actions", async () => {
    const executor = new MockExecutorAdapter()
    const events: Array<{ event: string }> = []

    await executor.run(
      {
        event: "task.assign",
        project: {
          id: "project_1",
          name: "Jarvis",
          githubOwner: "landigf",
          githubRepo: "JMCP",
          summary: "Operator workspace",
          defaultBranch: "main",
          nightlyEnabled: true,
          repoUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        brief: {
          id: "brief_1",
          projectId: "project_1",
          summary: "Operator workspace",
          codingNorms: [],
          testCommands: [],
          dangerousPaths: [],
          releaseConstraints: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        automationPolicy: {
          id: "policy_1",
          projectId: "project_1",
          paused: false,
          nightlyEnabled: true,
          autoRunOnTodo: true,
          maxConcurrentRuns: 1,
          mergePolicyId: "merge_1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        mergePolicy: {
          id: "merge_1",
          projectId: "project_1",
          mode: "auto_merge_protected_green",
          requireProtectedBranch: true,
          requireChecks: true,
          requireReviews: false,
          allowAutoMerge: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        taskRun: {
          id: "run_1",
          projectId: "project_1",
          sourceTodoId: null,
          objective: "merge changes into main",
          status: "queued",
          branchName: null,
          executorId: null,
          approvalReason: null,
          resultSummary: null,
          prUrl: null,
          prNumber: null,
          priority: 50,
          attemptCount: 0,
          lastErrorSignature: null,
          mergeState: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      async (event) => {
        events.push(event)
      },
    )

    expect(events[0]?.event).toBe("task.approval_required")
  })
})
