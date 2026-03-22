import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"])

const REQUIRED_FILES = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "README.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "docs/design-docs/index.md",
  "docs/design-docs/core-beliefs.md",
  "docs/product-specs/index.md",
  "docs/product-specs/mobile-operator-flow.md",
  "docs/security/threat-model.md",
  "docs/security/credential-boundaries.md",
  "docs/security/crypto-and-kms.md",
  "docs/compliance/data-classification.md",
  "docs/compliance/privacy-baseline.md",
  "docs/compliance/retention-and-deletion.md",
  "docs/compliance/open-source-release-checklist.md",
  "docs/operations/incident-response.md",
  "docs/operations/repo-settings.md",
  "docs/DESIGN.md",
  "docs/FRONTEND.md",
  "docs/PLANS.md",
  "docs/PRODUCT_SENSE.md",
  "docs/QUALITY_SCORE.md",
  "docs/RELIABILITY.md",
] as const

const REQUIRED_ARCHITECTURE_DIRS = [
  "apps/operator-web",
  "services/control-plane",
  "services/local-bridge",
  "packages/contracts",
  "packages/security",
  "packages/config",
  "tooling/repo-guardrails",
] as const

const REQUIRED_FRESHNESS_FILES = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/design-docs/index.md",
  "docs/design-docs/core-beliefs.md",
  "docs/product-specs/index.md",
  "docs/product-specs/mobile-operator-flow.md",
  "docs/security/threat-model.md",
  "docs/security/credential-boundaries.md",
  "docs/security/crypto-and-kms.md",
  "docs/compliance/data-classification.md",
  "docs/compliance/privacy-baseline.md",
  "docs/compliance/retention-and-deletion.md",
  "docs/compliance/open-source-release-checklist.md",
  "docs/operations/incident-response.md",
  "docs/operations/repo-settings.md",
  "docs/DESIGN.md",
  "docs/FRONTEND.md",
  "docs/PLANS.md",
  "docs/PRODUCT_SENSE.md",
  "docs/QUALITY_SCORE.md",
  "docs/RELIABILITY.md",
] as const

const REQUIRED_QUALITY_SECTIONS = [
  "## Current grade",
  "## Review areas",
  "## Expected evolution",
] as const

const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "coverage", "dist", "node_modules"])

const LOCAL_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g
const FRESHNESS_PATTERN = /^Last (updated|reviewed): \d{4}-\d{2}-\d{2}$/m

export async function assertRequiredFiles(repoRoot: string): Promise<void> {
  const missing: string[] = []

  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = path.join(repoRoot, relativePath)

    try {
      await stat(absolutePath)
    } catch {
      missing.push(relativePath)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required files:\n${missing.map((entry) => `- ${entry}`).join("\n")}`)
  }
}

export async function assertArchitectureDirectories(repoRoot: string): Promise<void> {
  const missing: string[] = []

  for (const relativePath of REQUIRED_ARCHITECTURE_DIRS) {
    const absolutePath = path.join(repoRoot, relativePath)

    try {
      const fileStat = await stat(absolutePath)

      if (!fileStat.isDirectory()) {
        missing.push(relativePath)
      }
    } catch {
      missing.push(relativePath)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required architecture directories:\n${missing.map((entry) => `- ${entry}`).join("\n")}`,
    )
  }
}

export async function assertLocalMarkdownLinks(repoRoot: string): Promise<void> {
  const markdownFiles = await collectMarkdownFiles(repoRoot)
  const errors: string[] = []

  for (const filePath of markdownFiles) {
    const content = await readFile(filePath, "utf8")
    const directory = path.dirname(filePath)

    for (const link of extractLocalLinks(content)) {
      const resolvedPath = resolveLocalLink(directory, link)
      const exists = await pathExists(resolvedPath)

      if (!exists) {
        errors.push(`${path.relative(repoRoot, filePath)} -> ${link}`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Broken local markdown links:\n${errors.map((entry) => `- ${entry}`).join("\n")}`,
    )
  }
}

export async function assertFreshnessMarkers(repoRoot: string): Promise<void> {
  const stale: string[] = []

  for (const relativePath of REQUIRED_FRESHNESS_FILES) {
    const absolutePath = path.join(repoRoot, relativePath)
    const content = await readFile(absolutePath, "utf8")

    if (!FRESHNESS_PATTERN.test(content)) {
      stale.push(relativePath)
    }
  }

  if (stale.length > 0) {
    throw new Error(`Missing freshness markers:\n${stale.map((entry) => `- ${entry}`).join("\n")}`)
  }
}

export async function assertQualityStub(repoRoot: string): Promise<void> {
  const qualityScorePath = path.join(repoRoot, "docs/QUALITY_SCORE.md")
  const content = await readFile(qualityScorePath, "utf8")
  const missingSections = REQUIRED_QUALITY_SECTIONS.filter((section) => !content.includes(section))

  if (missingSections.length > 0) {
    throw new Error(
      `Quality score stub is incomplete:\n${missingSections.map((entry) => `- ${entry}`).join("\n")}`,
    )
  }
}

export function extractLocalLinks(markdown: string): string[] {
  const links: string[] = []

  for (const match of markdown.matchAll(LOCAL_LINK_PATTERN)) {
    const rawLink = match[1]?.trim()

    if (!rawLink) {
      continue
    }

    if (
      rawLink.startsWith("#") ||
      rawLink.startsWith("http://") ||
      rawLink.startsWith("https://") ||
      rawLink.startsWith("mailto:")
    ) {
      continue
    }

    links.push(rawLink)
  }

  return links
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const markdownFiles: string[] = []

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue
    }

    const absolutePath = path.join(root, entry.name)

    if (entry.isDirectory()) {
      markdownFiles.push(...(await collectMarkdownFiles(absolutePath)))
      continue
    }

    if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name))) {
      markdownFiles.push(absolutePath)
    }
  }

  return markdownFiles
}

function resolveLocalLink(baseDirectory: string, rawLink: string): string {
  const [filePart] = rawLink.split("#")
  return path.resolve(baseDirectory, filePart)
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath)
    return true
  } catch {
    return false
  }
}
