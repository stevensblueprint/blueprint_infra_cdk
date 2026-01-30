import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import PullRequestReminderConstruct from "../constructs/pull-request-reminder-construct";

export interface GithubInfraStackProps extends cdk.StackProps {
  readonly githubOwner: string;
}

export class GithubInfraStack extends cdk.Stack {
  public readonly ghOidc: iam.OpenIdConnectProvider;
  public readonly githubTokenSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: GithubInfraStackProps) {
    super(scope, id, props);

    this.ghOidc = new iam.OpenIdConnectProvider(this, "GitHubOIDCProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
      thumbprints: [
        "6938fd4d98bab03faadb97b34396831e3780aea1",
        "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
      ],
    });

    this.githubTokenSecret = new secretsmanager.Secret(
      this,
      "GithubTokenSecret",
      {
        secretName: "buddy-bot/github-token",
        description:
          "GitHub token for Buddy Bot scheduled PR reminders (needs repo:read access to list PRs)",
      },
    );

    new PullRequestReminderConstruct(this, "PullRequestReminderConstruct", {
      githubTokenSecret: this.githubTokenSecret,
    });

    new cdk.CfnOutput(this, "GithubOidcProviderArn", {
      value: this.ghOidc.openIdConnectProviderArn,
      exportName: `${this.stackName}-GithubOidcProviderArn`,
    });
  }
}
