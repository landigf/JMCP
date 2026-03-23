import { headers } from "next/headers"

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

export async function getResolvedPublicWebBaseUrl(): Promise<string | null> {
  const requestedHostHeaders = await headers()
  const host = requestedHostHeaders.get("x-forwarded-host") ?? requestedHostHeaders.get("host")
  const protocol = requestedHostHeaders.get("x-forwarded-proto") ?? "https"
  const inferred = host ? normalizeBaseUrl(`${protocol}://${host}`) : null
  const configured = getPublicWebBaseUrl()

  if (!configured) {
    return inferred
  }

  if (
    inferred &&
    configured.includes(".ts.net") &&
    inferred.includes(".ts.net") &&
    configured !== inferred
  ) {
    return inferred
  }

  return configured
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

export function buildWorkspaceShareUrl(base: string | null): string | null {
  return base ? `${base}/` : null
}

export function buildProjectShareUrl(base: string | null, projectId: string): string | null {
  return base ? `${base}/projects/${projectId}` : null
}
