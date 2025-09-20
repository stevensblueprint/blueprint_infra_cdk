#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BlueprintInfraStack } from "../lib/blueprint_infra-stack";

import * as dotenv from "dotenv";

dotenv.config();

const app = new cdk.App();
new BlueprintInfraStack(app, "blueprint-infra-stack", {
  env: {
    account: process.env.ACCOUNT_ID,
    region: process.env.AWS_REGION || "us-east-1",
  },
  senderEmail: process.env.SENDER_EMAIL || "",
  recipientEmails: process.env.RECIPIENT_EMAILS || "",
  domainName: process.env.DOMAIN_NAME || "",
  subdomainName: process.env.SUBDOMAIN_NAME || "",
  certificateArn: process.env.CERTIFICATE_ARN || "",
});
