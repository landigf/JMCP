import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const SECRET_PATTERNS = [
  /(gh[pousr]_[A-Za-z0-9_]+)/g,
  /(sk-[A-Za-z0-9]+)/g,
  /(xox[baprs]-[A-Za-z0-9-]+)/g,
  /([A-Za-z0-9+/]{32,}={0,2})/g,
] as const

export function generateBridgeToken(): string {
  return randomBytes(24).toString("hex")
}

export function verifySharedToken(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)

  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export function verifyGitHubWebhookSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false
  }

  const digest = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`
  return verifySharedToken(digest, signatureHeader)
}

export function redactSecrets(input: string): string {
  return SECRET_PATTERNS.reduce((accumulator, pattern) => {
    return accumulator.replace(pattern, "[REDACTED]")
  }, input)
}
