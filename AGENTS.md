# JMCP Agent Guide

Last updated: 2026-03-23

This file is a map, not an encyclopedia. If you need deeper context, follow the linked documents and keep the repository as the source of truth.

## What this repository is

JMCP is a mobile-first control plane for steering coding agents across GitHub projects. This repository contains a runnable first product slice as well as the governance, security policy, repository structure, and mechanical quality checks around it.

## Before making changes

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) for approved top-level boundaries.
2. Read [SECURITY.md](SECURITY.md) and the files under [docs/security/](docs/security/) before touching auth, secrets, logs, or deployment logic.
3. If the change spans multiple files, multiple subsystems, or more than a short session, create or update an ExecPlan using [docs/PLANS.md](docs/PLANS.md).
4. Keep documentation updated in the same change when behavior, policy, or boundaries change.

## Non-negotiable rules

- Do not add custom cryptography. Use platform cryptography only.
- Do not store long-lived personal access tokens on phones.
- Prefer GitHub App or other short-lived credentials over PATs.
- Treat `docs/` as the system of record for product, security, and operational knowledge.
- Validate all external data at the system boundary.
- Keep audit trails append-oriented and never log secrets.
- Do not create new top-level architecture areas without updating [ARCHITECTURE.md](ARCHITECTURE.md).

## Validation commands

- Install: `npm install`
- Lint: `npm run lint`
- Test: `npm run test`
- Full repository checks: `npm run check`
- Docs validation only: `npm run docs:check`
- Control plane dev server: `npm run dev:control-plane`
- Local bridge: `npm run dev:bridge`
- Web app: `npm run dev:web`

## Where to look next

- Design and core beliefs: [docs/design-docs/index.md](docs/design-docs/index.md)
- Product intent: [docs/product-specs/index.md](docs/product-specs/index.md)
- Security and privacy: [docs/security/threat-model.md](docs/security/threat-model.md)
- Compliance baseline: [docs/compliance/privacy-baseline.md](docs/compliance/privacy-baseline.md)
- Reliability expectations: [docs/RELIABILITY.md](docs/RELIABILITY.md)
- Quality baseline: [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
