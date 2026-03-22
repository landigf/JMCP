# JMCP Architecture Map

Last updated: 2026-03-23

This document defines the only approved top-level product boundaries for the repository bootstrap. These directories exist now as placeholders so future agents work inside a predictable map instead of inventing new structure.

## System shape

JMCP is planned as a responsive web control surface for a single trusted operator. The near-term execution host is the operator's laptop. The later execution host is a cloud control plane on Azure or GCP. The architecture is split so that the local bridge, cloud services, and shared contracts can evolve independently.

## Approved top-level areas

- `apps/operator-web`
  - Future responsive web UI used from a phone or desktop browser.
- `services/control-plane`
  - Future cloud-hosted orchestration and policy service.
- `services/local-bridge`
  - Future local service running on the operator laptop during phase 1.
- `packages/contracts`
  - Shared schemas, API contracts, and message types.
- `packages/security`
  - Shared auth, validation, and audit helpers.
- `packages/config`
  - Shared configuration parsing and environment schemas.
- `tooling/repo-guardrails`
  - Repository validation, doc checks, and structural enforcement.

## Boundary rules

- Shared types live in `packages/contracts`, not in apps or services.
- Security primitives, credential policies, and logging redaction helpers live in `packages/security`.
- Configuration parsing and environment validation live in `packages/config`.
- Product code should depend on shared packages, never on repository scripts.
- Tooling may inspect any file in the repository, but runtime code must not depend on tooling packages.
- New top-level directories require an update to this document and corresponding docs in `docs/`.

## Deployment phases

### Phase 1

The phone talks to `services/local-bridge` over a private overlay. The laptop remains online and holds secrets locally.

### Phase 2

The phone talks to `services/control-plane` on Azure or GCP. The control plane uses short-lived identity, cloud secret managers, and KMS-backed encryption.
