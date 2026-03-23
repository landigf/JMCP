"use client"

import { useState } from "react"
import { registerPushSubscription } from "../lib/api"

const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY

export function PushSetup() {
  const [status, setStatus] = useState("Web push is optional.")

  async function enablePush() {
    if (!publicKey) {
      setStatus("Push is not configured on this deployment yet.")
      return
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("This browser does not support web push.")
      return
    }

    const registration = await navigator.serviceWorker.register("/sw.js")
    const permission = await Notification.requestPermission()

    if (permission !== "granted") {
      setStatus("Notifications were not granted.")
      return
    }

    const subscription = await registration.pushManager.subscribe({
      applicationServerKey: base64ToUint8Array(publicKey) as BufferSource,
      userVisibleOnly: true,
    })

    await registerPushSubscription(subscription)
    setStatus("Web push enabled for this device.")
  }

  return (
    <div className="panel stack-tight">
      <h2>Phone alerts</h2>
      <p className="muted">
        Use in-app inbox by default. Turn on push if this deployment has VAPID keys.
      </p>
      <button
        className="button button-secondary"
        onClick={() => {
          void enablePush()
        }}
        type="button"
      >
        Enable web push
      </button>
      <p className="muted">{status}</p>
    </div>
  )
}

function base64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/")
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
