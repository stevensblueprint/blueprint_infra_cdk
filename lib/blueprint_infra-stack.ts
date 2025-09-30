import * as cdk from "aws-cdk-lib";
import * as website from "@sitblueprint/website-construct";
import GithubDeployRole from "../constructs/github-deploy-role";
import { Construct } from "constructs";

export interface SourceActionConfig {
  /**
   * GitHub owner or organization name
   */
  readonly githubOwner: string;

  /**
   * GitHub repository name
   */
  readonly githubRepositoryName: string;

  /**
   * GitHub branch name
   */
  readonly githubBranchName: string;
}

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

  /**
   * Configuration for the source action of the pipeline
   */
  readonly sourceAction: SourceActionConfig;
}

export class BlueprintInfraStack extends cdk.Stack {
  private readonly blueprintChat: string = "blueprint-chat";
  constructor(scope: Construct, id: string, props: BlueprintInfraStackProps) {
    super(scope, id, props);

    const blueprintChatWebsite = new website.Website(
      this,
      "Blueprint-Chat-Website",
      {
        bucketName: `${this.blueprintChat}-website`,
        indexFile: "index.html",
        errorFile: "index.html",
        notFoundResponsePagePath: "/404.html",
        domainConfig: {
          domainName: props.domainName,
          subdomainName: props.subdomainName,
          certificateArn: props.certificateArn,
        },
      }
    );

    new GithubDeployRole(this, "GithubDeployRole", {
      bucketName: blueprintChatWebsite.bucket.bucketName,
      distributionId: blueprintChatWebsite.distribution.distributionId,
      repoOwner: props.sourceAction.githubOwner,
      repoName: props.sourceAction.githubRepositoryName,
      branchRef: `refs/heads/${props.sourceAction.githubBranchName}`,
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: blueprintChatWebsite.bucket.bucketName,
    });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: blueprintChatWebsite.distribution.distributionId,
    });
  }
}
