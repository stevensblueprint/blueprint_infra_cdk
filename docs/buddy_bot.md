# Buddy Bot

## Overview

Buddy Bot is a GitHub PR reminder system that sends Discord notifications for unreviewed pull requests. It consists of two main components:

1. **Webhook Handler** (`BuddyHandler`) — a Lambda Function URL that receives GitHub webhook events and manages EventBridge schedules to send delayed reminders.
2. **Config API** (`BuddyBotConfigApi`) — a Cognito-authenticated REST API Gateway that allows programmatic management of the `buddy-bot/team-config` secret in AWS Secrets Manager.

## Architecture

```
GitHub Webhook ──► BuddyHandler (Lambda Function URL)
                        │
                        ├── reads TeamConfigSecret (Secrets Manager)
                        └── creates/manages EventBridge Schedules
                                    │
                                    └── PullRequestReminderCron (Lambda)
                                                │
                                                └── sends Discord notification

Cognito User ──► [JWT] ──► BuddyBotConfigApi (API Gateway)
                                    │
                                    └── BuddyBotConfigHandler (Lambda)
                                                │
                                                └── reads/writes TeamConfigSecret
```

## Authentication

The Config API requires a valid Cognito JWT token in the `Authorization` header of every request.

```bash
# Obtain a JWT from Cognito
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=<email>,PASSWORD=<password> \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# Use in API calls
curl -H "Authorization: $TOKEN" <ConfigApiUrl>/config
```

## Data Model

The `buddy-bot/team-config` secret stores a JSON object with the following schema:

```json
{
  "settings": {
    "reminder_threshold_days": 1
  },
  "teams": [
    {
      "name": "team-alpha",
      "discord_webhook_url": "https://discord.com/api/webhooks/...",
      "repositories": [
        { "name": "org/repo-one", "github_secret": "ghp_token_for_repo_one" },
        { "name": "org/repo-two", "github_secret": "ghp_token_for_repo_two" }
      ],
      "team_leads": ["github-user-a"],
      "buddies": {
        "github-user-a": "github-user-b",
        "github-user-c": "github-user-d"
      },
      "username_mappings": {
        "github-user-a": "discord-user-a",
        "github-user-b": "discord-user-b"
      }
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `settings.reminder_threshold_days` | number | Days after PR creation before sending a reminder |
| `teams[].name` | string | Unique team identifier |
| `teams[].discord_webhook_url` | string | Discord webhook URL for this team's notifications |
| `teams[].repositories` | object[] | Repos to monitor; each has `name` (`org/repo`) and `github_secret` (PAT with `repo:read`) |
| `teams[].team_leads` | string[] | GitHub usernames of team leads |
| `teams[].buddies` | object | Map of GitHub username → their assigned reviewer's GitHub username |
| `teams[].username_mappings` | object | Map of GitHub username → Discord username for mentions |

## API Endpoints

Base URL: `<BuddyBotConfigApiUrl>` (output from CDK deploy as `BuddyBotConfigApiUrl`)

All requests require `Authorization: <CognitoJWT>` header.

---

### Full Config

#### `GET /config`
Returns the full configuration object.

**Response:**
```json
{
  "settings": { ... },
  "teams": [ ... ]
}
```

#### `PUT /config`
Replaces the entire configuration. Body must include a `teams` key.

**Request:**
```json
{
  "settings": { "reminder_threshold_hours": 24 },
  "teams": []
}
```

---

### Settings

#### `GET /config/settings`
Returns the global settings object.

**Response:**
```json
{ "settings": { "reminder_threshold_hours": 24 } }
```

#### `PUT /config/settings`
Replaces the global settings object.

**Request:**
```json
{ "reminder_threshold_hours": 48 }
```

---

### Teams

#### `GET /config/teams`
Lists all teams.

**Response:**
```json
{ "teams": [ { "name": "team-alpha", ... } ] }
```

#### `POST /config/teams`
Creates a new team. The `name` field is required and must be unique.

**Request:**
```json
{
  "name": "team-alpha",
  "discord_webhook_url": "https://discord.com/api/webhooks/...",
  "repositories": [],
  "buddies": [],
  "username_mappings": {}
}
```

**Response:** `201 Created` with the created team object.

---

#### `GET /config/teams/{teamName}`
Returns a single team.

#### `PUT /config/teams/{teamName}`
Replaces a team's full configuration. The team must already exist.

**Request:** Full team object (same shape as POST).

#### `DELETE /config/teams/{teamName}`
Deletes a team.

**Response:**
```json
{ "deleted": "team-alpha" }
```

---

### Repositories

#### `GET /config/teams/{teamName}/repositories`
Lists all repositories for a team.

**Response:**
```json
{
  "repositories": [
    { "name": "org/repo-one", "github_secret": "ghp_..." },
    { "name": "org/repo-two", "github_secret": "ghp_..." }
  ]
}
```

#### `POST /config/teams/{teamName}/repositories`
Adds a repository to a team.

**Request:**
```json
{ "name": "org/new-repo", "github_secret": "ghp_..." }
```

**Response:** `201 Created`
```json
{
  "repositories": [
    { "name": "org/repo-one", "github_secret": "ghp_..." },
    { "name": "org/new-repo", "github_secret": "ghp_..." }
  ]
}
```

#### `DELETE /config/teams/{teamName}/repositories/{repoName}`
Removes a repository from a team. The `repoName` path parameter should be URL-encoded (e.g., `org%2Frepo-one`).

**Response:**
```json
{ "deleted": "org/repo-one" }
```

---

### Buddies

#### `PUT /config/teams/{teamName}/buddies`
Replaces all buddy assignments for a team. Each key is assigned to review the value's PRs, and vice versa.

**Request:**
```json
{
  "buddies": {
    "github-user-a": "github-user-b",
    "github-user-c": "github-user-d"
  }
}
```

---

### Username Mappings

#### `PUT /config/teams/{teamName}/username-mappings`
Replaces all GitHub-to-Discord username mappings for a team.

**Request:**
```json
{
  "username_mappings": {
    "github-user-a": "discord-user-a",
    "github-user-b": "discord-user-b"
  }
}
```

---

## Setup Instructions

After deploying the stack (`npx cdk deploy blueprint-github-stack`), follow these steps to configure Buddy Bot:

### 1. Get the API URL

```bash
aws cloudformation describe-stacks \
  --stack-name blueprint-github-stack \
  --query "Stacks[0].Outputs[?OutputKey=='BuddyBotConfigApiUrl'].OutputValue" \
  --output text
