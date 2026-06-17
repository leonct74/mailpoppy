# Brief for the parallel website session

> You are a second Claude Code session working **only on the MailPoppy marketing website**,
> in parallel with another session that is building mailbox encryption. Read this first, then
> read `docs/master-plan.md` (strategy) and skim `docs/onboarding-two-personas.md` +
> `docs/OPEN-vs-CLOSED.md` (voice + trust posture). Everything you need is in the repo — you
> don't need the other session's chat history.

## Your scope (and the hard boundary)

Work **only on the marketing site** under `apps/web/src/app/**` and the marketing copy/components
it uses. The other session owns the webmail client and will be editing `apps/web` too, so to
avoid collisions, **do NOT touch**:

- `apps/web/src/components/webmail/**` (except you may *use* `Logo` and `icons` — don't modify them)
- `apps/web/src/lib/mailClient.ts`, `apps/web/src/lib/mailpoppy/**`, `apps/web/src/lib/hub/**`
- `apps/web/package.json` / `package-lock.json` (the other session adds a crypto dependency here)
- anything outside `apps/web` (packages, lambdas, infra, apps/desktop, apps/mobile)

If you think you need to touch one of those, stop and leave a note instead.

## Git rules (so `main` stays safe)

- You are on branch **`web/launch-kit`** in a git worktree. **Commit only on this branch.**
- **Do NOT switch to, merge, rebase, or push `main`.** Do not `git pull`. The encryption-session
  owner merges `web/launch-kit` into `main` later; if you push, push only `web/launch-kit`.
- End commit messages with the Claude co-author trailer.
- Before committing site changes, `cd apps/web && npm run build` must pass (it's Next.js — build
  also typechecks). Run `npm install` once first (worktrees don't copy `node_modules`).

## What MailPoppy is (so the copy is accurate)

A desktop app that deploys a complete email service into the **user's own AWS account** — they own
the data, no vendor sits in the path, pay AWS at cost (no per-seat fee), and the engine is
open-source/verifiable. Lead go-to-market wedge: **Amazon WorkMail is shutting down (no new
customers since 2026-04-30, full shutdown 2027-03-31)** — MailPoppy is the "email in AWS, but
*owned*" landing spot. See `docs/master-plan.md` for the full positioning.

## Voice
Honest, confident, plain. "Email you own, in your own AWS." Sentence case in UI labels. Lead with
ownership + privacy + the WorkMail wedge. The existing homepage (`apps/web/src/app/page.tsx`) and
`/workmail-alternative` set the tone — match them.

## Honesty guardrails (do NOT overclaim — these are load-bearing)

1. **"We can't read your mail" = the *vendor* (MailPoppy) can't.** Mailbox encryption that would
   stop the *AWS account admin* from reading mail is **in progress, not shipped**. Do **not** write
   or imply that an admin/employer can't read mailboxes yet. Scope every privacy claim to the vendor.
2. **No calendar or contacts** today; **Outlook/IMAP third-party-client support is on the roadmap,
   not available.** Don't claim them.
3. **Don't advertise the mobile app as downloadable** — it isn't live yet. "Coming to iPhone &
   Android" is fine; a download link/CTA is not.

## Open launch-kit work (in priority order)

1. **Creator setup guide page** — e.g. a new route `apps/web/src/app/setup/` (or `/guide`). Purpose:
   a canonical, *safe* reference so content creators making MailPoppy tutorials stay on the
   least-privilege rails (this is a deliberate marketing strategy — see master-plan §4). Walk
   through the desktop "connect AWS → deploy → add mailbox" flow in plain language, emphasising:
   create a **dedicated, scoped IAM user — never root/admin keys**, and link the two policy files.
   Match the site's `Section`/`SectionHeading` patterns; add the route to `src/app/sitemap.ts`.
2. **Pricing — leave it as-is.** The homepage Pricing section currently says "coming soon / pay AWS
   at cost." **Do NOT** build a paid free-vs-paid matrix: the paid mobile app + AI Assistant tier
   aren't purchasable yet (no release, no checkout) — publishing prices for them would advertise a
   product that can't be bought. Revisit only when mobile + checkout exist (the Agents 2.0 wave).
3. **Homepage polish (light touch only).** The homepage is already strong — small copy tightening
   is welcome; do not rewrite or restructure it.
4. **SEO upkeep.** Any new page: give it `metadata` (title/description/keywords/canonical), and if it
   has an FAQ, keep the **visible accordion and the FAQPage JSON-LD sourced from one array** (see how
   `/workmail-alternative` and the homepage do it). Add new routes to `src/app/sitemap.ts`.

## Design system quick reference
- Crimson-Navy dark theme via CSS vars in `apps/web/src/app/globals.css` (`--color-primary` #ff5637,
  `--color-bg` #051424, `--color-heading`, `--color-muted`, `--color-text`, `border-hairline`,
  `bg-surface`, `bg-surface-container`). Tailwind utility classes map to these (`text-primary`,
  `text-heading`, `text-muted`, `bg-surface`, etc.).
- Reuse `Logo` and the icon set from `apps/web/src/components/webmail/`.
- Copy the `Section` / `SectionHeading` layout helpers' pattern from `page.tsx` (or factor a shared
  one — your call, but keep it in the marketing layer).

## Definition of done for each change
Builds clean (`npm run build` in `apps/web`), accurate to the honesty guardrails, on-brand, new
routes in the sitemap, committed on `web/launch-kit` only.
