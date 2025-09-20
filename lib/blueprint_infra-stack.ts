import * as cdk from "aws-cdk-lib";
import * as billingConstructs from "../constructs/billing-report-construct";
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
}

export class BlueprintInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BlueprintInfraStackProps) {
    super(scope, id, props);
    new billingConstructs.BillingReportConstruct(this, "MonthlyBillingReport", {
      senderEmail: props.senderEmail,
      recipientEmails: props.recipientEmails,
    });
  }
}
