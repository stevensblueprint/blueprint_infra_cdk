import * as cdk from "aws-cdk-lib";
import * as website from "@sitblueprint/website-construct";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import GithubDeployRole from "../constructs/github-deploy-role";
import PasswordVaultConstruct from "../constructs/password-vault-construct";
import AdminConstruct from "../constructs/admin-construct";
import HsdsConstruct from "../constructs/hsds-construct";

export interface WebsiteConfiguration {
  readonly name: string;
  readonly subdomain: string;
  readonly githubRepositoryName?: string;
  readonly githubBranchName?: string;
  readonly requiresAuth?: boolean;
  readonly includeRootDomain?: boolean;
}

export interface WebsiteStackProps extends cdk.StackProps {
  readonly domainName: string;
  readonly certificateArn: string;
  readonly githubOwner: string;
  readonly website: WebsiteConfiguration;
  readonly userPool: cognito.IUserPool;
  readonly ghOidc: iam.OpenIdConnectProvider;
}

type SiteFactory = (
  scope: Construct,
  id: string,
  args: {
    site: WebsiteConfiguration;
    siteId: string;
    userPool: cognito.IUserPool;
    githubOwner: string;
    ghOidc: iam.OpenIdConnectProvider;
    domainName: string;
    certificateArn: string;
  },
) => void;

const siteFactoryMap = new Map<string, SiteFactory>([
  [
    "vault",
    (scope, id, { siteId, userPool }) => {
      new PasswordVaultConstruct(scope, id, {
        codePath: "password-vault-function",
        userPool: userPool as cognito.UserPool,
        namePrefix: siteId,
      });
    },
  ],
  [
    "hsds-transformer",
    (
      scope,
      id,
      {
        site,
        siteId,
        userPool,
        githubOwner,
        ghOidc,
        domainName,
        certificateArn,
      },
    ) => {
      new HsdsConstruct(scope, id, {
        userPool: userPool as cognito.UserPool,
        namePrefix: siteId,
        githubOwner,
        githubRepositoryName: site.githubRepositoryName ?? `${siteId}-service`,
        githubBranchName: site.githubBranchName,
        ghOidc,
        domainName,
        certificateArn,
        subdomainName: site.subdomain,
      });
    },
  ],
  // [
  //   "admin",
  //   (scope, id, { siteId, userPool }) => {
  //     new AdminConstruct(scope, id, {
  //       userPool: userPool as cognito.UserPool,
  //       namePrefix: siteId,
  //     });
  //   },
  // ],
]);

const LOCAL_URLS = ["http://localhost:3000", "http://localhost:5173"];

export class WebsiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    const site = props.website;
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
        includeRootDomain: site.includeRootDomain ?? false,
      },
      previewConfig: {
        bucketPrefix: `${siteId}-preview-`,
        bucketCount: 5,
        maxLeaseHours: 12,
      },
    });

    websiteConstruct.previewEnvironment?.buckets.forEach((bucket, index) => {
      new cdk.CfnOutput(this, `PreviewBucket${siteId}${index + 1}`, {
        value: bucket.bucketName,
        description: `S3 Bucket Name for ${site.name} Preview Environment ${index + 1}`,
      });
    });

    if (site.githubRepositoryName) {
      new GithubDeployRole(this, `${siteId}-GithubDeployRole`, {
        bucketNames: [
          websiteConstruct.bucket.bucketName,
          ...(websiteConstruct.previewEnvironment?.buckets.map(
            (b) => b.bucketName,
          ) ?? []),
        ],
        distributionIds: [
          websiteConstruct.distribution.distributionId,
          ...(websiteConstruct.previewEnvironment?.distributions.map(
            (d) => d.distributionId,
          ) ?? []),
        ],
        repoOwner: props.githubOwner,
        repoName: site.githubRepositoryName,
        ghOidc: props.ghOidc,
        branchRef: `refs/heads/${site.githubBranchName ?? "main"}`,
      });
    }

    if (site.requiresAuth) {
      const groupName = `website-${siteId}-access`;
      new cognito.CfnUserPoolGroup(this, `${siteId}WebsiteGroup`, {
        userPoolId: props.userPool.userPoolId,
        groupName: groupName,
        description: `Access group for website ${siteId}`,
      });
      const client = props.userPool.addClient(`${siteId}-WebsiteAuth`, {
        userPoolClientName: `${siteId}-WebsiteAuth`,
        generateSecret: false,
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
          callbackUrls: [
            `https://${site.subdomain}.${props.domainName}/callback`,
            ...LOCAL_URLS.map((url) => `${url}/callback`),
          ],
          logoutUrls: [
            `https://${site.subdomain}.${props.domainName}/logout`,
            ...LOCAL_URLS.map((url) => `${url}/logout`),
          ],
        },
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.COGNITO,
        ],
      });

      new cognito.CfnManagedLoginBranding(
        this,
        `${siteId}ManagedLoginBranding`,
        {
          userPoolId: props.userPool.userPoolId,
          clientId: client.userPoolClientId,
          useCognitoProvidedValues: true,
        },
      );

      new cdk.CfnOutput(this, `AuthClient${siteId}`, {
        value: client.userPoolClientId,
        description: `Cognito Client ID for ${siteId}`,
      });
    }

    const factory = siteFactoryMap.get(site.name);
    if (factory) {
      factory(this, `${siteId}-SiteFactory`, {
        site,
        siteId,
        userPool: props.userPool,
        githubOwner: props.githubOwner,
        ghOidc: props.ghOidc,
        domainName: props.domainName,
        certificateArn: props.certificateArn,
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
  }
}
