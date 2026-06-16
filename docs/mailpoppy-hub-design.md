# MailPoppy Hub — design (accounts + subscription + domain directory)

*Design for review — created 2026-06-14. **Not yet built.** Keep private (account/billing plane).*

The Hub is the **account/billing plane** the open-source strategy anticipated
([[OPEN-vs-CLOSED]] "Monetisation & enforcement"). One small MailPoppy-operated service does
three jobs, and a single lookup at login delivers **both** multi-tenancy *and* subscription
enforcement:

1. **Accounts** — a MailPoppy login per customer (the admin who deploys a backend).
2. **Subscriptions** — Stripe; each account is active or not.
3. **Directory** — for each customer domain, the *public* connection details of their backend.

> Why this unblocks mobile: today the clients hard-code one backend (`config.ts`). A published
> app can only serve that one deployment, and there's no way to gate on payment. The Hub fixes
> both: the client resolves the backend from the user's email domain, and only gets it while the
> owning account is subscribed.

---

## 1. Where it lives

Extend **mailpoppy.com** (the existing Next.js app on Firebase App Hosting):
- **Firestore** — data (accounts, domains).
- **Firebase Auth** — MailPoppy accounts (admins). *Distinct* from the mailbox-plane Cognito in
  each customer's AWS — do not conflate (three identities, per the strategy).
- **Stripe** — subscriptions (Checkout + Customer Portal + webhook).
- **Next.js Route Handlers** under `src/app/api/` — the endpoints below.

No new infrastructure; matches the strategy ("reuse Firebase Auth + Stripe"); Firebase+Stripe is
proven ground (ScrutiBank).

---

## 2. What the Hub does and does NOT see

- **Sees:** account email, Stripe customer/subscription status, and per-domain *public* config
  (region, Cognito user-pool id, app-client id, API Gateway URL). `config.ts` already documents
  these as non-secret.
- **Never sees:** mailbox contents, AWS credentials, or user passwords. Sign-in is still SRP →
  Cognito **in the customer's own AWS**; the Hub is only consulted to *find* that Cognito and to
  confirm the subscription.
