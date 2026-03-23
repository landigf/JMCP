import { resolveControlPlaneConfig } from "@jmcp/config"
import { createControlPlaneRuntime } from "./app.js"
import { TelegramPollingBot } from "./telegram.js"

const config = await resolveControlPlaneConfig()
const runtime = createControlPlaneRuntime(config)
const telegram = new TelegramPollingBot(config, runtime.service)

await runtime.app.listen({
  host: config.JMCP_CONTROL_PLANE_HOST,
  port: config.JMCP_CONTROL_PLANE_PORT,
})

void telegram.start()

if (config.JMCP_TELEGRAM_BOT_TOKEN_SOURCE === "keychain") {
  console.log("Telegram bot token loaded from macOS Keychain.")
} else if (config.JMCP_TELEGRAM_BOT_TOKEN_SOURCE === "env") {
  console.log("Telegram bot token loaded from environment.")
} else {
  console.log("Telegram bot disabled: no bot token configured.")
}

if (config.JMCP_XAI_API_KEY_SOURCE === "keychain") {
  console.log("xAI provider secret loaded from macOS Keychain.")
} else if (config.JMCP_XAI_API_KEY_SOURCE === "env") {
  console.log("xAI provider secret loaded from environment.")
}

console.log(
  `JMCP control-plane listening on http://${config.JMCP_CONTROL_PLANE_HOST}:${config.JMCP_CONTROL_PLANE_PORT}`,
)
