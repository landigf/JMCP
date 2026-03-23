function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  return trimmed.replace(/\/$/, "")
}

export function getPublicWebBaseUrl(): string | null {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_JMCP_PUBLIC_WEB_URL)
}

function getHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function getShareMode(value: string | null): "tailscale" | "lan" | "custom" | "unknown" {
  if (!value) {
    return "unknown"
  }

  const hostname = getHostname(value)

  if (!hostname) {
    return "custom"
  }

  if (hostname.endsWith(".ts.net") || hostname.endsWith(".beta.tailscale.net")) {
    return "tailscale"
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  ) {
    return "lan"
  }

  return "custom"
}

export function getWorkspaceShareUrl(): string | null {
  const base = getPublicWebBaseUrl()
  return base ? `${base}/` : null
}

export function getProjectShareUrl(projectId: string): string | null {
  const base = getPublicWebBaseUrl()
  return base ? `${base}/projects/${projectId}` : null
}
