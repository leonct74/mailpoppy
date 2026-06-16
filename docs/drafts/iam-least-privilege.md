# MailPoppy needs *least privilege*, not admin

A fair worry before connecting any tool to your AWS: *how much can it do?* MailPoppy is
designed to run on a **tightly-scoped IAM identity** — not your root or `AdministratorAccess`
keys. Attach the policy below to a dedicated IAM user (or role) and connect MailPoppy with
**that**, so it can only ever touch its own email stack — nothing else in your account.

> Source of truth: `infra/policies/` in the open repo (`mailpoppy-provisioning-policy.json`,
> `mailpoppy-deploy-policy.json`, and the matching CloudFormation role templates). The policy
> is kept exactly in step with the AWS SDK calls the app actually makes — no gaps, no excess —
> and validated with IAM Access Analyzer (no findings).

## Day-to-day policy (what MailPoppy uses to run)

This is the narrow **provisioning** policy — everything the app does directly in your account
(domain setup, mailbox admin, sending-health reads, teardown). It's scoped to MailPoppy's own
resources wherever AWS allows resource-level control.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "Identity", "Effect": "Allow", "Action": ["sts:GetCallerIdentity"], "Resource": "*" },
    { "Sid": "Route53", "Effect": "Allow",
      "Action": ["route53:ListHostedZonesByName", "route53:ListResourceRecordSets", "route53:ChangeResourceRecordSets"],
      "Resource": "*" },
    { "Sid": "Ses", "Effect": "Allow",
      "Action": ["ses:CreateEmailIdentity","ses:GetEmailIdentity","ses:ListEmailIdentities","ses:DeleteEmailIdentity","ses:GetAccount","ses:GetSendStatistics","ses:PutAccountDetails","ses:PutEmailIdentityMailFromAttributes","ses:SendEmail","ses:CreateReceiptRuleSet","ses:CreateReceiptRule","ses:DescribeActiveReceiptRuleSet","ses:SetActiveReceiptRuleSet"],
      "Resource": "*" },
    { "Sid": "S3ListForReadiness", "Effect": "Allow", "Action": ["s3:ListAllMyBuckets"], "Resource": "*" },
    { "Sid": "CloudFormationStack", "Effect": "Allow",
      "Action": ["cloudformation:DescribeStacks","cloudformation:DescribeStackResources","cloudformation:CreateStack","cloudformation:UpdateStack","cloudformation:DeleteStack"],
      "Resource": "arn:aws:cloudformation:*:*:stack/MailpoppyMailStack/*" },
    { "Sid": "S3MailpoppyBuckets", "Effect": "Allow",
      "Action": ["s3:CreateBucket","s3:DeleteBucket","s3:PutBucketPolicy","s3:ListBucket"],
      "Resource": "arn:aws:s3:::mailpoppy-*" },
    { "Sid": "S3MailpoppyObjects", "Effect": "Allow",
      "Action": ["s3:PutObject","s3:DeleteObject"], "Resource": "arn:aws:s3:::mailpoppy-*/*" },
    { "Sid": "StackBucket", "Effect": "Allow",
      "Action": ["s3:ListBucket","s3:DeleteBucket"], "Resource": "arn:aws:s3:::mailpoppymailstack-*" },
    { "Sid": "StackObjects", "Effect": "Allow",
      "Action": ["s3:PutObject","s3:DeleteObject"], "Resource": "arn:aws:s3:::mailpoppymailstack-*/*" },
    { "Sid": "StackTables", "Effect": "Allow",
      "Action": ["dynamodb:PutItem","dynamodb:BatchWriteItem","dynamodb:GetItem","dynamodb:Query","dynamodb:Scan","dynamodb:DeleteItem","dynamodb:DeleteTable"],
      "Resource": "arn:aws:dynamodb:*:*:table/MailpoppyMailStack-*" },
    { "Sid": "MailboxAdmin", "Effect": "Allow",
      "Action": ["cognito-idp:AdminCreateUser","cognito-idp:AdminSetUserPassword","cognito-idp:AdminDeleteUser","cognito-idp:ListUsers","cognito-idp:DeleteUserPool"],
      "Resource": "arn:aws:cognito-idp:*:*:userpool/*" }
  ]
}
```

**How it's scoped:** S3 is locked to `mailpoppy-*` and `mailpoppymailstack-*`; DynamoDB to
`MailpoppyMailStack-*` tables; CloudFormation to the `MailpoppyMailStack` stack. Route 53, SES,
and Cognito use `Resource: "*"` only because AWS offers no finer resource-level control for those
actions (the Cognito pool id doesn't exist until deploy time) — so the limit there is the explicit
**action allow-list**, not a wildcard on what it can do.

## First-time deploy needs a bit more — and there's a pattern to keep *you* minimal

Creating the backend stack the first time also creates IAM roles (the Lambda execution roles, etc.),
which needs a **broader** permission set (`mailpoppy-deploy-policy.json`). The recommended shape keeps
the broad permissions off your own user:

1. Deploy `mailpoppy-deploy-role.yaml` once → it creates a **`MailpoppyDeploymentRole`** that
   CloudFormation assumes and that holds the broad permissions.
2. MailPoppy passes that role's ARN to CloudFormation, so **CloudFormation** — not you — exercises
   the create permissions.
3. **Your** identity then only needs `cloudformation:*` on MailPoppy stacks + `iam:PassRole` for that
   role (the optional `MailpoppyDeployer` policy).

## Revoke any time

Because it's a dedicated IAM identity, you can detach the policy, delete the user, or rotate the keys
whenever you like — and MailPoppy's one-click teardown removes everything it created.

---

*Use on the website:* the day-to-day policy block + "How it's scoped" + "Revoke any time" make a
strong, concrete "least access" section under *Connecting your AWS, safely*. Link to the open
`infra/policies/` for the full, validated set once the repo is public.
