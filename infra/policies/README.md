# Mailpoppy provisioning policy

This is the least-privilege IAM policy the Step 0 readiness gate refers to — attach it to the
IAM user/role you run Mailpoppy as, **instead of full `AdministratorAccess`**.

- [`mailpoppy-provisioning-policy.json`](./mailpoppy-provisioning-policy.json) — the raw policy
  document (attach as a customer-managed policy).
- [`mailpoppy-provisioning-role.yaml`](./mailpoppy-provisioning-role.yaml) — CloudFormation that
  creates the managed policy (and optionally attaches it to a user) in one click.

## What it grants (current scope)

Covers what the app does **today** — the direct Route53 / SES / S3 provisioning proven in
`phase0-derisk.md`:

| Service | Why |
|---|---|
| `sts:GetCallerIdentity` | Readiness: confirm credentials resolve |
| Route53 (list/get/change RRsets, GetChange) | Publish MX / SPF / DKIM / DMARC |
| SES (email identity, receipt rules, send) | Verify the domain, receive → S3, send |
| `s3:ListAllMyBuckets` | Readiness probe |
| S3 on `arn:aws:s3:::mailpoppy-*` | Create/configure the mail bucket + objects |

**Scoping notes:** S3 is locked to **`mailpoppy-*`** buckets (the app's naming convention).
Route53 and SES use `Resource: "*"` because AWS offers only coarse resource-level control for
those actions — the tightening here is via the explicit *action* allow-list.

## Apply it

**Option A — CloudFormation (recommended):**

```bash
aws cloudformation deploy \
  --template-file mailpoppy-provisioning-role.yaml \
  --stack-name mailpoppy-provisioning \
  --parameter-overrides AttachToUser=<your-iam-user> \
  --capabilities CAPABILITY_NAMED_IAM
# omit AttachToUser to just create the policy and attach it yourself
```

**Option B — attach the JSON** as a customer-managed policy in the IAM console (Policies →
Create → JSON → paste `mailpoppy-provisioning-policy.json`), then attach to your user/role.

## Not covered yet — deploy-time policy (Phase 2+)

When the full backend ships via CloudFormation (`cdk synth` → `cloudformation:CreateStack`,
DESIGN §15), provisioning will also need permissions to create the stack and its resources:
**CloudFormation**, **IAM** (`CreateRole` / `PassRole` for the Lambda + Cognito Identity Pool
roles), **Lambda**, **DynamoDB**, **Cognito**, **API Gateway**, **SNS**, **EventBridge**.

That deploy-time set is necessarily broader (it creates IAM roles), so it will be a **separate,
clearly-labelled policy** finalized alongside the CDK deploy path — not folded into this one.
Runtime stays least-privilege: the *deployed* Lambda/Cognito roles are tightly scoped within
the CDK stack itself.
