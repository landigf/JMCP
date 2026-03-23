# JMCP Architecture Map

Last updated: 2026-03-23

This document defines the approved top-level product boundaries for JMCP. These areas now contain a runnable first slice of the product and are the only places new work should land unless the architecture itself changes.

## System shape

JMCP is a responsive web control surface for a single trusted operator. The near-term execution host is the operator's laptop. The later execution host is a cloud control plane on Azure or GCP. The architecture is split so that the local bridge, cloud services, and shared contracts can evolve independently.

## Approved top-level areas

- `apps/operator-web`
  - Next.js PWA used from a phone or desktop browser.
  - Owns the operator inbox, project chat, TODO capture, compact run views, and push registration.
- `services/control-plane`
  - Fastify service for project state, task intent handling, approvals, notifications, bridge orchestration, and GitHub webhook ingress.
- `services/local-bridge`
  - Outbound-only executor bridge running on the operator laptop during phase 1.
  - Claims queued work, runs a local adapter, and emits structured progress or approval events.
- `packages/contracts`
  - Shared schemas, domain models, bridge protocol types, and API payload contracts.
- `packages/security`
  - Shared auth, signature verification, and log-redaction helpers.
- `packages/config`
  - Shared runtime configuration parsing and defaults.
- `tooling/repo-guardrails`
  - Repository validation, doc checks, and structural enforcement.

## Boundary rules

- Shared types and request or event payload schemas live in `packages/contracts`, not in apps or services.
- Security primitives, credential verification, and redaction helpers live in `packages/security`.
- Configuration parsing and environment validation live in `packages/config`.
- `apps/operator-web` only talks to the control plane over HTTP and SSE. It must not reach into local bridge internals.
- `services/local-bridge` only talks outward to the control plane. It must not expose inbound listener ports for runtime control.
- Product code should depend on shared packages, never on repository scripts.
- Tooling may inspect any file in the repository, but runtime code must not depend on tooling packages.
- New top-level directories require an update to this document and corresponding docs in `docs/`.

## Deployment phases

### Phase 1

The phone talks to `services/control-plane` and a laptop-hosted `services/local-bridge` executes the work. The laptop remains online and holds secrets locally.

### Phase 2

The phone talks to a cloud-hosted `services/control-plane` on Azure or GCP. The control plane uses short-lived identity, cloud secret managers, and KMS-backed encryption.
