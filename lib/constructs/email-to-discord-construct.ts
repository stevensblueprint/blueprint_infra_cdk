import * as path from "path";
import { Construct } from "constructs";
import {
  Duration,
  RemovalPolicy,
  Stack,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_s3 as s3,
  aws_ses as ses,
  custom_resources as cr,
} from "aws-cdk-lib";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";

export interface EmailMapping {
  /** Discord webhook URL */
  readonly webhookUrl: string;
  /** Only forward emails from these sender domains, e.g. ["example.com", "partner.com"] */
  readonly allowedSenderDomains: string[];
}

export interface EmailToDiscordProps {
  readonly domainName: string;
  /** Maps email local parts to their config, e.g. { design: { webhookUrl: "https://...", allowedSenderDomains: ["example.com"] } } */
  readonly mappings: Record<string, EmailMapping>;
}

export class EmailToDiscordConstruct extends Construct {
  constructor(scope: Construct, id: string, props: EmailToDiscordProps) {
    super(scope, id);

    const account = Stack.of(this).account;
    const recipients = Object.keys(props.mappings).map(
      (local) => `${local}@${props.domainName}`,
    );

    const emailBucket = new s3.Bucket(this, "InboundEmailBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    emailBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [emailBucket.arnForObjects("*")],
        conditions: {
          StringEquals: { "aws:Referer": account },
        },
      }),
    );

    const fn = new lambda.Function(this, "EmailToDiscordFunction", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambda/email-to-discord-function"),
      ),
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: "Forwards inbound emails to their mapped Discord channels",
      environment: {
        EMAIL_DISCORD_MAPPINGS: JSON.stringify(props.mappings),
        EMAIL_BUCKET: emailBucket.bucketName,
      },
    });

    emailBucket.grantRead(fn);

    fn.addPermission("SesInvoke", {
      principal: new iam.ServicePrincipal("ses.amazonaws.com"),
      sourceAccount: account,
    });

    const ruleSet = new ses.ReceiptRuleSet(this, "InboundRuleSet", {
      receiptRuleSetName: "inbound-invoice-rules",
    });

    ruleSet.addRule("InvoiceEmailRule", {
      recipients,
      actions: [
        new sesActions.S3({
          bucket: emailBucket,
          objectKeyPrefix: "emails/",
        }),
        new sesActions.Lambda({
          function: fn,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
      enabled: true,
      scanEnabled: true,
    });

    new cr.AwsCustomResource(this, "ActiveRuleSet", {
      onCreate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: cr.PhysicalResourceId.of("ActiveReceiptRuleSet"),
      },
      onUpdate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: cr.PhysicalResourceId.of("ActiveReceiptRuleSet"),
      },
      onDelete: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: {},
        physicalResourceId: cr.PhysicalResourceId.of("ActiveReceiptRuleSet"),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });
  }
}
