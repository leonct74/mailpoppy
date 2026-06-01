# Mailpoppy — Phase 0 De-risk Runbook

> **Purpose:** Before writing a single line of app code, prove the core mechanic works by hand:
> receive mail into S3 and send mail that lands in a **Gmail inbox (not spam)** with
> SPF/DKIM/DMARC passing — and feel the SES sandbox friction firsthand.
> **Time:** ~½–1 day (mostly DNS propagation + the verification email click).
> **Cost:** a few cents (SES/S3) + $0.50/mo only if you create a *new* Route53 hosted zone.

---

## 0. Success criteria (what "de-risked" means)

You're done when all three are true:

1. ✅ An email sent **from Gmail → `test@<your-domain>`** appears as an `.eml` object in your
   S3 bucket within seconds.
2. ✅ An email sent **via SES → your Gmail** lands in the **Inbox** (not Spam), and Gmail's
   *Show original* reports **SPF=PASS, DKIM=PASS, DMARC=PASS**.
3. ✅ You've hit the **SES sandbox** restriction and understand the production-access request.

If #2 lands in spam or any auth check fails, that's the single most important thing to learn
*now* — it's the project's #1 risk (DESIGN.md §13).

---

## ⚠️ Read before you start

- **Use a spare domain or a subdomain — NOT your live email domain.** This runbook points an
  **MX record** at SES, which hijacks mail delivery for whatever name it's on. If your domain
  currently routes real mail (e.g. still on WorkMail), use a throwaway domain or a subdomain
  like `mailtest.<your-domain>` so you don't break production.
- **Region matters.** SES *inbound* (receiving) is only supported in some regions. Safe
  choices: **`eu-west-1`** (Ireland — good for EU), `us-east-1`, `us-west-2`. Confirm current
  support in the SES console. Use the **same region** for everything below.
- **You'll start in the SES sandbox.** That's expected — Step 5 works around it for the test.
- The domain should be in **Route53** (this runbook uses the Route53 CLI for DNS).

---

## 1. Set your variables

```bash
# ---- EDIT THIS ONE ----
export AWS_PROFILE="<your-profile>"               # your named / SSO profile for this account
# -----------------------

# Pre-filled for your setup
export REGION="eu-west-1"                          # Ireland — supports SES inbound
export DOMAIN="ollydigital.com"                    # your spare domain (apex)
export TEST_RECIPIENT="leonct74@gmail.com"         # your Gmail (change if you prefer another)
export BUCKET="mailpoppy-phase0-ollydigital-com"   # S3 bucket (lowercase, no underscores)

# Derived (apex domain → the hosted zone IS the domain itself)
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ZONE_ID="$(aws route53 list-hosted-zones-by-name \
  --dns-name "$DOMAIN" --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')"
echo "Account=$ACCOUNT_ID  Region=$REGION  Domain=$DOMAIN  Zone=$ZONE_ID  Bucket=$BUCKET"

# Sanity check: this MUST print "ollydigital.com." — if not, the zone lookup grabbed the wrong zone
aws route53 get-hosted-zone --id "$ZONE_ID" --query 'HostedZone.Name' --output text
```

> Apex domain, so the zone is `ollydigital.com` itself. The sanity check confirms the lookup
> found the right hosted zone before you start changing records.

---

## 2. Verify the domain identity + enable DKIM

```bash
# Create the email identity (SESv2) — this also sets up Easy DKIM
aws sesv2 create-email-identity --region "$REGION" --email-identity "$DOMAIN"

# Fetch the 3 DKIM CNAME tokens you must publish
aws sesv2 get-email-identity --region "$REGION" --email-identity "$DOMAIN" \
  --query 'DkimAttributes.Tokens' --output text
```

For **each** of the 3 tokens, add a CNAME in Route53:
`<token>._domainkey.$DOMAIN  →  <token>.dkim.amazonses.com`

Use this helper per token (run 3×, substituting `$TOKEN`):

```bash
TOKEN="paste-one-token-here"
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "{
  \"Changes\": [{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{
    \"Name\":\"${TOKEN}._domainkey.${DOMAIN}\",\"Type\":\"CNAME\",\"TTL\":300,
    \"ResourceRecords\":[{\"Value\":\"${TOKEN}.dkim.amazonses.com\"}]}}]}"
```

Wait until verification flips to success (poll every minute or so):

