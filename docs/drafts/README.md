<!-- DRAFT — README for the public, source-available "engine" repo. Review before publishing. -->

# MailPoppy

**Your domain's email, in your own AWS.** MailPoppy gives you professional email on
your own domain, running entirely inside *your* AWS account — you own every message,
there are no per-seat fees, and nothing is locked in.

This repository is the **open, auditable engine** behind MailPoppy. It's public for a
simple reason: the parts that touch your AWS account and your mail should be ones you
can read for yourself.

## Why this is open

MailPoppy's pitch is trust — *we never see your mail, and the app can't run off with
your AWS keys.* Claims like that are only worth anything if you can verify them. So the
code that runs **inside your AWS** and the code that **handles your AWS credentials** is
here, in the open, for anyone to inspect.

## What's in this repo

| Area | What it is |
|---|---|
| `lambdas/` | The mail backend that runs **in your AWS** — inbound processing, the access API, the janitor. This is where your mail lives and is handled. |
| `infra/` | The AWS CDK definition of **exactly** what gets created in your account, plus the **least-privilege IAM policies** (`infra/policies/`). |
| `packages/` | Shared core logic (`core`) and the API client (`api-client`). |
| `apps/desktop/node-sidecar/` | The local **engine** the admin app runs — it reads your AWS credentials and deploys the stack. This is the part that proves *"it can't copy my keys."* |

## What's *not* in this repo

The polished **desktop admin app** (the GUI) and any **Pro/Business** features are
proprietary and distributed separately. MailPoppy is a commercial product; this engine
is source-available so it can be trusted, not so it can be resold (see the license).

## License

Source-available under the **Functional Source License (FSL-1.1-Apache-2.0)** — you may
read, run, modify and build on it for any purpose **except** offering a competing
product or service. Two years after each release, that version automatically becomes
**Apache-2.0**. See [`LICENSE`](./LICENSE).

The **MailPoppy** name and logo are trademarks — see [`TRADEMARK.md`](./TRADEMARK.md).

## Security

Found a vulnerability? Please report it responsibly — see [`SECURITY.md`](./SECURITY.md).
Independent security review is the most valuable contribution you can make to a tool that
asks for your trust.

## Contributing

Issues and pull requests are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Contributions require agreeing to our [CLA](./CLA.md).

## Links

- Website: https://mailpoppy.com
- Webmail: https://mailpoppy.com/app
