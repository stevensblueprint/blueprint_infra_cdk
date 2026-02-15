import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as apigw from "aws-cdk-lib/aws-apigateway";

export interface AdminConstructProps {
  readonly userPool: cognito.IUserPool;
  readonly namePrefix: string;
}

export default class AdminConstruct extends Construct {
  public readonly fn: lambda.Function;
  public readonly api: apigw.LambdaRestApi;

  constructor(scope: Construct, id: string, props: AdminConstructProps) {
    super(scope, id);

    this.fn = new lambda.Function(this, `${props.namePrefix}-AdminFunction`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "admin-api-function")),
    });

    this.api = new apigw.LambdaRestApi(this, `${props.namePrefix}-AdminApi`, {
      handler: this.fn,
      deployOptions: {
        stageName: "prod",
        metricsEnabled: true,
        dataTraceEnabled: true,
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: [
          "Authorization",
          "Content-Type",
          "X-Amz-Date",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
      },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [props.userPool],
      },
    );

    const lambdaIntegration = new apigw.LambdaIntegration(this.fn, {
      proxy: true,
    });

    this.api.root.addMethod("GET", lambdaIntegration, {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
  }
}
