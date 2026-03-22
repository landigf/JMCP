# Data Classification

Last reviewed: 2026-03-23

JMCP uses four data classes to reason about retention, logging, and access controls.

- Public: repository docs, public issues, released source code
- Internal: architecture discussions, planning artifacts, non-sensitive operational notes
- Confidential: task output summaries, unpublished repository state, device metadata
- Restricted: credentials, tokens, secret material, signing keys, recovery codes

Restricted data must never appear in public artifacts or routine logs.
