import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface GithubEcrDeployRoleProps {
  readonly repoOwner: string;
  readonly repoName: string;
  readonly repository: ecr.IRepository;
  readonly ghOidc: iam.OpenIdConnectProvider;
  readonly branchRef?: string;
}

export default class GithubEcrDeployRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubEcrDeployRoleProps) {
    super(scope, id);
    const branchRef = props.branchRef ?? "refs/heads/*";
    const normalizedBranchRef = branchRef.replace(/^ref:/, "");

    this.role = new iam.Role(this, "GithubEcrDeployerRole", {
      roleName: `github-ecr-deployer-${props.repoName}`,
      assumedBy: new iam.OpenIdConnectPrincipal(props.ghOidc).withConditions({
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${props.repoOwner}/${props.repoName}:*`,
        },
      }),
      description: "GitHub Actions can push container images to ECR.",
    });

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        resources: [props.repository.repositoryArn],
      }),
    );

    new cdk.CfnOutput(this, `GithubEcrDeployRoleArn${props.repoName}`, {
      value: this.role.roleArn,
      description: `ARN of the GitHub ECR deploy role for ${props.repoName}`,
    });
  }
}
