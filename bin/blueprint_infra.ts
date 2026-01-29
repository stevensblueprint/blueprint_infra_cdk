#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BlueprintInfraStack } from "../lib/blueprint_infra-stack";
import { config } from "./config";

const app = new cdk.App();
new BlueprintInfraStack(app, "blueprint-infra-stack", {
  description: "Blueprint Infrastructure Stack",
  env: {
    account: config.account,
    region: config.region,
  },
  senderEmail: config.senderEmail,
  recipientEmails: config.recipientEmails,
  domainName: config.domainName,
  certificateArn: config.certificateArn,
  githubOwner: config.githubOwner,
  websites: config.websites,
});
