import * as cdk from "aws-cdk-lib";
import * as website from "@sitblueprint/website-construct";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import GithubDeployRole from "./constructs/github-deploy-role";
import PullRequestReminderConstruct from "./constructs/pull-request-reminder-construct";
import PasswordVaultConstruct from "./constructs/password-vault-construct";
import { BillingReportConstruct } from "./constructs/billing-report-construct";
import AuthPoolConstruct from "./constructs/auth-pool-construct";
import { Construct } from "constructs";

type SiteFactory = (
  scope: Construct,
  id: string,
  args: {
    site: WebsiteConfiguration;
    siteId: string;
    authPool: AuthPoolConstruct;
  },
) => void;

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

  /**
   * Whether the website requires authentication (optional, defaults to false)
   */
  readonly requiresAuth?: boolean;
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

const siteFactoryMap = new Map<string, SiteFactory>([
  [
    "vault",
    (scope, id, { siteId, authPool }) => {
      new PasswordVaultConstruct(scope, id, {
        codePath: "password-vault-function",
        userPool: authPool.userPool,
        namePrefix: siteId,
      });
    },
  ],
]);

export class BlueprintInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BlueprintInfraStackProps) {
    super(scope, id, props);

    const authPool = new AuthPoolConstruct(this, "AuthPoolConstruct", {
      domainName: props.domainName,
      certificateArn: props.certificateArn,
    });

    const githubTokenSecret = new secretsmanager.Secret(
      this,
      "GithubTokenSecret",
      {
        secretName: "buddy-bot/github-token",
        description:
          "GitHub token for Buddy Bot scheduled PR reminders (needs repo:read access to list PRs)",
      },
    );

    const ghOidc = new iam.OpenIdConnectProvider(this, "GitHubOIDCProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
      thumbprints: [
        "6938fd4d98bab03faadb97b34396831e3780aea1",
        "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
      ],
    });

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

      if (site.githubRepositoryName)
        new GithubDeployRole(this, `${siteId}-GithubDeployRole`, {
          bucketName: websiteConstruct.bucket.bucketName,
          distributionId: websiteConstruct.distribution.distributionId,
          repoOwner: props.githubOwner,
          repoName: site.githubRepositoryName,
          ghOidc: ghOidc,
          branchRef: `refs/heads/${site.githubBranchName ?? "main"}`,
        });

      if (site.requiresAuth) {
        authPool.createWebsiteGroup(siteId);
        authPool.addClientApp(
          `${siteId}-WebsiteAuth`,
          [`https://${site.subdomain}.${props.domainName}/callback`],
          [`https://${site.subdomain}.${props.domainName}/logout`],
        );
      }

      const factory = siteFactoryMap.get(site.name);
      if (factory) {
        factory(this, `${siteId}-SiteFactory`, {
          site,
          siteId,
          authPool,
        });
      }

      new cdk.CfnOutput(this, `Site${siteId}Bucket`, {
        value: websiteConstruct.bucket.bucketName,
        description: `S3 Bucket Name for ${site.name}`,
      });
      new cdk.CfnOutput(this, `Site${siteId}Distribution`, {
        value: websiteConstruct.distribution.distributionId,
        description: `CloudFront Distribution ID for ${site.name}`,
      });
    });

    new BillingReportConstruct(this, "BillingReportConstruct", {
      senderEmail: props.senderEmail,
      recipientEmails: props.recipientEmails,
      codePath: "billing-report-function",
    });

    new PullRequestReminderConstruct(this, "PullRequestReminderConstruct", {
      githubTokenSecret: githubTokenSecret,
    });
  }
}
