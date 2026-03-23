import { execFile as execFileCallback, spawn } from "node:child_process"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { BridgeConfig } from "@jmcp/config"
import type {
  BridgeClaimResponse,
  BridgeProgressEvent,
  Project,
  ProjectBrief,
  ProjectMemory,
  RunArtifact,
} from "@jmcp/contracts"

const execFile = promisify(execFileCallback)
const PROMPT_PACK_VERSION = "2026-03-23a"
const PLANNER_TIMEOUT_MS = 30_000
const MODEL_PASS_TIMEOUT_MS = 10 * 60 * 1000

type AssignedTask = Extract<BridgeClaimResponse, { event: "task.assign" }>

export interface ExecutorProgressEvent {
  event:
    | "task.progress"
    | "task.retrying"
    | "task.blocked"
    | "task.result"
    | "task.approval_required"
    | "task.checks_green"
    | "task.merge_ready"
    | "task.merged"
  message: string
  branchName?: string
  artifact?: Omit<RunArtifact, "id" | "createdAt" | "taskRunId">
  proposedTodo?: {
    title: string
    details: string | null
  }
  step?: BridgeProgressEvent["step"]
  attempt?: BridgeProgressEvent["attempt"]
  checkpointBundle?: BridgeProgressEvent["checkpointBundle"]
}

