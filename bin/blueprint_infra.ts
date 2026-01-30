#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/stacks/auth-stack";
import { GithubInfraStack } from "../lib/stacks/github-infra-stack";
import { WebsiteStack } from "../lib/stacks/website-stack";
import { BillingStack } from "../lib/stacks/billing-stack";
import { config } from "./config";

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const authStack = new AuthStack(app, "blueprint-auth-stack", {
  description: "Authentication stack for Blueprint infrastructure",
  env,
  domainName: config.domainName,
  certificateArn: config.certificateArn,
});

const githubStack = new GithubInfraStack(app, "blueprint-github-stack", {
  description: "GitHub OIDC provider stack for Blueprint infrastructure",
  env,
  githubOwner: config.githubOwner,
});

new BillingStack(app, "blueprint-billing-stack", {
  description: "Billing report stack for Blueprint infrastructure",
  env,
  senderEmail: config.senderEmail,
  recipientEmails: config.recipientEmails,
});

config.websites.forEach((website) => {
  const siteId = website.name.replace(/\s+/g, "-");
  const websiteStack = new WebsiteStack(
    app,
    `blueprint-${siteId}-website-stack`,
    {
      description: `Website stack for ${website.name} website`,
      env,
      domainName: config.domainName,
      certificateArn: config.certificateArn,
      githubOwner: config.githubOwner,
      website,
      userPool: authStack.authPool.userPool,
      ghOidc: githubStack.ghOidc,
    },
  );
  websiteStack.addDependency(authStack);
  websiteStack.addDependency(githubStack);
});

app.synth();
