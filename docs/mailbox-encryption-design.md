# MailPoppy — Mailbox encryption ("even the admin can't read your mail")

*Design note — created 2026-06-14. **Not yet built.** Keep **private** — discusses the
threat model and credential/key handling of the closed admin app and the open backend.*

Goal recorded from discussion: the **admin must not be able to read a mailbox's message
*content*** by inspecting the datastore (DynamoDB/S3) in their own AWS account. It is
acceptable that an admin can **reset** a mailbox password and thereby gain access *through
the client* (a disruptive, detectable act). What's unacceptable is **silent, passive
reading** of stored mail while the legitimate user is using the client.

This is a flagship trust feature aligned with the mission ([[onboarding-two-personas]] §1)
and the open/verifiable posture ([[OPEN-vs-CLOSED]]). It pairs with the
build-provenance/`/verify` roadmap: provenance proves the code, encryption proves even the
operator can't read content.

---

## 1. Why the naive version fails

The mail lives in the **customer's own AWS account**, which the admin controls. Any key AWS
holds — KMS, DynamoDB SSE, S3 SSE — the admin can grant themselves decrypt on (they own the
key policy). AWS-managed encryption defends against *AWS-the-company* and stolen disks, **not
against the admin.** To lock out the admin, the decryption key must be something the admin
**never possesses.**

The one secret the admin doesn't have is the **user's password**: Cognito stores only an SRP
verifier (a hash), never the plaintext. The admin can *reset* it but cannot *read* it. That is
the hook the whole design hangs on.

---

## 2. Threat model

