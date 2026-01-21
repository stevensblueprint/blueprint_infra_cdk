import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface GithubDeployRoleProps {
  bucketName: string;
  distributionId: string;
  repoOwner: string;
  repoName: string;
  branchRef?: string; // default: "refs/heads/main"
}

export default class GithubDeployRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubDeployRoleProps) {
    super(scope, id);
    const branchRef = props.branchRef ?? "refs/heads/main";

    const ghOidc = new iam.OpenIdConnectProvider(this, "GitHubOIDC", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    this.role = new iam.Role(this, "GithubDeployerRole", {
      roleName: `github-deployer-${props.repoName}`,
      assumedBy: new iam.OpenIdConnectPrincipal(ghOidc).withConditions({
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${props.repoOwner}/${props.repoName}:ref:${branchRef}`,
        },
      }),
      description:
        "GitHub Actions can deploy static site to S3 and invalidate CloudFront.",
    });

    const bucketArn = `arn:aws:s3:::${props.bucketName}`;
    const bucketObjsArn = `${bucketArn}/*`;

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:GetBucketLocation",
          "s3:GetObject",
        ],
        resources: [bucketArn, bucketObjsArn],
      })
    );

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${
            props.distributionId
          }`,
        ],
      })
    );
  }
}