export interface ExecutorAdapter {
  run(task: AssignedTask, emit: (event: ExecutorProgressEvent) => Promise<void>): Promise<void>
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

export function createBundleFilename(input: string, suffix: string): string {
  const stem = input
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${stem || "artifact"}-${suffix}`
}

function createPlanPrompt(
  project: Project,
  brief: ProjectBrief,
  projectMemory: ProjectMemory,
  objective: string,
): string {
  return [
    "You are the planner for JMCP.",
    `Repository: ${project.githubOwner}/${project.githubRepo}`,
    `Objective: ${objective}`,
    `Project summary: ${brief.summary}`,
    `Coding norms: ${brief.codingNorms.join(" | ")}`,
    `Dangerous paths: ${brief.dangerousPaths.join(" | ")}`,
    `Validation commands: ${brief.testCommands.join(" | ")}`,
    `Jarvis template: ${projectMemory.templateName}@${projectMemory.templateVersion}`,
    `Repo facts: ${projectMemory.repoFacts.join(" | ")}`,
    `Operator defaults: ${projectMemory.operatorDefaults.join(" | ")}`,
    "Produce a concise actionable plan with files to inspect, implementation intent, and validation focus.",
    "Do not edit files in this pass.",
  ].join("\n")
}

function createExecutorPrompt(
  project: Project,
  brief: ProjectBrief,
  projectMemory: ProjectMemory,
  objective: string,
  planSummary: string,
): string {
  return [
    "You are the execution agent for JMCP.",
    `Repository: ${project.githubOwner}/${project.githubRepo}`,
    `Objective: ${objective}`,
    `Project summary: ${brief.summary}`,
    `Coding norms: ${brief.codingNorms.join(" | ")}`,
    `Dangerous paths: ${brief.dangerousPaths.join(" | ")}`,
    `Validation commands: ${brief.testCommands.join(" | ")}`,
    `Jarvis template: ${projectMemory.templateName}@${projectMemory.templateVersion}`,
    `Repo facts: ${projectMemory.repoFacts.join(" | ")}`,
    `Operator defaults: ${projectMemory.operatorDefaults.join(" | ")}`,
    `Project instructions: ${projectMemory.instructions.join(" | ")}`,
    "Requirements:",
    "- make the code changes directly in the current worktree",
    "- stay within repo-local changes only",
    "- do not attempt remote PR or merge operations",
    "- run local checks where reasonable before finishing",
    "- leave the repo in a coherent state",
    `Approved plan: ${planSummary}`,
    "At the end, summarize what changed and any remaining risk in 6 bullets or fewer.",
  ].join("\n")
}

function createRepairPrompt(
  objective: string,
  validationOutput: string,
  attemptNumber: number,
): string {
  return [
    "You are the repair agent for JMCP.",
    `Objective: ${objective}`,
    `Repair attempt: ${attemptNumber}`,
    "The previous run produced failing validation output. Fix the code and rerun only the necessary local validation.",
    "Validation output:",
    validationOutput,
  ].join("\n")
}

function createReviewPrompt(objective: string): string {
  return [
    "You are the reviewer for JMCP.",
    `Objective: ${objective}`,
    "Inspect the current diff and produce a compact review summary with:",
    "- change summary",
    "- validation confidence",
    "- risks that still remain",
  ].join("\n")
}

function createRecapPrompt(objective: string, reviewSummary: string): string {
  return [
    "You are the recap agent for JMCP.",
    `Objective: ${objective}`,
    "Turn the run into a compact mobile recap with status, what changed, what still needs attention, and next steps.",
    reviewSummary,
  ].join("\n")
}

function createProposalPrompt(
  objective: string,
  reviewSummary: string,
  recapSummary: string,
): string {
  return [
    "You are the follow-up planner for JMCP.",
    `Completed objective: ${objective}`,
    "Based on the completed work, propose up to 3 useful follow-up tasks that would materially improve the repo.",
    "Only include ideas that are concrete, bounded, and safe to queue as standalone TODOs.",
    "Do not repeat the objective that was just completed.",
    "Do not suggest vague polish, generic testing, or speculative work unless there is a clear repo-local next step.",
    "Return strict JSON only. Use this exact shape:",
    '[{"title":"Short actionable title","details":"Why this is useful and what it would change."}]',
    "If there is nothing worth proposing, return [].",
    "Review summary:",
    reviewSummary,
    "Recap summary:",
    recapSummary,
  ].join("\n")
}

function isProtectedAction(objective: string): boolean {
  const lower = objective.toLowerCase()
  return lower.includes("secret") || lower.includes("credential") || lower.includes("settings")
}

function parsePullRequestNumber(url: string | null | undefined): number | null {
  if (!url) {
    return null
  }

  const match = url.match(/\/pull\/(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : null
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function captureJsonCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  if (timeoutMs) {
    const stdout = await captureTextCommand(command, args, cwd, timeoutMs)
    return JSON.parse(stdout)
  }

  const result = await execFile(command, args, {
    cwd,
    env: {
      ...process.env,
      HOME: process.env.HOME ?? os.homedir(),
    },
    maxBuffer: 10 * 1024 * 1024,
  })
  return JSON.parse(result.stdout)
}

async function captureTextCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<string> {
  if (!timeoutMs) {
    const result = await execFile(command, args, {
      cwd,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
      maxBuffer: 10 * 1024 * 1024,
    })
    return result.stdout.trim()
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let finished = false

    const forceKillTimer = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL")
      }
    }, timeoutMs + 1_500)

    const timeoutTimer = setTimeout(() => {
      if (!finished) {
        child.kill("SIGTERM")
      }
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      finished = true
      clearTimeout(timeoutTimer)
      clearTimeout(forceKillTimer)
      reject(error)
    })

    child.on("close", (code, signal) => {
      finished = true
      clearTimeout(timeoutTimer)
      clearTimeout(forceKillTimer)

      if (signal || code === 143 || code === 137) {
        reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`))
        return
      }

      if (code && code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${stderr.trim()}`))
        return
      }

      resolve(stdout.trim())
    })
  })
}

async function runShell(
  command: string,
  cwd: string,
): Promise<{
  code: number
  stdout: string
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", command], {
      cwd,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

async function runClaudeJson(args: {
  command: string
  cwd: string
  prompt: string
  permissionMode: "plan" | "bypassPermissions"
  timeoutMs?: number
}): Promise<{
  result: string
  totalCostUsd: number | null
}> {
  const response = await captureJsonCommand(
    args.command,
    [
      "-p",
      args.prompt,
      "--output-format",
      "json",
      "--permission-mode",
      args.permissionMode,
      "--dangerously-skip-permissions",
    ],
    args.cwd,
    args.timeoutMs,
  )

  return {
    result: typeof response.result === "string" ? response.result : JSON.stringify(response.result),
    totalCostUsd: typeof response.total_cost_usd === "number" ? response.total_cost_usd : null,
  }
}

function createFallbackPlannerSummary(
  task: AssignedTask,
  brief: ProjectBrief,
  projectMemory: ProjectMemory,
): string {
  return [
    `Fallback plan for ${task.taskRun.objective}`,
    `1. Inspect the app routes, feed logic, and shared contracts that most directly control ${task.taskRun.objective}.`,
    "2. Implement the smallest coherent slice that preserves existing repo boundaries and public/blind-mode safety rules.",
    `3. Validate with: ${brief.testCommands.join(" | ")}`,
    "4. Keep the change repo-local, then summarize risks and next steps clearly.",
    `Project facts: ${projectMemory.repoFacts.slice(0, 3).join(" | ")}`,
  ].join("\n")
}

function parseProposalList(raw: string): Array<{ title: string; details: string | null }> {
  const trimmed = raw.trim()
  const candidate = trimmed.startsWith("[")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("["), trimmed.lastIndexOf("]") + 1)

  if (!candidate || candidate[0] !== "[") {
    return []
  }

  try {
    const parsed = JSON.parse(candidate)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.title === "string" &&
          entry.title.trim()
        ) {
          return {
            title: entry.title.trim().slice(0, 140),
            details:
              typeof entry.details === "string" && entry.details.trim()
                ? entry.details.trim().slice(0, 500)
                : null,
          }
        }

        return null
      })
      .filter((entry): entry is { title: string; details: string | null } => entry !== null)
      .slice(0, 3)
  } catch {
    return []
  }
}

async function discoverValidationCommands(
  worktreeDir: string,
  brief: ProjectBrief,
  defaults: string[],
): Promise<string[]> {
  const commands = new Set<string>()

  for (const command of brief.testCommands) {
    commands.add(command)
  }

  const packageJsonPath = path.join(worktreeDir, "package.json")
  if (await exists(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))
      const scripts = packageJson.scripts ?? {}
      for (const scriptName of ["lint", "test", "check", "build"]) {
        if (typeof scripts[scriptName] === "string") {
          commands.add(`npm run ${scriptName}`)
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  if (commands.size === 0) {
    for (const fallback of defaults) {
      commands.add(fallback)
    }
  }

  return [...commands]
}

export class MockExecutorAdapter implements ExecutorAdapter {
  async run(
    task: AssignedTask,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<void> {
    const objective = task.taskRun.objective.toLowerCase()

    if (
      objective.includes("merge") ||
      objective.includes("secret") ||
      objective.includes("settings")
    ) {
      await emit({
        event: "task.approval_required",
        message: "This request touches a protected action and needs manual approval.",
      })
      return
    }

    const branchName = `jmcp/${slugify(task.taskRun.objective)}`
    await emit({
      event: "task.progress",
      message: "Scanned the task and prepared a working branch.",
      branchName,
      step: {
        kind: "plan",
        status: "completed",
        title: "Prepared mock execution",
        body: "The mock executor queued a safe dry-run style flow.",
      },
    })
    await emit({
      event: "task.result",
      message: "Prepared a draft-ready result package for review.",
      branchName,
      artifact: {
        kind: "pull_request",
        title: "Draft PR candidate",
        url: `https://github.com/${branchName}`,
        text: null,
      },
    })
  }
}