| Actor / vector | Defended? |
|---|---|
| Admin reads DynamoDB / S3 directly | **Yes** — only ciphertext + a password-wrapped key |
| Admin runs the access-api / queries the DB | **Yes** — same |
| Stolen disk / AWS-internal access | Yes (also covered by KMS, but that's secondary) |
| Admin **resets** a password, logs in via client | **No (accepted)** — disruptive + detectable (user locked out); grants go-forward access only |
| Admin **actively tampers** with the inbound Lambda to copy plaintext at receipt | **No** — see §6.2; converted from passive→active+detectable, not absolute |
| In-transit interception (SMTP/SES) | Out of scope — normal email isn't E2E unless the sender uses our keys (PGP-style) |

The accepted hole (admin reset) is acceptable precisely because it is **noisy**: the real user
is locked out and notices.

---

## 3. Design: envelope encryption with a password-wrapped private key

### Key hierarchy
- **Password `P`** — only the user knows it (Cognito has only the SRP verifier).
- **Master key `MK = Argon2id(P, salt)`** — a key-encryption-key. `salt` stored in the backend (not secret).
- **Mailbox keypair `(pub, priv)`** — generated **client-side on first login** (X25519).
- **Wrapped private key `WPK = AEAD(MK, priv)`** — stored in the backend. The admin sees only `WPK` — useless without `P`.
- **Per-message**: random content key `CK`; `body_ct = AEAD(CK, body)`; `CK_wrapped = seal(pub, CK)` (libsodium sealed box — the sender needs only the recipient's public key, no sender key).

### Inbound flow (inbound-processor Lambda)
1. Parse the `.eml` (Lambda sees plaintext momentarily — unavoidable, see §6.2).
2. Fetch the recipient's `pub`.
3. Generate `CK`; encrypt body + attachments; `seal(pub, CK)`.
4. Store `body_ct`, `CK_wrapped`, encrypted attachments; **encrypt (or delete) the raw `.eml` in S3** so no plaintext lingers.

### Read flow (client, after login)
1. User authenticates (Cognito SRP) — client has `P` in memory.
2. `MK = Argon2id(P, salt)` → unwrap `WPK` → `priv` (cached in memory for the session).
3. Per message: `unseal(priv, CK_wrapped)` → `CK` → decrypt `body_ct`.

### Sent mail
The client has plaintext when composing; store the Sent copy `seal`ed to the user's own `pub`.
(The outbound message still leaves over SES in plaintext — this protects the *stored* copy, not transit.)

---

## 4. How it maps to the accepted threat model
- **Passive DB read** → ciphertext only → blocked. ✅ (the core requirement)
- **Admin reset** → can log in via client, but `WPK` is wrapped under the *old* password → old mail can't be unwrapped → client detects this and **re-keys** (fresh keypair). So a reset grants access to **new mail only**, never a silent window into existing mail — and the user noticed the lockout. ✅

---

## 5. What stays in cleartext (important tension)
The inbound Lambdas enforce **spam policy, allow/block lists, per-mailbox quota, and
reject-unknown-recipient** — these need routing metadata in clear: **sender, recipient, size,
spam/auth verdict, timestamp.** So we encrypt the **body + attachments** (and optionally the
**subject**), but **envelope/routing metadata stays cleartext**. Consequence to state plainly:
the admin can still see *who emailed whom, when, and how big* — and the subject unless we
encrypt it (encrypting the subject kills server-side subject filtering). The user's stated
concern is reading **content**, which body encryption addresses; metadata exposure is a lesser,
separate matter to call out in the privacy policy.

---

## 6. Unavoidable trade-offs (the hard truths)
1. **Forgotten / admin-reset password = existing mail is unrecoverable** unless the user saved
   a personal **recovery key** (§7). There can be no "admin restores my old mail" — that *is* a
   backdoor. Same trade-off ProtonMail/Tutanota make.
2. **A determined admin can still capture *inbound* mail at receipt.** The inbound Lambda runs in
   the admin's AWS and briefly sees plaintext before encrypting; the raw `.eml` hits S3 first.
   Encryption-at-rest converts *silent passive snooping* into *active tampering with
   open-source infra* — detectable via CloudTrail + deploy/code changes, which is the bar we
   want, but **not absolute**. Only sender-side E2E closes it, and normal senders won't.
3. **No server-side body search** — already client-side, so no regression.
4. **Client holds key material**, not just a JWT — re-derive on app restart; handle across
   desktop/web/mobile.
5. **Mail before first login**: a freshly-created mailbox has no keypair yet (it's generated
   under the *user's* password on first login, not the admin-known temp password). Need a policy
   — see §10.

---

## 7. Recovery story
- On first login, optionally generate a random **recovery key `R`** (shown once for the user to
  store) and keep a second wrapping `WPK_R = AEAD(KDF(R), priv)`.
- Lost password + has `R` → recover `priv`, re-wrap under the new password.
- **User-initiated** password change (knows the old password) → client unwraps with old `MK`,
  re-wraps with new `MK` → **no data loss**. (Only an *admin reset*, where the old password is
  unknown, loses old mail.)
- Lost password **and** `R` → mail is gone. The admin cannot help — by design.
- An admin-escrow recovery option would weaken the guarantee to "admin can read" → **rejected**.

---

## 8. What it touches (scope)
- **core**: vetted crypto helpers (KDF, seal/unseal, AEAD, wrap/unwrap) shared by clients + Lambda.
- **inbound-processor Lambda**: encrypt body/attachments, wrap `CK`, encrypt/scrub raw `.eml`.
- **access-api Lambda**: serve ciphertext + wrapped keys only.
- **DynamoDB/S3 schema**: ciphertext + `CK_wrapped` fields; mailbox record holds `pub`, `WPK`,
  `salt`, optional `WPK_R`. (`pub`/`WPK` are small enough for Cognito custom attributes if
  preferred; bodies are far too big — they stay in DynamoDB/S3.)
- **Clients (desktop/web/mobile)**: first-login keygen + upload `pub`/`WPK`; login → derive `MK`,
  unwrap `priv`, cache; decrypt on read; encrypt Sent; recovery-key UX; re-key on
  un-unwrappable `WPK`.
- **First-login / new-password flow** changes (the keypair is born here).
- **Migration import**: encrypt-on-import (note: import already sees source plaintext on the
  admin's machine — inherent).

---

## 9. Library choice (do NOT hand-roll)
Use **libsodium** (`libsodium-wrappers` in JS — works in clients *and* the Node Lambda, so one
implementation everywhere): `crypto_box_seal` (sealed boxes), `crypto_secretbox` /
XChaCha20-Poly1305 (AEAD), `crypto_pwhash` Argon2id (KDF). Tune Argon2 params for mobile/web.
Rolling our own primitives is the most common way to ship broken crypto — out of scope.

---

## 10. Decisions (resolved 2026-06-17)
- **v1 launch blocker** — building it now, pre-launch (no mail to migrate; must be in the
  submitted mobile build).
- **Mail-before-activation**: **accept plaintext-at-rest until activation.** A mailbox has no
  keypair until first login, so mail that arrives before then is stored in clear; once the user
  activates, new mail is sealed and the client encrypts the pending plaintext on first login.
  **Must be disclosed to the admin** (bounded plaintext window). The inbound Lambda seals a message
  only when *every* local recipient is activated; a mixed-recipient message degrades to
  plaintext-at-rest (rare).
- **Recovery key**: **optional, generated + shown once on first keygen** (no admin escrow). The
  desktop login flow surfaces it behind an acknowledgement gate.
- **Encrypt the subject? — NO (v1).** The subject (and sender/recipient/size/timestamp) stay
  **cleartext**, consistent with the routing metadata the inbound Lambda already needs, and to keep
  server-side subject triage open for the future agent layer. Only **body + attachments** are
  sealed; the **snippet is blanked** for encrypted messages (it's body text). **Must be disclosed**:
  privacy copy says "body + attachments are unreadable by the admin; subject + routing metadata are
  visible." The `subjectEnc` path is kept reversible so a future multi-user/employer tier can flip
  subject encryption on per-deployment. (Once encrypted, the server can never produce cleartext
  again — so cleartext-now is the more reversible default.)
- **Rollout switch**: the inbound Lambda gates sealing on an `ENCRYPTION_ENABLED` env flag, fed by
  the `EncryptionEnabled` CfnParameter. The **CfnParameter default stays `false`** (a raw-CloudFormation
  deploy with the param omitted ships inert / backward-compatible). The **desktop setup wizard, the
  only product deploy path, now defaults the "Encrypt mailboxes at rest" toggle ON** — security-on-by-
  default per the admin's call (2026-06-17); the wizard always passes an explicit value so a new
  deploy gets encryption unless the admin opts out. **Client-readiness caveat: desktop + web read
  paths decrypt today; the mobile app has no native libsodium module yet, so an encrypted deploy locks
  mobile readers out until the RN libsodium module + EAS rebuild ship.** The toggle copy warns "turn
  off only if some people will read mail in an older Mailpoppy app." libsodium + Argon2id confirmed
  available across Node/web/desktop (sumo) and React Native bindings.
