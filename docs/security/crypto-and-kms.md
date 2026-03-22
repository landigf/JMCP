# Crypto and KMS

Last reviewed: 2026-03-23

## Rules

- Do not invent cryptographic algorithms or protocols.
- Use WebCrypto in browser contexts and Node `crypto` in server contexts.
- Use managed KMS for envelope encryption in hosted environments.
- Separate encryption keys from application data and logs.
- Rotate credentials and keys through platform facilities, not ad-hoc scripts.

## Design direction

Phase 1 stays simple: local secrets in the OS keychain and transport secured by the private overlay. Phase 2 moves sensitive material into cloud KMS and secret management services, keeping the repository provider neutral between Azure and GCP.
