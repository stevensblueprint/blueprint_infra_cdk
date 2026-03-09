import * as path from "path";
import { Construct } from "constructs";
import {
  Duration,
  RemovalPolicy,
  Stack,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_route53 as route53,
  aws_s3 as s3,
  aws_ses as ses,
} from "aws-cdk-lib";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";

export interface EmailToDiscordProps {
  readonly domainName: string;
  /** Maps email local parts to Discord webhook URLs, e.g. { design: "https://..." } */
  readonly mappings: Record<string, string>;
}

export class EmailToDiscordConstruct extends Construct {
  constructor(scope: Construct, id: string, props: EmailToDiscordProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const recipients = Object.keys(props.mappings).map(
      (local) => `${local}@${props.domainName}`,
    );

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.domainName,
    });

    // MX record — directs inbound mail to SES
    new route53.MxRecord(this, "SesInboundMxRecord", {
      zone: hostedZone,
      values: [
        { priority: 10, hostName: `inbound-smtp.${region}.amazonaws.com` },
      ],
    });

    // Domain identity — auto-creates DKIM records in Route53
    new ses.EmailIdentity(this, "DomainIdentity", {
      identity: ses.Identity.publicHostedZone(hostedZone),
    });

    // S3 bucket to hold raw inbound emails
    const emailBucket = new s3.Bucket(this, "InboundEmailBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Allow SES to write emails into the bucket
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

    // Lambda that parses the email and posts to the matching Discord channel
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

    // Receipt rule set
    const ruleSet = new ses.ReceiptRuleSet(this, "InboundRuleSet", {
      receiptRuleSetName: "inbound-invoice-rules",
    });

    // One rule covers all mapped addresses
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

    // Activate the rule set (only one can be active per region)
    new ses.CfnActiveReceiptRuleSet(this, "ActiveRuleSet", {
      ruleSetName: ruleSet.receiptRuleSetName,
    });
  }
}
