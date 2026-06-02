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
| CloudFormation read on `stack/MailpoppyMailStack/*` | The **resource transparency view** (DESIGN §14.1) reads the deployed stack's inventory via `DescribeStackResources` |

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

## Deploy-time policy (the backend stack)

Deploying the backend (DESIGN §15) — `cloudformation:CreateStack` with the shipped template —
needs a **broader** set than provisioning, because the stack itself creates IAM roles (the
Lambda execution roles, the Cognito SMS role, the custom-resource role). That set is a
**separate, clearly-labelled policy** so the narrow provisioning policy above stays narrow:

- [`mailpoppy-deploy-policy.json`](./mailpoppy-deploy-policy.json) — the raw deploy permissions.
- [`mailpoppy-deploy-role.yaml`](./mailpoppy-deploy-role.yaml) — CloudFormation that creates a
  **deployment service role** holding those permissions, plus an optional narrow `MailpoppyDeployer`
  policy for the admin.

It covers exactly what `MailpoppyMailStack` creates (verified against a real deploy): **CloudFormation**,
**IAM** role lifecycle + `PassRole`, **Lambda**, **DynamoDB**, **Cognito**, **API Gateway (v2)**,
**SNS**, **EventBridge**, **SES** (receipt rules + identity), **S3**, **CloudWatch Logs**.
Everything is scoped to **`MailpoppyMailStack-*`** / **`mailpoppy*`** resources where AWS supports
resource-level permissions; `PassRole` is constrained with an `iam:PassedToService` condition.
Validated: `cloudformation validate-template` (CAPABILITY_NAMED_IAM) + `accessanalyzer
validate-policy` → **no findings**.

### Recommended shape (keeps the human least-privileged)

Don't put the broad set on a person. Instead:

1. Deploy `mailpoppy-deploy-role.yaml` → it creates **`MailpoppyDeploymentRole`** (assumable by
   CloudFormation) that holds the broad perms.
2. The desktop passes that role's ARN as the **`RoleARN`** on `CreateStack`/`UpdateStack`, so
   *CloudFormation* — not the admin — exercises the create permissions.
3. The admin's own identity only needs `cloudformation:*` on Mailpoppy stacks + `iam:PassRole`
   for the role — the optional **`MailpoppyDeployer`** policy (pass `AttachDeployerToUser`).

```bash
aws cloudformation deploy \
  --template-file mailpoppy-deploy-role.yaml \
  --stack-name mailpoppy-deploy-role \
  --parameter-overrides AttachDeployerToUser=<your-iam-user> \
  --capabilities CAPABILITY_NAMED_IAM
# omit AttachDeployerToUser to just create the deployment role
```

> **Dev/CDK note:** if you instead deploy with `cdk deploy` into a **bootstrapped** account (as
> in the live Phase 2 test), CDK assumes the `cdk-hnb659fds-*` bootstrap roles, so the caller only
> needs `sts:AssumeRole` on those — the broad policy above is for the **product path**
> (`cloudformation:CreateStack` with no CDK/bootstrap in the customer's account).
