# Mailpoppy

Host email for your own domains **inside your own AWS account** — set up in minutes, with a
built-in desktop (later mobile) mail client. Pay once per domain, unlimited mailboxes, no
per-seat subscription, no lock-in.

> **Docs:** [`DESIGN.md`](./DESIGN.md) (source of truth) · [`CLAUDE.md`](./CLAUDE.md)
> (build guide) · [`phase0-derisk.md`](./phase0-derisk.md) (proven AWS sequence + PASS result).

## Runs on AgentsPoppy

MailPoppy is a **poppy** — an app whose backend lives in **your own AWS account**, installed and
supervised by [AgentsPoppy](https://agentspoppy-web--agentspoppy.europe-west4.hosted.app), the
local-first permission broker. The desktop app ships through AgentsPoppy's curated directory:
one click installs it, and every update arrives explained, diffable, and verifiable before you
choose to apply it. **AgentsPoppy launches publicly in the coming days** — this repository opens
first, so anyone (or anyone's AI agent) can read exactly what MailPoppy does before installing it.

## Monorepo (npm workspaces)

```
packages/core         shared types/models/validation/MIME + mailbox logic
packages/api-client   Cognito-JWT calls to the access API (shared desktop+mobile)
apps/desktop          Tauri + React frontend (the setup wizard + mailbox)
apps/desktop/node-sidecar   Node provisioning engine (AWS SDK v3) — desktop-admin-only
infra                 AWS CDK (TS) → CloudFormation template for the deployable backend
lambdas               TS Lambdas: inbound processor, access API, janitor, suppression
```

## Quickstart

```bash
npm install                                   # wire workspaces
npm run dev -w @mailpoppy/desktop-sidecar     # start the provisioning sidecar (:8787)
npm run dev -w @mailpoppy/desktop             # start the React frontend (:1420)
```

To wrap the desktop frontend as a native **Tauri v2** app, see `apps/desktop/README.md`
(Rust toolchain is present).

## Status

- ✅ Phase 0 de-risk **PASSED** (deliverability proven live).
- ⏭️ **Phase 1 (setup wizard)** in progress — this scaffold. The wizard automates the
  validated sequence in `phase0-derisk.md` (now translated to TS in
  `apps/desktop/node-sidecar/src/provisioning.ts`).

## License

MailPoppy is licensed under the [MIT License](./LICENSE) — read it, run it, build on it, ship it
however you like. MailPoppy is a *poppy*: permissively licensed to grow the AgentsPoppy ecosystem.
(Only the AgentsPoppy host it runs on is source-available under a non-compete license.) The
MailPoppy name and brand are not licensed with the code.
