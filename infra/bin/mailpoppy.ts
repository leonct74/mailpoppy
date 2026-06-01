import { App } from "aws-cdk-lib";
import { MailStack } from "../lib/mail-stack";

// `cdk synth` produces the CloudFormation template that the desktop app ships and
// deploys into the customer's account via cloudformation:CreateStack/UpdateStack
// (so customers never need CDK installed). DESIGN §15.
const app = new App();
new MailStack(app, "MailpoppyMailStack");
app.synth();
