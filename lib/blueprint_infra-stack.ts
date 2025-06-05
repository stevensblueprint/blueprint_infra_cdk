import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BillingReportConstruct } from "../constructs/billing-report-construct";

export interface BlueprintInfraStackProps extends StackProps {
  /**
   * SES‐verified sender address, e.g. "billing@example.com"
   */
  readonly senderEmail: string;

  /**
   * Comma‐separated list of all recipients, e.g. "acct@example.com,finance@example.com"
   */
  readonly recipientEmails: string;
}

export class BlueprintInfraStack extends Stack {
  constructor(scope: Construct, id: string, props: BlueprintInfraStackProps) {
    super(scope, id, props);
    new BillingReportConstruct(this, "MonthlyBillingReport", {
      senderEmail: props.senderEmail,
      recipientEmails: props.recipientEmails,
    });
  }
}
