import path from "node:path"
import { z } from "zod"

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue
  }

  return value !== "false"
}

const controlPlaneEnvSchema = z.object({
  JMCP_CONTROL_PLANE_HOST: z.string().default("127.0.0.1"),
  JMCP_CONTROL_PLANE_PORT: z.coerce.number().int().positive().default(4000),
  JMCP_CONTROL_PLANE_DATA_DIR: z
    .string()
    .default(path.resolve(process.cwd(), "data/control-plane")),
  JMCP_CONTROL_PLANE_DB_PATH: z.string().optional(),
  JMCP_BRIDGE_SHARED_TOKEN: z.string().default("jmcp-local-bridge-token"),
  JMCP_GITHUB_WEBHOOK_SECRET: z.string().default("jmcp-dev-github-secret"),
  JMCP_PUBLIC_WEB_URL: z.string().optional(),
  JMCP_WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  JMCP_WEB_PUSH_PRIVATE_KEY: z.string().optional(),
  JMCP_WEB_PUSH_SUBJECT: z.string().default("mailto:operator@example.com"),
  JMCP_TELEGRAM_BOT_TOKEN: z.string().optional(),
  JMCP_TELEGRAM_CHAT_ID: z.string().optional(),
  JMCP_TELEGRAM_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  JMCP_NIGHTLY_START_HOUR: z.coerce.number().int().min(0).max(23).default(1),
  JMCP_NIGHTLY_END_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  JMCP_AUTORUN_ENABLED: z.string().optional(),
  JMCP_VOICE_ASSET_DIR: z.string().optional(),
  JMCP_VOICE_TRANSCRIBE_COMMAND: z.string().optional(),
  JMCP_VOICE_TTS_COMMAND: z.string().optional(),
})

const webEnvSchema = z.object({
  NEXT_PUBLIC_CONTROL_PLANE_URL: z.string().default("http://127.0.0.1:4000"),
  NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_JMCP_PUBLIC_WEB_URL: z.string().optional(),
})

const bridgeEnvSchema = z.object({
  JMCP_BRIDGE_CONTROL_PLANE_URL: z.string().default("http://127.0.0.1:4000"),
  JMCP_BRIDGE_SHARED_TOKEN: z.string().default("jmcp-local-bridge-token"),
  JMCP_BRIDGE_NAME: z.string().default("Local Laptop Executor"),
  JMCP_BRIDGE_HOST_LABEL: z.string().default("laptop"),
  JMCP_BRIDGE_KIND: z.enum(["mock", "shell", "claude_code"]).default("claude_code"),
  JMCP_BRIDGE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
  JMCP_BRIDGE_MAX_PARALLEL_RUNS: z.coerce.number().int().positive().default(3),
  JMCP_BRIDGE_REPO_CACHE_ROOT: z
    .string()
    .default(path.resolve(process.cwd(), "data/local-bridge/repos")),
  JMCP_BRIDGE_WORKTREE_ROOT: z
    .string()
    .default(path.resolve(process.cwd(), "data/local-bridge/worktrees")),
  JMCP_BRIDGE_BUNDLE_ROOT: z
    .string()
    .default(path.resolve(process.cwd(), "data/local-bridge/bundles")),
  JMCP_BRIDGE_CLAUDE_COMMAND: z.string().default("claude"),
  JMCP_BRIDGE_GH_COMMAND: z.string().default("gh"),
  JMCP_BRIDGE_DEFAULT_TEST_COMMANDS: z
    .string()
    .default("npm test;npm run test;npm run check;npm run lint"),
  JMCP_BRIDGE_PR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  JMCP_BRIDGE_PR_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(1800000),
})

export type ControlPlaneConfig = Omit<
  z.infer<typeof controlPlaneEnvSchema>,
  "JMCP_CONTROL_PLANE_DB_PATH" | "JMCP_AUTORUN_ENABLED" | "JMCP_VOICE_ASSET_DIR"
> & {
  JMCP_CONTROL_PLANE_DB_PATH: string
  JMCP_AUTORUN_ENABLED: boolean
  JMCP_VOICE_ASSET_DIR: string
}
export type WebConfig = z.infer<typeof webEnvSchema>
export type BridgeConfig = Omit<
  z.infer<typeof bridgeEnvSchema>,
  "JMCP_BRIDGE_DEFAULT_TEST_COMMANDS"
> & {
  JMCP_BRIDGE_DEFAULT_TEST_COMMANDS: string[]
}

export function getControlPlaneConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const parsed = controlPlaneEnvSchema.parse(env)
  const dataDir = parsed.JMCP_CONTROL_PLANE_DATA_DIR

  return {
    ...parsed,
    JMCP_CONTROL_PLANE_DB_PATH:
      parsed.JMCP_CONTROL_PLANE_DB_PATH ?? path.join(dataDir, "jmcp.sqlite"),
    JMCP_AUTORUN_ENABLED: parseBoolean(parsed.JMCP_AUTORUN_ENABLED, true),
    JMCP_VOICE_ASSET_DIR: parsed.JMCP_VOICE_ASSET_DIR ?? path.join(dataDir, "voice"),
  }
}

export function getWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  return webEnvSchema.parse(env)
}

export function getBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const parsed = bridgeEnvSchema.parse(env)

  return {
    ...parsed,
    JMCP_BRIDGE_DEFAULT_TEST_COMMANDS: parsed.JMCP_BRIDGE_DEFAULT_TEST_COMMANDS.split(";")
      .map((value) => value.trim())
      .filter(Boolean),
  }
}
