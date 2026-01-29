import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface PullRequestReminderConstructProps {
  githubTokenSecret: secretsmanager.ISecret;
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

    new cdk.CfnOutput(this, "PullRequestReminderFunctionUrl", {
      value: this.functionUrl,
    });

    new cdk.CfnOutput(this, "PullRequestReminderScheduleGroup", {
      value: scheduleGroup.name ?? "buddy-bot-pr-reminders",
    });

    new cdk.CfnOutput(this, "PullRequestReminderReminderLambdaArn", {
      value: reminderHandler.functionArn,
    });
  }
}
