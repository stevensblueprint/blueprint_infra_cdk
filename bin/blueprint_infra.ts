#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BlueprintInfraStack } from "../lib/blueprint_infra-stack";
import { config } from "./config";

const app = new cdk.App();
new BlueprintInfraStack(app, "blueprint-infra-stack", {
  env: {
    account: config.ACCOUNT_ID,
    region: config.AWS_REGION,
  },
  senderEmail: config.SENDER_EMAIL,
  recipientEmails: config.RECIPIENT_EMAILS,
  domainName: config.DOMAIN_NAME,
  subdomainName: config.SUBDOMAIN_NAME,
  certificateArn: config.CERTIFICATE_ARN,
});
