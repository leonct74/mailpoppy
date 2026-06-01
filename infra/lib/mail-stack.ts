import { Stack, type StackProps, RemovalPolicy } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";

/**
 * The deployable Mailpoppy backend (runs inside the CUSTOMER's AWS account).
 * Skeleton — fleshed out across Phases 2–3. See DESIGN §5 / §8.
 */
export class MailStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Raw mail storage: inbound/, sent/, trash/, attachments/.
    const mailBucket = new s3.Bucket(this, "MailBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // The "mailbox" — all manufactured state (flags, folders, threads, search keys).
    //   PK = `${domain}#${mailbox}`   SK = `${folder}#${date}#${messageId}`
    const indexTable = new dynamodb.Table(this, "IndexTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    indexTable.addGlobalSecondaryIndex({
      indexName: "by-thread",
      partitionKey: { name: "threadId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
    });

    // Per-deployment + per-domain policy (retention, spam actions, allow/block lists).
    const settingsTable = new dynamodb.Table(this, "SettingsTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Mailbox identities → scoped temp creds for clients (DESIGN §6).
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false, // admins create mailbox users
      signInAliases: { email: true },
      mfa: cognito.Mfa.OPTIONAL,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient("DesktopMobileClient", {
      authFlows: { userSrp: true },
    });

    // TODO (Phases 2–3):
    //  - Lambdas via aws-cdk-lib/aws-lambda-nodejs (bundle ../../lambdas/src/*):
    //      inbound-processor (S3 event → indexTable), access-api, janitor (scheduled), suppression.
    //  - HTTP API (aws-cdk-lib/aws-apigatewayv2) + Cognito JWT authorizer → access-api.
    //  - Identity Pool federating the User Pool → scoped IAM role (S3 prefix / DynamoDB leading-key).
    //  - SES receipt rule set → write to mailBucket + trigger inbound-processor.
    //  - SNS topic for bounces/complaints → suppression Lambda.

    void mailBucket;
    void settingsTable;
    void userPoolClient;
  }
}
