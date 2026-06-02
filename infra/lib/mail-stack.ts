import {
  Stack,
  type StackProps,
  RemovalPolicy,
  Duration,
  CfnParameter,
  CfnOutput,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as path from "node:path";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

const LAMBDA_SRC = path.join(__dirname, "..", "..", "lambdas", "src");
const BY_MESSAGE_INDEX = "by-message";

/**
 * The deployable Mailpoppy backend — runs entirely inside the CUSTOMER's AWS
 * account. `cdk synth` turns this into the CloudFormation template the desktop
 * app deploys via cloudformation:CreateStack (customers never install CDK).
 * See DESIGN §5 / §8 / §15.
 *
 * Flow wired here:
 *   SES receipt rule → S3 (raw .eml) + Lambda (inbound-processor → DynamoDB)
 *   Client → API Gateway (Cognito JWT) → access-api Lambda → DynamoDB / S3 / SES
 *   EventBridge (daily) → janitor;  SNS (bounces/complaints) → suppression
 */
export class MailStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The domain this deployment receives mail for (e.g. "ollydigital.com").
    const mailDomain = new CfnParameter(this, "MailDomain", {
      type: "String",
      description: "Primary domain this deployment receives email for (e.g. ollydigital.com).",
    });

    // ---- Storage -----------------------------------------------------------
    // Raw mail: inbound/<messageId>, sent/<messageId>.
    const mailBucket = new s3.Bucket(this, "MailBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // The "mailbox" — manufactured state (flags, folders, threads) on top of S3.
    //   PK = `${domain}#${address}`   SK = `${folder}#${date}#${messageId}`
    const indexTable = new dynamodb.Table(this, "IndexTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    // Thread view (group a conversation across folders).
    indexTable.addGlobalSecondaryIndex({
      indexName: "by-thread",
      partitionKey: { name: "threadId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
    });
    // Locate a row by SES messageId (for raw/flags/move) without scanning.
    indexTable.addGlobalSecondaryIndex({
      indexName: BY_MESSAGE_INDEX,
      partitionKey: { name: "messageId", type: dynamodb.AttributeType.STRING },
    });

    // Per-deployment / per-domain policy + the send suppression list.
    const settingsTable = new dynamodb.Table(this, "SettingsTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- Identity (mailbox access plane) -----------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false, // admins create mailbox users
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: { aliases: new cognito.StringAttribute({ mutable: true }) },
      mfa: cognito.Mfa.OPTIONAL,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient("DesktopMobileClient", {
      authFlows: { userSrp: true },
      // Public client (no secret) — desktop & React Native use SRP.
    });

    // ---- Lambdas -----------------------------------------------------------
    const fn = (name: string, file: string, env: Record<string, string>): NodejsFunction =>
      new NodejsFunction(this, name, {
        entry: path.join(LAMBDA_SRC, file),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: env,
        bundling: {
          format: OutputFormat.CJS,
          target: "node20",
          // Bundle everything (incl. @aws-sdk/*): the clients are in the Node 20
          // runtime, but utility packages like @aws-sdk/s3-request-presigner may
          // not be — bundling guarantees a self-contained, version-pinned artifact.
          externalModules: [],
        },
      });

    const inboundProcessor = fn("InboundProcessor", "inbound-processor.ts", {
      INDEX_TABLE: indexTable.tableName,
      MAIL_BUCKET: mailBucket.bucketName,
      INBOUND_PREFIX: "inbound/",
      HOSTED_DOMAINS: mailDomain.valueAsString,
    });
    mailBucket.grantReadWrite(inboundProcessor); // read the raw .eml + write extracted attachments
    indexTable.grantWriteData(inboundProcessor);
    settingsTable.grantReadData(inboundProcessor);

    const accessApi = fn("AccessApi", "access-api.ts", {
      INDEX_TABLE: indexTable.tableName,
      MAIL_BUCKET: mailBucket.bucketName,
      BY_MESSAGE_INDEX,
      SENT_PREFIX: "sent/",
    });
    indexTable.grantReadWriteData(accessApi);
    mailBucket.grantReadWrite(accessApi);
    settingsTable.grantReadData(accessApi);
    accessApi.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }),
    );

    const janitor = fn("Janitor", "janitor.ts", {
      INDEX_TABLE: indexTable.tableName,
      MAIL_BUCKET: mailBucket.bucketName,
    });
    indexTable.grantReadWriteData(janitor);
    mailBucket.grantReadWrite(janitor);

    const suppression = fn("Suppression", "suppression.ts", {
      SETTINGS_TABLE: settingsTable.tableName,
    });
    settingsTable.grantWriteData(suppression);

    // ---- Inbound pipeline: SES receipt rule → S3 + Lambda ------------------
    const ruleSet = new ses.ReceiptRuleSet(this, "MailRuleSet");
    ruleSet.addRule("InboundRule", {
      recipients: [mailDomain.valueAsString],
      scanEnabled: true, // populate spam/virus verdicts
      actions: [
        new sesActions.S3({ bucket: mailBucket, objectKeyPrefix: "inbound/" }),
        new sesActions.Lambda({
          function: inboundProcessor,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
    });

    // Only one receipt rule set can be active per account/region — activate ours.
    // (No native CFN resource exists; SES API call via a custom resource.)
    const activate = new AwsCustomResource(this, "ActivateRuleSet", {
      onCreate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: PhysicalResourceId.of("mailpoppy-active-rule-set"),
      },
      onUpdate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: PhysicalResourceId.of("mailpoppy-active-rule-set"),
      },
      onDelete: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: {}, // clear the active rule set on stack delete
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      // setActiveReceiptRuleSet is in the runtime's built-in SDK — no need to fetch latest.
      installLatestAwsSdk: false,
    });
    activate.node.addDependency(ruleSet);

    // ---- Access API: HTTP API + Cognito JWT authorizer ---------------------
    const authorizer = new HttpUserPoolAuthorizer("MailboxAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });
    const integration = new HttpLambdaIntegration("AccessApiIntegration", accessApi);
    const httpApi = new HttpApi(this, "MailApi", {
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: ["*"], // desktop (tauri/localhost) + mobile
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type"],
      },
    });
    httpApi.addRoutes({ path: "/messages", methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({ path: "/messages/{id}/raw", methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({ path: "/messages/{id}/attachments/{index}", methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({ path: "/messages/{id}/flags", methods: [HttpMethod.PATCH], integration });
    httpApi.addRoutes({ path: "/messages/{id}/move", methods: [HttpMethod.POST], integration });
    httpApi.addRoutes({ path: "/send", methods: [HttpMethod.POST], integration });

    // ---- Retention janitor (daily) -----------------------------------------
    new events.Rule(this, "JanitorSchedule", {
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new targets.LambdaFunction(janitor)],
    });

    // ---- Bounce/complaint suppression --------------------------------------
    // SES publishes bounce/complaint notifications here; wiring the verified
    // identity → topic is completed at provisioning time (DESIGN §13).
    const notifications = new sns.Topic(this, "MailNotifications");
    notifications.addSubscription(new subs.LambdaSubscription(suppression));

    // ---- Outputs (the desktop app reads these to configure the client) -----
    new CfnOutput(this, "ApiBaseUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "MailBucketName", { value: mailBucket.bucketName });
    new CfnOutput(this, "IndexTableName", { value: indexTable.tableName });
    new CfnOutput(this, "NotificationsTopicArn", { value: notifications.topicArn });
    new CfnOutput(this, "DeployRegion", { value: this.region });
  }
}
