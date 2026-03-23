import type { ControlPlaneConfig } from "@jmcp/config"
import { type ProviderConfig, providerConfigSchema } from "@jmcp/contracts"

export interface TextProvider {
  readonly name: "xai_grok"
  readonly model: string
  readonly enabled: boolean
  complete(input: { system?: string; prompt: string }): Promise<string>
}

export class XaiGrokProvider implements TextProvider {
  readonly name = "xai_grok" as const
  readonly model: string
  readonly enabled: boolean
  readonly #config: ControlPlaneConfig

  constructor(config: ControlPlaneConfig) {
    this.#config = config
    this.model = config.JMCP_XAI_MODEL
    this.enabled = Boolean(config.JMCP_XAI_API_KEY)
  }

  async complete(input: { system?: string; prompt: string }): Promise<string> {
    if (!this.enabled || !this.#config.JMCP_XAI_API_KEY) {
      throw new Error("xAI provider is disabled until a rotated JMCP_XAI_API_KEY is configured.")
    }

    const response = await fetch(`${this.#config.JMCP_XAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#config.JMCP_XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          input.system
            ? {
                role: "system",
                content: [{ type: "input_text", text: input.system }],
              }
            : null,
          {
            role: "user",
            content: [{ type: "input_text", text: input.prompt }],
          },
        ].filter(Boolean),
      }),
    })

    if (!response.ok) {
      throw new Error(`xAI provider failed with ${response.status}`)
    }

    const payload = (await response.json()) as {
      output_text?: string
    }

    return payload.output_text ?? ""
  }
}

export function getProviderConfig(config: ControlPlaneConfig): ProviderConfig {
  return providerConfigSchema.parse({
    defaultTextProvider: config.JMCP_XAI_API_KEY ? "xai_grok" : "disabled",
    xaiEnabled: Boolean(config.JMCP_XAI_API_KEY),
    xaiModel: config.JMCP_XAI_API_KEY ? config.JMCP_XAI_MODEL : null,
  })
}