export class ClaudeCodeExecutor implements ExecutorAdapter {
  readonly #config: BridgeConfig

  constructor(config: BridgeConfig) {
    this.#config = config
  }

  async run(
    task: AssignedTask,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<void> {
    if (isProtectedAction(task.taskRun.objective)) {
      await emit({
        event: "task.approval_required",
        message:
          "This objective touches secrets or sensitive settings and requires a manual review.",
      })
      return
    }

    const repoDir = await this.#ensureRepo(task.project, emit)
    const branchName = `jmcp/${slugify(task.taskRun.objective)}-${task.taskRun.id.slice(0, 8)}`
    const worktreeDir = path.join(this.#config.JMCP_BRIDGE_WORKTREE_ROOT, task.taskRun.id)

    await mkdir(this.#config.JMCP_BRIDGE_WORKTREE_ROOT, { recursive: true })
    await mkdir(this.#config.JMCP_BRIDGE_BUNDLE_ROOT, { recursive: true })

    try {
      await emit({
        event: "task.progress",
        message: "Preparing a dedicated worktree for the run.",
        branchName,
        step: {
          kind: "git",
          status: "running",
          title: "Preparing worktree",
          body: worktreeDir,
        },
      })

      await runShell(`git -C ${shellQuote(repoDir)} fetch origin --prune`, repoDir)
      await runShell(
        `git -C ${shellQuote(repoDir)} worktree add --force -B ${shellQuote(branchName)} ${shellQuote(worktreeDir)} ${shellQuote(`origin/${task.project.defaultBranch}`)}`,
        repoDir,
      )

      const planner = await this.#runPlanner(task, worktreeDir, emit)
      const validationCommands = await discoverValidationCommands(
        worktreeDir,
        task.brief,
        this.#config.JMCP_BRIDGE_DEFAULT_TEST_COMMANDS,
      )

      let attemptNumber = 1
      let finalValidationOutput = ""
      let lastErrorSignature: string | null = null

      for (;;) {
        if (attemptNumber === 1) {
          await this.#runExecutorPass(task, worktreeDir, planner, emit, attemptNumber)
        } else {
          await this.#runRepairPass(task, worktreeDir, finalValidationOutput, emit, attemptNumber)
        }

        const validation = await this.#runValidation(worktreeDir, validationCommands, emit)
        finalValidationOutput = validation.output

        if (validation.ok) {
          await emit({
            event: "task.checks_green",
            message: "Local validation passed.",
            branchName,
            step: {
              kind: "validation",
              status: "completed",
              title: "Checks green",
              body: validation.output,
            },
          })
          break
        }

        const signature = validation.output.slice(0, 320)
        if (signature === lastErrorSignature || attemptNumber >= 4) {
          await emit({
            event: "task.blocked",
            message: "Validation kept failing after automated retries.",
            branchName,
            artifact: {
              kind: "check",
              title: "Validation failure",
              text: validation.output,
              url: null,
            },
          })
          return
        }

        lastErrorSignature = signature
        attemptNumber += 1
        await emit({
          event: "task.retrying",
          message: `Validation failed. Starting repair attempt ${attemptNumber}.`,
          branchName,
          step: {
            kind: "repair",
            status: "running",
            title: `Repair attempt ${attemptNumber}`,
            body: validation.output.slice(0, 1000),
          },
          attempt: {
            phase: "repair",
            number: attemptNumber,
            status: "running",
            promptPackVersion: PROMPT_PACK_VERSION,
            summary: "Retrying after validation failure.",
            totalCostUsd: null,
          },
        })
      }

      const review = await this.#runReviewerPass(task, worktreeDir, emit, attemptNumber)
      const prUrl = await this.#publishResult(task, repoDir, worktreeDir, branchName, review, emit)

      const recap = await this.#runRecapPass(task, worktreeDir, review, emit)
      await this.#runProposalPass(task, worktreeDir, review, recap, emit)
      const bundlePath = await this.#writeBundle(
        task,
        worktreeDir,
        branchName,
        recap,
        review,
        prUrl,
      )

      await emit({
        event: prUrl ? "task.result" : "task.blocked",
        message: prUrl
          ? "Run completed and result bundle prepared."
          : "Run finished locally but did not produce a PR.",
        branchName,
        artifact: prUrl
          ? {
              kind: "pull_request",
              title: "JMCP pull request",
              url: prUrl,
              text: review,
            }
          : {
              kind: "note",
              title: "No PR created",
              text: review,
              url: null,
            },
        checkpointBundle: {
          path: bundlePath,
          summary: recap,
        },
      })
    } finally {
      await rm(worktreeDir, { force: true, recursive: true }).catch(() => undefined)
      await runShell(`git -C ${shellQuote(repoDir)} worktree prune`, repoDir).catch(() => undefined)
    }
  }

  async #ensureRepo(
    project: Project,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<string> {
    const repoDir = path.join(
      this.#config.JMCP_BRIDGE_REPO_CACHE_ROOT,
      project.githubOwner,
      project.githubRepo,
    )
    const repoRoot = path.dirname(repoDir)
    await mkdir(repoRoot, { recursive: true })

    if (!(await exists(repoDir))) {
      await emit({
        event: "task.progress",
        message: "Cloning the repository into the local cache.",
        step: {
          kind: "git",
          status: "running",
          title: "Cloning repository",
          body: repoDir,
        },
      })
      await runShell(
        `${shellQuote(this.#config.JMCP_BRIDGE_GH_COMMAND)} repo clone ${shellQuote(`${project.githubOwner}/${project.githubRepo}`)} ${shellQuote(repoDir)}`,
        process.cwd(),
      )
    }

    return repoDir
  }

  async #runPlanner(
    task: AssignedTask,
    worktreeDir: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<string> {
    await emit({
      event: "task.progress",
      message: "Building an implementation plan.",
      branchName: undefined,
      step: {
        kind: "plan",
        status: "running",
        title: "Planner pass",
        body: "Inspecting the repo and deciding the first implementation route.",
      },
      attempt: {
        phase: "planner",
        number: 1,
        status: "running",
        promptPackVersion: PROMPT_PACK_VERSION,
        summary: null,
        totalCostUsd: null,
      },
    })

    try {
      const planner = await runClaudeJson({
        command: this.#config.JMCP_BRIDGE_CLAUDE_COMMAND,
        cwd: worktreeDir,
        prompt: createPlanPrompt(
          task.project,
          task.brief,
          task.projectMemory,
          task.taskRun.objective,
        ),
        permissionMode: "plan",
        timeoutMs: PLANNER_TIMEOUT_MS,
      })

      await emit({
        event: "task.progress",
        message: "Plan ready. Moving into code changes.",
        step: {
          kind: "plan",
          status: "completed",
          title: "Planner pass complete",
          body: planner.result,
        },
        attempt: {
          phase: "planner",
          number: 1,
          status: "completed",
          promptPackVersion: PROMPT_PACK_VERSION,
          summary: planner.result.slice(0, 500),
          totalCostUsd: planner.totalCostUsd,
        },
        artifact: {
          kind: "plan",
          title: "Planner summary",
          text: planner.result,
          url: null,
        },
      })

      return planner.result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const fallbackPlan = createFallbackPlannerSummary(task, task.brief, task.projectMemory)

      await emit({
        event: "task.progress",
        message: "Planner timed out. Jarvis switched to a bounded fallback plan.",
        step: {
          kind: "plan",
          status: "completed",
          title: "Planner fallback",
          body: `${message}\n\n${fallbackPlan}`,
        },
        attempt: {
          phase: "planner",
          number: 1,
          status: "completed",
          promptPackVersion: PROMPT_PACK_VERSION,
          summary: fallbackPlan.slice(0, 500),
          totalCostUsd: null,
        },
        artifact: {
          kind: "plan",
          title: "Fallback planner summary",
          text: `${message}\n\n${fallbackPlan}`,
          url: null,
        },
      })

      return fallbackPlan
    }
  }

  async #runExecutorPass(
    task: AssignedTask,
    worktreeDir: string,
    planSummary: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
    attemptNumber: number,
  ): Promise<void> {
    await emit({
      event: "task.progress",
      message: "Claude is editing the worktree.",
      step: {
        kind: "executor",
        status: "running",
        title: "Execution pass",
        body: `Attempt ${attemptNumber}`,
      },
      attempt: {
        phase: "executor",
        number: attemptNumber,
        status: "running",
        promptPackVersion: PROMPT_PACK_VERSION,
        summary: null,
        totalCostUsd: null,
      },
    })

    const result = await runClaudeJson({
      command: this.#config.JMCP_BRIDGE_CLAUDE_COMMAND,
      cwd: worktreeDir,
      prompt: createExecutorPrompt(
        task.project,
        task.brief,
        task.projectMemory,
        task.taskRun.objective,
        planSummary,
      ),
      permissionMode: "bypassPermissions",
      timeoutMs: MODEL_PASS_TIMEOUT_MS,
    })

    await emit({
      event: "task.progress",
      message: "Claude finished the current implementation pass.",
      step: {
        kind: "executor",
        status: "completed",
        title: "Execution pass complete",
        body: result.result,
      },
      attempt: {
        phase: "executor",
        number: attemptNumber,
        status: "completed",
        promptPackVersion: PROMPT_PACK_VERSION,
        summary: result.result.slice(0, 500),
        totalCostUsd: result.totalCostUsd,
      },
    })
  }

  async #runRepairPass(
    task: AssignedTask,
    worktreeDir: string,
    validationOutput: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
    attemptNumber: number,
  ): Promise<void> {
    const result = await runClaudeJson({
      command: this.#config.JMCP_BRIDGE_CLAUDE_COMMAND,
      cwd: worktreeDir,
      prompt: createRepairPrompt(task.taskRun.objective, validationOutput, attemptNumber),
      permissionMode: "bypassPermissions",
      timeoutMs: MODEL_PASS_TIMEOUT_MS,
    })

    await emit({
      event: "task.progress",
      message: `Repair attempt ${attemptNumber} finished.`,
      step: {
        kind: "repair",
        status: "completed",
        title: `Repair attempt ${attemptNumber} complete`,
        body: result.result,
      },
      attempt: {
        phase: "repair",
        number: attemptNumber,
        status: "completed",
        promptPackVersion: PROMPT_PACK_VERSION,
        summary: result.result.slice(0, 500),
        totalCostUsd: result.totalCostUsd,
      },
    })
  }

  async #runValidation(
    worktreeDir: string,
    commands: string[],
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<{ ok: boolean; output: string }> {
    const outputs: string[] = []

    for (const command of commands) {
      await emit({
        event: "task.progress",
        message: `Running validation: ${command}`,
        step: {
          kind: "validation",
          status: "running",
          title: command,
          body: null,
        },
      })

      const result = await runShell(command, worktreeDir)
      const output = `${command}\nexit=${result.code}\n${result.stdout}${result.stderr}`.trim()
      outputs.push(output)

      if (result.code !== 0) {
        return {
          ok: false,
          output: outputs.join("\n\n"),
        }
      }
    }

    return {
      ok: true,
      output: outputs.join("\n\n"),
    }
  }

  async #runReviewerPass(
    task: AssignedTask,
    worktreeDir: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
    attemptNumber: number,
  ): Promise<string> {
    const result = await runClaudeJson({
      command: this.#config.JMCP_BRIDGE_CLAUDE_COMMAND,
      cwd: worktreeDir,
      prompt: createReviewPrompt(task.taskRun.objective),
      permissionMode: "plan",
      timeoutMs: MODEL_PASS_TIMEOUT_MS,
    })

    await emit({
      event: "task.progress",
      message: "Review summary prepared.",
      step: {
        kind: "review",
        status: "completed",
        title: "Review pass complete",
        body: result.result,
      },
      attempt: {
        phase: "reviewer",
        number: attemptNumber,
        status: "completed",
        promptPackVersion: PROMPT_PACK_VERSION,
        summary: result.result.slice(0, 500),
        totalCostUsd: result.totalCostUsd,
      },
      artifact: {
        kind: "note",
        title: "Review summary",
        text: result.result,
        url: null,
      },
    })

    return result.result
  }

