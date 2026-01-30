import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import AuthPoolConstruct from "../constructs/auth-pool-construct";

export interface AuthStackProps extends cdk.StackProps {
  readonly domainName: string;
  readonly certificateArn: string;
}

export class AuthStack extends cdk.Stack {
  public readonly authPool: AuthPoolConstruct;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.authPool = new AuthPoolConstruct(this, "AuthPoolConstruct", {
      domainName: props.domainName,
      certificateArn: props.certificateArn,
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.authPool.userPool.userPoolId,
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, "UserPoolArn", {
      value: this.authPool.userPool.userPoolArn,
      exportName: `${this.stackName}-UserPoolArn`,
    });
  }
}