```bash
aws sesv2 get-email-identity --region "$REGION" --email-identity "$DOMAIN" \
  --query '{Verified:VerifiedForSendingStatus, DKIM:DkimAttributes.Status}'
# Goal: Verified=true, DKIM=SUCCESS
```

---

## 3. Receiving: S3 bucket + bucket policy

```bash
# Create the bucket (note: us-east-1 omits LocationConstraint)
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# Allow SES to write received mail into it
cat > /tmp/ses-bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowSESPuts",
    "Effect": "Allow",
    "Principal": { "Service": "ses.amazonaws.com" },
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::${BUCKET}/*",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" },
      "StringLike":   { "aws:SourceArn": "arn:aws:ses:${REGION}:${ACCOUNT_ID}:receipt-rule-set/*" }
    }
  }]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/ses-bucket-policy.json
```

---

## 4. Receiving: receipt rule set + rule + MX record

```bash
# Rule set
aws ses create-receipt-rule-set --region "$REGION" --rule-set-name "mailpoppy-phase0"

# Rule: for mail to the domain, store the raw message in S3
aws ses create-receipt-rule --region "$REGION" --rule-set-name "mailpoppy-phase0" --rule "{
  \"Name\": \"store-to-s3\",
  \"Enabled\": true,
  \"Recipients\": [\"${DOMAIN}\"],
  \"ScanEnabled\": true,
  \"Actions\": [{ \"S3Action\": { \"BucketName\": \"${BUCKET}\", \"ObjectKeyPrefix\": \"inbound/\" } }]
}"

# Make it the active rule set
aws ses set-active-receipt-rule-set --region "$REGION" --rule-set-name "mailpoppy-phase0"
```

Point the domain's **MX** at the SES inbound endpoint for your region:

```bash
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "{
  \"Changes\": [{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{
    \"Name\":\"${DOMAIN}\",\"Type\":\"MX\",\"TTL\":300,
    \"ResourceRecords\":[{\"Value\":\"10 inbound-smtp.${REGION}.amazonaws.com\"}]}}]}"
```

---

## 5. Test INBOUND (Gmail → your domain → S3)

1. Wait ~2–5 min for the MX record to propagate.
2. From your Gmail, send an email to **`test@$DOMAIN`** (any local-part works; the rule matches
   the whole domain).
3. Confirm it landed in S3:

```bash
aws s3 ls "s3://${BUCKET}/inbound/" --recursive
# Download and inspect the raw message:
aws s3 cp "s3://${BUCKET}/inbound/<the-object-key>" /tmp/received.eml && less /tmp/received.eml
```

✅ **Success criterion #1** met if the `.eml` appears within seconds.

---

## 6. Sending: SPF + DMARC records, then escape the sandbox for the test

Add SPF and DMARC (DKIM is already done in Step 2):

```bash
# SPF (TXT on the domain)
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "{
  \"Changes\": [{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{
    \"Name\":\"${DOMAIN}\",\"Type\":\"TXT\",\"TTL\":300,
    \"ResourceRecords\":[{\"Value\":\"\\\"v=spf1 include:amazonses.com ~all\\\"\"}]}}]}"

# DMARC (TXT on _dmarc.<domain>) — monitor mode
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "{
  \"Changes\": [{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{
    \"Name\":\"_dmarc.${DOMAIN}\",\"Type\":\"TXT\",\"TTL\":300,
    \"ResourceRecords\":[{\"Value\":\"\\\"v=DMARC1; p=none; rua=mailto:${TEST_RECIPIENT}\\\"\"}]}}]}"
```

**The sandbox:** a new SES account can only send to **verified** recipients. So verify your
Gmail address once (click the link Amazon emails you):

```bash
aws sesv2 create-email-identity --region "$REGION" --email-identity "$TEST_RECIPIENT"
# → check your Gmail inbox and click the AWS verification link
```

