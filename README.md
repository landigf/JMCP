# JMCP

Jarvis is My Co-Pilot.

JMCP is a security-first, agent-first scaffold for building a remote software operations copilot. The first version of this repository is intentionally infrastructure and documentation heavy: it establishes the rules, repository shape, and quality gates that future coding agents must follow before product code is added.

## Current scope

This bootstrap does not ship a usable product yet. It provides:

- a public open-source repository with governance and security policies
- a short `AGENTS.md` file for coding agents
- a structured `docs/` knowledge base that acts as the system of record
- a TypeScript-based guardrail package for repository checks
- GitHub workflows for CI, secret scanning, dependency review, CodeQL, and scheduled documentation hygiene

## Planned deployment phases

### Phase 1: Laptop-hosted bridge

The operator uses a phone to connect over a private overlay such as Tailscale to a laptop-hosted `local-bridge`. Secrets stay in the local OS keychain. The laptop remains the execution host.

### Phase 2: Cloud-hosted control plane

The operator uses the same phone interface, but the control plane and workers move to Azure or GCP. Authentication uses OIDC and MFA or passkeys. Secrets move to cloud KMS and secret manager services.

## Repository layout

- `AGENTS.md`: the primary entry point for coding agents
- `ARCHITECTURE.md`: the canonical map of approved top-level boundaries
- `docs/`: versioned product, security, compliance, reliability, and planning knowledge
- `tooling/repo-guardrails/`: repository checks that validate structure, docs, and hygiene

## Local development

The repository is pinned to Node 24 LTS for CI and contributors.

```bash
npm install
npm run lint
npm run test
npm run check
npm run docs:check
```

## Required GitHub settings

Repository settings that should remain enabled:

- branch protection on `main`
- secret scanning and push protection
- dependency graph and dependency alerts
- CodeQL default setup or the checked-in CodeQL workflow
- least-privilege GitHub Actions permissions

The detailed checklist lives in [docs/operations/repo-settings.md](docs/operations/repo-settings.md).
