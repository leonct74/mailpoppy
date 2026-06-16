<!-- DRAFT — review before publishing. -->

# Contributing to MailPoppy

Thanks for your interest! MailPoppy is **source-available** (see [`LICENSE`](./LICENSE)) —
open so it can be trusted and improved, while remaining a commercial product. A few notes
so contributing goes smoothly.

## What we're keen to merge

- **Bug fixes** and regressions.
- **Security disclosures** (please follow [`SECURITY.md`](./SECURITY.md) — don't open a
  public issue for vulnerabilities).
- **AWS edge cases** — region quirks, service limits, error handling.
- **IMAP-import compatibility** with specific providers.
- **Docs, translations (i18n), and accessibility** improvements.

## What's likely out of scope

- Large new features — please **open an issue first** to discuss, so you don't build
  something we can't take.
- Anything belonging to the proprietary desktop app or Pro modules (they're not in this repo).

## Before you start

- Open an issue (or comment on one) for anything beyond a small fix, so we can agree on the
  approach before you invest time.
- Keep PRs focused and small where you can; include tests for behaviour changes.

## Developer setup

```bash
npm install
npm test          # run the test suite
npm run typecheck  # or: npx tsc --noEmit, per package
```

(Per-package scripts live in each `package.json`.)

## Contributor License Agreement (CLA)

Because MailPoppy is a commercial, source-available project, we ask all contributors to
agree to a short **[CLA](./CLA.md)** before we can merge. It confirms you have the right to
contribute your code and lets us include it under the project's current and future licenses.
A bot will prompt you on your first PR.

## Code of conduct

By participating you agree to our [Code of Conduct](./CODE_OF_CONDUCT.md).