  async #runRecapPass(
    task: AssignedTask,
    worktreeDir: string,
    reviewSummary: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<string> {
    const result = await runClaudeJson({
      command: this.#config.JMCP_BRIDGE_CLAUDE_COMMAND,
      cwd: worktreeDir,
      prompt: createRecapPrompt(task.taskRun.objective, reviewSummary),
      permissionMode: "plan",
      timeoutMs: MODEL_PASS_TIMEOUT_MS,
    })

    await emit({
      event: "task.progress",
      message: "Morning recap block prepared.",
      step: {
        kind: "recap",
        status: "completed",
        title: "Recap prepared",
        body: result.result,
      },
      attempt: {
        phase: "recap",
        number: 1,
        status: "completed",
        promptPackVersion: PROMPT_PACK_VERSION,
        summary: result.result.slice(0, 500),
        totalCostUsd: result.totalCostUsd,
      },
    })

    return result.result
  }

  async #runProposalPass(
    task: AssignedTask,
    worktreeDir: string,
    reviewSummary: string,
    recapSummary: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<void> {
    const result = await runClaudeJson({
      command: this.#config.JMCP_BRIDGE_CLAUDE_COMMAND,
      cwd: worktreeDir,
      prompt: createProposalPrompt(task.taskRun.objective, reviewSummary, recapSummary),
      permissionMode: "plan",
      timeoutMs: MODEL_PASS_TIMEOUT_MS,
    })

    const proposals = parseProposalList(result.result)

    for (const proposal of proposals) {
      await emit({
        event: "task.progress",
        message: `Captured follow-up proposal: ${proposal.title}`,
        proposedTodo: proposal,
        step: {
          kind: "recap",
          status: "completed",
          title: "Follow-up proposal captured",
          body: proposal.details,
        },
      })
    }
  }

