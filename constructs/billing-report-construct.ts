import * as path from "path";
import { Construct } from "constructs";
import {
  Duration,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_events as events,
  aws_events_targets as targets,
  aws_ses as ses,
} from "aws-cdk-lib";

export interface BillingReportProps {
  readonly senderEmail: string;
  readonly recipientEmails: string;
}

export class BillingReportConstruct extends Construct {
  constructor(scope: Construct, id: string, props: BillingReportProps) {
    super(scope, id);

    new ses.EmailIdentity(this, "BillingReportIdentity", {
      identity: ses.Identity.email(props.senderEmail),
    });
    const lambdaRole = new iam.Role(this, "BillingReportLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Allows Lambda to query Cost Explorer and send via SES",
      inlinePolicies: {
        CostExplorerPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ce:GetCostAndUsage",
                "ce:GetCostAndUsageWithResources",
              ],
              resources: ["*"],
            }),
          ],
        }),
        SESSendEmailPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ses:SendEmail", "ses:SendRawEmail"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    const billingLambda = new lambda.Function(
      this,
      "SendBillingReportFunction",
      {
        runtime: lambda.Runtime.PYTHON_3_8,
        handler: "send_billing_report.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda")),
        role: lambdaRole,
        timeout: Duration.minutes(1),
        environment: {
          SENDER_EMAIL: props.senderEmail,
          RECIPIENT_EMAILS: props.recipientEmails,
        },
      }
    );

    const monthlyRule = new events.Rule(this, "MonthlyBillingRule", {
      schedule: events.Schedule.cron({
        minute: "0",
        hour: "12",
        day: "1",
        month: "*",
        year: "*",
      }),
      description:
        "Trigger the billing‐report Lambda on the first day of each month at 12:00 UTC",
    });

    monthlyRule.addTarget(new targets.LambdaFunction(billingLambda));
    billingLambda.grantInvoke(new iam.ServicePrincipal("events.amazonaws.com"));
  }
}
