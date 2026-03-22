# Security Policy

Last reviewed: 2026-03-23

Security is the first priority for JMCP. This repository currently contains project scaffolding, but the security rules are binding now so future automation does not build on unsafe defaults.

## Supported versions

Only the `main` branch is supported.

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in public issues. Report them privately through GitHub Security Advisories or by contacting the maintainer before public disclosure. Include:

- a short description of the issue
- affected files or flows
- reproduction steps if available
- impact assessment if known

We will acknowledge receipt, investigate, and coordinate remediation before public disclosure whenever possible.

## Non-negotiable rules

- No custom cryptography. Use `WebCrypto`, Node `crypto`, and cloud KMS offerings only.
- No long-lived personal access tokens on phones.
- Future GitHub access should default to GitHub App or other short-lived credentials.
- Secrets stay in the OS keychain for local development and in a cloud secret manager for hosted environments.
- External inputs must be validated before use.
- Audit logs must never contain secret values.

## System of record

Security design and controls live in:

- [docs/security/threat-model.md](docs/security/threat-model.md)
- [docs/security/credential-boundaries.md](docs/security/credential-boundaries.md)
- [docs/security/crypto-and-kms.md](docs/security/crypto-and-kms.md)
- [docs/compliance/privacy-baseline.md](docs/compliance/privacy-baseline.md)
