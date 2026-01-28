import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface PasswordVaultConstructProps {
  codePath: string;
  userPool: cognito.UserPool;
  namePrefix?: string;
}

export default class PasswordVaultConstruct extends Construct {
  public readonly table: dynamodb.Table;
  public readonly fn: lambda.Function;
  public readonly api: apigw.RestApi;
  public readonly userPool?: cognito.UserPool;

  constructor(
    scope: Construct,
    id: string,
    props: PasswordVaultConstructProps,
  ) {
    super(scope, id);
    const prefix = props.namePrefix ?? "password-vault";

    this.table = new dynamodb.Table(this, "PasswordEntriesTable", {
      tableName: `${prefix}-entries`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fn = new lambda.Function(this, "PasswordVaultFunction", {
      functionName: `${prefix}-api`,
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "..", "..", "lambda", props.codePath),
      ),
      handler: "main.handler",
      timeout: Duration.seconds(15),
      environment: {
        PASSWORD_ENTRIES_TABLE_NAME: this.table.tableName,
      },
    });

    this.table.grantReadWriteData(this.fn);

    this.api = new apigw.RestApi(this, "PasswordVaultApi", {
      restApiName: `${prefix}-api`,
      deployOptions: {
        stageName: "v1",
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

    /**
     * Routes:
     *  POST /passwords
     *  GET /passwords
     */
    const passwords = this.api.root.addResource("passwords");
    passwords.addMethod("GET", lambdaIntegration, {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });

    passwords.addMethod("POST", lambdaIntegration, {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });

    this.fn.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: this.api.arnForExecuteApi("*", "/*", "*"),
    });

    new cdk.CfnOutput(this, "PasswordVaultApiUrl", {
      value: this.api.url,
    });
  }
}
