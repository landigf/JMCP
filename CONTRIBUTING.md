# Contributing to JMCP

Last updated: 2026-03-23

Thanks for contributing. This repository is intentionally structured for agentic development, so the main contribution requirement is not just code quality but repository legibility.

## Ground rules

- Read [AGENTS.md](AGENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [SECURITY.md](SECURITY.md) before proposing substantial changes.
- Use an ExecPlan for any multi-file, multi-hour, or high-risk change. The format lives in [docs/PLANS.md](docs/PLANS.md).
- Keep docs updated in the same pull request when you change architecture, policies, or behavior.
- Do not introduce custom cryptography, ad-hoc credential handling, or internet-facing defaults without updating the security docs first.

## Development workflow

1. Install Node 24 LTS.
2. Run `npm install`.
3. Run `npm run lint`, `npm run test`, `npm run check`, and `npm run docs:check`.
4. Open a pull request using the template in `.github/PULL_REQUEST_TEMPLATE.md`.

## Repository conventions

- Prefer boring, explicit technologies over opaque abstractions.
- Validate data at boundaries before it enters the system.
- Keep audit logs structured and redact secrets.
- Add new top-level directories only if [ARCHITECTURE.md](ARCHITECTURE.md) is updated in the same change.

## Security disclosures

Do not open public issues for suspected vulnerabilities. Follow the process in [SECURITY.md](SECURITY.md).
