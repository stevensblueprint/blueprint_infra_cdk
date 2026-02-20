import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import GithubEcrDeployRole from "./github-ecr-deploy-role";

export interface HsdsConstructProps {
  readonly userPool: cognito.UserPool;
  readonly namePrefix: string;
  readonly githubOwner: string;
  readonly githubRepositoryName: string;
  readonly githubBranchName?: string;
  readonly initialDesiredCount?: number;
  readonly ghOidc: iam.OpenIdConnectProvider;
  readonly domainName: string;
  readonly certificateArn: string;
  readonly subdomainName: string;
}

export default class HsdsConstruct extends Construct {
  public readonly repository: ecr.Repository;
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: HsdsConstructProps) {
    super(scope, id);

    this.repository = new ecr.Repository(
      this,
      `${props.namePrefix}-HsdsRepository`,
      {
        repositoryName: props.githubRepositoryName.toLowerCase(),
        imageScanOnPush: true,
        lifecycleRules: [{ maxImageCount: 30 }],
      },
    );

    const vpc = new ec2.Vpc(this, `${props.namePrefix}-HsdsVpc`, {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, `${props.namePrefix}-HsdsCluster`, {
      vpc,
      enableFargateCapacityProviders: true,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.domainName,
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "Certificate",
      props.certificateArn,
    );

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      `${props.namePrefix}-HsdsService`,
      {
        cluster,
        publicLoadBalancer: true,
        assignPublicIp: true,
        desiredCount: props.initialDesiredCount,
        cpu: 512,
        memoryLimitMiB: 1024,
        taskImageOptions: {
          containerName: "hsds",
          containerPort: 8000,
          image: ecs.ContainerImage.fromEcrRepository(
            this.repository,
            "latest",
          ),
        },
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE_SPOT",
            weight: 1,
          },
        ],
        deploymentController: {
          type: ecs.DeploymentControllerType.ECS,
        },
        circuitBreaker: { rollback: true },
        healthCheckGracePeriod: cdk.Duration.seconds(200),
        taskSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        domainName: `${props.subdomainName}.${props.domainName}`,
        domainZone: hostedZone,
        certificate: certificate,
        redirectHTTP: true,
      },
    );

    const scaling = this.service.service.autoScaleTaskCount({
      minCapacity: 0,
      maxCapacity: 2,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    this.service.targetGroup.configureHealthCheck({
      path: "/health",
      port: "traffic-port",
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      timeout: cdk.Duration.seconds(10),
      interval: cdk.Duration.seconds(30),
    });

    const githubDeployRole = new GithubEcrDeployRole(
      this,
      `${props.namePrefix}-HsdsGithubEcrDeployRole`,
      {
        repoOwner: props.githubOwner,
        repoName: props.githubRepositoryName,
        repository: this.repository,
        ghOidc: props.ghOidc,
        branchRef: props.githubBranchName
          ? `refs/heads/${props.githubBranchName}`
          : undefined,
      },
    );

    new cdk.CfnOutput(this, `${props.namePrefix}HsdsEcrRepositoryUri`, {
      value: this.repository.repositoryUri,
      description: "ECR repository URI for the HSDS service",
    });

    new cdk.CfnOutput(this, `${props.namePrefix}HsdsEcrRepositoryName`, {
      value: this.repository.repositoryName,
      description: "ECR repository name for the HSDS service",
    });

    // new cdk.CfnOutput(this, `${props.namePrefix}HsdsAlbDnsName`, {
    //   value: this.service.loadBalancer.loadBalancerDnsName,
    //   description: "ALB DNS name for HSDS service",
    // });

    new cdk.CfnOutput(this, `${props.namePrefix}HsdsEndpointUrl`, {
      value: `https://${props.subdomainName}.${props.domainName}`,
      description: "Public HTTPS endpoint URL for HSDS",
    });

    new cdk.CfnOutput(this, `${props.namePrefix}HsdsGithubDeployRoleName`, {
      value: githubDeployRole.role.roleName,
      description: "GitHub role name for pushing HSDS images to ECR",
    });

    new cdk.CfnOutput(this, `${props.namePrefix}HsdsGithubDeployRoleArn`, {
      value: githubDeployRole.role.roleArn,
      description: "GitHub role ARN for pushing HSDS images to ECR",
    });
  }
}
