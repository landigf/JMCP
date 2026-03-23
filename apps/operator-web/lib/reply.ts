export function parseAssistantReply(text: string): {
  status: string
  whatChanged: string[]
  needsDecision: string[]
  next: string[]
} | null {
  try {
    const parsed = JSON.parse(text)

    if (
      typeof parsed.status === "string" &&
      Array.isArray(parsed.whatChanged) &&
      Array.isArray(parsed.needsDecision) &&
      Array.isArray(parsed.next)
    ) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}
