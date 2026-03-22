import path from "node:path"
import {
  assertArchitectureDirectories,
  assertFreshnessMarkers,
  assertLocalMarkdownLinks,
  assertQualityStub,
  assertRequiredFiles,
} from "./checks.js"

const repoRoot = path.resolve(import.meta.dirname, "../../..")
const command = process.argv[2]

async function main(): Promise<void> {
  switch (command) {
    case "docs": {
      await assertRequiredFiles(repoRoot)
      await assertLocalMarkdownLinks(repoRoot)
      console.log("docs check passed")
      return
    }

    case "structure": {
      await assertArchitectureDirectories(repoRoot)
      console.log("structure check passed")
      return
    }

    case "freshness": {
      await assertFreshnessMarkers(repoRoot)
      console.log("freshness check passed")
      return
    }

    case "quality-stub": {
      await assertQualityStub(repoRoot)
      console.log("quality stub check passed")
      return
    }

    default: {
      throw new Error(`Unknown command: ${command ?? "<missing>"}`)
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
