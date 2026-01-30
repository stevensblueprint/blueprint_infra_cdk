import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { BillingReportConstruct } from "../constructs/billing-report-construct";

export interface BillingStackProps extends cdk.StackProps {
  readonly senderEmail: string;
  readonly recipientEmails: string;
}

export class BillingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BillingStackProps) {
    super(scope, id, props);

    new BillingReportConstruct(this, "BillingReportConstruct", {
      senderEmail: props.senderEmail,
      recipientEmails: props.recipientEmails,
      codePath: "billing-report-function",
    });
  }
}
