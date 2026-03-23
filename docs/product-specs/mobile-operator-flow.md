# Mobile Operator Flow

Last reviewed: 2026-03-23

## Purpose

JMCP exists to let a single trusted operator steer coding agents from a phone, not just from a laptop. The operator should be able to inspect project state, dispatch work, review concise results, and keep long-running agent loops productive while away from the keyboard.

## Phase 1

The phone connects to a control plane while a laptop-hosted `local-bridge` performs the actual work. The laptop remains online and the phone experience is a responsive web app rather than a native mobile app.

## Phase 2

The same operator flow moves to a cloud-hosted control plane on Azure or GCP. The cloud phase keeps the same security expectations but replaces laptop-held execution with hosted services, KMS-backed secrets, and short-lived identity.

## V1 scope boundary

The current repository implements a first usable slice of this flow:

- per-project chat with task intent classification
- TODO capture and overnight queue markers
- run tracking, approvals, notifications, and recap cards
- an outbound local bridge that can claim queued work and report progress

This version does not yet implement live duplex voice, real coding-agent execution, or inbound Slack, Discord, Gmail, or Telegram connectors.
