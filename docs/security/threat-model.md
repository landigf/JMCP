# Threat Model

Last reviewed: 2026-03-23

## Scope

The first repository version is a scaffold, but the threat model already matters because unsafe assumptions in docs and tooling will shape future implementation.

## Protected assets

- source code and repository history
- GitHub credentials and automation credentials
- task prompts, execution logs, and audit trails
- future user session state and device trust signals

## Trust model

JMCP currently assumes a single trusted operator. The public repository is open to contributors, but the eventual runtime is not a public multi-tenant service.

## Primary threats

- credential theft from the phone or laptop
- secret leakage through logs, issue comments, commits, or task artifacts
- unsafe remote access paths that expose a laptop-hosted bridge to the public internet
- prompt or tool misuse that causes destructive repository changes
- future cloud misconfiguration around identity, KMS, or secret storage

## Phase 1 controls

- phone access should use a private overlay such as Tailscale
- no public internet exposure for the laptop bridge by default
- secrets remain in the local OS keychain
- logs must redact secrets and sensitive identifiers when possible

## Phase 2 controls

- use OIDC with MFA or passkeys
- prefer short-lived service credentials and GitHub App auth
- keep encryption keys in cloud KMS
- keep secrets in a managed secret manager
- audit authentication, task dispatch, and privileged actions
