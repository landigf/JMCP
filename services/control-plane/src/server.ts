import { getControlPlaneConfig } from "@jmcp/config"
import { createControlPlaneRuntime } from "./app.js"
import { TelegramPollingBot } from "./telegram.js"

const config = getControlPlaneConfig()
const runtime = createControlPlaneRuntime(config)
const telegram = new TelegramPollingBot(config, runtime.service)

await runtime.app.listen({
  host: config.JMCP_CONTROL_PLANE_HOST,
  port: config.JMCP_CONTROL_PLANE_PORT,
})

void telegram.start()

console.log(
  `JMCP control-plane listening on http://${config.JMCP_CONTROL_PLANE_HOST}:${config.JMCP_CONTROL_PLANE_PORT}`,
)