- **Privacy nuance to own:** the client must send the **email domain** to the Hub at login (to
  find the backend). Send **domain only, never the full address or password** — so the Hub learns
  "someone with an `acme.com` mailbox is signing in," not who. This is a real change to the
  "your sign-in never passes through us" wording → the privacy policy needs an account-plane
  section (the strategy's "two planes"). Marketing stays true: *mail and password* never pass
  through MailPoppy; only a domain lookup + a paid/unpaid check do.

---

## 3. Data model (Firestore)

```
accounts/{uid}                       // uid = Firebase Auth uid (one account per admin)
  email: string
  stripeCustomerId: string | null
  subscriptionStatus: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  currentPeriodEnd: Timestamp | null
  createdAt, updatedAt

domains/{domain}                     // domain = lowercased, e.g. "acme.com"  (resolve = 1 get)
  accountId: string                  // owning accounts/{uid}
  deployment: { region, userPoolId, clientId, apiBaseUrl }   // public config
  verified: boolean                  // DNS-TXT verified (Phase C); seeded=true in Phase A
  verifyToken: string | null
  createdAt, updatedAt

accounts/{uid}/apiKeys/{keyId}       // integration API keys (launch; see §13)
  hash: string                       // SHA-256 of the key; the raw key is shown only once
  prefix: string                     // e.g. "mp_live_ab12" — first chars, for display in the UI
  label: string                      // user-given name, e.g. "Acme CRM"
  createdAt, lastUsedAt, revokedAt
```

Notes: one account may own several domains (one doc each). A backend that serves multiple domains
just repeats the `deployment` block per domain doc (dedupe later if needed). Domain is the key, so
resolve is a single document read.

---

## 4. API (Next.js route handlers on mailpoppy.com)

### Public (client-facing, unauthenticated)
- **`GET /api/resolve?domain=acme.com`** — the heart of it.
  1. normalise domain (lowercase).
  2. read `domains/{domain}` → 404 `unknown_domain` if missing.
  3. read owning `accounts/{accountId}` → if `subscriptionStatus` not in {active, trialing}
     (plus optional past_due grace) → **403 `inactive_subscription`**.
  4. else **200** `{ region, userPoolId, clientId, apiBaseUrl }`.
  - Rate-limited; logs the domain only (never a full email). Short CDN cache (~60 s).

### Account-authed (admin; Firebase ID token)
- `GET  /api/account` → account + subscription + owned domains (for the dashboard).
- `POST /api/account/checkout` → Stripe Checkout session → `{ url }`.
- `POST /api/account/portal` → Stripe Billing Portal session → `{ url }` (manage/cancel).
- `POST /api/deployments/register` → `{ domain, region, userPoolId, clientId, apiBaseUrl }` →
  upsert `domains/{domain}` for this account. Rejects a domain owned by a *different* account.
  Requires verification (Phase C).
- `DELETE /api/deployments/{domain}` → remove mapping (desktop teardown).

### Stripe
- `POST /api/stripe/webhook` (signature-verified) → on `checkout.session.completed`,
  `customer.subscription.updated|deleted` → update `accounts/{uid}.subscriptionStatus` +
  `currentPeriodEnd`.

### Integration API v1 — the public, documented API (see §13)
Key management (admin, Firebase ID token):
- `POST   /api/account/keys` → create a key → returns the raw `mp_live_…` **once**.
- `GET    /api/account/keys` → list keys (masked: prefix + label + lastUsed).
- `DELETE /api/account/keys/{id}` → revoke.

Public, **API-key authed** (`Authorization: Bearer mp_live_…`), versioned under `/v1`:
- `GET /v1/account` → `{ email, subscriptionStatus, currentPeriodEnd }`.
- `GET /v1/domains` → `[ { domain, verified, deployment } ]` — **"all domains under one account."**
- `GET /v1/domains/{domain}` → `{ domain, verified, deployment }`.

Read-only at launch. Inactive subscription → 402/403 so integrators see the same gate. Rate-limited
per key; `lastUsedAt` updated for visibility.

---

## 5. Flows

**End-user signs in (mobile / web):**
1. Enter email → client derives domain → `GET /api/resolve?domain=…`.
2. 200 → client configures Cognito (`userPoolId`, `clientId`, `region`) + `apiBaseUrl` from the
   response, then does the normal SRP password sign-in against the customer's AWS.
3. 403 → "Your organisation's MailPoppy subscription is inactive — contact your administrator."
   404 → "This email isn't set up with MailPoppy."
4. Cache the resolved config locally; re-resolve on launch / every 24 h to re-check entitlement
   (see §7).

**Admin onboards:**
1. Sign up for a MailPoppy account on mailpoppy.com → subscribe (Stripe Checkout).
2. Deploy a backend in the desktop app (unchanged).
3. Desktop registers the domain + public config with the Hub (Phase C; manual seed until then).
4. Their users can now resolve + sign in while the subscription is active.

---

## 6. Client refactor (grounded in current files)

The clients import a static `config`. It becomes a value resolved at login.

**Mobile (`mailpoppy-mobile/src`):**
- `config.ts` — replace the static export with a `resolveDeployment(domain)` fetch + a
  runtime-set/persisted `DeploymentConfig` (AsyncStorage).
- `auth.ts` (`UserPoolId: config.userPoolId`, `ClientId`, region) and `mailClient.ts`
  (`apiBaseUrl: config.apiBaseUrl`) — read from the resolved config instead of the constant.
- `LoginScreen.tsx` — add the email → resolve step before password; surface 403/404 messages.
- `AuthContext.tsx` — hold the resolved config; clear on sign-out.

**Web (`mailpoppy-web/src/lib`):** same shape — `config.ts`, `auth.ts` (`getPool`),
`mailClient.ts`, and the `/app` login.

**Desktop (Phase C):** after deploy, call `/api/deployments/register`; needs MailPoppy-account
login in the desktop app (the closed-app login from the strategy).

---

## 7. Enforcement reality (be honest)

- The mailbox (Cognito) lives in the customer's AWS and works independently of MailPoppy. The Hub
  gates **discovery** (resolve) — so new sign-ins stop when the subscription lapses, and clients
  that re-resolve on launch will sign out. A determined user with cached config could linger; that's
  acceptable (same philosophy as the open-source enforcement note — gate the convenient path, not
  an absolute lock). The real teeth: a customer's whole client experience depends on staying
  subscribed, and the Hub is the only easy way to get config.
- Grace period: treat `past_due` as active for N days (default 7) so a failed card doesn't instantly
  lock out a customer's whole company.

---

## 8. Security & abuse

- **Domain ownership** (Phase C): DNS-TXT challenge (`_mailpoppy-verify.<domain> = token`). Natural
  fit — the admin already controls the domain's DNS for MX/SPF/DKIM, and the desktop app can write
  the record. Prevents one account claiming another's domain.
- A domain can be owned by exactly one account; `register` rejects cross-account claims.
- Rate-limit `resolve` (enumeration), log domains not emails, verify the Stripe webhook signature,
  store no secrets in the directory (config is public by design).

---

## 9. Privacy-policy / legal updates needed

- Add an **account-plane** section: MailPoppy now holds an account email + Stripe billing, runs a
  domain-resolution + subscription check at sign-in; never receives mail, passwords, or AWS keys.
- Mobile/web in-app privacy copy + the website privacy page both need this (keep the two `legal`
  sources in sync, per the existing KEEP-IN-SYNC note).

---

## 10. Phased build plan

**Phase A — Directory + dynamic login (multi-tenant).**
- Firestore `domains`; `GET /api/resolve` (subscription check stubbed to allow seeded domains).
- Refactor mobile + web login to resolve-by-domain → dynamic Cognito/API config; persist + messages.
- Seed the current deployment's domain.
- ✅ Outcome: clients work for many backends. Mobile can then go to the stores serving real customers.

**Phase B — Accounts + Stripe = the gate + the public API (launch bundle).**
- Firebase Auth accounts; `accounts` docs; Stripe Checkout + Portal + webhook → drive
  `subscriptionStatus`; `resolve` enforces it; account dashboard page on the site.
- **Integration API v1** (§13): API-key issuance/management + the read endpoints + a published
  **docs page** (`mailpoppy.com/docs/api`). This ships *with* launch so there's an API to point
  integrators at on day one.
- Decide the plan(s): monthly/annual, price, trial length.
- ✅ Outcome: "only works if subscribed" is real, and MailPoppy launches as a documented platform.

**Phase C — Desktop self-registration.**
- MailPoppy-account login in the desktop app; auto-register domain + config on deploy; DNS-TXT
  verification; deregister on teardown.
- ✅ Outcome: admins self-serve; no manual directory seeding.

---

## 11. Decisions to confirm before/while building

1. ✅ **Resolve by domain only** (decided). Send the domain, never the full address/password.
   Note: the customer's domains being known to the Hub is **intentional and an asset** (it powers
   the future integration API — see §13), not a privacy worry; the resolve endpoint stays
   domain-only purely for data minimality.
