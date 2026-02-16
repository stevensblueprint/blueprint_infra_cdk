import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface GithubDeployRoleProps {
  bucketNames: string[];
  distributionIds: string[];
  repoOwner: string;
  repoName: string;
  ghOidc: iam.OpenIdConnectProvider;
  branchRef?: string; // default: "refs/heads/main"
}

export default class GithubDeployRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubDeployRoleProps) {
    super(scope, id);

    this.role = new iam.Role(this, "GithubDeployerRole", {
      roleName: `github-deployer-${props.repoName}`,
      assumedBy: new iam.OpenIdConnectPrincipal(props.ghOidc).withConditions({
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${props.repoOwner}/${props.repoName}:*`,
        },
      }),
      description:
        "GitHub Actions can deploy static site to S3 and invalidate CloudFront.",
    });

    const bucketArns = props.bucketNames.map(
      (bucketName) => `arn:aws:s3:::${bucketName}`,
    );
    const bucketObjsArns = bucketArns.map((bucketArn) => `${bucketArn}/*`);

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
        resources: [...bucketArns, ...bucketObjsArns],
      }),
    );

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          ...props.distributionIds.map(
            (distributionId) =>
              `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${distributionId}`,
          ),
        ],
      }),
    );

    new cdk.CfnOutput(this, `GithubDeployRoleArn${props.repoName}`, {
      value: this.role.roleArn,
      description: `ARN of the GitHub Deploy Role for ${props.repoName}`,
    });
  }
}
