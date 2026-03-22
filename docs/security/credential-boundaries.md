# Credential Boundaries

Last reviewed: 2026-03-23

## Rules

- Do not store long-lived personal access tokens on the phone.
- Prefer GitHub App flows or other short-lived credentials for repository operations.
- Store local secrets in the OS keychain during phase 1.
- Store hosted secrets in a cloud secret manager during phase 2.
- Redact secrets from logs, traces, screenshots, and generated summaries.

## Boundary intent

The phone should be a control surface, not the root secret store. If the phone is lost, the expected response should be session revocation and device trust rotation, not total repository compromise.
