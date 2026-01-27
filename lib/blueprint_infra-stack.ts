import * as cdk from "aws-cdk-lib";
import * as website from "@sitblueprint/website-construct";
import GithubDeployRole from "./constructs/github-deploy-role";
import PullRequestReminderConstruct from "./constructs/pull-request-reminder-construct";
import { Construct } from "constructs";

export interface WebsiteConfiguration {
  /**
   * Logical name for the website (used in Construct IDs and bucket names)
   */
  readonly name: string;

  /**
   * Subdomain name, e.g. "app" or "vault"
   */
  readonly subdomain: string;

  /**
   * GitHub repository name for deployment (optional)
   */
  readonly githubRepositoryName?: string;

  /**
   * GitHub branch name for deployment (optional, defaults to main)
   */
  readonly githubBranchName?: string;
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
   * ARN of an existing ACM certificate in us-east-1 for the domain/subdomain
   */
  readonly certificateArn: string;

  /**
   * GitHub owner or organization name
   */
  readonly githubOwner: string;

  /**
   * List of websites to deploy
   */
  readonly websites: WebsiteConfiguration[];
}

export class BlueprintInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BlueprintInfraStackProps) {
    super(scope, id, props);

    props.websites.forEach((site) => {
      const siteId = site.name.replace(/\s+/g, "-");
      const websiteConstruct = new website.Website(this, `${siteId}-Website`, {
        bucketName: `${site.name.toLowerCase()}-website`,
        indexFile: "index.html",
        errorFile: "index.html",
        notFoundResponsePagePath: "/404.html",
        domainConfig: {
          domainName: props.domainName,
          subdomainName: site.subdomain,
          certificateArn: props.certificateArn,
        },
      });

      if (site.githubRepositoryName) {
        new GithubDeployRole(this, `${siteId}-GithubDeployRole`, {
          bucketName: websiteConstruct.bucket.bucketName,
          distributionId: websiteConstruct.distribution.distributionId,
          repoOwner: props.githubOwner,
          repoName: site.githubRepositoryName,
          branchRef: `refs/heads/${site.githubBranchName ?? "main"}`,
        });
      }

      new cdk.CfnOutput(this, `${siteId}-BucketName`, {
        value: websiteConstruct.bucket.bucketName,
      });
      new cdk.CfnOutput(this, `${siteId}-CloudFrontDistributionId`, {
        value: websiteConstruct.distribution.distributionId,
      });
    });

    new PullRequestReminderConstruct(this, "PullRequestReminderFunction");
  }
}
