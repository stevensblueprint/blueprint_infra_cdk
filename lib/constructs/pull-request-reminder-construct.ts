import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";

export interface PullRequestReminderConstructProps {
  githubTokenSecret: secretsmanager.ISecret;
  userPool: cognito.IUserPool;
}

export default class PullRequestReminderConstruct extends Construct {
  public readonly functionUrl: string;

  constructor(
    scope: Construct,
    id: string,
    props: PullRequestReminderConstructProps,
  ) {
    super(scope, id);

    const teamConfigSecret = new secretsmanager.Secret(
      this,
      "TeamConfigSecret",
      {
        secretName: "buddy-bot/team-config",
        description:
          "Configuration for GitHub Buddy Bot (Discord Webhooks & Mappings)",
        secretStringValue: cdk.SecretValue.unsafePlainText(
          JSON.stringify({
            teams: [],
          }),
        ),
      },
    );

    const reminderHandler = new lambda.Function(
      this,
      "PullRequestReminderCron",
      {
        runtime: lambda.Runtime.PYTHON_3_11,
        handler: "main.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../lambda/pull-request-cron-function"),
        ),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        description:
          "Cron job that triggers the Pull Request Reminder after a threshold",
        environment: {
          GITHUB_TOKEN_SECRET_ARN: props.githubTokenSecret.secretArn,
        },
      },
    );

    teamConfigSecret.grantRead(reminderHandler);
    props.githubTokenSecret.grantRead(reminderHandler);

    const scheduleGroup = new scheduler.CfnScheduleGroup(
      this,
      "BuddySchedules",
      {
        name: "buddy-bot-schedule-group",
      },
    );

    const schedulerInvokeRole = new iam.Role(this, "SchedulerInvokeRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to invoke the reminder Lambda",
    });

    schedulerInvokeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [reminderHandler.functionArn],
      }),
    );

    const handler = new lambda.Function(this, "BuddyHandler", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambda/pull-request-reminder-function"),
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description:
        "Sends Discord reminders for unreviewed pull requests in GitHub repos",
      environment: {
        TEAM_CONFIG_SECRET_ARN: teamConfigSecret.secretArn,
        SCHEDULER_GROUP_NAME: scheduleGroup.name ?? "buddy-bot-pr-reminders",
        REMINDER_FUNCTION_ARN: reminderHandler.functionArn,
        SCHEDULER_INVOKE_ROLE_ARN: schedulerInvokeRole.roleArn,
      },
    });

    teamConfigSecret.grantRead(handler);

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
        ],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: "scheduler",
            resource: "schedule",
            resourceName: `${scheduleGroup.name}/*`,
          }),
          cdk.Stack.of(this).formatArn({
            service: "scheduler",
            resource: "schedule-group",
            resourceName: `${scheduleGroup.name}`,
          }),
        ],
      }),
    );

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerInvokeRole.roleArn],
        conditions: {
          StringEquals: { "iam:PassedToService": "scheduler.amazonaws.com" },
        },
      }),
    );

    const fnUrl = handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.POST],
      },
    });
    this.functionUrl = fnUrl.url;

    new cdk.CfnOutput(this, "PRReminderFunctionUrl", {
      value: this.functionUrl,
      description: "Function URL for the Pull Request Reminder Lambda",
    });

    new cdk.CfnOutput(this, "PRReminderScheduleGroup", {
      value: scheduleGroup.name ?? "buddy-bot-pr-reminders",
      description: "EventBridge Schedule Group for PR reminders",
    });

    new cdk.CfnOutput(this, "PRReminderLambdaArn", {
      value: reminderHandler.functionArn,
      description: "ARN of the underlying PR Reminder Lambda function",
    });

    // --- Config API ---

    const configHandler = new lambda.Function(this, "BuddyBotConfigHandler", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambda/buddy-bot-config-function"),
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: "REST API handler for managing Buddy Bot team configuration",
      environment: {
        TEAM_CONFIG_SECRET_ARN: teamConfigSecret.secretArn,
      },
    });

    teamConfigSecret.grantRead(configHandler);
    teamConfigSecret.grantWrite(configHandler);

    const configApi = new apigw.RestApi(this, "BuddyBotConfigApi", {
      restApiName: "BuddyBotConfigApi",
      deployOptions: {
        stageName: "prod",
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
      "ConfigApiAuthorizer",
      {
        cognitoUserPools: [props.userPool],
      },
    );

    const configIntegration = new apigw.LambdaIntegration(configHandler, {
      proxy: true,
    });

    const methodOptions: apigw.MethodOptions = {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    };

    // /config
    const configResource = configApi.root.addResource("config");
    configResource.addMethod("GET", configIntegration, methodOptions);
    configResource.addMethod("PUT", configIntegration, methodOptions);

    // /config/settings
    const settingsResource = configResource.addResource("settings");
    settingsResource.addMethod("GET", configIntegration, methodOptions);
    settingsResource.addMethod("PUT", configIntegration, methodOptions);

    // /config/teams
    const teamsResource = configResource.addResource("teams");
    teamsResource.addMethod("GET", configIntegration, methodOptions);
    teamsResource.addMethod("POST", configIntegration, methodOptions);

    // /config/teams/{teamName}
    const teamResource = teamsResource.addResource("{teamName}");
    teamResource.addMethod("GET", configIntegration, methodOptions);
    teamResource.addMethod("PUT", configIntegration, methodOptions);
    teamResource.addMethod("DELETE", configIntegration, methodOptions);

    // /config/teams/{teamName}/repositories
    const reposResource = teamResource.addResource("repositories");
    reposResource.addMethod("GET", configIntegration, methodOptions);
    reposResource.addMethod("POST", configIntegration, methodOptions);

    // /config/teams/{teamName}/repositories/{repoName}
    const repoResource = reposResource.addResource("{repoName}");
    repoResource.addMethod("DELETE", configIntegration, methodOptions);

    // /config/teams/{teamName}/buddies
    const buddiesResource = teamResource.addResource("buddies");
    buddiesResource.addMethod("PUT", configIntegration, methodOptions);

    // /config/teams/{teamName}/username-mappings
    const mappingsResource = teamResource.addResource("username-mappings");
    mappingsResource.addMethod("PUT", configIntegration, methodOptions);

    // Inject CORS headers on gateway-level errors (401, 403, etc.)
    // so the browser can read the error response instead of a CORS block.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "'*'",
      "Access-Control-Allow-Headers":
        "'Authorization,Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
    };
    configApi.addGatewayResponse("Default4xx", {
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });
    configApi.addGatewayResponse("Default5xx", {
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
    });

    new cdk.CfnOutput(this, "BuddyBotConfigApiUrl", {
      value: configApi.url,
      description: "URL for the Buddy Bot Config REST API",
    });
  }
}
