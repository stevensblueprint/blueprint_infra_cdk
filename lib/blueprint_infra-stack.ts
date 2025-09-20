import * as cdk from "aws-cdk-lib";
import * as billingConstructs from "../constructs/billing-report-construct";
import * as website from "@sitblueprint/website-construct";
import * as pipeline from "@sitblueprint/pipeline-construct";
import { Construct } from "constructs";

export interface BlueprintInfraStackProps extends cdk.StackProps {
  /**
   * SES‐verified sender address, e.g. "billing@example.com"
   */
  readonly senderEmail: string;

  /**
   * Comma‐separated list of all recipients, e.g. "acct@example.com,finance@example.com"
   */
  readonly recipientEmails: string;

  /**
   * Domain name for the website, e.g. "example.com"
   */
  readonly domainName: string;

  /**
   * Subdomain name for the website, e.g. "app"
   */
  readonly subdomainName: string;

  /**
   * ARN of an existing ACM certificate in us-east-1 for the domain/subdomain
   */
  readonly certificateArn: string;
}

export class BlueprintInfraStack extends cdk.Stack {
  private readonly blueprintChat: string = "blueprint-chat";
  constructor(scope: Construct, id: string, props: BlueprintInfraStackProps) {
    super(scope, id, props);
    new billingConstructs.BillingReportConstruct(this, "MonthlyBillingReport", {
      senderEmail: props.senderEmail,
      recipientEmails: props.recipientEmails,
    });

    new website.Website(this, "Blueprint-Chat-Website", {
      bucketName: `${this.blueprintChat}-website`,
      indexFile: "index.html",
      errorFile: "index.html",
      notFoundResponsePagePath: "404.html",
      domainConfig: {
        domainName: props.domainName,
        subdomainName: props.subdomainName,
        certificateArn: props.certificateArn,
      },
    });
  }
}
