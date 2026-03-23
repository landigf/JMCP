"use client"

import { useState } from "react"

export function ShareCopyButton(props: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.value)
    } else {
      const input = document.createElement("input")
      input.value = props.value
      document.body.append(input)
      input.select()
      document.execCommand("copy")
      input.remove()
    }

    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
    }, 1200)
  }

  return (
    <button
      className="button button-secondary button-small"
      onClick={() => void handleCopy()}
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  )
}
