# GitHub Buddy Bot (Lambda Function)

This directory contains the source code for the GitHub Buddy Bot, a serverless function that processes GitHub Pull Request webhooks and sends notifications to a designated "coding buddy" on Discord.

## Overview

The function performs the following steps:
1. Verifies the HMAC signature of the incoming GitHub webhook request.
2. Retrieves team configurations and buddy mappings from AWS Secrets Manager.
3. Identifies the "buddy" assigned to the PR author.
4. Sends a formatted notification to the configured Discord Webhook.

## Configuration

This application is stateless. All dynamic configuration (team members, repo secrets, Discord URLs) is stored in AWS Secrets Manager. The application reads this secret at runtime.

### Secret Location
* **Service:** AWS Secrets Manager
* **Secret ID:** `buddy-bot/team-config`

### JSON Schema
To update the configuration, you must construct a JSON object matching this structure:

```json
{
  "teams": [
    {
      "name": "Backend Team",
      "discord_webhook_url": "[https://discord.com/api/webhooks/YOUR_WEBHOOK_URL](https://discord.com/api/webhooks/YOUR_WEBHOOK_URL)",
      "repositories": [
        {
          "name": "api-service",
          "github_secret": "your-webhook-secret-defined-in-github-settings"
        }
      ],
      "buddies": {
        "github_user_a": "github_user_b",
        "github_user_b": "github_user_a"
      },
      "username_mappings": {
        "github_user_a": "discord_user_id_12345",
        "github_user_b": "discord_handle"
      }
    }
  ]
}
```

## Configuration Fields
`discord_webhook_url`: The URL provided by Discord (Server Settings -> Integrations -> Webhooks).

`github_secret`: The arbitrary secret string you entered when creating the Webhook in the GitHub repository settings.

`buddies`: A Key-Value map where the Key is the PR Author (GitHub Username) and the Value is the Assigned Reviewer (GitHub Username).

`username_mappings`: Maps GitHub usernames to Discord identifiers. Using a numeric Discord User ID (e.g., "123456789") is recommended to ensure the user receives a push notification.

## Updating the Configuration
You do not need to redeploy the Lambda code to change buddy pairings. You only need to update the secret value in AWS.

Create a local file named config.json with the schema defined above.

Run the following AWS CLI command:

```bash
aws secretsmanager put-secret-value \
    --secret-id buddy-bot/team-config \
    --secret-string file://config.json
```

Verify the update:

```bash
aws secretsmanager get-secret-value --secret-id buddy-bot/team-config
```
To beautify with jq
```bash
aws secretsmanager get-secret-value --secret-id buddy-bot/team-config \
| jq -r '.SecretString | fromjson'
```

## Environment Variables
The Lambda function relies on the following environment variable to locate the configuration:
`TEAM_CONFIG_SECRET_ARN: The full ARN of the buddy-bot/team-config secret.`

## Local Development
To run this script locally or in a test environment, you must have valid AWS credentials configured that allow reading from Secrets Manager.
Running locally: Ensure you export the `TEAM_CONFIG_SECRET_ARN` variable in your terminal before executing the script.