  async #publishResult(
    task: AssignedTask,
    repoDir: string,
    worktreeDir: string,
    branchName: string,
    reviewSummary: string,
    emit: (event: ExecutorProgressEvent) => Promise<void>,
  ): Promise<string | null> {
    const status = await captureTextCommand("git", ["status", "--short"], worktreeDir)

    if (!status.trim()) {
      await emit({
        event: "task.blocked",
        message: "Claude completed the run without leaving any code changes to publish.",
        branchName,
      })
      return null
    }

    await runShell(`git config user.name "JMCP Bot"`, worktreeDir)
    await runShell(`git config user.email "jmcp@local.invalid"`, worktreeDir)
    await runShell(`git add -A`, worktreeDir)
    await runShell(`git commit -m ${shellQuote(`jmcp: ${task.taskRun.objective}`)}`, worktreeDir)
    await runShell(`git push --set-upstream origin ${shellQuote(branchName)}`, worktreeDir)

    const prUrl = await this.#openPullRequest(task.project, worktreeDir, branchName, reviewSummary)

    await emit({
      event: "task.merge_ready",
      message: "Pull request published. Checking merge policy.",
      branchName,
      artifact: {
        kind: "pull_request",
        title: "JMCP pull request",
        url: prUrl,
        text: reviewSummary,
      },
      step: {
        kind: "github",
        status: "completed",
        title: "Pull request published",
        body: prUrl,
      },
    })

    const protection = await this.#getBranchProtection(task.project)
    if (
      task.mergePolicy.mode !== "auto_merge_protected_green" ||
      !task.mergePolicy.allowAutoMerge ||
      !protection.protected ||
      protection.requiredChecks.length === 0
    ) {
      return prUrl
    }

    await emit({
      event: "task.progress",
      message: "Protected branch detected. Arming auto-merge and waiting for green checks.",
      branchName,
      step: {
        kind: "merge",
        status: "running",
        title: "Auto-merge armed",
        body: prUrl,
      },
    })

    const prNumber = parsePullRequestNumber(prUrl)
    if (!prNumber) {
      return prUrl
    }

    await runShell(
      `${shellQuote(this.#config.JMCP_BRIDGE_GH_COMMAND)} pr merge ${prNumber} --auto --squash --delete-branch`,
      repoDir,
    )

    const merged = await this.#waitForMerge(task.project, prNumber)
    if (merged) {
      await emit({
        event: "task.merged",
        message: "PR merged successfully after required checks passed.",
        branchName,
        artifact: {
          kind: "pull_request",
          title: "Merged PR",
          url: prUrl,
          text: reviewSummary,
        },
        step: {
          kind: "merge",
          status: "completed",
          title: "Merged",
          body: prUrl,
        },
      })
    }

    return prUrl
  }

  async #openPullRequest(
    project: Project,
    worktreeDir: string,
    branchName: string,
    reviewSummary: string,
  ): Promise<string> {
    try {
      const existing = await captureJsonCommand(
        this.#config.JMCP_BRIDGE_GH_COMMAND,
        ["pr", "view", branchName, "--json", "url,number,isDraft"],
        worktreeDir,
      )
      return typeof existing.url === "string" ? existing.url : ""
    } catch {
      const bodyPath = path.join(
        this.#config.JMCP_BRIDGE_BUNDLE_ROOT,
        createBundleFilename(branchName, "pr.md"),
      )
      await mkdir(path.dirname(bodyPath), { recursive: true })
      await writeFile(bodyPath, reviewSummary)
      const url = await captureTextCommand(
        this.#config.JMCP_BRIDGE_GH_COMMAND,
        [
          "pr",
          "create",
          "--base",
          project.defaultBranch,
          "--head",
          branchName,
          "--title",
          `JMCP: ${project.name} - ${branchName}`,
          "--body-file",
          bodyPath,
        ],
        worktreeDir,
      )
      return url.split("\n").pop() ?? url
    }
  }

  async #getBranchProtection(project: Project): Promise<{
    protected: boolean
    requiredChecks: string[]
  }> {
    try {
      const response = await captureJsonCommand(
        this.#config.JMCP_BRIDGE_GH_COMMAND,
        [
          "api",
          `repos/${project.githubOwner}/${project.githubRepo}/branches/${project.defaultBranch}/protection`,
        ],
        process.cwd(),
      )
      const requiredStatusChecks =
        typeof response.required_status_checks === "object" && response.required_status_checks
          ? (response.required_status_checks as { contexts?: unknown }).contexts
          : undefined

      return {
        protected: true,
        requiredChecks: Array.isArray(requiredStatusChecks)
          ? requiredStatusChecks.filter((entry): entry is string => typeof entry === "string")
          : [],
      }
    } catch {
      return {
        protected: false,
        requiredChecks: [],
      }
    }
  }

  async #waitForMerge(project: Project, prNumber: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < this.#config.JMCP_BRIDGE_PR_POLL_TIMEOUT_MS) {
      const pr = await captureJsonCommand(
        this.#config.JMCP_BRIDGE_GH_COMMAND,
        [
          "pr",
          "view",
          String(prNumber),
          "--repo",
          `${project.githubOwner}/${project.githubRepo}`,
          "--json",
          "mergedAt,state,mergeStateStatus,url",
        ],
        process.cwd(),
      )

      if (typeof pr.mergedAt === "string" && pr.mergedAt) {
        return true
      }

      if (pr.state === "CLOSED" && !pr.mergedAt) {
        return false
      }

      await sleep(this.#config.JMCP_BRIDGE_PR_POLL_INTERVAL_MS)
    }

    return false
  }

  async #writeBundle(
    task: AssignedTask,
    worktreeDir: string,
    branchName: string,
    recap: string,
    reviewSummary: string,
    prUrl: string | null,
  ): Promise<string> {
    const bundleDir = path.join(this.#config.JMCP_BRIDGE_BUNDLE_ROOT, task.project.id)
    await mkdir(bundleDir, { recursive: true })

    const diff = await captureTextCommand(
      "git",
      ["diff", "--stat", `origin/${task.project.defaultBranch}...HEAD`],
      worktreeDir,
    ).catch(() => "")
    const status = await captureTextCommand("git", ["status", "--short"], worktreeDir).catch(
      () => "",
    )
    const headSha = await captureTextCommand("git", ["rev-parse", "HEAD"], worktreeDir).catch(
      () => "",
    )
    const baseSha = await captureTextCommand(
      "git",
      ["rev-parse", `origin/${task.project.defaultBranch}`],
      worktreeDir,
    ).catch(() => "")

    const bundlePath = path.join(bundleDir, `${task.taskRun.id}.json`)
    await writeFile(
      bundlePath,
      JSON.stringify(
        {
          taskRunId: task.taskRun.id,
          projectId: task.project.id,
          objective: task.taskRun.objective,
          branchName,
          promptPackVersion: PROMPT_PACK_VERSION,
          repo: `${task.project.githubOwner}/${task.project.githubRepo}`,
          beforeSha: baseSha,
          afterSha: headSha,
          diff,
          status,
          reviewSummary,
          recap,
          prUrl,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )

    return bundlePath
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