> 👉 **This is the friction every Mailpoppy customer will hit.** Note it. To send to *anyone*
> you must request production access (console → SES → Account dashboard → "Request production
> access"; it's a manual AWS review). You don't need it for this test, but do try submitting
> the request to learn the flow.

---

## 7. Test OUTBOUND + the deliverability verdict (the important one)

```bash
aws sesv2 send-email --region "$REGION" \
  --from-email-address "hello@${DOMAIN}" \
  --destination "ToAddresses=${TEST_RECIPIENT}" \
  --content "{\"Simple\":{
     \"Subject\":{\"Data\":\"Mailpoppy Phase 0 test\"},
     \"Body\":{\"Text\":{\"Data\":\"If you can read this in your inbox, sending works.\"},
               \"Html\":{\"Data\":\"<p>If you can read this in your <b>inbox</b>, sending works.</p>\"}}}}"
```

Then in Gmail:
1. Is it in the **Inbox** or **Spam**? (Inbox = good.)
2. Open the message → **⋮ → Show original**. Confirm:
   - **SPF: PASS**, **DKIM: 'PASS' with domain `$DOMAIN`**, **DMARC: PASS**.

✅ **Success criteria #2 and #3** met if it's in the inbox with all three PASS.

> If it's in spam or anything FAILs: re-check the DNS records propagated, that DKIM status is
> SUCCESS, and that the From domain matches the DKIM/SPF domain (alignment). This is exactly
> the deliverability work that never fully "finishes" — better to confront it here.

---

## 8. What you just learned (decision gates)

- **Region** you'll standardize on for inbound (likely `eu-west-1` for EU customers).
- **Sandbox reality** — confirms the "provisioned → pending approval" UX the wizard needs
  (DESIGN.md §13). How long did production-access approval take?
- **Deliverability** — did a fresh domain land in the inbox on the first try, or did it need
  warming? This calibrates expectations for §13.
- **The full happy path works end-to-end** → green-light Phase 1 (the wizard automates exactly
  these steps).

---

## 9. Teardown (do this — don't leave the MX hijacked)

```bash
# Stop receiving / remove rules
aws ses set-active-receipt-rule-set --region "$REGION"        # clears active rule set
aws ses delete-receipt-rule --region "$REGION" --rule-set-name "mailpoppy-phase0" --rule-name "store-to-s3"
aws ses delete-receipt-rule-set --region "$REGION" --rule-set-name "mailpoppy-phase0"

# Remove DNS records you added (MX, SPF, DMARC, the 3 DKIM CNAMEs) via change-resource-record-sets with Action=DELETE
# (delete the MX first so the test name stops accepting mail)

# Empty + delete the bucket
aws s3 rm "s3://${BUCKET}" --recursive && aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION"

# Optionally delete the SES identities
aws sesv2 delete-email-identity --region "$REGION" --email-identity "$DOMAIN"
aws sesv2 delete-email-identity --region "$REGION" --email-identity "$TEST_RECIPIENT"
```

---

## Appendix — common gotchas

- **No object in S3?** MX not propagated yet (wait), bucket policy `aws:SourceArn` mismatch, or
  the rule set isn't *active*. Check `aws ses describe-active-receipt-rule-set --region $REGION`.
- **Send fails with "Email address not verified"** → that's the sandbox; verify the recipient
  (Step 6) or get production access.
- **Lands in spam** → DNS not propagated, DKIM not `SUCCESS`, or From-domain misalignment.
- **`create-bucket` error in `us-east-1`** → omit `--create-bucket-configuration`.
- **TXT quoting** → SPF/DMARC values must be wrapped in escaped quotes (as shown).
- **Wrong region for inbound** → if there's no `inbound-smtp.<region>` endpoint, that region
  doesn't support receiving; switch to `eu-west-1` / `us-east-1` / `us-west-2`.

---

## ✅ Phase 0 RESULT — 2026-06-01 (PASSED)

Ran live against **ollydigital.com** / **eu-west-1** (account 675546221165). All criteria met:

- **Inbound** — SES received mail to `test@ollydigital.com` via the Route53 MX and stored a
  clean `.eml` in `s3://mailpoppy-phase0-ollydigital-com/inbound/`.
- **Outbound** — SES sent `hello@ollydigital.com` → a real Gmail and it landed **directly in
  the Inbox (not spam)** on the first attempt from a cold domain.
- **Auth (received headers)** — `spf=pass`; `dkim=pass header.i=@ollydigital.com`
  (domain-aligned); `dmarc=pass header.from=ollydigital.com`; `X-SES-Spam-Verdict: PASS`;
  `X-SES-Virus-Verdict: PASS`.
- **Sandbox** — this account was already in production; *new* customer accounts will still
  start sandboxed → the wizard's "pending approval" UX (DESIGN §13) is still required.

**Conclusion:** the #1 project risk (deliverability) is validated end-to-end. The command
sequence above is the reference implementation for the Phase 1 wizard. Test resources were
torn down afterward (DNS restored to original; bucket + receipt rules + SES identity deleted).
```
