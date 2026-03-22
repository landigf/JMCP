# Mobile Operator Flow

Last reviewed: 2026-03-23

## Purpose

JMCP exists to let a single trusted operator steer coding agents from a phone, not just from a laptop. The operator should be able to inspect project state, dispatch work, review concise results, and keep long-running agent loops productive while away from the keyboard.

## Phase 1

The phone connects to a laptop-hosted `local-bridge` over a private overlay network. The laptop remains online and performs the actual work. The phone experience is a responsive web app rather than a native mobile app.

## Phase 2

The same operator flow moves to a cloud-hosted control plane on Azure or GCP. The cloud phase keeps the same security expectations but replaces laptop-held execution with hosted services, KMS-backed secrets, and short-lived identity.

## V1 scope boundary

The current repository bootstrap does not implement this flow. It only defines the constraints the eventual implementation must respect.
