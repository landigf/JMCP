import Image from "next/image"
import QRCode from "qrcode"
import { getProjectShareUrl, getShareMode, getWorkspaceShareUrl } from "../lib/share"
import { ShareCopyButton } from "./share-copy-button"

type ShareEntry = {
  label: string
  url: string
  qrDataUrl: string
}

async function buildShareEntry(label: string, url: string): Promise<ShareEntry> {
  return {
    label,
    url,
    qrDataUrl: await QRCode.toDataURL(url, {
      margin: 1,
      width: 220,
      color: {
        dark: "#EEF4FF",
        light: "#0000",
      },
    }),
  }
}

export async function SharePanel(props: { projectId?: string; projectName?: string }) {
  const workspaceUrl = getWorkspaceShareUrl()
  const projectUrl = props.projectId ? getProjectShareUrl(props.projectId) : null
  const shareMode = getShareMode(workspaceUrl)

  if (!workspaceUrl) {
    return (
      <div className="panel stack-tight">
        <div className="lane-header">
          <h2>Open on iPhone</h2>
          <span>Pending URL</span>
        </div>
        <p className="muted">
          Set <code>NEXT_PUBLIC_JMCP_PUBLIC_WEB_URL</code> to your private Tailscale Jarvis URL to
          unlock direct links and QR codes for your phone.
        </p>
      </div>
    )
  }

  const entries = await Promise.all(
    [
      buildShareEntry("Workspace", workspaceUrl),
      projectUrl && props.projectName
        ? buildShareEntry(`${props.projectName} project`, projectUrl)
        : null,
    ].filter(Boolean) as Promise<ShareEntry>[],
  )

  return (
    <div className="panel stack-tight">
      <div className="lane-header">
        <h2>Open on iPhone</h2>
        <span>{entries.length} links</span>
      </div>
      {shareMode === "tailscale" ? (
        <p className="muted">
          Scan the QR code from your iPhone camera or copy the private Tailscale URL directly.
        </p>
      ) : (
        <div className="share-mode-banner">
          <strong>{shareMode === "lan" ? "LAN fallback active" : "Custom share URL active"}</strong>
          <p className="muted">
            These links work as-is, but they are not yet on a private Tailscale hostname. Finish
            Tailscale login and point <code>NEXT_PUBLIC_JMCP_PUBLIC_WEB_URL</code> at the tailnet
            address when you want a stable private Jarvis path outside the local network.
          </p>
        </div>
      )}
      <div className="share-grid">
        {entries.map((entry) => (
          <div className="share-card" key={entry.label}>
            <div className="stack-tight">
              <strong>{entry.label}</strong>
              <div className="share-actions">
                <input className="input share-input" readOnly value={entry.url} />
                <ShareCopyButton value={entry.url} />
              </div>
              <a className="inline-link" href={entry.url} rel="noreferrer" target="_blank">
                Open link
              </a>
            </div>
            <div className="share-qr">
              <Image
                alt={`${entry.label} QR code`}
                height={220}
                src={entry.qrDataUrl}
                unoptimized
                width={220}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
