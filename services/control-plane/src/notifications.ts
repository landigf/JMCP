import type { ControlPlaneConfig } from "@jmcp/config"
import type { Notification, WorkspaceSnapshot } from "@jmcp/contracts"
import webpush from "web-push"
import type { NotificationDispatcher } from "./types.js"

function shouldEnableWebPush(config: ControlPlaneConfig): boolean {
  return Boolean(config.JMCP_WEB_PUSH_PUBLIC_KEY && config.JMCP_WEB_PUSH_PRIVATE_KEY)
}

export class CompositeNotificationDispatcher implements NotificationDispatcher {
  readonly #config: ControlPlaneConfig

  constructor(config: ControlPlaneConfig) {
    this.#config = config

    if (shouldEnableWebPush(config)) {
      const publicKey = config.JMCP_WEB_PUSH_PUBLIC_KEY
      const privateKey = config.JMCP_WEB_PUSH_PRIVATE_KEY

      if (!publicKey || !privateKey) {
        return
      }

      webpush.setVapidDetails(config.JMCP_WEB_PUSH_SUBJECT, publicKey, privateKey)
    }
  }

  async deliver(notification: Notification, snapshot: WorkspaceSnapshot): Promise<void> {
    await Promise.all([
      this.#deliverWebPush(notification, snapshot),
      this.#deliverTelegram(notification),
    ])
  }

  async #deliverWebPush(notification: Notification, snapshot: WorkspaceSnapshot): Promise<void> {
    if (!shouldEnableWebPush(this.#config) || snapshot.pushSubscriptions.length === 0) {
      return
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      href: notification.href,
    })

    await Promise.allSettled(
      snapshot.pushSubscriptions.map((subscription) =>
        webpush.sendNotification(subscription, payload),
      ),
    )
  }

  async #deliverTelegram(notification: Notification): Promise<void> {
    const token = this.#config.JMCP_TELEGRAM_BOT_TOKEN
    const chatId = this.#config.JMCP_TELEGRAM_CHAT_ID

    if (!token || !chatId) {
      return
    }

    const inline_keyboard = buildTelegramKeyboard(notification, this.#config)

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${notification.title}\n${notification.body}`,
        disable_web_page_preview: true,
        reply_markup: inline_keyboard
          ? {
              inline_keyboard,
            }
          : undefined,
      }),
    }).catch(() => undefined)
  }
}

function buildTelegramKeyboard(
  notification: Notification,
  config: ControlPlaneConfig,
): Array<Array<{ text: string; callback_data?: string; url?: string }>> | null {
  const href = notification.href
  const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> = []

  if (notification.type === "approval_requested" && href) {
    const parsed = href.match(/\/projects\/([^#]+)#run-(.+)$/)
    if (parsed) {
      rows.push([
        {
          text: "Approve",
          callback_data: `run_approve:${parsed[1]}:${parsed[2]}`,
        },
      ])
    }
  }

  if (notification.type === "task_blocked" && href) {
    const parsed = href.match(/\/projects\/([^#]+)#run-(.+)$/)
    if (parsed) {
      rows.push([
        {
          text: "Retry",
          callback_data: `run_retry:${parsed[1]}:${parsed[2]}`,
        },
      ])
    }
  }

  if (href && config.JMCP_PUBLIC_WEB_URL) {
    rows.push([
      {
        text: "Open JMCP",
        url: `${config.JMCP_PUBLIC_WEB_URL.replace(/\/$/, "")}${href}`,
      },
    ])
  }

  return rows.length > 0 ? rows : null
}
