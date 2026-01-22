import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

export default class PullRequestReminderConstruct extends Construct {
  public readonly functionUrl: string;

  constructor(scope: Construct, id: string) {
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

    const handler = new lambda.Function(this, "BuddyHandler", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambda/pull-request-reminder-function"),
      ),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      description:
        "Sends Discord reminders for unreviewed pull requests in GitHub repos",
      environment: {
        TEAM_CONFIG_SECRET_ARN: teamConfigSecret.secretArn,
      },
    });

    teamConfigSecret.grantRead(handler);

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
  }
}