```

### 2. Obtain a Cognito JWT

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=<email>,PASSWORD=<password> \
  --query 'AuthenticationResult.IdToken' \
  --output text)
```

### 3. Set your GitHub token

The `buddy-bot/github-token` secret must be populated manually:

```bash
aws secretsmanager put-secret-value \
  --secret-id buddy-bot/github-token \
  --secret-string "ghp_your_token_here"
```

### 4. Create your first team

```bash
API_URL="<BuddyBotConfigApiUrl>"

curl -X POST "$API_URL/config/teams" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-team",
    "discord_webhook_url": "https://discord.com/api/webhooks/...",
    "repositories": [{"name": "my-org/my-repo", "github_secret": "ghp_..."}],
    "team_leads": ["alice"],
    "buddies": {"alice": "bob", "charlie": "dave"},
    "username_mappings": {"alice": "alice_discord", "bob": "bob_discord"}
  }'
```

### 5. Configure the GitHub Webhook

In your GitHub repository settings, add a webhook:
- **Payload URL:** The `PRReminderFunctionUrl` output from the CDK deploy
- **Content type:** `application/json`
- **Events:** Pull requests

## Security Notes

- The Config API requires a valid Cognito JWT — unauthenticated requests are rejected at the API Gateway level.
- The `BuddyBotConfigHandler` Lambda has least-privilege IAM: it can only `GetSecretValue` and `PutSecretValue` on the `buddy-bot/team-config` secret.
- The `BuddyHandler` Function URL has no auth (`NONE`) since it receives GitHub webhook POSTs. Consider validating the `X-Hub-Signature-256` header in the handler for additional security.
- CORS is set to `*` (all origins). Restrict `allowOrigins` in the construct if you want to limit API access to specific domains.
