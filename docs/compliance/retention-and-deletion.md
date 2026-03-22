# Retention and Deletion

Last reviewed: 2026-03-23

Retention rules for the future runtime must be explicit before data-bearing features ship.

## Baseline

- keep secrets only as long as the underlying secret manager requires
- keep audit logs append-oriented and redact secrets
- set default retention windows for screenshots, traces, and task transcripts before those artifacts are stored
- provide a documented revocation path for compromised devices and sessions

This repository version defines the policy direction only. It does not yet store runtime user data.
