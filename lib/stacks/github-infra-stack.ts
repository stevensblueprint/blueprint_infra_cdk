import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import PullRequestReminderConstruct from "../constructs/pull-request-reminder-construct";

export interface GithubInfraStackProps extends cdk.StackProps {
  readonly githubOwner: string;
  readonly githubRepositoryName: string;
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

    const githubActionsRole = new iam.Role(this, "GitHubActionsRole", {
      roleName: "GitHubActionsDeployRole",
      assumedBy: new iam.WebIdentityPrincipal(
        this.ghOidc.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${props.githubOwner}/${props.githubRepositoryName}:*`,
          },
        },
      ),
    });

    githubActionsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
    );

    new PullRequestReminderConstruct(this, "PullRequestReminderConstruct", {
      githubTokenSecret: this.githubTokenSecret,
    });

    new cdk.CfnOutput(this, "GithubOidcProviderArn", {
      value: this.ghOidc.openIdConnectProviderArn,
      exportName: `${this.stackName}-GithubOidcProviderArn`,
    });

    new cdk.CfnOutput(this, "GithubDeployRoleArn", {
      value: githubActionsRole.roleArn,
      exportName: `${this.stackName}-GithubDeployRoleArn`,
    });
  }
}