2. **Subscription shape** (Phase B): monthly/annual, price points, free trial? (Stripe needs this;
   can be decided when we reach B.)
3. **Grace period** for `past_due` before cutting off resolution (default 7 days).
4. **Phase C timing** — self-registration now, or keep seeding the directory manually until there's
   a real second customer?
5. **Account = Firebase Auth uid** (one account per admin login) for MVP — OK?

---

## 12. Store impact (mobile)

The store kit (`mailpoppy-mobile/store/`) is unchanged and still valid — we submit **after Phase A**
(so the published app is multi-tenant). The reviewer demo domain just needs to be a registered +
active entry in the Hub. The app now makes one network call (resolve) at login → already covered by
the privacy update in §9; no store-policy issue.

---

## 13. Integration API — basic + documented at launch

**Decision: ship a basic, documented API on day one** to signal MailPoppy is a *platform* and seed
integration interest (CRMs, helpdesks, automation). The Hub's account → domains directory is the
natural foundation — the same data that resolves logins answers integration queries. Aligns with
the **MailPoppy CRM** roadmap in [[OPEN-vs-CLOSED]].

**Auth:** per-account **API keys** (`mp_live_…`), created/revoked from the account dashboard
(stored hashed — §3). Keys suit third-party integrations better than short-lived Firebase user
tokens. Pass as `Authorization: Bearer mp_live_…`.

**Surface at launch (read-only, account-scoped metadata):**
- `GET /v1/account`, `GET /v1/domains` (← "all domains under one account"), `GET /v1/domains/{domain}`.
- Built directly on `domains` (query by `accountId` — add a Firestore index). Subscription-gated
  like everything else.

**Docs at launch:** a public **`mailpoppy.com/docs/api`** page — auth (get a key), the endpoints,
example `curl`, and error/rate-limit notes. Cheap to do and high-signal.

**Deliberately out of the v1 surface (V2+):**
- **Mail-data endpoints** (read/send mail, contacts). That's the *data plane*, which lives in each
  customer's own AWS (the deployment's `access-api`), authenticated per-mailbox. We document *that*
  it exists and how to reach it (the resolved `apiBaseUrl` + a mailbox Cognito token), but new
  data endpoints + a unified gateway are a later build. **Keep mailbox contents out of the Hub** —
  the Hub only ever serves account/domain/config metadata.
- Write operations (creating mailboxes/domains via API) — later.

This keeps "basic API, day one" genuinely small (it's the metadata you already have), while the
published docs + versioned `/v1` namespace make MailPoppy *look and behave* like a platform from
launch.
