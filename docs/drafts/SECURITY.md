<!-- DRAFT — confirm the contact address (create the security@ alias) before publishing. -->

# Security Policy

MailPoppy is built around a single promise: your email and your AWS credentials stay
yours. We take security reports seriously and welcome responsible disclosure.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **security@mailpoppy.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- the affected component/version.

We'll acknowledge your report within **3 business days**, keep you updated as we
investigate, and let you know when a fix ships. We're happy to credit you for the
disclosure unless you'd prefer to remain anonymous.

Please give us a reasonable window to fix the issue before any public disclosure.

## Scope

In scope: the code in this repository — the mail backend (`lambdas/`), the infrastructure
definition (`infra/`), the shared packages, and the desktop **sidecar** engine
(`apps/desktop/node-sidecar/`).

Out of scope here: third-party services (AWS itself, etc.) and the proprietary desktop UI
(report those to security@mailpoppy.com as well, but they're not in this repo).

## What we especially want eyes on

- The handling of AWS credentials in the sidecar (`apps/desktop/node-sidecar/src/awsProfile.ts`).
- The least-privilege IAM policies in `infra/policies/`.
- Anything in the mail path that could leak data outside the user's own AWS account.
