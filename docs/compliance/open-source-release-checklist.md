# Open Source Release Checklist

Last reviewed: 2026-03-23

Before shipping a new public capability, verify:

- no secrets or private endpoints are committed
- `npm run lint`, `npm run test`, `npm run check`, and `npm run docs:check` succeed
- security-sensitive changes update [SECURITY.md](../../SECURITY.md) or the files in [../security/](../security/)
- new top-level boundaries update [../../ARCHITECTURE.md](../../ARCHITECTURE.md)
- contributor-facing docs stay aligned with the real repository behavior
