# JMCP

Jarvis is My Co-Pilot.

JMCP is a private, mobile-first control plane for steering coding work across multiple GitHub repositories while the actual execution stays on your laptop. The current implementation is built around:

- a Next.js PWA for phone-sized steering
- a Fastify control plane with durable SQLite state
- a laptop-hosted bridge that can invoke Claude Code, manage git worktrees, run validations, publish PRs, and arm auto-merge behind protected-branch gates
- Telegram long-polling for fast commands and notifications
- local voice-note ingestion with optional local transcription commands

## What Works Now

- Per-project chat, TODO capture, immediate one-tap TODO execution, and overnight queueing
- Durable project, run, recap, approval, notification, and artifact state in SQLite
- A real bridge runtime that can:
  - cache repos locally
  - create per-run worktrees
  - call `claude` in non-interactive mode
  - validate changes
  - retry failed validations
  - push a branch
  - open a PR with `gh`
  - arm auto-merge when the repo actually has protected-green rules
- Telegram long polling for `/projects`, `/status`, `/run`, `/todo`, `/pause`, `/resume`, `/nightly`, and `/inbox`
- PWA voice lane for audio upload or transcript-first voice notes

## Security Model

- The phone is a control surface, not a secret store.
- Repo credentials stay on the laptop.
- Telegram is optional and must use a **rotated** bot token if any previous token was exposed.
- No public inbound port is required for v1 if you use Tailscale for the PWA and Telegram polling for bot ingress.
- Auto-merge is only attempted when JMCP detects a protected default branch with required checks.

## Runtime Layout

- `apps/operator-web`: phone-first PWA
- `services/control-plane`: SQLite-backed control plane, notifications, Telegram polling, voice ingest
- `services/local-bridge`: Claude/GitHub execution host
- `packages/contracts`, `packages/config`, `packages/security`: shared runtime boundaries

## Local Development

The repository is pinned to Node 24 LTS for CI and contributors.

```bash
npm install
npm run lint
npm run test
npm run check
npm run docs:check
```

### Start JMCP

1. Populate env from `.env.example`
2. Start the control plane:

```bash
npm run dev:control-plane
```

3. Start the bridge:

```bash
npm run dev:bridge
```

4. Start the web app:

```bash
npm run dev:web
```

5. Open `http://localhost:3000`

## Required Host Setup

- `claude` must be installed locally and authenticated with your Claude Max account.
- `gh` must be installed and authenticated for the repos JMCP should touch.
- For private phone access, expose the control plane over Tailscale instead of a public tunnel.
- If you want voice transcription, set `JMCP_VOICE_TRANSCRIBE_COMMAND` so it prints a transcript to stdout using the file path from `JMCP_VOICE_INPUT_PATH`.

## Practical Caveats

- Overnight execution only works if the laptop stays powered, awake, online, and authenticated.
- The bridge currently uses your local `gh` authentication as the practical v1 path. GitHub App credentials remain the preferred hardening path and can be layered in next.
- Telegram voice notes are stored immediately, but fully automatic voice execution still depends on a configured local transcription command.
